<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types.js';
	import type { Track, Playlist } from '$lib/types/index.js';
	import type { PlayerAlbum, PlayerPlaylist } from './+page.server.js';
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
		ListPlus,
		Plus,
		Trash2,
		Pencil,
		ArrowUp,
		ArrowDown,
		Globe,
		Lock
	} from '@lucide/svelte';
	import AddToPlaylistModal from '$lib/components/AddToPlaylistModal.svelte';

	let { data }: { data: PageData } = $props();

	// Local data collections
	let albums = $state<PlayerAlbum[]>([...data.albums]);
	let playlists = $state<PlayerPlaylist[]>([...data.playlists]);

	// Library Switcher Tab: 'albums' vs 'playlists'
	let libraryTab = $state<'albums' | 'playlists'>(data.initialView === 'playlists' ? 'playlists' : 'albums');

	// Active Main View Target
	let selectedType = $state<'album' | 'playlist'>('album');
	let selectedAlbum = $state<PlayerAlbum | null>(null);
	let selectedPlaylist = $state<PlayerPlaylist | null>(null);

	// Filters & Search
	let librarySearch = $state('');
	let albumFilter = $state<'all' | 'lossless' | 'verified'>('all');
	let playlistFilter = $state<'all' | 'public' | 'private'>('all');
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

	// "Add to Playlist" Modal State
	let showPlaylistModal = $state(false);
	let playlistModalTrackIds = $state<number[]>([]);
	let playlistModalTitle = $state<string | undefined>(undefined);

	function openAddToPlaylist(trackIds: number[], title?: string) {
		playlistModalTrackIds = trackIds;
		playlistModalTitle = title;
		showPlaylistModal = true;
	}

	async function handlePlaylistAdded(playlistId: number) {
		try {
			const res = await fetch(`/api/playlists/${playlistId}`);
			const json = await res.json();
			if (json.playlist && json.tracks) {
				const updatedPl: PlayerPlaylist = {
					...json.playlist,
					tracks: json.tracks
				};
				const idx = playlists.findIndex((p) => p.id === playlistId);
				if (idx !== -1) {
					playlists[idx] = updatedPl;
				} else {
					playlists.push(updatedPl);
				}
				if (selectedPlaylist && selectedPlaylist.id === playlistId) {
					selectedPlaylist = updatedPl;
				}
			}
		} catch (err) {
			console.error('Failed to refresh updated playlist:', err);
		}
	}

	// Playlist CRUD Modals
	let showCreatePlaylistModal = $state(false);
	let newPlaylistName = $state('');
	let newPlaylistComment = $state('');
	let newPlaylistIsPublic = $state(false);
	let isCreatingPlaylist = $state(false);
	let createPlaylistError = $state<string | null>(null);

	let showEditPlaylistModal = $state(false);
	let editPlaylistName = $state('');
	let editPlaylistComment = $state('');
	let editPlaylistIsPublic = $state(false);
	let isSavingPlaylist = $state(false);
	let editPlaylistError = $state<string | null>(null);

	let showDeletePlaylistModal = $state(false);
	let isDeletingPlaylist = $state(false);

	let isReordering = $state(false);

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
			if (!res.ok) {
				lyricsLines = [];
				isInstrumentalLyrics = false;
				return;
			}
			const data = await res.json();
			if (data.status === 'instrumental' || data.is_instrumental) {
				isInstrumentalLyrics = true;
				instrumentalMarker = data.instrumental_marker || '♪';
				lyricsLines = [{ time: 0, text: instrumentalMarker }];
			} else if (data.lyrics_text) {
				isInstrumentalLyrics = false;
				lyricsLines = parseLrc(data.lyrics_text);
			} else {
				isInstrumentalLyrics = false;
				lyricsLines = [];
			}
		} catch (err) {
			console.error('Failed to load lyrics:', err);
			lyricsLines = [];
			isInstrumentalLyrics = false;
		} finally {
			lyricsLoading = false;
		}
	}

	// Reactively re-load lyrics when active track changes
	$effect(() => {
		if (player.currentTrack?.id) {
			loadLyricsForCurrentTrack();
		}
	});

	function toggleLyrics() {
		showLyricsDrawer = !showLyricsDrawer;
		if (showLyricsDrawer) {
			showQueueDrawer = false;
		}
	}

	function toggleQueue() {
		showQueueDrawer = !showQueueDrawer;
		if (showQueueDrawer) {
			showLyricsDrawer = false;
		}
	}

	// Filtered library albums
	let filteredAlbums = $derived.by(() => {
		let list = albums;
		if (librarySearch.trim()) {
			const q = librarySearch.trim().toLowerCase();
			list = list.filter((a) => a.title.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q));
		}

		if (albumFilter === 'verified') {
			list = list.filter((a) => a.checked_count === a.track_count && (a.track_count || 0) > 0);
		} else if (albumFilter === 'lossless') {
			list = list.filter((a) => a.tracks.some((t) => t.format === 'FLAC' || t.format === 'ALAC' || t.format === 'WAV'));
		}
		return list;
	});

	// Filtered library playlists
	let filteredPlaylists = $derived.by(() => {
		let list = playlists;
		if (librarySearch.trim()) {
			const q = librarySearch.trim().toLowerCase();
			list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.comment && p.comment.toLowerCase().includes(q)));
		}

		if (playlistFilter === 'public') {
			list = list.filter((p) => p.is_public === 1);
		} else if (playlistFilter === 'private') {
			list = list.filter((p) => !p.is_public);
		}
		return list;
	});

	// Filtered tracks within currently selected item (album or playlist)
	let displayedTracks = $derived.by(() => {
		const targetTracks = selectedType === 'album' ? selectedAlbum?.tracks : selectedPlaylist?.tracks;
		if (!targetTracks) return [];
		if (!albumTrackSearch.trim()) return targetTracks;
		const q = albumTrackSearch.trim().toLowerCase();
		return targetTracks.filter(
			(t) =>
				t.title.toLowerCase().includes(q) ||
				(t.artist && t.artist.toLowerCase().includes(q)) ||
				(t.album_title && t.album_title.toLowerCase().includes(q))
		);
	});

	// Multi-disc detection and stats for album view
	let albumDiscCount = $derived.by(() => {
		if (selectedType !== 'album' || !selectedAlbum?.tracks) return 1;
		return new Set(selectedAlbum.tracks.map((t) => t.disc_number || 1)).size;
	});
	let albumHasMultipleDiscs = $derived(albumDiscCount > 1);

	function getDiscStats(discNum: number): { count: number; duration: string } {
		if (!selectedAlbum) return { count: 0, duration: '0:00' };
		const discTracks = selectedAlbum.tracks.filter((t) => (t.disc_number || 1) === discNum);
		return {
			count: discTracks.length,
			duration: formatTotalAlbumDuration(discTracks)
		};
	}

	// Select Handlers
	function selectAlbum(album: PlayerAlbum) {
		selectedType = 'album';
		selectedAlbum = album;
		selectedPlaylist = null;
		albumTrackSearch = '';
	}

	function selectPlaylist(playlist: PlayerPlaylist) {
		selectedType = 'playlist';
		selectedPlaylist = playlist;
		selectedAlbum = null;
		albumTrackSearch = '';
	}

	// Playlist Actions
	function playPlaylistAll() {
		if (!selectedPlaylist || selectedPlaylist.tracks.length === 0) return;
		if (player.currentAlbum?.id === -selectedPlaylist.id && player.isPlaying) {
			player.togglePlay();
		} else {
			player.playPlaylist(selectedPlaylist, selectedPlaylist.tracks, 0);
		}
	}

	function playPlaylistShuffle() {
		if (!selectedPlaylist || selectedPlaylist.tracks.length === 0) return;
		const shuffled = [...selectedPlaylist.tracks].sort(() => Math.random() - 0.5);
		player.playPlaylist(selectedPlaylist, shuffled, 0);
	}

	async function movePlaylistTrack(originalIdx: number, direction: 'up' | 'down') {
		if (!selectedPlaylist || isReordering) return;
		const targetIndex = direction === 'up' ? originalIdx - 1 : originalIdx + 1;
		if (targetIndex < 0 || targetIndex >= selectedPlaylist.tracks.length) return;

		const newTracks = [...selectedPlaylist.tracks];
		const temp = newTracks[originalIdx];
		newTracks[originalIdx] = newTracks[targetIndex];
		newTracks[targetIndex] = temp;
		selectedPlaylist.tracks = newTracks;

		isReordering = true;
		try {
			const res = await fetch(`/api/playlists/${selectedPlaylist.id}/tracks`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ trackIds: newTracks.map((t) => t.id) })
			});
			const result = await res.json();
			if (result.tracks) {
				selectedPlaylist.tracks = result.tracks;
				const pIdx = playlists.findIndex((p) => p.id === selectedPlaylist!.id);
				if (pIdx !== -1) {
					playlists[pIdx].tracks = result.tracks;
				}
			}
		} catch (err) {
			console.error('Failed to reorder playlist tracks:', err);
		} finally {
			isReordering = false;
		}
	}

	async function removePlaylistTrack(originalIdx: number, track: Track) {
		if (!selectedPlaylist) return;
		if (!confirm(`Remove "${track.title}" from ${selectedPlaylist.name}?`)) return;

		const originalTracks = [...selectedPlaylist.tracks];
		selectedPlaylist.tracks = selectedPlaylist.tracks.filter((_, idx) => idx !== originalIdx);

		try {
			const res = await fetch(
				`/api/playlists/${selectedPlaylist.id}/tracks?trackIndex=${originalIdx}&trackId=${track.id}`,
				{ method: 'DELETE' }
			);
			const result = await res.json();
			if (result.tracks) {
				selectedPlaylist.tracks = result.tracks;
				const pIdx = playlists.findIndex((p) => p.id === selectedPlaylist!.id);
				if (pIdx !== -1) {
					playlists[pIdx].tracks = result.tracks;
					playlists[pIdx].song_count = result.tracks.length;
				}
			}
		} catch (err) {
			console.error('Failed to remove track:', err);
			selectedPlaylist.tracks = originalTracks;
		}
	}

	async function handleCreatePlaylist(e: SubmitEvent) {
		e.preventDefault();
		if (!newPlaylistName.trim()) return;

		isCreatingPlaylist = true;
		createPlaylistError = null;

		try {
			const res = await fetch('/api/playlists', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: newPlaylistName.trim(),
					comment: newPlaylistComment.trim() || null,
					is_public: newPlaylistIsPublic
				})
			});

			const result = await res.json();
			if (!res.ok || result.error) {
				createPlaylistError = result.error || 'Failed to create playlist';
				return;
			}

			const created: PlayerPlaylist = {
				...result.playlist,
				tracks: []
			};

			playlists.unshift(created);
			selectPlaylist(created);
			libraryTab = 'playlists';

			showCreatePlaylistModal = false;
			newPlaylistName = '';
			newPlaylistComment = '';
			newPlaylistIsPublic = false;
		} catch (err: any) {
			createPlaylistError = err.message || 'Network error';
		} finally {
			isCreatingPlaylist = false;
		}
	}

	async function handleSavePlaylistDetails(e: SubmitEvent) {
		e.preventDefault();
		if (!selectedPlaylist || !editPlaylistName.trim()) return;

		isSavingPlaylist = true;
		editPlaylistError = null;

		try {
			const res = await fetch(`/api/playlists/${selectedPlaylist.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: editPlaylistName.trim(),
					comment: editPlaylistComment.trim() || null,
					is_public: editPlaylistIsPublic
				})
			});

			const result = await res.json();
			if (!res.ok || result.error) {
				editPlaylistError = result.error || 'Failed to update playlist';
				return;
			}

			if (result.playlist) {
				selectedPlaylist.name = result.playlist.name;
				selectedPlaylist.comment = result.playlist.comment;
				selectedPlaylist.is_public = result.playlist.is_public;

				const pIdx = playlists.findIndex((p) => p.id === selectedPlaylist!.id);
				if (pIdx !== -1) {
					playlists[pIdx].name = result.playlist.name;
					playlists[pIdx].comment = result.playlist.comment;
					playlists[pIdx].is_public = result.playlist.is_public;
				}
			}
			showEditPlaylistModal = false;
		} catch (err: any) {
			editPlaylistError = err.message || 'Network error';
		} finally {
			isSavingPlaylist = false;
		}
	}

	async function handleDeletePlaylist() {
		if (!selectedPlaylist) return;
		isDeletingPlaylist = true;
		try {
			const res = await fetch(`/api/playlists/${selectedPlaylist.id}`, {
				method: 'DELETE'
			});
			if (res.ok) {
				playlists = playlists.filter((p) => p.id !== selectedPlaylist!.id);
				showDeletePlaylistModal = false;
				if (playlists.length > 0) {
					selectPlaylist(playlists[0]);
				} else if (albums.length > 0) {
					selectAlbum(albums[0]);
					libraryTab = 'albums';
				} else {
					selectedPlaylist = null;
				}
			} else {
				alert('Failed to delete playlist');
			}
		} catch (err) {
			console.error('Failed to delete playlist:', err);
			alert('Network error while deleting playlist');
		} finally {
			isDeletingPlaylist = false;
		}
	}

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
		// Initial Target Selection from parameters or player state
		if (data.initialPlaylistId) {
			const foundPl = playlists.find((p) => p.id === data.initialPlaylistId);
			if (foundPl) {
				selectPlaylist(foundPl);
				libraryTab = 'playlists';
			}
		} else if (data.initialAlbumId) {
			const foundAlb = albums.find((a) => a.id === data.initialAlbumId);
			if (foundAlb) {
				selectAlbum(foundAlb);
				libraryTab = 'albums';
			}
		} else if (player.currentAlbum) {
			const activeAlbum = player.currentAlbum;
			if (activeAlbum.id < 0) {
				const plId = -activeAlbum.id;
				const foundPl = playlists.find((p) => p.id === plId);
				if (foundPl) {
					selectPlaylist(foundPl);
					libraryTab = 'playlists';
				}
			} else {
				const foundAlb = albums.find((a) => a.id === activeAlbum.id);
				if (foundAlb) {
					selectAlbum(foundAlb);
					libraryTab = 'albums';
				}
			}
		}

		// Fallback default selection
		if (!selectedAlbum && !selectedPlaylist) {
			if (libraryTab === 'playlists' && playlists.length > 0) {
				selectPlaylist(playlists[0]);
			} else if (albums.length > 0) {
				selectAlbum(albums[0]);
			} else if (playlists.length > 0) {
				selectPlaylist(playlists[0]);
			}
		}

		if (data.initialTrackId && !player.currentTrack) {
			let foundTrack: Track | undefined;
			let foundAlbum: (typeof albums)[0] | undefined;
			for (const alb of albums) {
				const candidate = alb.tracks.find((t) => t.id === data.initialTrackId);
				if (candidate) {
					foundTrack = candidate;
					foundAlbum = alb;
					break;
				}
			}
			if (foundTrack && foundAlbum) {
				selectAlbum(foundAlbum);
				player.playTrack(foundTrack, foundAlbum, foundAlbum.tracks);
			}
		}
	});
</script>

<svelte:window onkeydown={handleKeyDown} />

<!-- Trax Vault Studio Audio Player (Full Viewport, Non-Scrollable Window) -->
<div class="flex-1 h-full flex flex-col bg-neutral-950 text-neutral-100 font-sans select-none overflow-hidden min-h-0">
	<!-- Workspace: Side Library + Main Stage + Drawers -->
	<div class="flex-1 flex overflow-hidden min-h-0 p-3 gap-3">
		<!-- LEFT SIDEBAR: Vault Audio Library & Playlists -->
		<aside class="order-1 w-72 lg:w-80 bg-neutral-900/60 backdrop-blur-xl border border-neutral-800/70 rounded-2xl flex flex-col overflow-hidden shrink-0 shadow-xl">
			<!-- Header & Mode Tabs -->
			<div class="p-3.5 pb-2 border-b border-neutral-800/60 shrink-0">
				<div class="flex items-center justify-between mb-2.5">
					<div class="flex items-center gap-2 text-white font-bold text-xs tracking-wide">
						<Disc3 class="w-4 h-4 text-emerald-400" />
						<span>Your Library</span>
					</div>

					<div class="flex items-center gap-2">
						<!-- "+ New Playlist" Button -->
						<button
							type="button"
							onclick={() => {
								newPlaylistName = '';
								newPlaylistComment = '';
								newPlaylistIsPublic = false;
								createPlaylistError = null;
								showCreatePlaylistModal = true;
							}}
							class="flex items-center gap-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/25 transition cursor-pointer"
							title="Create New Playlist"
						>
							<Plus class="w-3 h-3" />
							<span>Playlist</span>
						</button>
					</div>
				</div>

				<!-- Segmented Switcher: Albums vs Playlists -->
				<div class="grid grid-cols-2 p-0.5 rounded-xl bg-neutral-950/80 border border-neutral-800 mb-2.5">
					<button
						type="button"
						onclick={() => (libraryTab = 'albums')}
						class="flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer {libraryTab === 'albums'
							? 'bg-neutral-800 text-white shadow-sm'
							: 'text-neutral-400 hover:text-neutral-200'}"
					>
						<Disc3 class="w-3.5 h-3.5 {libraryTab === 'albums' ? 'text-emerald-400' : ''}" />
						<span>Albums ({albums.length})</span>
					</button>

					<button
						type="button"
						onclick={() => (libraryTab = 'playlists')}
						class="flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer {libraryTab === 'playlists'
							? 'bg-neutral-800 text-white shadow-sm'
							: 'text-neutral-400 hover:text-neutral-200'}"
					>
						<ListMusic class="w-3.5 h-3.5 {libraryTab === 'playlists' ? 'text-emerald-400' : ''}" />
						<span>Playlists ({playlists.length})</span>
					</button>
				</div>

				<!-- Search Input -->
				<div class="relative">
					<Search class="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
					<input
						type="text"
						bind:value={librarySearch}
						placeholder={libraryTab === 'albums' ? 'Search album, artist...' : 'Search playlists...'}
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
					{#if libraryTab === 'albums'}
						{#each [
							{ id: 'all', label: 'All' },
							{ id: 'lossless', label: 'FLAC / Hi-Res' },
							{ id: 'verified', label: 'Verified' }
						] as chip}
							<button
								type="button"
								onclick={() => (albumFilter = chip.id as any)}
								class="px-2.5 py-0.5 rounded-lg text-[10px] font-semibold transition cursor-pointer shrink-0 border {albumFilter === chip.id
									? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm'
									: 'bg-neutral-950/60 text-neutral-400 border-neutral-800 hover:text-white hover:bg-neutral-800'}"
							>
								{chip.label}
							</button>
						{/each}
					{:else}
						{#each [
							{ id: 'all', label: 'All Playlists' },
							{ id: 'public', label: 'Public' },
							{ id: 'private', label: 'Private' }
						] as chip}
							<button
								type="button"
								onclick={() => (playlistFilter = chip.id as any)}
								class="px-2.5 py-0.5 rounded-lg text-[10px] font-semibold transition cursor-pointer shrink-0 border {playlistFilter === chip.id
									? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm'
									: 'bg-neutral-950/60 text-neutral-400 border-neutral-800 hover:text-white hover:bg-neutral-800'}"
							>
								{chip.label}
							</button>
						{/each}
					{/if}
				</div>
			</div>

			<!-- Scrollable Items List -->
			<div class="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
				{#if libraryTab === 'albums'}
					{#each filteredAlbums as album}
						{@const isSelected = selectedType === 'album' && selectedAlbum?.id === album.id}
						{@const isPlayingThisAlbum = player.currentAlbum?.id === album.id && player.isPlaying}
						<div
							role="button"
							tabindex="0"
							onclick={() => selectAlbum(album)}
							onkeydown={(e) => {
								if (e.key === 'Enter') selectAlbum(album);
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
									selectAlbum(album);
									if (album.tracks.length > 0) {
										player.playTrack(album.tracks[0], album, album.tracks);
									}
								}}
								class="w-7 h-7 rounded-full bg-emerald-500 hover:bg-emerald-400 text-neutral-950 flex items-center justify-center opacity-0 group-hover:opacity-100 transition shadow-md cursor-pointer shrink-0"
								title="Play {album.title}"
							>
								<Play class="w-3.5 h-3.5 fill-current ml-0.5" />
							</button>
						</div>
					{/each}
				{:else}
					<!-- PLAYLISTS LIST -->
					<!-- Quick Add Card -->
					<button
						type="button"
						onclick={() => {
							newPlaylistName = '';
							newPlaylistComment = '';
							newPlaylistIsPublic = false;
							createPlaylistError = null;
							showCreatePlaylistModal = true;
						}}
						class="w-full flex items-center gap-2.5 p-2 rounded-xl border border-dashed border-neutral-800 hover:border-emerald-500/50 hover:bg-neutral-800/30 text-neutral-400 hover:text-emerald-300 transition text-left cursor-pointer group"
					>
						<div class="w-11 h-11 rounded-lg bg-neutral-900 border border-neutral-800 flex items-center justify-center group-hover:border-emerald-500/40 text-neutral-400 group-hover:text-emerald-400 shrink-0">
							<Plus class="w-5 h-5" />
						</div>
						<div class="min-w-0 flex-1">
							<div class="text-xs font-semibold">New Playlist</div>
							<div class="text-[10px] text-neutral-500">Create a mix or custom collection</div>
						</div>
					</button>

					{#each filteredPlaylists as playlist}
						{@const isSelected = selectedType === 'playlist' && selectedPlaylist?.id === playlist.id}
						{@const isPlayingThisPl = player.currentAlbum?.id === -playlist.id && player.isPlaying}
						<div
							role="button"
							tabindex="0"
							onclick={() => selectPlaylist(playlist)}
							onkeydown={(e) => {
								if (e.key === 'Enter') selectPlaylist(playlist);
							}}
							class="w-full flex items-center gap-2.5 p-2 rounded-xl transition text-left cursor-pointer group border {isSelected
								? 'bg-neutral-800/80 border-emerald-500/40 text-white shadow-md'
								: 'border-transparent text-neutral-300 hover:bg-neutral-800/40 hover:text-white'}"
						>
							<!-- Playlist Cover Art -->
							<div class="relative w-11 h-11 rounded-lg overflow-hidden bg-neutral-950 shrink-0 border border-neutral-800 shadow-sm">
								{#if playlist.cover_url}
									<img src={playlist.cover_url} alt={playlist.name} class="w-full h-full object-cover" />
								{:else}
									<div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-neutral-900 via-neutral-950 to-emerald-950/20 text-emerald-400">
										<ListMusic class="w-5 h-5 opacity-40" />
									</div>
								{/if}

								{#if isPlayingThisPl}
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
								<div class="text-xs font-semibold truncate {isPlayingThisPl ? 'text-emerald-300' : 'text-neutral-100'}">
									{playlist.name}
								</div>
								<div class="text-[10px] text-neutral-400 truncate mt-0.5 flex items-center gap-1.5">
									<span>{playlist.tracks.length} songs</span>
									<span>&bull;</span>
									{#if playlist.is_public}
										<span class="text-emerald-400">Public</span>
									{:else}
										<span class="text-neutral-500">Private</span>
									{/if}
								</div>
							</div>

							<!-- Instant Play Trigger on Hover -->
							{#if playlist.tracks.length > 0}
								<button
									type="button"
									onclick={(e) => {
										e.stopPropagation();
										selectPlaylist(playlist);
										player.playPlaylist(playlist, playlist.tracks, 0);
									}}
									class="w-7 h-7 rounded-full bg-emerald-500 hover:bg-emerald-400 text-neutral-950 flex items-center justify-center opacity-0 group-hover:opacity-100 transition shadow-md cursor-pointer shrink-0"
									title="Play {playlist.name}"
								>
									<Play class="w-3.5 h-3.5 fill-current ml-0.5" />
								</button>
							{/if}
						</div>
					{/each}
				{/if}
			</div>
		</aside>

		<!-- CENTER / MIDDLE PANEL: Studio Synced Lyrics (When Open) -->
		{#if showLyricsDrawer}
			<section class="order-2 flex-1 bg-neutral-900/60 backdrop-blur-xl border border-neutral-800/70 rounded-2xl flex flex-col overflow-hidden min-h-0 shadow-xl animate-in fade-in duration-200">
				<!-- Lyrics Header -->
				<div class="p-3.5 px-5 border-b border-neutral-800/60 flex items-center justify-between shrink-0">
					<div class="flex items-center gap-2.5">
						<div class="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
							<Mic class="w-4 h-4" />
						</div>
						<div>
							<h3 class="font-bold text-xs text-white">Live Synced Lyrics</h3>
							{#if player.currentTrack}
								<p class="text-[10px] text-neutral-400 truncate max-w-xs">{player.currentTrack.title} &bull; {player.currentTrack.artist || player.currentAlbum?.artist}</p>
							{/if}
						</div>
					</div>

					<div class="flex items-center gap-2">
						{#if player.currentTrack && lyricsLines.length > 0}
							<a
								href="/lrc-maker?trackId={player.currentTrack.id}"
								class="text-[11px] font-semibold text-neutral-400 hover:text-emerald-300 px-2 py-1 rounded-lg hover:bg-neutral-800/60 transition"
								title="Edit in LRC Maker Studio"
							>
								Edit LRC &rarr;
							</a>
						{/if}

						<button
							type="button"
							onclick={() => {
								showLyricsDrawer = false;
							}}
							class="text-neutral-400 hover:text-white p-1.5 rounded-lg hover:bg-neutral-800 cursor-pointer transition"
							title="Close Lyrics"
						>
							<X class="w-4 h-4" />
						</button>
					</div>
				</div>

				<!-- Lyrics Scrollable Body -->
				<div class="flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col min-h-0">
					{#if lyricsLoading}
						<div class="flex-1 flex flex-col items-center justify-center text-xs text-neutral-400 gap-2">
							<div class="w-5 h-5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin"></div>
							<span>Loading synced lyrics...</span>
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
						<div bind:this={lyricsContainerEl} class="max-w-2xl mx-auto w-full space-y-2 py-8 px-2">
							{#each lyricsLines as line, i}
								{@const isActive = activeLyricLineIndex === i}
								<button
									type="button"
									id={`lyrics-line-${i}`}
									onclick={() => line.time !== null && player.seekTo(line.time)}
									class="w-full text-left cursor-pointer rounded-2xl px-4 py-2.5 text-[17px] font-semibold leading-relaxed border transition-all duration-200 {isActive
										? 'text-emerald-300 bg-emerald-950/40 border-emerald-500/40 drop-shadow-[0_0_14px_rgba(16,185,129,0.4)] scale-[1.01]'
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
				</div>
			</section>
		{/if}

		<!-- SONGS & HERO PANEL: Main Viewport (Center when lyrics closed, Right when lyrics open) -->
		<main class="{showLyricsDrawer ? 'order-3 flex-1 min-w-[320px] lg:min-w-[380px] lg:max-w-[480px] xl:max-w-[540px]' : 'order-2 flex-1 min-w-0'} bg-neutral-900/60 backdrop-blur-xl border border-neutral-800/70 rounded-2xl flex flex-col overflow-hidden min-h-0 shadow-xl transition-all duration-200">
			{#if selectedType === 'album' && selectedAlbum}
				<!-- ALBUM HERO BANNER -->
				<div class="{showLyricsDrawer ? 'p-4 pb-3' : 'p-6 pb-4'} border-b border-neutral-800/60 shrink-0">
					<div class="flex flex-col sm:flex-row items-center sm:items-end gap-4">
						<!-- Big Album Cover -->
						<div class="relative {showLyricsDrawer ? 'w-24 h-24 sm:w-28 sm:h-28' : 'w-36 h-36 sm:w-44 sm:h-44'} rounded-2xl overflow-hidden bg-neutral-950 shrink-0 shadow-2xl border border-neutral-800">
							{#if selectedAlbum.cover_url}
								<img src={selectedAlbum.cover_url} alt={selectedAlbum.title} class="w-full h-full object-cover" />
							{:else}
								<div class="w-full h-full flex items-center justify-center bg-neutral-900 text-neutral-600">
									<Music class={showLyricsDrawer ? 'w-10 h-10' : 'w-14 h-14'} />
								</div>
							{/if}
						</div>

						<!-- Album Metadata Header -->
						<div class="flex-1 min-w-0 text-center sm:text-left space-y-1.5">
							<div class="flex flex-wrap items-center justify-center sm:justify-start gap-1.5">
								<span class="text-[10px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-800/50">
									Album
								</span>

								{#if selectedAlbum.tracks.some(t => t.format === 'FLAC')}
									<span class="text-[10px] font-mono text-cyan-300 bg-cyan-950/60 px-2 py-0.5 rounded-full border border-cyan-800/50">
										Lossless FLAC
									</span>
								{/if}

								{#if (selectedAlbum.track_count || 0) > 0 && selectedAlbum.checked_count === selectedAlbum.track_count}
									<span class="text-[10px] font-semibold text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-600 flex items-center gap-1">
										<CircleCheck class="w-3 h-3 text-emerald-400" />
										Verified
									</span>
								{/if}
							</div>

							<h1 class="{showLyricsDrawer ? 'text-lg sm:text-xl font-bold' : 'text-xl sm:text-3xl lg:text-4xl font-extrabold'} text-white tracking-tight leading-tight line-clamp-2">
								{selectedAlbum.title}
							</h1>

							<div class="flex flex-wrap items-center justify-center sm:justify-start gap-1.5 text-xs text-neutral-300">
								<span class="font-bold text-white truncate max-w-[200px]">
									{selectedAlbum.artist}
								</span>
								{#if selectedAlbum.release_year}
									<span>&bull;</span>
									<span class="text-neutral-400">{selectedAlbum.release_year}</span>
								{/if}
								<span>&bull;</span>
								<span class="text-neutral-400">{selectedAlbum.tracks.length} tracks{albumHasMultipleDiscs ? ` (${albumDiscCount} CDs)` : ''}</span>
								{#if selectedAlbum.genre && !showLyricsDrawer}
									<span>&bull;</span>
									<span class="px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700/60 text-[10px]">
										{selectedAlbum.genre}
									</span>
								{/if}
							</div>

							<!-- Action Bar -->
							<div class="pt-1.5 flex flex-wrap items-center justify-center sm:justify-start gap-2">
								<!-- Play Button -->
								<button
									type="button"
									onclick={() => {
										if (player.currentAlbum?.id === selectedAlbum!.id && player.isPlaying) {
											player.togglePlay();
										} else if (selectedAlbum!.tracks.length > 0) {
											player.playTrack(selectedAlbum!.tracks[0], selectedAlbum!, selectedAlbum!.tracks);
										}
									}}
									class="px-4 py-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-neutral-950 font-bold text-xs shadow-lg shadow-emerald-500/20 hover:scale-105 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
								>
									{#if player.currentAlbum?.id === selectedAlbum.id && player.isPlaying}
										<Pause class="w-3.5 h-3.5 fill-current" />
										<span>Pause</span>
									{:else}
										<Play class="w-3.5 h-3.5 fill-current ml-0.5" />
										<span>Play</span>
									{/if}
								</button>

								<!-- Shuffle Button -->
								<button
									type="button"
									onclick={() => {
										player.toggleShuffle();
										if (!player.isPlaying || player.currentAlbum?.id !== selectedAlbum!.id) {
											if (selectedAlbum!.tracks.length > 0) {
												player.playTrack(selectedAlbum!.tracks[0], selectedAlbum!, selectedAlbum!.tracks);
											}
										}
									}}
									class="p-1.5 rounded-xl bg-neutral-800/80 border border-neutral-700/70 text-neutral-300 hover:text-white hover:bg-neutral-700 text-xs font-semibold transition flex items-center gap-1"
									title="Shuffle Play"
								>
									<Shuffle class="w-3.5 h-3.5" />
									<span class="hidden sm:inline">Shuffle</span>
								</button>

								<!-- Open in Album Details -->
								<a
									href="/album/{selectedAlbum.id}"
									class="p-1.5 rounded-xl bg-neutral-800/80 border border-neutral-700/70 text-neutral-300 hover:text-white hover:bg-neutral-700 text-xs font-semibold transition flex items-center gap-1"
									title="View Album Details & Fixer Rules"
								>
									<ExternalLink class="w-3.5 h-3.5" />
									<span class="hidden sm:inline">Details</span>
								</a>

								<!-- Add Album to Playlist -->
								<button
									type="button"
									onclick={() => openAddToPlaylist(selectedAlbum!.tracks.map((t) => t.id), selectedAlbum!.title)}
									class="p-1.5 rounded-xl bg-neutral-800/80 border border-neutral-700/70 text-neutral-300 hover:text-white hover:bg-neutral-700 text-xs font-semibold transition flex items-center gap-1"
									title="Add entire album to a playlist"
								>
									<ListPlus class="w-3.5 h-3.5 text-emerald-400" />
									<span class="hidden sm:inline">Add</span>
								</button>

								<!-- Search in Album -->
								<div class="relative ml-auto hidden md:block {showLyricsDrawer ? 'w-32' : 'w-48'}">
									<Search class="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
									<input
										type="text"
										bind:value={albumTrackSearch}
										placeholder="Filter..."
										class="w-full bg-neutral-950/80 text-xs text-white placeholder-neutral-500 rounded-xl pl-7 pr-2.5 py-1 border border-neutral-800 focus:outline-none focus:border-emerald-500/60"
									/>
								</div>
							</div>
						</div>
					</div>
				</div>

				<!-- Tracklist Table Container -->
				<div class="flex-1 overflow-y-auto px-4 py-2 min-h-0">
					<table class="w-full text-left text-xs border-collapse">
						<thead class="text-neutral-400 border-b border-neutral-800/60 sticky top-0 bg-neutral-900/90 backdrop-blur z-10">
							<tr class="h-8">
								<th class="w-10 text-center font-semibold">#</th>
								<th class="font-semibold">Title</th>
								{#if !showLyricsDrawer}
									<th class="font-semibold hidden sm:table-cell">Quality</th>
									<th class="font-semibold hidden md:table-cell">Lyrics</th>
								{/if}
								<th class="w-14 text-right pr-2 font-semibold"><Clock class="w-3.5 h-3.5 inline text-neutral-500" /></th>
								<th class="w-8 text-center pr-3 font-semibold"></th>
							</tr>
						</thead>
						<tbody class="divide-y divide-neutral-800/30">
							{#each displayedTracks as track, idx}
								{@const currentDisc = track.disc_number || 1}
								{@const showDiscHeader = selectedType === 'album' && albumHasMultipleDiscs && !albumTrackSearch.trim() && (idx === 0 || (displayedTracks[idx - 1]?.disc_number || 1) !== currentDisc)}
								{@const discStats = showDiscHeader ? getDiscStats(currentDisc) : null}

								{#if showDiscHeader}
									<tr class="bg-neutral-900/95 border-y border-neutral-800/80 sticky top-8 z-[5] backdrop-blur-md group/disc">
										<td colspan={showLyricsDrawer ? 4 : 6} class="py-2 px-3 text-left sticky top-8 bg-neutral-900/95 backdrop-blur-md z-[5]">
											<div class="flex items-center justify-between">
												<div class="flex items-center gap-2">
													<div class="w-5 h-5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shadow-xs">
														<Disc3 class="w-3.5 h-3.5" />
													</div>
													<span class="text-xs font-bold uppercase tracking-wider text-neutral-200">
														Disc {currentDisc}
													</span>
													{#if discStats}
														<span class="text-[11px] font-normal text-neutral-400">
															&bull; {discStats.count} {discStats.count === 1 ? 'track' : 'tracks'} ({discStats.duration})
														</span>
													{/if}
												</div>

												<button
													type="button"
													onclick={(e) => {
														e.stopPropagation();
														const discTracks = selectedAlbum!.tracks.filter((t) => (t.disc_number || 1) === currentDisc);
														if (discTracks.length > 0) {
															player.playTrack(discTracks[0], selectedAlbum!, selectedAlbum!.tracks);
														}
													}}
													class="opacity-90 sm:opacity-0 sm:group-hover/disc:opacity-100 flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-[10px] font-semibold transition cursor-pointer"
													title="Play Disc {currentDisc}"
												>
													<Play class="w-2.5 h-2.5 fill-current" />
													<span>Play Disc</span>
												</button>
											</div>
										</td>
									</tr>
								{/if}

								{@const isCurrent = player.currentTrack?.id === track.id}
								{@const isCurrentPlaying = isCurrent && player.isPlaying}
								<tr
									onclick={() => player.playTrack(track, selectedAlbum!, selectedAlbum!.tracks)}
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
											{track.artist || selectedAlbum!.artist}
										</div>
									</td>

									{#if !showLyricsDrawer}
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
														player.playTrack(track, selectedAlbum!, selectedAlbum!.tracks);
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
									{/if}

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
			{:else if selectedType === 'playlist' && selectedPlaylist}
				<!-- PLAYLIST HERO BANNER -->
				<div class="{showLyricsDrawer ? 'p-4 pb-3' : 'p-6 pb-4'} border-b border-neutral-800/60 shrink-0">
					<div class="flex flex-col sm:flex-row items-center sm:items-end gap-4">
						<!-- Big Playlist Cover Art -->
						<div class="relative {showLyricsDrawer ? 'w-24 h-24 sm:w-28 sm:h-28' : 'w-36 h-36 sm:w-44 sm:h-44'} rounded-2xl overflow-hidden bg-neutral-950 shrink-0 shadow-2xl border border-neutral-800">
							{#if selectedPlaylist.cover_url}
								<img src={selectedPlaylist.cover_url} alt={selectedPlaylist.name} class="w-full h-full object-cover" />
							{:else}
								<div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-neutral-900 via-neutral-950 to-emerald-950/20 text-emerald-400">
									<ListMusic class={showLyricsDrawer ? 'w-10 h-10' : 'w-16 h-16'} opacity-40 />
								</div>
							{/if}
						</div>

						<!-- Playlist Metadata Header -->
						<div class="flex-1 min-w-0 text-center sm:text-left space-y-1.5">
							<div class="flex flex-wrap items-center justify-center sm:justify-start gap-1.5">
								<span class="text-[10px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-950/60 px-2.5 py-0.5 rounded-full border border-emerald-800/50">
									Playlist
								</span>

								{#if selectedPlaylist.is_public}
									<span class="text-[10px] font-medium text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-600/50 flex items-center gap-1">
										<Globe class="w-3 h-3 text-emerald-400" />
										Public
									</span>
								{:else}
									<span class="text-[10px] font-medium text-neutral-400 bg-neutral-900/80 px-2 py-0.5 rounded-full border border-neutral-700/60 flex items-center gap-1">
										<Lock class="w-3 h-3 text-neutral-400" />
										Private
									</span>
								{/if}
							</div>

							<h1 class="{showLyricsDrawer ? 'text-lg sm:text-xl font-bold' : 'text-xl sm:text-3xl lg:text-4xl font-extrabold'} text-white tracking-tight leading-tight line-clamp-2">
								{selectedPlaylist.name}
							</h1>

							{#if selectedPlaylist.comment && !showLyricsDrawer}
								<p class="text-xs text-neutral-300 line-clamp-2 max-w-xl">
									{selectedPlaylist.comment}
								</p>
							{/if}

							<div class="flex flex-wrap items-center justify-center sm:justify-start gap-1.5 text-xs text-neutral-400">
								<span class="text-neutral-200 font-semibold">{selectedPlaylist.tracks.length} songs</span>
								<span>&bull;</span>
								<span>{formatTotalAlbumDuration(selectedPlaylist.tracks)}</span>
							</div>

							<!-- Playlist Action Bar -->
							<div class="pt-1.5 flex flex-wrap items-center justify-center sm:justify-start gap-2">
								<!-- Play Button -->
								<button
									type="button"
									onclick={playPlaylistAll}
									disabled={selectedPlaylist.tracks.length === 0}
									class="px-4 py-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-neutral-950 font-bold text-xs shadow-lg shadow-emerald-500/20 hover:scale-105 active:scale-95 disabled:opacity-40 transition-all flex items-center gap-1.5 cursor-pointer"
								>
									{#if player.currentAlbum?.id === -selectedPlaylist.id && player.isPlaying}
										<Pause class="w-3.5 h-3.5 fill-current" />
										<span>Pause</span>
									{:else}
										<Play class="w-3.5 h-3.5 fill-current ml-0.5" />
										<span>Play</span>
									{/if}
								</button>

								<!-- Shuffle Button -->
								<button
									type="button"
									onclick={playPlaylistShuffle}
									disabled={selectedPlaylist.tracks.length === 0}
									class="p-1.5 rounded-xl bg-neutral-800/80 border border-neutral-700/70 text-neutral-300 hover:text-white hover:bg-neutral-700 text-xs font-semibold disabled:opacity-40 transition flex items-center gap-1"
									title="Shuffle Play"
								>
									<Shuffle class="w-3.5 h-3.5" />
									<span class="hidden sm:inline">Shuffle</span>
								</button>

								<!-- Edit Details Button -->
								<button
									type="button"
									onclick={() => {
										editPlaylistName = selectedPlaylist!.name;
										editPlaylistComment = selectedPlaylist!.comment || '';
										editPlaylistIsPublic = Boolean(selectedPlaylist!.is_public);
										editPlaylistError = null;
										showEditPlaylistModal = true;
									}}
									class="p-1.5 rounded-xl bg-neutral-800/80 border border-neutral-700/70 text-neutral-300 hover:text-white hover:bg-neutral-700 text-xs font-semibold transition flex items-center gap-1"
									title="Edit Playlist Details"
								>
									<Pencil class="w-3.5 h-3.5 text-neutral-300" />
									<span class="hidden sm:inline">Edit</span>
								</button>

								<!-- Delete Playlist Button -->
								<button
									type="button"
									onclick={() => (showDeletePlaylistModal = true)}
									class="p-1.5 rounded-xl bg-rose-950/20 border border-rose-900/40 text-rose-300 hover:bg-rose-950/50 hover:text-rose-200 text-xs font-semibold transition flex items-center gap-1"
									title="Delete Playlist"
								>
									<Trash2 class="w-3.5 h-3.5" />
									<span class="hidden sm:inline">Delete</span>
								</button>

								<!-- Search in Playlist -->
								<div class="relative ml-auto hidden md:block {showLyricsDrawer ? 'w-32' : 'w-48'}">
									<Search class="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
									<input
										type="text"
										bind:value={albumTrackSearch}
										placeholder="Filter..."
										class="w-full bg-neutral-950/80 text-xs text-white placeholder-neutral-500 rounded-xl pl-7 pr-2.5 py-1 border border-neutral-800 focus:outline-none focus:border-emerald-500/60"
									/>
								</div>
							</div>
						</div>
					</div>
				</div>

				<!-- Playlist Tracklist Table Container -->
				<div class="flex-1 overflow-y-auto px-4 py-2 min-h-0">
					{#if selectedPlaylist.tracks.length > 0}
						<table class="w-full text-left text-xs border-collapse">
							<thead class="text-neutral-400 border-b border-neutral-800/60 sticky top-0 bg-neutral-900/90 backdrop-blur z-10">
								<tr class="h-8">
									<th class="w-10 text-center font-semibold">#</th>
									<th class="font-semibold">Title & Artist</th>
									{#if !showLyricsDrawer}
										<th class="font-semibold hidden md:table-cell">Album</th>
										<th class="font-semibold hidden sm:table-cell">Quality</th>
									{/if}
									<th class="w-14 text-right pr-2 font-semibold"><Clock class="w-3.5 h-3.5 inline text-neutral-500" /></th>
									<th class="w-24 text-right pr-3 font-semibold">Order</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-neutral-800/30">
								{#each displayedTracks as track, idx (track.id + '-' + idx)}
									{@const originalIdx = selectedPlaylist.tracks.findIndex((t) => t.id === track.id)}
									{@const isCurrent = player.currentTrack?.id === track.id}
									{@const isCurrentPlaying = isCurrent && player.isPlaying}
									<tr
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
												<span class="group-hover:hidden text-neutral-500">{originalIdx + 1}</span>
												<button
													type="button"
													onclick={() => player.playPlaylist(selectedPlaylist!, selectedPlaylist!.tracks, originalIdx)}
													class="hidden group-hover:inline-flex items-center justify-center text-emerald-400 hover:text-emerald-300"
												>
													<Play class="w-3.5 h-3.5 fill-current" />
												</button>
											{/if}
										</td>

										<!-- Track Title & Artist -->
										<td class="py-2 pr-3 min-w-0">
											<div class="font-semibold truncate {isCurrent ? 'text-emerald-300' : 'text-neutral-100'}">
												{track.title}
											</div>
											<div class="text-[10px] text-neutral-400 truncate">
												{track.artist}
											</div>
										</td>

										{#if !showLyricsDrawer}
											<!-- Album Title Link -->
											<td class="hidden md:table-cell pr-3">
												{#if track.album_id}
													<a
														href="/album/{track.album_id}"
														class="text-neutral-400 hover:text-emerald-400 hover:underline truncate block"
														title={track.album_title || 'Album'}
													>
														{track.album_title || 'Album'}
													</a>
												{:else}
													<span class="text-neutral-500">&mdash;</span>
												{/if}
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
										{/if}

										<!-- Duration -->
										<td class="text-right pr-2 font-mono tabular-nums text-xs text-neutral-400">
											{formatDurationMs(track.duration_ms)}
										</td>

										<!-- Reorder & Remove Actions -->
										<td class="text-right pr-3">
											<div class="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
												<!-- Move Up -->
												<button
													type="button"
													onclick={(e) => {
														e.stopPropagation();
														movePlaylistTrack(originalIdx, 'up');
													}}
													disabled={originalIdx === 0 || isReordering}
													class="p-1 rounded text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-20 transition"
													title="Move Up"
												>
													<ArrowUp class="w-3.5 h-3.5" />
												</button>

												<!-- Move Down -->
												<button
													type="button"
													onclick={(e) => {
														e.stopPropagation();
														movePlaylistTrack(originalIdx, 'down');
													}}
													disabled={originalIdx === selectedPlaylist.tracks.length - 1 || isReordering}
													class="p-1 rounded text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-20 transition"
													title="Move Down"
												>
													<ArrowDown class="w-3.5 h-3.5" />
												</button>

												<!-- Remove Track -->
												<button
													type="button"
													onclick={(e) => {
														e.stopPropagation();
														removePlaylistTrack(originalIdx, track);
													}}
													class="p-1 rounded text-rose-400/80 hover:bg-rose-950/50 hover:text-rose-300 transition"
													title="Remove from Playlist"
												>
													<Trash2 class="w-3.5 h-3.5" />
												</button>
											</div>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{:else}
						<!-- Empty Playlist State inside Player -->
						<div class="flex flex-col items-center justify-center py-20 text-center text-neutral-500">
							<div class="w-14 h-14 rounded-2xl bg-neutral-800/80 text-emerald-400 flex items-center justify-center mb-3 shadow-inner">
								<ListMusic class="w-7 h-7" />
							</div>
							<h3 class="text-sm font-bold text-neutral-200">This playlist is currently empty</h3>
							<p class="text-xs text-neutral-400 mt-1 max-w-sm">
								Add songs from your albums by clicking the "+ Add to Playlist" button on any track row.
							</p>
							<button
								type="button"
								onclick={() => (libraryTab = 'albums')}
								class="mt-4 px-4 py-2 rounded-xl bg-emerald-500 text-neutral-950 text-xs font-semibold hover:bg-emerald-400 transition"
							>
								Browse Albums Library
							</button>
						</div>
					{/if}
				</div>
			{:else}
				<!-- Empty Selection Fallback -->
				<div class="flex-1 flex flex-col items-center justify-center p-8 text-center text-neutral-500">
					<Disc3 class="w-16 h-16 opacity-30 mb-3" />
					<h3 class="text-base font-bold text-neutral-300">No selection</h3>
					<p class="text-xs text-neutral-500 mt-1">Select an album or playlist from your library to start listening.</p>
				</div>
			{/if}
		</main>

		<!-- RIGHT PANEL: Play Queue Drawer (When Open) -->
		{#if showQueueDrawer}
			<aside class="order-3 w-80 lg:w-96 bg-neutral-900/70 backdrop-blur-xl border border-neutral-800/70 rounded-2xl flex flex-col overflow-hidden shrink-0 shadow-2xl animate-in slide-in-from-right duration-200 min-h-0">
				<!-- Header -->
				<div class="p-3.5 border-b border-neutral-800/60 flex items-center justify-between shrink-0">
					<div class="flex items-center gap-2">
						<ListMusic class="w-4 h-4 text-emerald-400" />
						<h3 class="font-bold text-xs text-white">Play Queue</h3>
					</div>
					<button
						type="button"
						onclick={() => {
							showQueueDrawer = false;
						}}
						class="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-neutral-800 cursor-pointer"
						title="Close Queue"
					>
						<X class="w-4 h-4" />
					</button>
				</div>

				<!-- Drawer Scrollable Body -->
				<div class="flex-1 overflow-y-auto p-4 flex flex-col min-h-0">
					<div class="space-y-2">
						<span class="text-[10px] font-bold uppercase tracking-wider text-neutral-400 block mb-2">
							Now Playing
						</span>
						{#if player.currentTrack}
							<div class="p-2.5 rounded-xl bg-neutral-800/60 border border-neutral-700/40 flex items-center gap-3">
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-1.5">
										{#if (player.currentTrack.disc_number || 1) > 1}
											<span class="text-[9px] font-mono font-bold text-amber-400 bg-amber-950/60 px-1 py-0.2 rounded border border-amber-800/50 shrink-0">CD {player.currentTrack.disc_number}</span>
										{/if}
										<div class="text-xs font-bold text-emerald-300 truncate">{player.currentTrack.title}</div>
									</div>
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
									<div class="flex items-center gap-1.5">
										{#if (nextTr.disc_number || 1) > 1}
											<span class="text-[9px] font-mono font-bold text-amber-400 bg-amber-950/60 px-1 py-0.2 rounded border border-amber-800/50 shrink-0">CD {nextTr.disc_number}</span>
										{/if}
										<div class="font-medium text-white truncate">{nextTr.title}</div>
									</div>
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
				</div>
			</aside>
		{/if}
	</div>

	<!-- BOTTOM FLOATING AUDIO CONTROL DOCK -->
	<footer class="h-20 bg-neutral-900/85 backdrop-blur-2xl border-t border-neutral-800/80 px-4 sm:px-6 flex items-center justify-between gap-4 z-40 shrink-0 shadow-2xl">
		<!-- Track Info Pill -->
		<div class="flex items-center gap-3 w-1/4 min-w-[160px] max-w-[280px]">
			{#if player.currentTrack}
				<div class="w-12 h-12 rounded-xl bg-neutral-950 overflow-hidden shrink-0 border border-neutral-800 shadow-md relative">
					{#if player.currentAlbum?.cover_url}
						<img src={player.currentAlbum.cover_url} alt="Cover" class="w-full h-full object-cover" />
					{:else}
						<div class="w-full h-full flex items-center justify-center bg-neutral-900 text-neutral-500">
							<Disc3 class="w-6 h-6 animate-spin-slow" />
						</div>
					{/if}
				</div>

				<div class="min-w-0 flex-1">
					<div class="text-xs font-bold text-white truncate hover:underline cursor-pointer" title={player.currentTrack.title}>
						{player.currentTrack.title}
					</div>
					<div class="text-[10px] text-neutral-400 truncate mt-0.5" title={player.currentTrack.artist || player.currentAlbum?.artist}>
						{player.currentTrack.artist || player.currentAlbum?.artist || 'Unknown Artist'}
					</div>
					<div class="flex items-center gap-1.5 mt-0.5 text-[9px] font-mono">
						{#if (player.currentTrack.disc_number || 1) > 1}
							<span class="text-amber-400 font-semibold bg-amber-950/60 px-1 rounded border border-amber-800/50">CD {player.currentTrack.disc_number}</span>
							<span class="text-neutral-500">&bull;</span>
						{/if}
						<span class="text-emerald-400 font-semibold">{player.currentTrack.format}</span>
						{#if player.currentTrack.bitrate_kbps}
							<span class="text-neutral-500">&bull;</span>
							<span class="text-neutral-400">{player.currentTrack.bitrate_kbps.toLocaleString()} kbps</span>
						{/if}
					</div>
				</div>
			{:else}
				<div class="text-xs text-neutral-500 italic">No audio loaded</div>
			{/if}
		</div>

		<!-- Playback Controls & Scrubber Center -->
		<div class="flex-1 max-w-xl flex flex-col items-center justify-center gap-1">
			<!-- Buttons Row -->
			<div class="flex items-center gap-4 sm:gap-6">
				<!-- Shuffle -->
				<button
					type="button"
					onclick={() => player.toggleShuffle()}
					class="p-1 rounded text-neutral-400 hover:text-white transition cursor-pointer {player.shuffleEnabled ? 'text-emerald-400 hover:text-emerald-300' : ''}"
					title="Shuffle ({player.shuffleEnabled ? 'On' : 'Off'})"
				>
					<Shuffle class="w-4 h-4" />
				</button>

				<!-- Skip Back -->
				<button
					type="button"
					onclick={() => player.previousTrack()}
					class="p-1 rounded text-neutral-300 hover:text-white transition cursor-pointer active:scale-95"
					title="Previous Track"
				>
					<SkipBack class="w-4 h-4 fill-current" />
				</button>

				<!-- Studio Glow Main Play/Pause Button -->
				<button
					type="button"
					onclick={() => player.togglePlay()}
					class="w-10 h-10 rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-neutral-950 flex items-center justify-center shadow-lg shadow-emerald-500/30 hover:scale-105 active:scale-95 transition cursor-pointer"
					title={player.isPlaying ? 'Pause (Space)' : 'Play (Space)'}
				>
					{#if player.isPlaying}
						<Pause class="w-5 h-5 fill-current" />
					{:else}
						<Play class="w-5 h-5 fill-current ml-0.5" />
					{/if}
				</button>

				<!-- Skip Forward -->
				<button
					type="button"
					onclick={() => player.nextTrack()}
					class="p-1 rounded text-neutral-300 hover:text-white transition cursor-pointer active:scale-95"
					title="Next Track"
				>
					<SkipForward class="w-4 h-4 fill-current" />
				</button>

				<!-- Repeat -->
				<button
					type="button"
					onclick={() => player.toggleRepeat()}
					class="p-1 rounded text-neutral-400 hover:text-white transition cursor-pointer {player.repeatMode !== 'off' ? 'text-emerald-400 hover:text-emerald-300' : ''}"
					title="Repeat ({player.repeatMode})"
				>
					{#if player.repeatMode === 'one'}
						<Repeat1 class="w-4 h-4" />
					{:else}
						<Repeat class="w-4 h-4" />
					{/if}
				</button>
			</div>

			<!-- Scrubber Slider Row -->
			<div class="w-full flex items-center gap-2.5 text-[10px] font-mono text-neutral-400">
				<span class="w-9 text-right tabular-nums">{formatTime(player.currentTime)}</span>
				<div class="relative flex-1 flex items-center">
					<input
						type="range"
						min="0"
						max={player.duration || 100}
						value={player.currentTime}
						oninput={(e) => player.seekTo(parseFloat(e.currentTarget.value))}
						class="w-full h-1 bg-neutral-800 hover:bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
					/>
				</div>
				<span class="w-9 text-left tabular-nums">{formatTime(player.duration)}</span>
			</div>
		</div>

		<!-- Right Side Utilities (Lyrics Drawer Toggle, Queue, Volume) -->
		<div class="flex items-center justify-end gap-3 w-1/4 min-w-[160px] max-w-[280px]">
			<!-- Lyrics Drawer Toggle -->
			<button
				type="button"
				onclick={toggleLyrics}
				class="p-2 rounded-xl transition cursor-pointer border {showLyricsDrawer
					? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-md'
					: 'bg-neutral-800/80 text-neutral-400 border-neutral-700/60 hover:text-white hover:bg-neutral-700'}"
				title="Studio Synced Lyrics (L)"
			>
				<Mic class="w-4 h-4" />
			</button>

			<!-- Queue Drawer Toggle -->
			<button
				type="button"
				onclick={toggleQueue}
				class="p-2 rounded-xl transition cursor-pointer border {showQueueDrawer
					? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-md'
					: 'bg-neutral-800/80 text-neutral-400 border-neutral-700/60 hover:text-white hover:bg-neutral-700'}"
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

	<!-- Global Add To Playlist Modal -->
	<AddToPlaylistModal
		isOpen={showPlaylistModal}
		trackIds={playlistModalTrackIds}
		trackTitle={playlistModalTitle}
		onClose={() => (showPlaylistModal = false)}
		onAdded={handlePlaylistAdded}
	/>

	<!-- Create Playlist Modal -->
	{#if showCreatePlaylistModal}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
			<div class="relative w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
				<div class="flex items-center justify-between pb-4 border-b border-neutral-800">
					<div class="flex items-center gap-2.5">
						<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
							<Plus class="h-4 w-4" />
						</div>
						<h2 class="text-base font-bold text-neutral-100">Create New Playlist</h2>
					</div>
					<button
						type="button"
						onclick={() => (showCreatePlaylistModal = false)}
						class="rounded-lg p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition cursor-pointer"
					>
						<X class="h-5 w-5" />
					</button>
				</div>

				<form onsubmit={handleCreatePlaylist} class="mt-4 space-y-4">
					{#if createPlaylistError}
						<div class="rounded-xl border border-rose-800 bg-rose-950/60 p-3 text-xs text-rose-300">
							{createPlaylistError}
						</div>
					{/if}

					<div>
						<label for="new-pl-name" class="block text-xs font-semibold text-neutral-300 mb-1.5">
							Playlist Name <span class="text-emerald-400">*</span>
						</label>
						<input
							id="new-pl-name"
							type="text"
							bind:value={newPlaylistName}
							placeholder="e.g. Late Night Mix, Focus FLACs"
							required
							class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 py-2.5 text-sm text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition"
						/>
					</div>

					<div>
						<label for="new-pl-comment" class="block text-xs font-semibold text-neutral-300 mb-1.5">
							Description (Optional)
						</label>
						<textarea
							id="new-pl-comment"
							bind:value={newPlaylistComment}
							rows="2"
							placeholder="Add optional notes about this playlist..."
							class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition resize-none"
						></textarea>
					</div>

					<div class="flex items-center gap-2.5 pt-1">
						<input
							id="new-pl-public"
							type="checkbox"
							bind:checked={newPlaylistIsPublic}
							class="h-4 w-4 rounded border-neutral-700 bg-neutral-950 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-neutral-900"
						/>
						<label for="new-pl-public" class="text-xs text-neutral-300 select-none cursor-pointer">
							Make Public (Visible across all Subsonic clients)
						</label>
					</div>

					<div class="flex items-center justify-end gap-3 pt-3 border-t border-neutral-800">
						<button
							type="button"
							onclick={() => (showCreatePlaylistModal = false)}
							class="rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-700 transition cursor-pointer"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={!newPlaylistName.trim() || isCreatingPlaylist}
							class="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-neutral-950 hover:bg-emerald-400 disabled:opacity-50 transition cursor-pointer"
						>
							{#if isCreatingPlaylist}
								<div class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-950 border-t-transparent"></div>
								<span>Creating...</span>
							{:else}
								<span>Create Playlist</span>
							{/if}
						</button>
					</div>
				</form>
			</div>
		</div>
	{/if}

	<!-- Edit Playlist Modal -->
	{#if showEditPlaylistModal}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
			<div class="relative w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
				<div class="flex items-center justify-between pb-4 border-b border-neutral-800">
					<div class="flex items-center gap-2.5">
						<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
							<Pencil class="h-4 w-4" />
						</div>
						<h2 class="text-base font-bold text-neutral-100">Edit Playlist</h2>
					</div>
					<button
						type="button"
						onclick={() => (showEditPlaylistModal = false)}
						class="rounded-lg p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition cursor-pointer"
					>
						<X class="h-5 w-5" />
					</button>
				</div>

				<form onsubmit={handleSavePlaylistDetails} class="mt-4 space-y-4">
					{#if editPlaylistError}
						<div class="rounded-xl border border-rose-800 bg-rose-950/60 p-3 text-xs text-rose-300">
							{editPlaylistError}
						</div>
					{/if}

					<div>
						<label for="edit-pl-name" class="block text-xs font-semibold text-neutral-300 mb-1.5">
							Playlist Name <span class="text-emerald-400">*</span>
						</label>
						<input
							id="edit-pl-name"
							type="text"
							bind:value={editPlaylistName}
							required
							class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 py-2.5 text-sm text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition"
						/>
					</div>

					<div>
						<label for="edit-pl-comment" class="block text-xs font-semibold text-neutral-300 mb-1.5">
							Description (Optional)
						</label>
						<textarea
							id="edit-pl-comment"
							bind:value={editPlaylistComment}
							rows="2"
							placeholder="Optional notes or description..."
							class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition resize-none"
						></textarea>
					</div>

					<div class="flex items-center gap-2.5 pt-1">
						<input
							id="edit-pl-public"
							type="checkbox"
							bind:checked={editPlaylistIsPublic}
							class="h-4 w-4 rounded border-neutral-700 bg-neutral-950 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-neutral-900"
						/>
						<label for="edit-pl-public" class="text-xs text-neutral-300 select-none cursor-pointer">
							Make Public (Visible across all Subsonic clients)
						</label>
					</div>

					<div class="flex items-center justify-end gap-3 pt-3 border-t border-neutral-800">
						<button
							type="button"
							onclick={() => (showEditPlaylistModal = false)}
							class="rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-700 transition cursor-pointer"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={!editPlaylistName.trim() || isSavingPlaylist}
							class="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-neutral-950 hover:bg-emerald-400 disabled:opacity-50 transition cursor-pointer"
						>
							{#if isSavingPlaylist}
								<div class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-950 border-t-transparent"></div>
								<span>Saving...</span>
							{:else}
								<span>Save Changes</span>
							{/if}
						</button>
					</div>
				</form>
			</div>
		</div>
	{/if}

	<!-- Delete Playlist Modal -->
	{#if showDeletePlaylistModal && selectedPlaylist}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
			<div class="relative w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
				<div class="flex items-center gap-3 text-rose-400 mb-3">
					<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/20 border border-rose-500/30">
						<Trash2 class="h-5 w-5" />
					</div>
					<div>
						<h3 class="text-base font-bold text-neutral-100">Delete Playlist</h3>
						<p class="text-xs text-neutral-400">This action cannot be undone.</p>
					</div>
				</div>

				<p class="text-xs text-neutral-300 leading-relaxed mb-6">
					Are you sure you want to delete <strong class="text-white">"{selectedPlaylist.name}"</strong>? The music files in your library will remain intact.
				</p>

				<div class="flex items-center justify-end gap-3">
					<button
						type="button"
						onclick={() => (showDeletePlaylistModal = false)}
						disabled={isDeletingPlaylist}
						class="rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-700 transition cursor-pointer"
					>
						Cancel
					</button>
					<button
						type="button"
						onclick={handleDeletePlaylist}
						disabled={isDeletingPlaylist}
						class="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50 transition cursor-pointer"
					>
						{#if isDeletingPlaylist}
							<div class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
							<span>Deleting...</span>
						{:else}
							<span>Delete Playlist</span>
						{/if}
					</button>
				</div>
			</div>
		</div>
	{/if}
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
