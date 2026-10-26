<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type { PageData } from './$types.js';
	import {
		Play,
		Pause,
		RotateCcw,
		RotateCw,
		Download,
		Copy,
		Save,
		Upload,
		Search,
		FileText,
		Check,
		AlertCircle,
		Trash2,
		Plus,
		Clock,
		Music,
		Mic,
		ArrowLeft,
		ExternalLink,
		ChevronUp,
		ChevronDown,
		Sparkles,
		Eye,
		Edit3,
		Volume2,
		Volume1,
		VolumeX,
		FolderCheck,
		LocateFixed,
		CheckSquare,
		Square,
		Sliders
	} from '@lucide/svelte';
	import { player } from '$lib/services/player.svelte.js';
	import LrcLibModal from '$lib/components/LrcLibModal.svelte';
	import type { LrcLibCandidate, LyricsStatus } from '$lib/types/index.js';

	let { data }: { data: PageData } = $props();

	interface LyricLine {
		id: string;
		time: number | null; // Seconds, e.g. 14.25
		text: string;
	}

	// Audio Player State
	let audioEl: HTMLAudioElement | null = $state(null);
	let isPlaying = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	let playbackRate = $state(1.0);
	let volume = $state(0.7);
	let isMuted = $state(false);
	let previousVolume = $state(0.7);
	let audioSrc = $state<string>('');
	let audioFileName = $state<string>('');
	let isUsingServerAudio = $state(false);

	// Editor & Sync State
	type EditorMode = 'text' | 'sync' | 'preview';
	let currentMode = $state<EditorMode>('sync');
	let rawLyricsText = $state('');
	let lyricLines = $state<LyricLine[]>([]);
	let activeLineIndex = $state(0);
	let autoFollowEnabled = $state(true);
	let companionFilePath = $state<string | null>(data.companionPath || null);
	let isReloadingFromDisk = $state(false);

	// Instrumental State
	let isInstrumental = $state(false);
	let instrumentalFormat = $state<'note' | 'tag'>('note');
	let showInstrumentalMenu = $state(false);

	// Multi-Line Selection State for Batch Shifting
	let selectedLineIndices = $state<number[]>([]);
	let lastClickedIndex = $state<number | null>(null);
	let customShiftAmount = $state<string>('1.0');

	// Track Info State (can be edited if standalone)
	let trackTitle = $state(data.track?.title || '');
	let trackArtist = $state(data.track?.artist || data.track?.album_artist || '');
	let albumTitle = $state(data.track?.album_title || '');

	// LRCLIB & Status State
	let showLrcLibModal = $state(false);

	let saveStatus = $state<{
		type: 'success' | 'error' | 'info';
		message: string;
	} | null>(null);
	let isSaving = $state(false);
	let copiedNotification = $state(false);

	// Reference to lines scroll container
	let linesContainerEl: HTMLDivElement | null = $state(null);

	// Helpers: Format Seconds to mm:ss.xx
	function formatTime(seconds: number): string {
		if (isNaN(seconds) || seconds < 0) return '00:00.00';
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		const ms = Math.floor((seconds % 1) * 100);
		return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
	}

	// Helpers: Format mm:ss without hundredths
	function formatDurationShort(seconds: number): string {
		if (isNaN(seconds) || seconds < 0) return '0:00';
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	// Helpers: Parse [mm:ss.xx] or [mm:ss] timestamp to seconds
	function parseTimestamp(timestamp: string): number | null {
		const match = timestamp.match(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/);
		if (!match) return null;
		const m = parseInt(match[1], 10);
		const s = parseInt(match[2], 10);
		const msStr = match[3] || '0';
		const ms = parseFloat(`0.${msStr}`);
		return m * 60 + s + ms;
	}

	// Parse LRC or Plain string into LyricLine array
	function parseLyrics(content: string): LyricLine[] {
		const lines = content.split('\n');
		const result: LyricLine[] = [];

		for (const rawLine of lines) {
			const line = rawLine.trim();
			if (!line) continue;

			// Skip metadata tags like [ti:], [ar:], [al:]
			if (/^\[(ti|ar|al|length|by|offset|re|ve):/i.test(line)) {
				continue;
			}

			// Extract all timestamps [mm:ss.xx]
			const timestampRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
			let match: RegExpExecArray | null;
			const times: number[] = [];
			let lastIndex = 0;

			while ((match = timestampRegex.exec(line)) !== null) {
				const time = parseTimestamp(match[0]);
				if (time !== null) {
					times.push(time);
				}
				lastIndex = timestampRegex.lastIndex;
			}

			if (times.length > 0) {
				const lyricText = line.slice(lastIndex).trim();
				for (const t of times) {
					result.push({
						id: Math.random().toString(36).slice(2, 9),
						time: t,
						text: lyricText
					});
				}
			} else {
				result.push({
					id: Math.random().toString(36).slice(2, 9),
					time: null,
					text: line
				});
			}
		}

		// Sort timed lyrics chronologically
		result.sort((a, b) => {
			if (a.time === null && b.time === null) return 0;
			if (a.time === null) return 1;
			if (b.time === null) return -1;
			return a.time - b.time;
		});

		return result.length > 0
			? result
			: [
					{ id: '1', time: null, text: 'First line of lyrics' },
					{ id: '2', time: null, text: 'Second line of lyrics' }
			  ];
	}

	// Generate standard .lrc file text with metadata
	function generateLrcContent(): string {
		const header: string[] = [];
		if (trackTitle) header.push(`[ti:${trackTitle}]`);
		if (trackArtist) header.push(`[ar:${trackArtist}]`);
		if (albumTitle) header.push(`[al:${albumTitle}]`);
		if (duration > 0) header.push(`[length:${formatDurationShort(duration)}]`);
		if (isInstrumental) header.push('[au:Instrumental]');
		header.push('[by:Trax Vault]');
		header.push('');

		if (isInstrumental) {
			const marker = instrumentalFormat === 'note' ? '♪' : '[instrumental]';
			return [...header, `[00:00.00]${marker}`].join('\n');
		}

		const body = lyricLines.map((l) => {
			if (l.time !== null) {
				return `[${formatTime(l.time)}] ${l.text}`;
			}
			return l.text;
		});

		return [...header, ...body].join('\n');
	}

	// Initial Setup on Mount
	onMount(() => {
		// Restore saved volume preference
		try {
			const saved =
				localStorage.getItem('traxvault_lrc_volume') ||
				localStorage.getItem('traxvault_player_volume') ||
				localStorage.getItem('trackvault_player_volume');
			if (saved !== null) {
				const parsed = parseFloat(saved);
				if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
					volume = parsed;
					previousVolume = parsed > 0 ? parsed : 0.7;
				}
			}
			const savedMuted = localStorage.getItem('traxvault_lrc_muted');
			if (savedMuted === 'true') {
				isMuted = true;
			}
		} catch {}

		// 1. If server has audio, default to server stream
		if (data.track && data.hasServerAudio) {
			audioSrc = `/api/tracks/${data.track.id}/audio`;
			isUsingServerAudio = true;
			audioFileName = data.track.bitrate_kbps
				? `Server Audio (${data.track.format} • ${data.track.bitrate_kbps.toLocaleString()} kbps)`
				: `Server Audio (${data.track.format})`;
		}

		// 2. Load existing lyrics from track or database
		if (data.existingLyrics && data.existingLyrics.trim()) {
			rawLyricsText = data.existingLyrics;
			lyricLines = parseLyrics(data.existingLyrics);
			if (
				data.track?.lyrics === 'instrumental' ||
				/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*(♪|♫|\[instrumental\]|\(instrumental\)|instrumental)/i.test(data.existingLyrics) ||
				/\[au:\s*instrumental\]/i.test(data.existingLyrics)
			) {
				isInstrumental = true;
				instrumentalFormat = data.existingLyrics.includes('[instrumental]') ? 'tag' : 'note';
			}
		} else if (data.track?.lyrics === 'instrumental') {
			isInstrumental = true;
			rawLyricsText = '[00:00.00]♪';
			lyricLines = [{ id: 'inst-1', time: 0, text: '♪' }];
		} else {
			rawLyricsText = '';
			lyricLines = [
				{ id: '1', time: null, text: 'Click "Fetch from LRCLIB" or paste your lyrics in Edit Text mode' },
				{ id: '2', time: null, text: 'Press Space to play and tag timestamps line by line' }
			];
		}
	});

	// Instrumental Actions
	function setAsInstrumental(format: 'note' | 'tag' = 'note') {
		isInstrumental = true;
		instrumentalFormat = format;
		const marker = format === 'note' ? '♪' : '[instrumental]';
		lyricLines = [{ id: 'inst-1', time: 0, text: marker }];
		activeLineIndex = 0;
		selectedLineIndices = [];
		showInstrumentalMenu = false;
		rawLyricsText = generateLrcContent();
		saveStatus = {
			type: 'info',
			message: `Marked as Instrumental track (${marker}). Click "Save to Trax Vault" to write companion file.`
		};
	}

	function revertFromInstrumental() {
		isInstrumental = false;
		showInstrumentalMenu = false;
		if (lyricLines.length === 1 && (lyricLines[0].text === '♪' || lyricLines[0].text === '[instrumental]')) {
			lyricLines = [
				{ id: '1', time: null, text: 'First line of lyrics' },
				{ id: '2', time: null, text: 'Second line of lyrics' }
			];
			rawLyricsText = '';
		}
		saveStatus = {
			type: 'info',
			message: 'Reverted to standard vocal lyrics mode.'
		};
	}

	// Multi-Line Selection and Batch Shift Actions
	function toggleLineSelection(index: number, event?: MouseEvent) {
		if (event && event.shiftKey && lastClickedIndex !== null) {
			const start = Math.min(lastClickedIndex, index);
			const end = Math.max(lastClickedIndex, index);
			const rangeIndices: number[] = [];
			for (let i = start; i <= end; i++) {
				rangeIndices.push(i);
			}
			const set = new Set([...selectedLineIndices, ...rangeIndices]);
			selectedLineIndices = Array.from(set).sort((a, b) => a - b);
		} else {
			if (selectedLineIndices.includes(index)) {
				selectedLineIndices = selectedLineIndices.filter((i) => i !== index);
			} else {
				selectedLineIndices = [...selectedLineIndices, index].sort((a, b) => a - b);
			}
			lastClickedIndex = index;
		}
	}

	function selectAllLines() {
		selectedLineIndices = lyricLines.map((_, i) => i);
	}

	function clearSelection() {
		selectedLineIndices = [];
		lastClickedIndex = null;
	}

	function shiftSelectedLines(deltaSeconds: number) {
		if (selectedLineIndices.length === 0) return;
		let shiftedCount = 0;
		for (const idx of selectedLineIndices) {
			const line = lyricLines[idx];
			if (line && line.time !== null) {
				line.time = Math.max(0, Math.round((line.time + deltaSeconds) * 100) / 100);
				shiftedCount++;
			}
		}
		saveStatus = {
			type: 'success',
			message: `Shifted timestamps for ${shiftedCount} line(s) by ${deltaSeconds > 0 ? '+' : ''}${deltaSeconds}s`
		};
	}

	function applyCustomShift() {
		const val = parseFloat(customShiftAmount);
		if (isNaN(val) || val === 0) return;
		shiftSelectedLines(val);
	}

	function removeSelectedTimestamps() {
		if (selectedLineIndices.length === 0) return;
		for (const idx of selectedLineIndices) {
			const line = lyricLines[idx];
			if (line) {
				line.time = null;
			}
		}
		saveStatus = {
			type: 'info',
			message: `Cleared timestamps for ${selectedLineIndices.length} line(s)`
		};
	}

	// Audio Player Controls
	function togglePlay() {
		if (!audioEl) return;
		if (isPlaying) {
			audioEl.pause();
		} else {
			audioEl.play().catch((err) => {
				console.warn('Playback error:', err);
			});
		}
	}

	function seekBackward(seconds = 3) {
		if (!audioEl) return;
		audioEl.currentTime = Math.max(0, audioEl.currentTime - seconds);
	}

	function seekForward(seconds = 3) {
		if (!audioEl) return;
		audioEl.currentTime = Math.min(duration, audioEl.currentTime + seconds);
	}

	function seekTo(time: number) {
		if (!audioEl) return;
		audioEl.currentTime = Math.max(0, Math.min(duration, time));
	}

	function setSpeed(speed: number) {
		playbackRate = speed;
		if (audioEl) audioEl.playbackRate = speed;
	}

	function setVolume(val: number) {
		volume = Math.max(0, Math.min(1, val));
		if (volume > 0) {
			isMuted = false;
		}
		if (audioEl) {
			audioEl.volume = isMuted ? 0 : volume;
			audioEl.muted = isMuted;
		}
		try {
			localStorage.setItem('traxvault_lrc_volume', volume.toString());
			localStorage.setItem('traxvault_player_volume', volume.toString());
			localStorage.setItem('traxvault_lrc_muted', isMuted ? 'true' : 'false');
		} catch {}
	}

	function toggleMute() {
		if (isMuted) {
			isMuted = false;
			if (volume === 0) {
				volume = previousVolume || 0.7;
			}
		} else {
			previousVolume = volume > 0 ? volume : 0.7;
			isMuted = true;
		}
		if (audioEl) {
			audioEl.volume = isMuted ? 0 : volume;
			audioEl.muted = isMuted;
		}
		try {
			localStorage.setItem('traxvault_lrc_muted', isMuted ? 'true' : 'false');
		} catch {}
	}

	// Local Audio File Upload
	function handleLocalAudioUpload(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files && target.files[0]) {
			const file = target.files[0];
			if (audioSrc && !isUsingServerAudio) {
				URL.revokeObjectURL(audioSrc);
			}
			audioSrc = URL.createObjectURL(file);
			audioFileName = file.name;
			isUsingServerAudio = false;
			if (!trackTitle) {
				const baseName = file.name.replace(/\.[^/.]+$/, '');
				trackTitle = baseName;
			}
		}
	}

	// Sync Engine: Stamp current line
	function stampCurrentLine() {
		if (!audioEl) return;

		// If audio paused, start playback
		if (!isPlaying) {
			audioEl.play().catch(() => {});
		}

		if (activeLineIndex < lyricLines.length) {
			const line = lyricLines[activeLineIndex];
			line.time = Math.round(audioEl.currentTime * 100) / 100;

			// Advance to next line
			if (activeLineIndex < lyricLines.length - 1) {
				activeLineIndex++;
				scrollToActiveLine();
			}
		}
	}

	// Sync Engine: Step back
	function stepBackLine() {
		if (activeLineIndex > 0) {
			activeLineIndex--;
			const line = lyricLines[activeLineIndex];
			// Jump audio to slightly before this line if tagged
			if (line.time !== null && audioEl) {
				audioEl.currentTime = Math.max(0, line.time - 0.5);
			}
			scrollToActiveLine();
		}
	}

	// Fine-tuning adjustment (+/- seconds)
	function adjustLineTime(index: number, delta: number) {
		const line = lyricLines[index];
		if (line.time !== null) {
			line.time = Math.max(0, Math.round((line.time + delta) * 100) / 100);
		} else if (audioEl) {
			line.time = Math.max(0, Math.round((audioEl.currentTime + delta) * 100) / 100);
		}
	}

	function removeTimestamp(index: number) {
		lyricLines[index].time = null;
	}

	function selectLine(index: number) {
		activeLineIndex = index;
		const line = lyricLines[index];
		if (line.time !== null && audioEl) {
			audioEl.currentTime = line.time;
		}
	}

	function scrollToActiveLine() {
		tick().then(() => {
			const el = document.getElementById(`line-${activeLineIndex}`);
			if (el && linesContainerEl) {
				el.scrollIntoView({ behavior: 'smooth', block: 'center' });
			}
		});
	}

	// Current Active Singing/Playback Line derived from audio currentTime
	let currentPlaybackLineIndex = $derived.by(() => {
		let idx = -1;
		for (let i = 0; i < lyricLines.length; i++) {
			const line = lyricLines[i];
			if (line.time !== null && line.time <= currentTime) {
				idx = i;
			}
		}
		return idx;
	});

	// Auto-scroll to center on the currently playing line
	$effect(() => {
		if (isPlaying && autoFollowEnabled && currentPlaybackLineIndex >= 0 && currentMode === 'sync') {
			const targetEl = document.getElementById(`line-${currentPlaybackLineIndex}`);
			if (targetEl && linesContainerEl) {
				targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
			}
		}
	});

	// Keep audio element volume in sync
	$effect(() => {
		if (audioEl) {
			audioEl.volume = isMuted ? 0 : volume;
			audioEl.muted = isMuted;
		}
	});

	// Reload lyrics from companion file on disk or database
	async function reloadFromDisk() {
		if (!data.track) return;
		isReloadingFromDisk = true;
		try {
			const res = await fetch(`/api/tracks/${data.track.id}/lyrics`);
			const json = await res.json();
			if (json.success && json.lyrics_text) {
				rawLyricsText = json.lyrics_text;
				lyricLines = parseLyrics(json.lyrics_text);
				if (json.companion_path) {
					companionFilePath = json.companion_path;
				}
				saveStatus = {
					type: 'success',
					message: `Reloaded lyrics from folder (${json.source === 'file' ? 'Companion File' : 'Database'})`
				};
			} else {
				saveStatus = {
					type: 'info',
					message: 'No lyrics found on disk or database for this track'
				};
			}
		} catch (err: any) {
			saveStatus = { type: 'error', message: `Failed to reload lyrics: ${err.message}` };
		} finally {
			isReloadingFromDisk = false;
		}
	}

	// Global Keyboard Hotkeys
	function handleKeyDown(e: KeyboardEvent) {
		// Ignore hotkeys when typing in input, textarea, or contentEditable
		const target = e.target as HTMLElement;
		if (
			target.tagName === 'INPUT' ||
			target.tagName === 'TEXTAREA' ||
			target.isContentEditable
		) {
			return;
		}

		if (e.code === 'Space') {
			e.preventDefault();
			if (currentMode === 'sync') {
				stampCurrentLine();
			} else {
				togglePlay();
			}
		} else if (e.code === 'Enter') {
			e.preventDefault();
			if (currentMode === 'sync') {
				stampCurrentLine();
			}
		} else if (e.code === 'ArrowUp') {
			e.preventDefault();
			stepBackLine();
		} else if (e.code === 'ArrowDown') {
			e.preventDefault();
			if (activeLineIndex < lyricLines.length - 1) {
				activeLineIndex++;
				scrollToActiveLine();
			}
		} else if (e.code === 'ArrowLeft') {
			e.preventDefault();
			seekBackward(3);
		} else if (e.code === 'ArrowRight') {
			e.preventDefault();
			seekForward(3);
		} else if (e.code === 'KeyM') {
			e.preventDefault();
			toggleMute();
		}
	}

	// LRCLIB Selection Handler
	function handleLrcLibSelect(result: {
		text: string;
		status: LyricsStatus;
		candidate: LrcLibCandidate;
	}) {
		if (result.status === 'instrumental') {
			setAsInstrumental('note');
		} else {
			rawLyricsText = result.text;
			lyricLines = parseLyrics(result.text);
			activeLineIndex = 0;
		}
		showLrcLibModal = false;
		saveStatus = {
			type: 'success',
			message: `Loaded ${result.status === 'synced_lrc' ? 'synced .lrc' : result.status === 'instrumental' ? 'instrumental' : 'plain'} lyrics for "${result.candidate.trackName}" from LRCLIB!`
		};
	}

	// Switch from Text Mode to Sync Mode
	function applyRawText() {
		lyricLines = parseLyrics(rawLyricsText);
		activeLineIndex = 0;
		currentMode = 'sync';
	}

	// Save to Trax Vault
	async function saveToTraxVault() {
		if (!data.track) {
			saveStatus = {
				type: 'info',
				message: 'No Trax Vault track associated. Use "Download .lrc" or "Copy LRC" instead.'
			};
			return;
		}

		isSaving = true;
		saveStatus = null;

		try {
			const content = generateLrcContent();
			const res = await fetch(`/api/tracks/${data.track.id}/lyrics`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					lyrics_text: content,
					status: isInstrumental ? 'instrumental' : 'synced_lrc',
					save_to_disk: true,
					overwrite: true
				})
			});

			const json = await res.json();
			if (json.success) {
				if (json.companion_path) {
					companionFilePath = json.companion_path;
				}
				if (json.saved_to_disk) {
					saveStatus = {
						type: 'success',
						message: isInstrumental
							? 'Saved as Instrumental track to database & companion .lrc file written to disk!'
							: 'Saved to Trax Vault database and companion .lrc file written to server!'
					};
				} else if (json.disk_error) {
					saveStatus = {
						type: 'info',
						message: `Saved to Trax Vault database! (${json.disk_error})`
					};
				} else {
					saveStatus = {
						type: 'success',
						message: isInstrumental
							? 'Saved to Trax Vault database! Lyrics status updated to Instrumental.'
							: 'Saved to Trax Vault database! Lyrics status updated to Synced LRC.'
					};
				}
			} else {
				saveStatus = { type: 'error', message: json.error || 'Failed to save lyrics' };
			}
		} catch (err: any) {
			saveStatus = { type: 'error', message: err.message || 'Network error saving lyrics' };
		} finally {
			isSaving = false;
		}
	}

	// Download .lrc file
	function downloadLrcFile() {
		const content = generateLrcContent();
		const filename = `${trackArtist ? trackArtist + ' - ' : ''}${trackTitle || 'lyrics'}.lrc`.replace(
			/[/\\?%*:|"<>]/g,
			'-'
		);

		const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	// Copy to Clipboard
	async function copyLrcToClipboard() {
		const content = generateLrcContent();
		try {
			await navigator.clipboard.writeText(content);
			copiedNotification = true;
			setTimeout(() => {
				copiedNotification = false;
			}, 2500);
		} catch (err) {
			console.error('Failed to copy:', err);
		}
	}
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col pb-16">
	<!-- Hidden HTML5 Audio Element -->
	{#if audioSrc}
		<audio
			bind:this={audioEl}
			src={audioSrc}
			bind:currentTime
			bind:duration
			onloadedmetadata={() => {
				if (audioEl) {
					audioEl.volume = isMuted ? 0 : volume;
					audioEl.muted = isMuted;
				}
			}}
			onplay={() => {
				isPlaying = true;
				if (player.isPlaying) {
					player.pause();
				}
			}}
			onpause={() => (isPlaying = false)}
			onended={() => (isPlaying = false)}
			preload="auto"
		></audio>
	{/if}

	<!-- Top Navigation / Header -->
	<header class="border-b border-neutral-800 bg-neutral-900/60 backdrop-blur sticky top-0 z-30 px-4 py-3">
		<div class="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
			<div class="flex items-center gap-3">
				{#if data.track}
					<a
						href="/album/{data.track.album_id}"
						class="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition px-2 py-1 rounded bg-neutral-800/60"
					>
						<ArrowLeft class="w-3.5 h-3.5" />
						Back to Album
					</a>
				{:else}
					<a
						href="/"
						class="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition px-2 py-1 rounded bg-neutral-800/60"
					>
						<ArrowLeft class="w-3.5 h-3.5" />
						Vault
					</a>
				{/if}

				<div class="flex items-center gap-2">
					<div class="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
						<Mic class="w-4 h-4" />
					</div>
					<div>
						<h1 class="text-sm font-bold text-white flex items-center gap-2">
							LRC Maker
							<span class="text-[10px] font-normal uppercase tracking-wider px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 border border-neutral-700">
								Studio
							</span>
						</h1>
					</div>
				</div>
			</div>

			<!-- Quick Actions: LRCLIB & Save -->
			<div class="flex items-center gap-2">
				<!-- Instrumental Mode Toggle & Options -->
				<div class="relative">
					{#if isInstrumental}
						<button
							type="button"
							onclick={() => (showInstrumentalMenu = !showInstrumentalMenu)}
							class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600/25 border border-purple-500/40 text-purple-300 hover:bg-purple-600/35 transition text-xs font-semibold cursor-pointer shadow-sm shadow-purple-950/40"
							title="Instrumental track mode active"
						>
							<span class="text-sm leading-none font-serif">♪</span>
							<span>Instrumental: {instrumentalFormat === 'note' ? '♪' : 'tag'}</span>
							<ChevronDown class="w-3 h-3 text-purple-400" />
						</button>
					{:else}
						<button
							type="button"
							onclick={() => (showInstrumentalMenu = !showInstrumentalMenu)}
							class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 transition text-xs font-medium cursor-pointer"
							title="Mark track as instrumental (generates [00:00.00]♪ or [00:00.00][instrumental])"
						>
							<span class="text-sm leading-none font-serif">♪</span>
							<span>Instrumental</span>
							<ChevronDown class="w-3 h-3 text-neutral-400" />
						</button>
					{/if}

					{#if showInstrumentalMenu}
						<div
							class="absolute right-0 mt-1.5 w-60 rounded-xl bg-neutral-900 border border-neutral-700 shadow-2xl p-2 z-50 space-y-1 animate-in fade-in duration-150"
						>
							<div class="px-2 py-1 text-[11px] font-semibold text-neutral-400 uppercase tracking-wider border-b border-neutral-800">
								Instrumental Marker Format
							</div>
							<button
								type="button"
								onclick={() => setAsInstrumental('note')}
								class="w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-neutral-800 flex items-center justify-between transition cursor-pointer {instrumentalFormat === 'note' && isInstrumental ? 'bg-purple-950/60 text-purple-300 font-semibold' : 'text-neutral-300'}"
							>
								<span>♪ Musical Note ([00:00.00]♪)</span>
								{#if instrumentalFormat === 'note' && isInstrumental}
									<Check class="w-3.5 h-3.5 text-purple-400" />
								{/if}
							</button>
							<button
								type="button"
								onclick={() => setAsInstrumental('tag')}
								class="w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-neutral-800 flex items-center justify-between transition cursor-pointer {instrumentalFormat === 'tag' && isInstrumental ? 'bg-purple-950/60 text-purple-300 font-semibold' : 'text-neutral-300'}"
							>
								<span>Tag ([00:00.00][instrumental])</span>
								{#if instrumentalFormat === 'tag' && isInstrumental}
									<Check class="w-3.5 h-3.5 text-purple-400" />
								{/if}
							</button>
							{#if isInstrumental}
								<div class="border-t border-neutral-800 pt-1 mt-1">
									<button
										type="button"
										onclick={revertFromInstrumental}
										class="w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-rose-950/40 text-rose-300 transition cursor-pointer"
									>
										Revert to vocal lyrics
									</button>
								</div>
							{/if}
						</div>
					{/if}
				</div>

				<button
					type="button"
					onclick={() => (showLrcLibModal = true)}
					class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30 transition text-xs font-medium cursor-pointer"
					title="Search and select lyrics candidates from LRCLIB"
				>
					<Sparkles class="w-3.5 h-3.5 text-indigo-400" />
					<span>Fetch from LRCLIB</span>
				</button>

				{#if data.track}
					<button
						type="button"
						onclick={saveToTraxVault}
						disabled={isSaving}
						class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition text-xs font-semibold shadow-lg shadow-emerald-950/40 cursor-pointer disabled:opacity-50"
					>
						<Save class="w-3.5 h-3.5" />
						{isSaving ? 'Saving...' : 'Save to Trax Vault'}
					</button>
				{/if}

				<button
					type="button"
					onclick={downloadLrcFile}
					class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-200 transition text-xs font-medium cursor-pointer"
					title="Download .lrc file"
				>
					<Download class="w-3.5 h-3.5 text-neutral-400" />
					Download .lrc
				</button>

				<button
					type="button"
					onclick={copyLrcToClipboard}
					class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-200 transition text-xs font-medium cursor-pointer"
					title="Copy LRC text to clipboard"
				>
					{#if copiedNotification}
						<Check class="w-3.5 h-3.5 text-emerald-400" />
						<span class="text-emerald-400 text-xs">Copied!</span>
					{:else}
						<Copy class="w-3.5 h-3.5 text-neutral-400" />
					{/if}
				</button>
			</div>
		</div>
	</header>

	<!-- Main Studio Container -->
	<main class="max-w-6xl mx-auto w-full px-4 pt-4 flex-1 flex flex-col gap-4">
		<!-- Notification Alert Banner -->
		{#if saveStatus}
			<div
				class="rounded-xl p-3 border text-xs flex items-center justify-between gap-3 animate-in fade-in duration-200 {saveStatus.type ===
				'success'
					? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
					: saveStatus.type === 'error'
					? 'bg-rose-950/40 border-rose-800/60 text-rose-300'
					: 'bg-neutral-900 border-neutral-700 text-neutral-300'}"
			>
				<div class="flex items-center gap-2">
					{#if saveStatus.type === 'success'}
						<Check class="w-4 h-4 text-emerald-400 shrink-0" />
					{:else if saveStatus.type === 'error'}
						<AlertCircle class="w-4 h-4 text-rose-400 shrink-0" />
					{:else}
						<AlertCircle class="w-4 h-4 text-neutral-400 shrink-0" />
					{/if}
					<span>{saveStatus.message}</span>
				</div>
				<button
					type="button"
					onclick={() => (saveStatus = null)}
					class="text-neutral-400 hover:text-white text-xs px-1.5 py-0.5"
				>
					✕
				</button>
			</div>
		{/if}

		<!-- Track & Audio Source Banner -->
		<div class="bg-neutral-900/80 rounded-xl border border-neutral-800 p-4">
			<div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
				<!-- Track Details -->
				<div class="md:col-span-2 flex items-center gap-3">
					{#if data.track?.album_cover_url}
						<img
							src={data.track.album_cover_url}
							alt={data.track.album_title}
							class="w-12 h-12 rounded-lg object-cover border border-neutral-800 shadow-md shrink-0"
						/>
					{:else}
						<div class="w-12 h-12 rounded-lg bg-neutral-800 border border-neutral-700 flex items-center justify-center shrink-0">
							<Music class="w-6 h-6 text-neutral-500" />
						</div>
					{/if}

					<div class="min-w-0 flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
						<div>
							<span class="text-[10px] text-neutral-400 block font-semibold uppercase tracking-wider">Title</span>
							<input
								type="text"
								bind:value={trackTitle}
								placeholder="Track Title"
								class="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-500"
							/>
						</div>
						<div>
							<span class="text-[10px] text-neutral-400 block font-semibold uppercase tracking-wider">Artist</span>
							<input
								type="text"
								bind:value={trackArtist}
								placeholder="Artist"
								class="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-500"
							/>
						</div>
					</div>
				</div>

				<!-- Audio File Selector -->
				<div class="flex flex-col gap-1.5 text-xs">
					<span class="text-[10px] text-neutral-400 font-semibold uppercase tracking-wider">Audio Source</span>
					<div class="flex items-center gap-2">
						{#if isUsingServerAudio}
							<div class="flex-1 truncate bg-neutral-950 border border-emerald-500/30 rounded px-2.5 py-1 text-emerald-400 flex items-center gap-1.5">
								<Volume2 class="w-3.5 h-3.5 shrink-0" />
								<span class="truncate">{audioFileName}</span>
							</div>
						{:else if audioFileName}
							<div class="flex-1 truncate bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1 text-neutral-300 flex items-center gap-1.5">
								<Music class="w-3.5 h-3.5 shrink-0 text-neutral-500" />
								<span class="truncate">{audioFileName}</span>
							</div>
						{:else}
							<div class="flex-1 truncate bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1 text-neutral-500 italic">
								No audio file loaded
							</div>
						{/if}

						<label
							class="cursor-pointer px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 text-xs shrink-0 flex items-center gap-1 font-medium transition"
						>
							<Upload class="w-3.5 h-3.5" />
							<span>Load File</span>
							<input
								type="file"
								accept="audio/*,.flac,.mp3,.wav,.ogg,.m4a"
								onchange={handleLocalAudioUpload}
								class="hidden"
							/>
						</label>
					</div>
				</div>
			</div>

			<!-- Folder Companion Lyrics File Info -->
			{#if data.track}
				<div class="mt-3 pt-3 border-t border-neutral-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
					<div class="flex items-center gap-2 min-w-0">
						<FolderCheck class="w-4 h-4 {companionFilePath ? 'text-emerald-400' : 'text-neutral-500'} shrink-0" />
						<span class="text-neutral-400 shrink-0">Song Folder File:</span>
						{#if companionFilePath}
							<code class="px-2 py-0.5 rounded bg-neutral-950 border border-neutral-800 text-emerald-300 font-mono text-[11px] truncate max-w-md" title={companionFilePath}>
								{companionFilePath}
							</code>
						{:else}
							<span class="text-neutral-500 italic text-[11px]">
								No companion .lrc found on disk (will be created in song folder on save)
							</span>
						{/if}
					</div>

					<button
						type="button"
						onclick={reloadFromDisk}
						disabled={isReloadingFromDisk}
						class="flex items-center gap-1.5 px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition text-xs font-medium cursor-pointer disabled:opacity-50 ml-auto"
						title="Reload latest lyrics from song folder"
					>
						<RotateCcw class="w-3 h-3 text-neutral-400 {isReloadingFromDisk ? 'animate-spin' : ''}" />
						<span>Reload from File</span>
					</button>
				</div>
			{/if}
		</div>

		<!-- Audio Player Toolbar -->
		<div class="bg-neutral-900 rounded-xl border border-neutral-800 p-4 shadow-xl">
			<!-- Timeline Slider -->
			<div class="flex items-center gap-3 mb-3">
				<span class="font-mono text-xs text-emerald-400 w-16 text-right tabular-nums">
					{formatTime(currentTime)}
				</span>
				<div class="flex-1 relative flex items-center">
					<input
						type="range"
						min="0"
						max={duration || 100}
						step="0.01"
						value={currentTime}
						oninput={(e) => seekTo(parseFloat(e.currentTarget.value))}
						class="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
					/>
				</div>
				<span class="font-mono text-xs text-neutral-500 w-16 tabular-nums">
					{formatTime(duration)}
				</span>
			</div>

			<!-- Player Control Buttons -->
			<div class="flex flex-wrap items-center justify-between gap-3 pt-1">
				<div class="flex items-center gap-2">
					<button
						type="button"
						onclick={() => seekBackward(3)}
						class="p-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition cursor-pointer"
						title="Rewind 3s (Left Arrow)"
					>
						<RotateCcw class="w-4 h-4" />
					</button>

					<button
						type="button"
						onclick={togglePlay}
						class="p-3 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black font-bold shadow-lg shadow-emerald-500/20 transition cursor-pointer"
						title="Play / Pause (Space)"
					>
						{#if isPlaying}
							<Pause class="w-5 h-5 fill-current" />
						{:else}
							<Play class="w-5 h-5 fill-current ml-0.5" />
						{/if}
					</button>

					<button
						type="button"
						onclick={() => seekForward(3)}
						class="p-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition cursor-pointer"
						title="Forward 3s (Right Arrow)"
					>
						<RotateCw class="w-4 h-4" />
					</button>
				</div>

				<!-- Playback Speed -->
				<div class="flex items-center gap-1 bg-neutral-950 border border-neutral-800 rounded-lg p-1 text-xs">
					<span class="text-[10px] text-neutral-500 uppercase px-1 font-semibold">Speed</span>
					{#each [0.5, 0.75, 1.0, 1.25] as spd}
						<button
							type="button"
							onclick={() => setSpeed(spd)}
							class="px-2 py-0.5 rounded text-xs transition cursor-pointer {playbackRate === spd
								? 'bg-emerald-500 text-black font-semibold'
								: 'text-neutral-400 hover:text-white'}"
						>
							{spd}x
						</button>
					{/each}
				</div>

				<!-- Volume Control -->
				<div
					class="flex items-center gap-2 bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1 text-xs"
					onwheel={(e) => {
						e.preventDefault();
						const delta = e.deltaY < 0 ? 0.05 : -0.05;
						setVolume(Math.round((volume + delta) * 100) / 100);
					}}
				>
					<button
						type="button"
						onclick={toggleMute}
						class="text-neutral-400 hover:text-white transition cursor-pointer p-0.5 rounded hover:bg-neutral-800"
						title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
					>
						{#if isMuted || volume === 0}
							<VolumeX class="w-4 h-4 text-rose-400" />
						{:else if volume < 0.5}
							<Volume1 class="w-4 h-4 text-neutral-300" />
						{:else}
							<Volume2 class="w-4 h-4 text-neutral-300" />
						{/if}
					</button>

					<input
						type="range"
						min="0"
						max="1"
						step="0.01"
						value={isMuted ? 0 : volume}
						oninput={(e) => setVolume(parseFloat(e.currentTarget.value))}
						class="w-16 sm:w-20 md:w-24 h-1.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
						title={`Volume: ${isMuted ? 0 : Math.round(volume * 100)}%`}
					/>

					<span class="font-mono text-[11px] text-neutral-400 w-8 text-right tabular-nums">
						{isMuted ? '0%' : `${Math.round(volume * 100)}%`}
					</span>
				</div>

				<!-- Mode Tabs -->
				<div class="flex items-center gap-1 bg-neutral-950 border border-neutral-800 rounded-lg p-1 text-xs">
					<button
						type="button"
						onclick={() => (currentMode = 'text')}
						class="flex items-center gap-1 px-3 py-1 rounded transition cursor-pointer {currentMode === 'text'
							? 'bg-neutral-800 text-white font-medium'
							: 'text-neutral-400 hover:text-white'}"
					>
						<Edit3 class="w-3.5 h-3.5" />
						Edit Text
					</button>

					<button
						type="button"
						onclick={() => (currentMode = 'sync')}
						class="flex items-center gap-1 px-3 py-1 rounded transition cursor-pointer {currentMode === 'sync'
							? 'bg-emerald-500/20 text-emerald-400 font-semibold border border-emerald-500/30'
							: 'text-neutral-400 hover:text-white'}"
					>
						<Clock class="w-3.5 h-3.5" />
						Synchronize
					</button>

					<button
						type="button"
						onclick={() => (currentMode = 'preview')}
						class="flex items-center gap-1 px-3 py-1 rounded transition cursor-pointer {currentMode === 'preview'
							? 'bg-neutral-800 text-white font-medium'
							: 'text-neutral-400 hover:text-white'}"
					>
						<Eye class="w-3.5 h-3.5" />
						Karaoke Live
					</button>
				</div>
			</div>
		</div>

		<!-- Main Workspace Area -->
		<div class="flex-1 flex flex-col min-h-[460px]">
			<!-- MODE 1: RAW TEXT EDITOR -->
			{#if currentMode === 'text'}
				<div class="bg-neutral-900 rounded-xl border border-neutral-800 p-4 flex-1 flex flex-col gap-3">
					<div class="flex items-center justify-between text-xs text-neutral-400">
						<span>Paste or type your lyrics line by line:</span>
						<span class="text-[11px] text-neutral-500">Supports plain text or existing [mm:ss.xx] .lrc</span>
					</div>
					<textarea
						bind:value={rawLyricsText}
						placeholder="Paste lyrics here..."
						rows="16"
						class="w-full flex-1 bg-neutral-950 border border-neutral-800 rounded-lg p-4 font-mono text-xs text-neutral-200 focus:outline-none focus:border-emerald-500 resize-none leading-relaxed"
					></textarea>
					<div class="flex items-center justify-between pt-1">
						<span class="text-[11px] text-neutral-500">
							{rawLyricsText.split('\n').filter((l) => l.trim()).length} lines detected
						</span>
						<button
							type="button"
							onclick={applyRawText}
							class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition cursor-pointer shadow-md"
						>
							Apply to Synchronizer &rarr;
						</button>
					</div>
				</div>

			<!-- MODE 2: INTERACTIVE SYNCHRONIZER -->
			{:else if currentMode === 'sync'}
				<div class="bg-neutral-900 rounded-xl border border-neutral-800 flex-1 flex flex-col overflow-hidden shadow-xl">
					<!-- Sync Actions Sticky Header -->
					<div class="bg-neutral-900/90 border-b border-neutral-800 p-3 flex flex-wrap items-center justify-between gap-3">
						<div class="flex items-center gap-2">
							<button
								type="button"
								onclick={stampCurrentLine}
								class="px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm transition cursor-pointer shadow-lg shadow-emerald-500/20 flex items-center gap-2"
							>
								<Clock class="w-4 h-4 fill-current" />
								<span>Stamp Line (Space / Enter)</span>
							</button>

							<button
								type="button"
								onclick={stepBackLine}
								disabled={activeLineIndex === 0}
								class="px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-medium text-xs transition cursor-pointer border border-neutral-700 disabled:opacity-40 flex items-center gap-1.5"
								title="Step back to re-record previous line (Up Arrow)"
							>
								<ChevronUp class="w-4 h-4" />
								<span>Step Back</span>
							</button>

							<button
								type="button"
								onclick={() => (autoFollowEnabled = !autoFollowEnabled)}
								class="px-2.5 py-2 rounded-lg border text-xs font-medium transition cursor-pointer flex items-center gap-1.5 {autoFollowEnabled
									? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
									: 'bg-neutral-800 border-neutral-700 text-neutral-400'}"
								title="Automatically center the currently playing lyric line during playback"
							>
								<LocateFixed class="w-3.5 h-3.5 {autoFollowEnabled ? 'text-emerald-400' : 'text-neutral-500'}" />
								<span>Auto-Follow: {autoFollowEnabled ? 'ON' : 'OFF'}</span>
							</button>
						</div>

						<div class="text-xs text-neutral-400 flex items-center gap-3">
							<span>Line {activeLineIndex + 1} of {lyricLines.length}</span>
							<span class="text-neutral-600">•</span>
							<span class="hidden sm:inline">Use <kbd class="px-1.5 py-0.5 bg-neutral-800 rounded border border-neutral-700 text-[10px]">Space</kbd> to stamp & advance</span>
						</div>
					</div>

					<!-- Instrumental Mode Banner in Synchronizer -->
					{#if isInstrumental}
						<div class="bg-purple-950/40 border-b border-purple-800/50 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs text-purple-300">
							<div class="flex items-center gap-2">
								<span class="text-base font-serif text-purple-400">♪</span>
								<span><strong>Instrumental Track:</strong> Saved with marker <code class="px-1.5 py-0.5 rounded bg-neutral-950 border border-purple-700/50 font-mono text-[11px]">{instrumentalFormat === 'note' ? '[00:00.00]♪' : '[00:00.00][instrumental]'}</code></span>
							</div>
							<div class="flex items-center gap-2">
								<button
									type="button"
									onclick={() => setAsInstrumental(instrumentalFormat === 'note' ? 'tag' : 'note')}
									class="px-2 py-1 rounded bg-purple-900/60 hover:bg-purple-800/80 text-purple-200 border border-purple-700/60 text-xs transition cursor-pointer"
								>
									Switch to {instrumentalFormat === 'note' ? '[instrumental]' : '♪'}
								</button>
								<button
									type="button"
									onclick={revertFromInstrumental}
									class="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 text-xs transition cursor-pointer"
								>
									Revert to Vocal
								</button>
							</div>
						</div>
					{/if}

					<!-- Multi-Line Batch Operations Toolbar -->
					{#if selectedLineIndices.length > 0}
						<div class="bg-indigo-950/70 border-b border-indigo-800/60 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs animate-in fade-in duration-150">
							<div class="flex items-center gap-2">
								<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 font-semibold text-[11px]">
									<CheckSquare class="w-3.5 h-3.5" />
									{selectedLineIndices.length} {selectedLineIndices.length === 1 ? 'line' : 'lines'} selected
								</span>
								<button
									type="button"
									onclick={selectAllLines}
									class="text-neutral-400 hover:text-white underline text-[11px] cursor-pointer"
								>
									Select All
								</button>
								<button
									type="button"
									onclick={clearSelection}
									class="text-neutral-400 hover:text-white underline text-[11px] cursor-pointer"
								>
									Clear
								</button>
							</div>

							<!-- Shift Controls -->
							<div class="flex flex-wrap items-center gap-1">
								<span class="text-neutral-400 text-[11px] mr-1 hidden sm:inline">Shift:</span>
								<button
									type="button"
									onclick={() => shiftSelectedLines(-1.0)}
									class="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-mono text-[11px] border border-neutral-700 transition cursor-pointer"
									title="Shift selected lines earlier by 1.0s (-1.0s)"
								>
									-1.0s
								</button>
								<button
									type="button"
									onclick={() => shiftSelectedLines(1.0)}
									class="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-mono text-[11px] border border-neutral-700 transition cursor-pointer"
									title="Shift selected lines later by 1.0s (+1.0s)"
								>
									+1.0s
								</button>
								<button
									type="button"
									onclick={() => shiftSelectedLines(-0.5)}
									class="px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-mono text-[11px] border border-neutral-700 transition cursor-pointer"
									title="Shift selected lines earlier by 0.5s (-0.5s)"
								>
									-0.5s
								</button>
								<button
									type="button"
									onclick={() => shiftSelectedLines(0.5)}
									class="px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-mono text-[11px] border border-neutral-700 transition cursor-pointer"
									title="Shift selected lines later by 0.5s (+0.5s)"
								>
									+0.5s
								</button>
								<button
									type="button"
									onclick={() => shiftSelectedLines(-0.1)}
									class="px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-mono text-[11px] border border-neutral-700 transition cursor-pointer"
									title="Shift selected lines earlier by 0.1s (-0.1s)"
								>
									-0.1s
								</button>
								<button
									type="button"
									onclick={() => shiftSelectedLines(0.1)}
									class="px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-mono text-[11px] border border-neutral-700 transition cursor-pointer"
									title="Shift selected lines later by 0.1s (+0.1s)"
								>
									+0.1s
								</button>

								<!-- Custom Shift Input -->
								<div class="flex items-center ml-1 border border-neutral-700 rounded-lg overflow-hidden bg-neutral-950 shadow-inner">
									<button
										type="button"
										onclick={() => {
											const cur = parseFloat(customShiftAmount) || 0;
											customShiftAmount = (Math.round((cur - 0.1) * 10) / 10).toFixed(1);
										}}
										class="px-2 py-1 text-neutral-400 hover:text-white hover:bg-neutral-800 text-xs font-mono transition cursor-pointer select-none"
										title="Decrease by 0.1s"
									>
										-
									</button>

									<div class="relative flex items-center">
										<input
											type="text"
											inputmode="decimal"
											bind:value={customShiftAmount}
											class="w-16 bg-transparent px-1 py-1 text-xs text-white text-center font-mono focus:outline-none"
											placeholder="1.0"
											title="Custom offset in seconds (e.g. 1.2 or -0.8)"
										/>
										<span class="text-[10px] text-neutral-400 pr-1.5 select-none font-mono">s</span>
									</div>

									<button
										type="button"
										onclick={() => {
											const cur = parseFloat(customShiftAmount) || 0;
											customShiftAmount = (Math.round((cur + 0.1) * 10) / 10).toFixed(1);
										}}
										class="px-2 py-1 text-neutral-400 hover:text-white hover:bg-neutral-800 text-xs font-mono transition cursor-pointer select-none"
										title="Increase by 0.1s"
									>
										+
									</button>

									<button
										type="button"
										onclick={applyCustomShift}
										class="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition cursor-pointer border-l border-neutral-700"
									>
										Shift
									</button>
								</div>

								<!-- Clear Timestamps on selected lines -->
								<button
									type="button"
									onclick={removeSelectedTimestamps}
									class="ml-1 p-1 rounded text-neutral-400 hover:text-rose-400 transition cursor-pointer"
									title="Clear timestamps for all selected lines"
								>
									<Trash2 class="w-3.5 h-3.5" />
								</button>
							</div>
						</div>
					{/if}

					<!-- Scrollable Lines Canvas -->
					<div
						bind:this={linesContainerEl}
						class="flex-1 overflow-y-auto p-4 space-y-2 max-h-[500px]"
					>
						{#each lyricLines as line, i}
							{@const isCurrentPlaying = currentPlaybackLineIndex === i}
							{@const isSyncTarget = i === activeLineIndex}
							{@const isSelected = selectedLineIndices.includes(i)}
							<div
								id={`line-${i}`}
								class="flex items-center gap-3 p-2.5 rounded-xl border transition-all duration-200 {isSelected
									? 'bg-indigo-950/40 border-indigo-500/60 ring-1 ring-indigo-500/30'
									: isCurrentPlaying
									? 'bg-emerald-950/70 border-emerald-500/80 ring-2 ring-emerald-500/40 shadow-lg scale-[1.01]'
									: isSyncTarget
									? 'bg-neutral-900 border-indigo-500/50 ring-1 ring-indigo-500/30'
									: line.time !== null
									? 'bg-neutral-950/60 border-neutral-800/80 hover:border-neutral-700'
									: 'bg-neutral-950/30 border-neutral-850 opacity-80'}"
							>
								<!-- Line Selection Checkbox -->
								<button
									type="button"
									onclick={(e) => toggleLineSelection(i, e)}
									class="p-1 rounded text-neutral-500 hover:text-indigo-400 transition shrink-0 cursor-pointer"
									title="Select line for batch time shifting (Shift+Click to select range)"
								>
									{#if isSelected}
										<CheckSquare class="w-4 h-4 text-indigo-400" />
									{:else}
										<Square class="w-4 h-4 text-neutral-600 hover:text-neutral-400" />
									{/if}
								</button>

								<!-- Line Index / Arrow / Active Playing Indicator -->
								<div class="w-6 text-center text-[11px] font-mono shrink-0 flex items-center justify-center">
									{#if isCurrentPlaying}
										<span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400/50" title="Currently Playing"></span>
									{:else if isSyncTarget}
										<span class="text-indigo-400 font-bold">&rarr;</span>
									{:else}
										<span class="text-neutral-500">{i + 1}</span>
									{/if}
								</div>

								<!-- Timestamp Chip -->
								<div class="shrink-0">
									{#if line.time !== null}
										<button
											type="button"
											onclick={() => seekTo(line.time!)}
											class="px-2.5 py-1 rounded border font-mono text-xs transition cursor-pointer flex items-center gap-1.5 {isCurrentPlaying
												? 'bg-emerald-500 text-black font-bold border-emerald-400 shadow-md'
												: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'}"
											title="Click to seek audio to this timestamp"
										>
											<Play class="w-2.5 h-2.5 fill-current" />
											{formatTime(line.time)}
										</button>
									{:else}
										<button
											type="button"
											onclick={() => {
												activeLineIndex = i;
												stampCurrentLine();
											}}
											class="px-2 py-1 rounded bg-neutral-800/80 border border-neutral-700 text-neutral-400 text-xs hover:text-white transition cursor-pointer"
										>
											--:--.--
										</button>
									{/if}
								</div>

								<!-- Line Text (Editable or clickable) -->
								<div class="flex-1 min-w-0">
									<input
										type="text"
										bind:value={line.text}
										onfocus={() => (activeLineIndex = i)}
										class="w-full bg-transparent border-0 text-sm focus:outline-none focus:ring-0 px-1 transition-all {isCurrentPlaying
											? 'text-emerald-200 font-bold text-base'
											: isSyncTarget
											? 'text-white font-semibold'
											: line.time !== null
											? 'text-neutral-200'
											: 'text-neutral-400'}"
									/>
								</div>

								<!-- Micro Fine-tuning Actions -->
								<div class="flex items-center gap-1 shrink-0 opacity-80 hover:opacity-100">
									<button
										type="button"
										onclick={() => adjustLineTime(i, -0.1)}
										class="px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] font-mono transition"
										title="Nudge -0.1s"
									>
										-0.1s
									</button>
									<button
										type="button"
										onclick={() => adjustLineTime(i, 0.1)}
										class="px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] font-mono transition"
										title="Nudge +0.1s"
									>
										+0.1s
									</button>

									{#if line.time !== null}
										<button
											type="button"
											onclick={() => removeTimestamp(i)}
											class="p-1 rounded text-neutral-500 hover:text-rose-400 transition"
											title="Clear timestamp"
										>
											<Trash2 class="w-3.5 h-3.5" />
										</button>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</div>

			<!-- MODE 3: KARAOKE LIVE PREVIEW -->
			{:else if currentMode === 'preview'}
				<div class="bg-neutral-900 rounded-xl border border-neutral-800 flex-1 flex flex-col items-center justify-center p-8 text-center min-h-[460px] overflow-hidden relative">
					{#if isInstrumental}
						<div class="max-w-md w-full p-8 rounded-3xl bg-neutral-950/80 border border-purple-500/30 shadow-2xl space-y-4 text-center">
							<div class="w-16 h-16 mx-auto rounded-2xl bg-purple-500/15 border border-purple-500/30 text-purple-400 flex items-center justify-center text-3xl font-serif shadow-lg shadow-purple-950/50">
								♪
							</div>
							<div>
								<h3 class="text-xl font-bold text-white flex items-center justify-center gap-2">
									<span>Instrumental Track</span>
								</h3>
								<p class="text-xs text-purple-300/80 mt-1">This song contains no vocal lyrics</p>
							</div>
							<div class="text-[11px] font-mono text-neutral-400 bg-neutral-900 p-2.5 rounded-xl border border-neutral-800">
								<code>[00:00.00]{instrumentalFormat === 'note' ? '♪' : '[instrumental]'}</code>
							</div>
							<div class="pt-2">
								<button
									type="button"
									onclick={revertFromInstrumental}
									class="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs transition cursor-pointer"
								>
									Switch to vocal lyrics
								</button>
							</div>
						</div>
					{:else}
						<div class="max-w-2xl w-full space-y-6">
							{#each lyricLines as line, i}
								{#if Math.abs(i - currentPlaybackLineIndex) <= 2}
									<div
										class="transition-all duration-300 transform {i === currentPlaybackLineIndex
											? 'text-2xl md:text-3xl font-extrabold text-emerald-400 scale-105 py-2'
											: i < currentPlaybackLineIndex
											? 'text-sm md:text-base text-neutral-500'
											: 'text-sm md:text-base text-neutral-400'}"
									>
										{line.text}
									</div>
								{/if}
							{/each}

							{#if currentPlaybackLineIndex === -1}
								<div class="text-neutral-500 italic text-sm">
									Press Play to start karaoke preview...
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</main>
</div>

<!-- LRCLIB Candidates Modal -->
<LrcLibModal
	open={showLrcLibModal}
	{trackTitle}
	{trackArtist}
	{albumTitle}
	durationSeconds={duration}
	onSelectLyrics={handleLrcLibSelect}
	onClose={() => (showLrcLibModal = false)}
/>
