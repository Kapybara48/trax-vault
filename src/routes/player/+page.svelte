<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types.js';
	import type { Track } from '$lib/types/index.js';
	import type { PlayerAlbum } from '$lib/services/player.svelte.js';
	import { player } from '$lib/services/player.svelte.js';
	import {
		Play,
		Pause,
		SkipBack,
		SkipForward,
		Shuffle,
		Repeat,
		Repeat1,
		Volume2,
		Volume1,
		VolumeX,
		Mic,
		ListMusic,
		Search,
		Disc3,
		Clock,
		ExternalLink,
		X,
		Music,
		CircleCheck,
		ListPlus
	} from '@lucide/svelte';
	import AddToPlaylistModal from '$lib/components/AddToPlaylistModal.svelte';

	let { data }: { data: PageData } = $props();

	// Active Selection & Filter State
	let selectedAlbum = $state<PlayerAlbum>(
		player.currentAlbum ||
		(data.initialAlbumId ? data.albums.find((a) => a.id === data.initialAlbumId) : null) ||
		data.albums[0] ||
		null
	);

	// Filters & Search
	let librarySearch = $state('');
	let libraryFilter = $state<'all' | 'lossless' | 'verified' | 'albums'>('all');
	let albumTrackSearch = $state('');

	// Side Drawers
	let showLyricsDrawer = $state(false);
	let showQueueDrawer = $state(false);

	// Synced Lyrics State
	let lyricsLoading = $state(false);
	let lyricsLines = $state<{ time: number | null; text: string }[]>([]);
	let isInstrumentalLyrics = $state(false);
	let instrumentalMarker = $state('♪');
	let lyricsContainerEl: HTMLDivElement | null = $state(null);

	// Add to Playlist Modal State
	let showPlaylistModal = $state(false);
	let playlistModalTrackIds = $state<number[]>([]);
	let playlistModalTitle = $state<string | undefined>(undefined);

	function openAddToPlaylist(trackIds: number[], title?: string) {
		playlistModalTrackIds = trackIds;
		playlistModalTitle = title;
		showPlaylistModal = true;
	}

	// Helpers: Format mm:ss
	function formatTime(seconds: number): string {
		if (isNaN(seconds) || seconds < 0) return '0:00';
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function formatDurationMs(ms: number | null | undefined): string {
		if (!ms || isNaN(ms)) return '0:00';
		return formatTime(ms / 1000);
	}

	function formatTotalAlbumDuration(tracks: Track[]): string {
		const totalMs = tracks.reduce((acc, t) => acc + (t.duration_ms || 0), 0);
		const totalSec = Math.floor(totalMs / 1000);
		const h = Math.floor(totalSec / 3600);
		const m = Math.floor((totalSec % 3600) / 60);
		const s = totalSec % 60;
		if (h > 0) {
			return `${h}h ${m}m`;
		}
		return `${m}m ${s}s`;
	}

	// Parse LRC format into structured lines (supports multiple timestamps per line)
	function parseLrc(content: string): { time: number | null; text: string }[] {
		const lines = content.split('\n');
		const result: { time: number | null; text: string }[] = [];

		for (const rawLine of lines) {
			const line = rawLine.trim();
			if (!line) continue;
			if (/^\[(ti|ar|al|length|by|offset|re|ve):/i.test(line)) continue;

			const timestampRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
			let match: RegExpExecArray | null;
			const times: number[] = [];
			let lastIndex = 0;

			while ((match = timestampRegex.exec(line)) !== null) {
				const m = parseInt(match[1], 10);
				const s = parseInt(match[2], 10);
				const ms = parseFloat(`0.${match[3] || '0'}`);
				times.push(m * 60 + s + ms);
				lastIndex = timestampRegex.lastIndex;
			}

			if (times.length > 0) {
				const lyricText = line.slice(lastIndex).trim();
				for (const t of times) {
					result.push({
						time: t,
						text: lyricText
					});
				}
			} else {
				result.push({
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

		return result;
	}

	// Active singing line derived from audio currentTime
	let activeLyricLineIndex = $derived.by(() => {
		if (!lyricsLines.length) return -1;
		let idx = -1;
		for (let i = 0; i < lyricsLines.length; i++) {
			const l = lyricsLines[i];
			if (l.time !== null && l.time <= player.currentTime) {
				idx = i;
			}
		}
		return idx;
	});

	// Auto-scroll lyrics smoothly to active line
	$effect(() => {
		if (showLyricsDrawer && activeLyricLineIndex >= 0 && lyricsContainerEl) {
			const el = document.getElementById(`lyrics-line-${activeLyricLineIndex}`);
			if (el) {
				el.scrollIntoView({ behavior: 'smooth', block: 'center' });
			}
		}
	});

	// Fetch Lyrics for current track
	async function loadLyricsForCurrentTrack() {
		const track = player.currentTrack;
		if (!track) {
			lyricsLines = [];
			isInstrumentalLyrics = false;
			return;
		}

		// If track is explicitly marked instrumental in database, render instrumental directly
		if (track.lyrics === 'instrumental') {
			isInstrumentalLyrics = true;
			instrumentalMarker = '♪';
			lyricsLines = [{ time: 0, text: instrumentalMarker }];
			lyricsLoading = false;
			return;
		}

		lyricsLoading = true;
		try {
			const res = await fetch(`/api/tracks/${track.id}/lyrics`);
			const json = await res.json();
			const status = json.lyrics_status || json.status || track.lyrics;
			const raw = json.lyrics_text ? json.lyrics_text.trim() : '';

			if (
				status === 'instrumental' ||
				/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*(♪|♫|\[instrumental\]|\(instrumental\)|instrumental)/i.test(raw) ||
				/\[au:\s*instrumental\]/i.test(raw)
			) {
				isInstrumentalLyrics = true;
				instrumentalMarker = raw.includes('[instrumental]') ? '[instrumental]' : '♪';
				lyricsLines = [{ time: 0, text: instrumentalMarker }];
			} else if (raw) {
				isInstrumentalLyrics = false;
				lyricsLines = parseLrc(raw);
			} else {
				lyricsLines = [];
				isInstrumentalLyrics = false;
			}
		} catch (e) {
			console.error('Error fetching lyrics:', e);
			lyricsLines = [];
			isInstrumentalLyrics = false;
		} finally {
			lyricsLoading = false;
		}
	}

	// Auto-load lyrics when track changes and drawer is open
	$effect(() => {
		const tr = player.currentTrack;
		if (showLyricsDrawer && tr) {
			loadLyricsForCurrentTrack();
		}
	});

	function toggleLyrics() {
		showLyricsDrawer = !showLyricsDrawer;
		if (showLyricsDrawer) {
			showQueueDrawer = false;
			loadLyricsForCurrentTrack();
		}
	}

	function toggleQueue() {
		showQueueDrawer = !showQueueDrawer;
		if (showQueueDrawer) {
			showLyricsDrawer = false;
		}
	}

	// Filtered library albums in sidebar
	let filteredAlbums = $derived.by(() => {
		let list = data.albums;
		if (librarySearch.trim()) {
			const q = librarySearch.trim().toLowerCase();
			list = list.filter(
				(a) =>
					a.title.toLowerCase().includes(q) ||
					a.artist.toLowerCase().includes(q) ||
					(a.genre && a.genre.toLowerCase().includes(q))
			);
		}

		if (libraryFilter === 'verified') {
			list = list.filter((a) => a.checked_count === a.track_count && (a.track_count || 0) > 0);
		} else if (libraryFilter === 'lossless') {
			list = list.filter((a) => a.tracks.some((t) => t.format === 'FLAC' || t.format === 'ALAC' || t.format === 'WAV'));
		}
		return list;
	});

	// Filtered tracks within selected album
	let displayedTracks = $derived.by(() => {
		if (!selectedAlbum) return [];
		if (!albumTrackSearch.trim()) return selectedAlbum.tracks;
		const q = albumTrackSearch.trim().toLowerCase();
		return selectedAlbum.tracks.filter(
			(t) =>
				t.title.toLowerCase().includes(q) ||
				(t.artist && t.artist.toLowerCase().includes(q))
		);
	});

	// Global Keyboard Shortcuts
	function handleKeyDown(e: KeyboardEvent) {
		const target = e.target as HTMLElement;
		if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
			return;
		}

		if (e.code === 'Space') {
			e.preventDefault();
			player.togglePlay();
		} else if (e.code === 'ArrowLeft') {
			e.preventDefault();
			if (e.shiftKey) {
				player.previousTrack();
			} else {
				player.seekTo(player.currentTime - 5);
			}
		} else if (e.code === 'ArrowRight') {
			e.preventDefault();
			if (e.shiftKey) {
				player.nextTrack();
			} else {
				player.seekTo(player.currentTime + 5);
			}
		} else if (e.code === 'ArrowUp') {
			e.preventDefault();
			player.setVolume(player.volume + 0.05);
		} else if (e.code === 'ArrowDown') {
			e.preventDefault();
			player.setVolume(player.volume - 0.05);
		} else if (e.key.toLowerCase() === 'm') {
			player.toggleMute();
		} else if (e.key.toLowerCase() === 'l') {
			toggleLyrics();
		}
	}

	onMount(() => {
		// Handle initial target from URL parameters
		if (data.initialAlbumId) {
			const found = data.albums.find((a) => a.id === data.initialAlbumId);
			if (found) {
				selectedAlbum = found;
			}
		}

		if (data.initialTrackId && !player.currentTrack) {
			let foundTrack: Track | undefined;
			let foundAlbum: (typeof data.albums)[0] | undefined;
			for (const alb of data.albums) {
				const candidate = alb.tracks.find((t) => t.id === data.initialTrackId);
				if (candidate) {
					foundTrack = candidate;
					foundAlbum = alb;
					break;
				}
			}
			if (foundTrack && foundAlbum) {
				selectedAlbum = foundAlbum;
				player.playTrack(foundTrack, foundAlbum, foundAlbum.tracks);
			}
		}
	});
</script>

<svelte:window onkeydown={handleKeyDown} />

<!-- Track Vault Studio Audio Player (Full Viewport, Non-Scrollable Window) -->
<div class="flex-1 h-full flex flex-col bg-neutral-950 text-neutral-100 font-sans select-none overflow-hidden min-h-0">
	<!-- Workspace: Side Library + Main Stage + Drawers -->
	<div class="flex-1 flex overflow-hidden min-h-0 p-3 gap-3">
		<!-- LEFT SIDEBAR: Vault Audio Library -->
		<aside class="w-72 lg:w-80 bg-neutral-900/60 backdrop-blur-xl border border-neutral-800/70 rounded-2xl flex flex-col overflow-hidden shrink-0 shadow-xl">
			<!-- Header & Search -->
			<div class="p-3.5 pb-2 border-b border-neutral-800/60 shrink-0">
				<div class="flex items-center justify-between mb-2.5">
					<div class="flex items-center gap-2 text-white font-bold text-xs tracking-wide">
						<Disc3 class="w-4 h-4 text-emerald-400" />
						<span>Vault Library</span>
					</div>
					<span class="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 px-2 py-0.5 rounded-full font-semibold">
						{data.albums.length} releases
					</span>
				</div>

				<!-- Search Input -->
				<div class="relative">
					<Search class="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
					<input
						type="text"
						bind:value={librarySearch}
						placeholder="Search album, artist..."
						class="w-full bg-neutral-950/80 text-xs text-white placeholder-neutral-500 rounded-xl pl-8 pr-3 py-1.5 border border-neutral-800 focus:outline-none focus:border-emerald-500/60 transition"
					/>
					{#if librarySearch}
						<button
							type="button"
							onclick={() => (librarySearch = '')}
							class="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white text-xs"
						>
							✕
						</button>
					{/if}
				</div>

				<!-- Filter Chips -->
				<div class="flex items-center gap-1.5 mt-2.5 overflow-x-auto no-scrollbar pb-1 text-xs">
					{#each [
						{ id: 'all', label: 'All' },
						{ id: 'lossless', label: 'FLAC / Hi-Res' },
						{ id: 'verified', label: 'Verified' }
					] as chip}
						<button
							type="button"
							onclick={() => (libraryFilter = chip.id as any)}
							class="px-2.5 py-0.5 rounded-lg text-[10px] font-semibold transition cursor-pointer shrink-0 border {libraryFilter === chip.id
								? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm'
								: 'bg-neutral-950/60 text-neutral-400 border-neutral-800 hover:text-white hover:bg-neutral-800'}"
						>
							{chip.label}
						</button>
					{/each}
				</div>
			</div>

			<!-- Scrollable Albums List -->
			<div class="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
				{#each filteredAlbums as album}
					{@const isSelected = selectedAlbum?.id === album.id}
					{@const isPlayingThisAlbum = player.currentAlbum?.id === album.id && player.isPlaying}
					<div
						role="button"
						tabindex="0"
						onclick={() => (selectedAlbum = album)}
						onkeydown={(e) => {
							if (e.key === 'Enter') selectedAlbum = album;
						}}
						class="w-full flex items-center gap-2.5 p-2 rounded-xl transition text-left cursor-pointer group border {isSelected
							? 'bg-neutral-800/80 border-emerald-500/40 text-white shadow-md'
							: 'border-transparent text-neutral-300 hover:bg-neutral-800/40 hover:text-white'}"
					>
						<!-- Album Cover -->
						<div class="relative w-11 h-11 rounded-lg overflow-hidden bg-neutral-950 shrink-0 border border-neutral-800 shadow-sm">
							{#if album.cover_url}
								<img src={album.cover_url} alt={album.title} class="w-full h-full object-cover" />
							{:else}
								<div class="w-full h-full flex items-center justify-center bg-neutral-900 text-neutral-600">
									<Music class="w-4 h-4" />
								</div>
							{/if}

							{#if isPlayingThisAlbum}
								<div class="absolute inset-0 bg-neutral-950/70 flex items-center justify-center">
									<div class="flex items-end gap-0.5 h-3">
										<span class="w-0.5 bg-emerald-400 animate-pulse h-full"></span>
										<span class="w-0.5 bg-emerald-400 animate-pulse h-2"></span>
										<span class="w-0.5 bg-emerald-400 animate-pulse h-full"></span>
									</div>
								</div>
							{/if}
						</div>

						<!-- Details -->
						<div class="min-w-0 flex-1">
							<div class="text-xs font-semibold truncate {isPlayingThisAlbum ? 'text-emerald-300' : 'text-neutral-100'}">
								{album.title}
							</div>
							<div class="text-[10px] text-neutral-400 truncate mt-0.5 flex items-center gap-1.5">
								<span>{album.artist}</span>
								<span>&bull;</span>
								<span>{album.tracks.length} tracks</span>
							</div>
						</div>

						<!-- Instant Play Trigger on Hover -->
						<button
							type="button"
							onclick={(e) => {
								e.stopPropagation();
								selectedAlbum = album;
								if (album.tracks.length > 0) {
									player.playTrack(album.tracks[0], album, album.tracks);
								}
							}}
							class="p-2 rounded-full bg-emerald-500 text-neutral-950 opacity-0 group-hover:opacity-100 transition hover:scale-110 shadow-md cursor-pointer shrink-0"
							title="Play Album"
						>
							<Play class="w-3.5 h-3.5 fill-current ml-0.5" />
						</button>
					</div>
				{/each}

				{#if filteredAlbums.length === 0}
					<div class="p-6 text-center text-xs text-neutral-500 italic">
						No albums matching filter
					</div>
				{/if}
			</div>
		</aside>

		<!-- MAIN STAGE: Album Hero & Independently Scrollable Tracklist -->
		<main class="flex-1 bg-neutral-900/50 backdrop-blur-xl border border-neutral-800/70 rounded-2xl flex flex-col overflow-hidden shadow-xl min-h-0">
			{#if selectedAlbum}
				<!-- Album Hero Header (Clean Audio Studio Banner) -->
				<div class="p-5 bg-gradient-to-b from-neutral-800/40 via-neutral-900/30 to-transparent border-b border-neutral-800/60 shrink-0">
					<div class="flex flex-col sm:flex-row items-center sm:items-start gap-5">
						<!-- Album Artwork with Subtle Glow -->
						<div class="relative group shrink-0">
							<div class="w-36 h-36 sm:w-44 sm:h-44 rounded-2xl overflow-hidden bg-neutral-950 shadow-2xl border border-neutral-700/50 relative z-10">
								{#if selectedAlbum.cover_url}
									<img src={selectedAlbum.cover_url} alt={selectedAlbum.title} class="w-full h-full object-cover" />
								{:else}
									<div class="w-full h-full flex items-center justify-center bg-neutral-900 text-neutral-600">
										<Disc3 class="w-16 h-16 opacity-30" />
									</div>
								{/if}
							</div>
							<!-- Subtle Ambient Glow -->
							<div class="absolute -inset-2 bg-emerald-500/10 rounded-3xl blur-xl opacity-60 group-hover:opacity-100 transition"></div>
						</div>

						<!-- Metadata & Studio Controls -->
						<div class="min-w-0 flex-1 text-center sm:text-left space-y-2.5">
							<div class="flex flex-wrap items-center justify-center sm:justify-start gap-2">
								<span class="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
									Vault Album
								</span>

								{#if selectedAlbum.tracks.some(t => t.format === 'FLAC')}
									<span class="px-2 py-0.5 rounded-full text-[10px] font-mono bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-semibold">
										Hi-Res Lossless
									</span>
								{/if}

								{#if (selectedAlbum.track_count || 0) > 0 && selectedAlbum.checked_count === selectedAlbum.track_count}
									<span class="px-2 py-0.5 rounded-full text-[10px] bg-emerald-950/80 border border-emerald-600 text-emerald-300 font-semibold flex items-center gap-1">
										<CircleCheck class="w-3 h-3" />
										100% Verified
									</span>
								{/if}
							</div>

							<h1 class="text-xl sm:text-3xl lg:text-4xl font-extrabold text-white tracking-tight leading-tight line-clamp-2">
								{selectedAlbum.title}
							</h1>

							<div class="flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs text-neutral-300">
								<span class="font-bold text-white">
									{selectedAlbum.artist}
								</span>
								{#if selectedAlbum.release_year}
									<span>&bull;</span>
									<span class="text-neutral-400">{selectedAlbum.release_year}</span>
								{/if}
								<span>&bull;</span>
								<span class="text-neutral-400">{selectedAlbum.tracks.length} tracks ({formatTotalAlbumDuration(selectedAlbum.tracks)})</span>
								{#if selectedAlbum.genre}
									<span>&bull;</span>
									<span class="px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700/60 text-[10px]">
										{selectedAlbum.genre}
									</span>
								{/if}
							</div>

							<!-- Action Bar -->
							<div class="pt-2 flex flex-wrap items-center justify-center sm:justify-start gap-3">
								<!-- Studio Gradient Play Button -->
								<button
									type="button"
									onclick={() => {
										if (player.currentAlbum?.id === selectedAlbum.id && player.isPlaying) {
											player.togglePlay();
										} else if (selectedAlbum.tracks.length > 0) {
											player.playTrack(selectedAlbum.tracks[0], selectedAlbum, selectedAlbum.tracks);
										}
									}}
									class="px-5 py-2 rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-neutral-950 font-bold text-xs shadow-lg shadow-emerald-500/20 hover:scale-105 active:scale-95 transition-all flex items-center gap-2 cursor-pointer"
								>
									{#if player.currentAlbum?.id === selectedAlbum.id && player.isPlaying}
										<Pause class="w-4 h-4 fill-current" />
										<span>Pause</span>
									{:else}
										<Play class="w-4 h-4 fill-current ml-0.5" />
										<span>Play Album</span>
									{/if}
								</button>

								<!-- Shuffle Button -->
								<button
									type="button"
									onclick={() => {
										player.toggleShuffle();
										if (!player.isPlaying || player.currentAlbum?.id !== selectedAlbum.id) {
											if (selectedAlbum.tracks.length > 0) {
												player.playTrack(selectedAlbum.tracks[0], selectedAlbum, selectedAlbum.tracks);
											}
										}
									}}
									class="p-2 rounded-xl border text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 {player.shuffleEnabled ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-neutral-800/80 border-neutral-700/70 text-neutral-300 hover:bg-neutral-700'}"
									title="Shuffle Play"
								>
									<Shuffle class="w-3.5 h-3.5" />
									<span class="hidden sm:inline">Shuffle</span>
								</button>

								<!-- Open in Album Details -->
								<a
									href="/album/{selectedAlbum.id}"
									class="p-2 rounded-xl bg-neutral-800/80 border border-neutral-700/70 text-neutral-300 hover:text-white hover:bg-neutral-700 text-xs font-semibold transition flex items-center gap-1.5"
									title="View Album Details & Fixer Rules"
								>
									<ExternalLink class="w-3.5 h-3.5" />
									<span class="hidden sm:inline">Vault Details</span>
								</a>

								<!-- Add Album to Playlist -->
								<button
									type="button"
									onclick={() => openAddToPlaylist(selectedAlbum.tracks.map((t) => t.id), selectedAlbum.title)}
									class="p-2 rounded-xl bg-neutral-800/80 border border-neutral-700/70 text-neutral-300 hover:text-white hover:bg-neutral-700 text-xs font-semibold transition flex items-center gap-1.5"
									title="Add entire album to a playlist"
								>
									<ListPlus class="w-3.5 h-3.5 text-emerald-400" />
									<span class="hidden sm:inline">Add to Playlist</span>
								</button>

								<!-- Search in Album -->
								<div class="relative ml-auto hidden md:block w-48">
									<Search class="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
									<input
										type="text"
										bind:value={albumTrackSearch}
										placeholder="Filter songs..."
										class="w-full bg-neutral-950/80 text-xs text-white placeholder-neutral-500 rounded-xl pl-7 pr-2.5 py-1.5 border border-neutral-800 focus:outline-none focus:border-emerald-500/60"
									/>
								</div>
							</div>
						</div>
					</div>
				</div>

				<!-- Tracklist Table Container (Only Songs Scroll!) -->
				<div class="flex-1 overflow-y-auto px-4 py-2 min-h-0">
					<table class="w-full text-left text-xs border-collapse">
						<thead class="text-neutral-400 border-b border-neutral-800/60 sticky top-0 bg-neutral-900/90 backdrop-blur z-10">
							<tr class="h-8">
								<th class="w-10 text-center font-semibold">#</th>
								<th class="font-semibold">Title</th>
								<th class="font-semibold hidden sm:table-cell">Quality</th>
								<th class="font-semibold hidden md:table-cell">Lyrics</th>
								<th class="w-14 text-right pr-2 font-semibold"><Clock class="w-3.5 h-3.5 inline text-neutral-500" /></th>
								<th class="w-8 text-center pr-3 font-semibold"></th>
							</tr>
						</thead>
						<tbody class="divide-y divide-neutral-800/30">
							{#each displayedTracks as track, idx}
								{@const isCurrent = player.currentTrack?.id === track.id}
								{@const isCurrentPlaying = isCurrent && player.isPlaying}
								<tr
									onclick={() => player.playTrack(track, selectedAlbum, selectedAlbum.tracks)}
									class="group hover:bg-neutral-800/50 transition cursor-pointer rounded-xl h-12 {isCurrent ? 'bg-emerald-950/20 text-white' : 'text-neutral-300'}"
								>
									<!-- Track # or Play Action -->
									<td class="text-center font-mono w-10">
										{#if isCurrentPlaying}
											<div class="flex items-end justify-center gap-0.5 h-3">
												<span class="w-0.5 bg-emerald-400 animate-pulse h-full"></span>
												<span class="w-0.5 bg-emerald-400 animate-pulse h-1.5"></span>
												<span class="w-0.5 bg-emerald-400 animate-pulse h-full"></span>
											</div>
										{:else}
											<span class="group-hover:hidden text-neutral-500">{track.track_number || idx + 1}</span>
											<Play class="w-3.5 h-3.5 fill-current mx-auto hidden group-hover:block text-emerald-400" />
										{/if}
									</td>

									<!-- Track Title & Artist -->
									<td class="py-2 pr-3 min-w-0">
										<div class="font-semibold truncate {isCurrent ? 'text-emerald-300' : 'text-neutral-100'}">
											{track.title}
										</div>
										<div class="text-[10px] text-neutral-400 truncate">
											{track.artist || selectedAlbum.artist}
										</div>
									</td>

									<!-- Quality Badge -->
									<td class="hidden sm:table-cell pr-3">
										<div class="flex items-center gap-1.5 flex-wrap">
											<span class="px-2 py-0.5 rounded text-[10px] font-mono {track.format === 'FLAC'
												? 'bg-emerald-950/60 text-emerald-300 border border-emerald-700/50'
												: 'bg-neutral-800 text-neutral-300 border border-neutral-700/40'}">
												{track.format}
											</span>
											{#if track.bitrate_kbps}
												<span class="text-[10px] font-mono text-neutral-400 bg-neutral-950/70 px-1.5 py-0.5 rounded border border-neutral-800/80">
													{track.bitrate_kbps.toLocaleString()} kbps
												</span>
											{/if}
										</div>
									</td>

									<!-- Lyrics Indicator Button -->
									<td class="hidden md:table-cell pr-3">
										{#if track.lyrics === 'instrumental'}
											<span class="px-2 py-0.5 rounded text-[10px] bg-purple-950/60 text-purple-300 border border-purple-800/50 font-serif">
												♪ Instrumental
											</span>
										{:else if track.lyrics === 'synced_lrc'}
											<button
												type="button"
												onclick={(e) => {
													e.stopPropagation();
													player.playTrack(track, selectedAlbum, selectedAlbum.tracks);
													showLyricsDrawer = true;
												}}
												class="px-2 py-0.5 rounded text-[10px] bg-emerald-950/50 hover:bg-emerald-900/50 text-emerald-300 border border-emerald-800/40 cursor-pointer transition"
												title="View Synced Lyrics"
											>
												Synced LRC
											</button>
										{:else}
											<span class="text-neutral-500 text-[10px]">
												{track.lyrics || 'plain'}
											</span>
										{/if}
									</td>

									<!-- Duration -->
									<td class="text-right pr-2 font-mono tabular-nums text-xs text-neutral-400">
										{formatDurationMs(track.duration_ms)}
									</td>

									<!-- Add to Playlist Action -->
									<td class="text-center pr-3">
										<button
											type="button"
											onclick={(e) => {
												e.stopPropagation();
												openAddToPlaylist([track.id], track.title);
											}}
											class="p-1 rounded text-neutral-500 hover:text-emerald-400 hover:bg-neutral-800 transition"
											title="Add to Playlist"
										>
											<ListPlus class="w-3.5 h-3.5" />
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<div class="flex-1 flex flex-col items-center justify-center p-8 text-center text-neutral-500">
					<Disc3 class="w-16 h-16 opacity-30 mb-3" />
					<h3 class="text-base font-bold text-neutral-300">No album selected</h3>
					<p class="text-xs text-neutral-500 mt-1">Select an album from the left library to start listening.</p>
				</div>
			{/if}
		</main>

		<!-- RIGHT PANEL: Studio Synced Lyrics & Queue Drawer -->
		{#if showLyricsDrawer || showQueueDrawer}
			<aside class="w-80 lg:w-96 bg-neutral-900/70 backdrop-blur-xl border border-neutral-800/70 rounded-2xl flex flex-col overflow-hidden shrink-0 shadow-2xl animate-in slide-in-from-right duration-200 min-h-0">
				<!-- Header -->
				<div class="p-3.5 border-b border-neutral-800/60 flex items-center justify-between shrink-0">
					<div class="flex items-center gap-2">
						{#if showLyricsDrawer}
							<Mic class="w-4 h-4 text-emerald-400" />
							<h3 class="font-bold text-xs text-white">Live Synced Lyrics</h3>
						{:else}
							<ListMusic class="w-4 h-4 text-emerald-400" />
							<h3 class="font-bold text-xs text-white">Playback Queue</h3>
						{/if}
					</div>
					<button
						type="button"
						onclick={() => {
							showLyricsDrawer = false;
							showQueueDrawer = false;
						}}
						class="text-neutral-400 hover:text-white p-1"
					>
						<X class="w-4 h-4" />
					</button>
				</div>

				<!-- Drawer Scrollable Body -->
				<div class="flex-1 overflow-y-auto p-4 flex flex-col min-h-0">
					{#if showLyricsDrawer}
						{#if lyricsLoading}
							<div class="flex-1 flex items-center justify-center text-xs text-neutral-500">
								Loading synced lyrics...
							</div>
						{:else if isInstrumentalLyrics}
							<div class="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-4">
								<div class="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/30 text-purple-400 flex items-center justify-center text-3xl font-serif shadow-lg">
									♪
								</div>
								<div>
									<h4 class="text-base font-bold text-white">Instrumental Track</h4>
									<p class="text-xs text-purple-300/80 mt-1">This song contains no vocal lyrics</p>
								</div>
								<div class="text-[11px] font-mono text-neutral-400 bg-neutral-950 px-3 py-1.5 rounded-xl border border-neutral-800">
									[00:00.00]{instrumentalMarker}
								</div>
							</div>
						{:else if lyricsLines.length > 0}
							<div bind:this={lyricsContainerEl} class="space-y-2 py-8 px-1">
								{#each lyricsLines as line, i}
									{@const isActive = activeLyricLineIndex === i}
									<button
										type="button"
										id={`lyrics-line-${i}`}
										onclick={() => line.time !== null && player.seekTo(line.time)}
										class="w-full text-left cursor-pointer rounded-xl px-3 py-2 text-[16px] font-semibold leading-relaxed border transition-colors duration-200 {isActive
											? 'text-emerald-300 bg-emerald-950/40 border-emerald-500/30 drop-shadow-[0_0_12px_rgba(16,185,129,0.35)]'
											: i < activeLyricLineIndex
											? 'text-neutral-500 border-transparent hover:text-neutral-300 hover:bg-neutral-800/30'
											: 'text-neutral-300 border-transparent hover:text-white hover:bg-neutral-800/30'}"
									>
										{line.text}
									</button>
								{/each}
							</div>
						{:else}
							<div class="flex-1 flex flex-col items-center justify-center text-center p-6 text-neutral-500 space-y-3">
								<Mic class="w-10 h-10 opacity-30" />
								<p class="text-xs">No lyrics found for this song.</p>
								{#if player.currentTrack}
									<a
										href="/lrc-maker?trackId={player.currentTrack.id}"
										class="px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30 text-xs font-semibold transition"
									>
										Create Synced Lyrics &rarr;
									</a>
								{/if}
							</div>
						{/if}
					{:else if showQueueDrawer}
						<div class="space-y-2">
							<span class="text-[10px] font-bold uppercase tracking-wider text-neutral-400 block mb-2">
								Now Playing
							</span>
							{#if player.currentTrack}
								<div class="p-2.5 rounded-xl bg-neutral-800/60 border border-neutral-700/40 flex items-center gap-3">
									<div class="min-w-0 flex-1">
										<div class="text-xs font-bold text-emerald-300 truncate">{player.currentTrack.title}</div>
										<div class="text-[10px] text-neutral-400 truncate">{player.currentTrack.artist || player.currentAlbum?.artist}</div>
									</div>
									<div class="text-right shrink-0">
										<div class="text-xs font-mono text-neutral-400">{formatDurationMs(player.currentTrack.duration_ms)}</div>
										{#if player.currentTrack.bitrate_kbps}
											<div class="text-[9px] font-mono text-emerald-400 font-semibold">{player.currentTrack.bitrate_kbps.toLocaleString()} kbps</div>
										{/if}
									</div>
								</div>
							{/if}

							<span class="text-[10px] font-bold uppercase tracking-wider text-neutral-400 block pt-3 mb-2">
								Next Up ({Math.max(0, player.activeQueue.length - player.queueIndex - 1)})
							</span>
							{#each player.activeQueue.slice(player.queueIndex + 1) as nextTr}
								<button
									type="button"
									onclick={() => player.playTrack(nextTr, player.currentAlbum || undefined, player.activeQueue)}
									class="w-full text-left p-2 rounded-xl hover:bg-neutral-800/40 flex items-center justify-between gap-3 text-xs text-neutral-300 transition cursor-pointer"
								>
									<div class="min-w-0 flex-1">
										<div class="font-medium text-white truncate">{nextTr.title}</div>
										<div class="text-[10px] text-neutral-400 truncate">{nextTr.artist || player.currentAlbum?.artist}</div>
									</div>
									<div class="text-right shrink-0">
										<span class="text-[10px] font-mono text-neutral-500 block">{formatDurationMs(nextTr.duration_ms)}</span>
										{#if nextTr.bitrate_kbps}
											<span class="text-[9px] font-mono text-neutral-400">{nextTr.bitrate_kbps} kbps</span>
										{/if}
									</div>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</aside>
		{/if}
	</div>

	<!-- BOTTOM FLOATING STUDIO PLAYER BAR (Refined Audiophile Glass Dock) -->
	<footer class="shrink-0 mx-3 mb-3 p-3 rounded-2xl bg-neutral-900/85 backdrop-blur-2xl border border-neutral-800/80 shadow-2xl flex items-center justify-between gap-4 z-40">
		<!-- Left: Now Playing Info -->
		<div class="flex items-center gap-3 w-1/4 min-w-[200px]">
			{#if player.currentTrack}
				<div class="w-12 h-12 rounded-xl overflow-hidden bg-neutral-950 shrink-0 border border-neutral-800 shadow">
					{#if player.currentAlbum?.cover_url}
						<img src={player.currentAlbum.cover_url} alt={player.currentTrack.title} class="w-full h-full object-cover" />
					{:else}
						<div class="w-full h-full flex items-center justify-center bg-neutral-900 text-neutral-500">
							<Music class="w-5 h-5" />
						</div>
					{/if}
				</div>

				<div class="min-w-0 flex-1">
					<div class="text-xs font-bold text-white truncate hover:underline cursor-pointer">
						{player.currentTrack.title}
					</div>
					<div class="text-[11px] text-neutral-400 truncate">
						{player.currentTrack.artist || player.currentAlbum?.artist || 'Track Vault'}
					</div>
					<div class="mt-0.5 flex items-center gap-1.5 flex-wrap">
						<span class="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-neutral-950 border border-emerald-500/30 text-emerald-400 font-semibold tracking-wider">
							{player.currentTrack.format}
						</span>
						{#if player.currentTrack.bitrate_kbps}
							<span class="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 font-bold shadow-sm">
								{player.currentTrack.bitrate_kbps.toLocaleString()} kbps
							</span>
						{/if}
						{#if player.currentTrack.sample_rate || player.currentTrack.bits_per_sample}
							<span class="text-[9px] font-mono text-neutral-400 hidden xl:inline">
								{#if player.currentTrack.bits_per_sample}{player.currentTrack.bits_per_sample}-bit / {/if}
								{#if player.currentTrack.sample_rate}{(player.currentTrack.sample_rate / 1000).toFixed(1)} kHz{/if}
							</span>
						{/if}
					</div>
				</div>
			{:else}
				<div class="w-12 h-12 rounded-xl bg-neutral-950 border border-neutral-800 flex items-center justify-center text-neutral-600 shrink-0">
					<Music class="w-5 h-5" />
				</div>
				<div class="min-w-0 flex-1">
					<span class="text-xs text-neutral-500 italic">No track loaded</span>
				</div>
			{/if}
		</div>

		<!-- Center: Controls & Scrubber -->
		<div class="flex flex-col items-center gap-1.5 w-2/4 max-w-xl">
			<!-- Buttons -->
			<div class="flex items-center gap-3">
				<!-- Shuffle -->
				<button
					type="button"
					onclick={() => player.toggleShuffle()}
					class="p-1.5 rounded-full transition cursor-pointer relative {player.shuffleEnabled ? 'text-emerald-400' : 'text-neutral-400 hover:text-white'}"
					title="Shuffle: {player.shuffleEnabled ? 'ON' : 'OFF'}"
				>
					<Shuffle class="w-4 h-4" />
				</button>

				<!-- Previous -->
				<button
					type="button"
					onclick={() => player.previousTrack()}
					class="text-neutral-400 hover:text-white transition cursor-pointer p-1"
					title="Previous Song"
				>
					<SkipBack class="w-4 h-4 fill-current" />
				</button>

				<!-- Play/Pause Button -->
				<button
					type="button"
					onclick={() => player.togglePlay()}
					class="w-9 h-9 rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 hover:scale-105 active:scale-95 text-neutral-950 flex items-center justify-center shadow-lg shadow-emerald-500/25 transition cursor-pointer"
					title="Play / Pause (Space)"
				>
					{#if player.isPlaying}
						<Pause class="w-4 h-4 fill-current" />
					{:else}
						<Play class="w-4 h-4 fill-current ml-0.5" />
					{/if}
				</button>

				<!-- Next -->
				<button
					type="button"
					onclick={() => player.nextTrack()}
					class="text-neutral-400 hover:text-white transition cursor-pointer p-1"
					title="Next Song"
				>
					<SkipForward class="w-4 h-4 fill-current" />
				</button>

				<!-- Repeat -->
				<button
					type="button"
					onclick={() => player.toggleRepeat()}
					class="p-1.5 rounded-full transition cursor-pointer relative {player.repeatMode !== 'off' ? 'text-emerald-400' : 'text-neutral-400 hover:text-white'}"
					title="Repeat: {player.repeatMode}"
				>
					{#if player.repeatMode === 'one'}
						<Repeat1 class="w-4 h-4" />
					{:else}
						<Repeat class="w-4 h-4" />
					{/if}
				</button>
			</div>

			<!-- Seekbar / Scrubber -->
			<div class="w-full flex items-center gap-2 text-[10px] font-mono text-neutral-400 tabular-nums">
				<span class="w-8 text-right">{formatTime(player.currentTime)}</span>
				<div class="flex-1 relative flex items-center">
					<input
						type="range"
						min="0"
						max={player.duration || 100}
						step="0.1"
						value={player.currentTime}
						oninput={(e) => player.seekTo(parseFloat(e.currentTarget.value))}
						class="w-full h-1 bg-neutral-800 hover:bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
					/>
				</div>
				<span class="w-8 text-left">{formatTime(player.duration)}</span>
			</div>
		</div>

		<!-- Right: Lyrics, Queue, Volume -->
		<div class="flex items-center justify-end gap-2.5 w-1/4 min-w-[180px]">
			<!-- Lyrics Drawer Toggle -->
			<button
				type="button"
				onclick={toggleLyrics}
				class="p-2 rounded-xl transition cursor-pointer border {showLyricsDrawer ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm' : 'border-transparent text-neutral-400 hover:text-white hover:bg-neutral-800'}"
				title="Synced Lyrics (L)"
			>
				<Mic class="w-4 h-4" />
			</button>

			<!-- Queue Drawer Toggle -->
			<button
				type="button"
				onclick={toggleQueue}
				class="p-2 rounded-xl transition cursor-pointer border {showQueueDrawer ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm' : 'border-transparent text-neutral-400 hover:text-white hover:bg-neutral-800'}"
				title="Play Queue"
			>
				<ListMusic class="w-4 h-4" />
			</button>

			<!-- Volume Controls -->
			<div class="flex items-center gap-1.5">
				<button
					type="button"
					onclick={() => player.toggleMute()}
					class="text-neutral-400 hover:text-white transition cursor-pointer p-1"
					title="Mute / Unmute (M)"
				>
					{#if player.isMuted || player.volume === 0}
						<VolumeX class="w-4 h-4" />
					{:else if player.volume < 0.5}
						<Volume1 class="w-4 h-4" />
					{:else}
						<Volume2 class="w-4 h-4" />
					{/if}
				</button>

				<input
					type="range"
					min="0"
					max="1"
					step="0.01"
					value={player.isMuted ? 0 : player.volume}
					oninput={(e) => player.setVolume(parseFloat(e.currentTarget.value))}
					class="w-16 sm:w-20 h-1 bg-neutral-800 hover:bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
				/>
			</div>
		</div>
	</footer>

	<AddToPlaylistModal
		isOpen={showPlaylistModal}
		trackIds={playlistModalTrackIds}
		trackTitle={playlistModalTitle}
		onClose={() => (showPlaylistModal = false)}
	/>
</div>

<style>
	.no-scrollbar::-webkit-scrollbar {
		display: none;
	}
	.no-scrollbar {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
</style>
