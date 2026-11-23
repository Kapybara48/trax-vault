<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types.js';
	import type { Track, Playlist } from '$lib/types/index.js';
	import type { PlayerAlbum, PlayerPlaylist, PlayerArtist } from './+page.server.js';
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
		Lock,
		AlertTriangle,
		Library,
		Compass,
		User,
		RefreshCw,
		Sparkles,
		FolderDown,
		Camera,
		Upload,
		Radio,
		Users,
		Download,
		ChevronLeft,
		ChevronDown,
		Grid,
		Settings,
		Wrench,
		Shield,
		LogOut,
		Smartphone,
		ArrowDownCircle
	} from '@lucide/svelte';
	import AddToPlaylistModal from '$lib/components/AddToPlaylistModal.svelte';
	import { confirmAction, alertAction } from '$lib/services/dialog.svelte.js';
	import { parseLrcEnhanced, type EnhancedLyricLine } from '$lib/utils.js';
	import { offlineStorage } from '$lib/services/offline.svelte.js';

	let { data }: { data: PageData } = $props();

	// Local data collections
	let albums = $state<PlayerAlbum[]>([...data.albums]);
	let playlists = $state<PlayerPlaylist[]>([...data.playlists]);
	let artists = $state<PlayerArtist[]>([...(data.artists || [])]);

	// Library Switcher Tab: 'albums' vs 'artists' vs 'songs' vs 'playlists'
	let libraryTab = $state<'albums' | 'artists' | 'songs' | 'playlists'>(
		data.initialView === 'playlists' ? 'playlists' : (data.initialView === 'artists' ? 'artists' : 'albums')
	);

	// Active Main View Target
	let selectedType = $state<'album' | 'artist' | 'playlist'>(
		data.initialArtist ? 'artist' : (data.initialView === 'playlists' ? 'playlist' : 'album')
	);
	let selectedAlbum = $state<PlayerAlbum | null>(null);
	let selectedPlaylist = $state<PlayerPlaylist | null>(null);
	let selectedArtist = $state<PlayerArtist | null>(null);

	// Quality & Transcoding Menus
	let showQualityMenu = $state(false);
	let activeDownloadTrackId = $state<number | null>(null);

	// Persist view state in localStorage across page refreshes
	function persistPlayerViewState() {
		if (typeof localStorage === 'undefined') return;
		try {
			const viewState = {
				libraryTab,
				selectedType,
				selectedAlbumId: selectedAlbum?.id ?? null,
				selectedPlaylistId: selectedPlaylist?.id ?? null,
				selectedArtistName: selectedArtist?.name ?? null,
				showLyricsDrawer,
				showQueueDrawer,
				mobilePlayerTab
			};
			localStorage.setItem('traxvault_player_view_state', JSON.stringify(viewState));
		} catch {}
	}

	$effect(() => {
		// Track reactive view properties and persist changes
		const _ = [
			libraryTab,
			selectedType,
			selectedAlbum?.id,
			selectedPlaylist?.id,
			selectedArtist?.name,
			showLyricsDrawer,
			showQueueDrawer,
			mobilePlayerTab
		];
		persistPlayerViewState();
	});

	// Filters & Search
	let librarySearch = $state('');
	let albumFilter = $state<'all' | 'lossless' | 'verified' | 'downloaded'>('all');
	let playlistFilter = $state<'all' | 'public' | 'private' | 'downloaded'>('all');
	let albumTrackSearch = $state('');
	let queueSearch = $state('');
	let isOffline = $state(typeof navigator !== 'undefined' ? !navigator.onLine : false);

	function formatBytes(bytes: number): string {
		if (!bytes || bytes <= 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
	}

	// Side Drawers
	let showLyricsDrawer = $state(false);
	let showQueueDrawer = $state(false);
	let mobilePlayerTab = $state<'player' | 'search' | 'library' | 'studio' | 'profile' | 'tracks' | 'lyrics' | 'queue'>('player');
	let mobilePreviousTab = $state<'search' | 'library' | 'studio' | 'profile'>('library');
	let mobileSearchQuery = $state('');
	let mobileLibraryTab = $state<'playlists' | 'albums' | 'artists' | 'songs' | 'downloaded'>('playlists');
	let mobileLibraryLayout = $state<'list' | 'grid'>('list');
	let mobileFullFeatures = $state(false);
	let mobileShowNavbar = $state(false);

	let mobileFilteredPlaylists = $derived.by(() => {
		let list = playlists;
		if (mobileLibraryTab === 'downloaded') {
			list = list.filter((p) => offlineStorage.isPlaylistDownloaded(p.id) || p.tracks.some((t) => offlineStorage.isDownloaded(t.id)));
		}
		const q = mobileSearchQuery.trim().toLowerCase();
		if (!q) return list;
		return list.filter((p) => p.name.toLowerCase().includes(q) || (p.comment && p.comment.toLowerCase().includes(q)));
	});

	let mobileFilteredAlbums = $derived.by(() => {
		let list = albums;
		if (mobileLibraryTab === 'downloaded') {
			list = list.filter((a) => offlineStorage.isAlbumDownloaded(a.id) || a.tracks.some((t) => offlineStorage.isDownloaded(t.id)));
		}
		const q = mobileSearchQuery.trim().toLowerCase();
		if (!q) return list;
		return list.filter((a) => a.title.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q));
	});

	// Synced Lyrics State
	let lyricsLoading = $state(false);
	let loadedLyricsTrackId = $state<number | null>(null);
	let lyricsLines = $state<EnhancedLyricLine[]>([]);
	let isInstrumentalLyrics = $state(false);
	let instrumentalMarker = $state('♪');
	let lyricsContainerEl: HTMLDivElement | null = $state(null);
	let userScrolledLyrics = $state(false);

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

	// Parse LRC format into structured lines (supports multiple timestamps, start/end, and word-by-word)
	function parseLrc(content: string): EnhancedLyricLine[] {
		return parseLrcEnhanced(content).lines;
	}

	// Active singing line derived from audio currentTime (with rest interval support between verses)
	let activeLyricLineIndex = $derived.by(() => {
		if (!lyricsLines.length) return -1;
		let idx = -1;
		for (let i = 0; i < lyricsLines.length; i++) {
			const l = lyricsLines[i];
			if (l.time !== null && l.time <= player.currentTime) {
				if (l.endTime !== null && l.endTime !== undefined && player.currentTime > l.endTime) {
					idx = -1;
					continue;
				}
				idx = i;
			}
		}
		return idx;
	});

	// Auto-scroll lyrics smoothly to active line (unless user has manually scrolled)
	$effect(() => {
		if (
			(showLyricsDrawer || mobilePlayerTab === 'lyrics') &&
			!lyricsLoading &&
			activeLyricLineIndex >= 0 &&
			lyricsContainerEl &&
			!userScrolledLyrics
		) {
			const el = document.getElementById(`lyrics-line-${activeLyricLineIndex}`);
			if (el) {
				el.scrollIntoView({ behavior: 'smooth', block: 'center' });
			}
		}
	});

	// Fetch Lyrics for current track (only when track ID actually changes)
	async function loadLyricsForCurrentTrack(forceReload = false) {
		const track = player.currentTrack;
		const trackId = track?.id ?? null;

		if (!forceReload && trackId === loadedLyricsTrackId) {
			return;
		}

		loadedLyricsTrackId = trackId;
		userScrolledLyrics = false;

		if (!track) {
			lyricsLines = [];
			isInstrumentalLyrics = false;
			return;
		}

		// If track is explicitly marked instrumental in database, render instrumental directly
		if (track.lyrics === 'instrumental') {
			isInstrumentalLyrics = true;
			instrumentalMarker = '♪';
			lyricsLines = [{ id: 'inst-1', time: 0, endTime: null, text: instrumentalMarker }];
			lyricsLoading = false;
			return;
		}

		lyricsLoading = true;
		try {
			// Check offline storage first for immediate offline teleprompter
			const offlineTrack = await offlineStorage.getOfflineTrack(track.id);
			if (player.currentTrack?.id !== track.id) return;
			if (offlineTrack) {
				if (offlineTrack.lyrics_status === 'instrumental' || offlineTrack.lyrics_text === '♪') {
					isInstrumentalLyrics = true;
					instrumentalMarker = '♪';
					lyricsLines = [{ id: 'inst-1', time: 0, endTime: null, text: instrumentalMarker }];
					lyricsLoading = false;
					return;
				} else if (offlineTrack.lyrics_text) {
					isInstrumentalLyrics = false;
					lyricsLines = parseLrc(offlineTrack.lyrics_text);
					lyricsLoading = false;
					return;
				}
			}

			const res = await fetch(`/api/tracks/${track.id}/lyrics`);
			// Guard against stale response if user switched tracks while fetch was in flight
			if (player.currentTrack?.id !== track.id) return;
			if (!res.ok) {
				lyricsLines = [];
				isInstrumentalLyrics = false;
				return;
			}
			const data = await res.json();
			if (player.currentTrack?.id !== track.id) return;
			if (data.status === 'instrumental' || data.is_instrumental) {
				isInstrumentalLyrics = true;
				instrumentalMarker = data.instrumental_marker || '♪';
				lyricsLines = [{ id: 'inst-1', time: 0, endTime: null, text: instrumentalMarker }];
			} else if (data.lyrics_text) {
				isInstrumentalLyrics = false;
				lyricsLines = parseLrc(data.lyrics_text);
			} else {
				isInstrumentalLyrics = false;
				lyricsLines = [];
			}
		} catch (err) {
			console.error('Failed to load lyrics:', err);
			if (player.currentTrack?.id === track.id) {
				lyricsLines = [];
				isInstrumentalLyrics = false;
			}
		} finally {
			if (player.currentTrack?.id === track.id) {
				lyricsLoading = false;
			}
		}
	}

	// Reactively re-load lyrics only when active track ID changes
	$effect(() => {
		const trackId = player.currentTrack?.id ?? null;
		if (trackId !== loadedLyricsTrackId) {
			loadLyricsForCurrentTrack();
		}
	});

	function toggleLyrics() {
		showLyricsDrawer = !showLyricsDrawer;
		if (showLyricsDrawer) {
			showQueueDrawer = false;
			mobilePlayerTab = 'lyrics';
		} else if (mobilePlayerTab === 'lyrics') {
			mobilePlayerTab = player.currentTrack ? 'player' : 'tracks';
		}
	}

	function toggleQueue() {
		showQueueDrawer = !showQueueDrawer;
		if (showQueueDrawer) {
			showLyricsDrawer = false;
			mobilePlayerTab = 'queue';
		} else if (mobilePlayerTab === 'queue') {
			mobilePlayerTab = player.currentTrack ? 'player' : 'tracks';
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
		} else if (albumFilter === 'downloaded') {
			list = list.filter((a) => offlineStorage.isAlbumDownloaded(a.id) || a.tracks.some((t) => offlineStorage.isDownloaded(t.id)));
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
		} else if (playlistFilter === 'downloaded') {
			list = list.filter((p) => offlineStorage.isPlaylistDownloaded(p.id) || p.tracks.some((t) => offlineStorage.isDownloaded(t.id)));
		}
		return list;
	});

	// Filtered library artists
	let filteredArtists = $derived.by(() => {
		let list = artists;
		if (librarySearch.trim()) {
			const q = librarySearch.trim().toLowerCase();
			list = list.filter((a) => a.name.toLowerCase().includes(q));
		}
		return list;
	});

	// Flat list of all tracks across all albums for song searching
	const allLibraryTracks = $derived(
		albums.flatMap((a) => a.tracks)
	);

	// Filtered library songs
	let filteredSongs = $derived.by(() => {
		let list = allLibraryTracks;
		if (librarySearch.trim()) {
			const q = librarySearch.trim().toLowerCase();
			list = list.filter(
				(t) =>
					t.title.toLowerCase().includes(q) ||
					(t.artist && t.artist.toLowerCase().includes(q)) ||
					(t.album_title && t.album_title.toLowerCase().includes(q))
			);
		}
		return list;
	});

	function playLibrarySong(track: Track) {
		const parentAlbum = albums.find((a) => a.id === track.album_id);
		if (parentAlbum) {
			selectedType = 'album';
			selectedAlbum = parentAlbum;
			const playable = parentAlbum.tracks.filter((t) => t.is_missing !== 1);
			player.playTrack(track, parentAlbum, playable);
		} else {
			player.playTrack(track, undefined, [track]);
		}
		if (mobilePlayerTab === 'library') {
			mobilePlayerTab = 'tracks';
		}
	}

	// Filtered queue next up tracks
	let filteredQueueTracks = $derived.by(() => {
		const nextTracks = player.activeQueue.slice(player.queueIndex + 1);
		if (!queueSearch.trim()) return nextTracks;
		const q = queueSearch.trim().toLowerCase();
		return nextTracks.filter(
			(tr) =>
				tr.title.toLowerCase().includes(q) ||
				(tr.artist && tr.artist.toLowerCase().includes(q)) ||
				(player.currentAlbum?.artist && player.currentAlbum.artist.toLowerCase().includes(q))
		);
	});

	// Filtered tracks within currently selected item (album, artist, or playlist)
	let displayedTracks = $derived.by(() => {
		const targetTracks = selectedType === 'album'
			? selectedAlbum?.tracks
			: (selectedType === 'artist' ? selectedArtist?.tracks : selectedPlaylist?.tracks);
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
		selectedArtist = null;
		albumTrackSearch = '';
		mobilePlayerTab = 'tracks';
	}

	function selectPlaylist(playlist: PlayerPlaylist) {
		selectedType = 'playlist';
		selectedPlaylist = playlist;
		selectedAlbum = null;
		selectedArtist = null;
		albumTrackSearch = '';
		mobilePlayerTab = 'tracks';
	}

	function selectArtist(artist: PlayerArtist | string) {
		const found = typeof artist === 'string'
			? artists.find((a) => a.name.toLowerCase() === artist.toLowerCase().trim())
			: artist;
		if (found) {
			selectedArtist = found;
			selectedType = 'artist';
			selectedAlbum = null;
			selectedPlaylist = null;
			albumTrackSearch = '';
			mobilePlayerTab = 'tracks';
			loadArtistMetadataIfMissing(found);
		}
	}

	function playArtistTrack(track: Track) {
		if (track.is_missing === 1 || !selectedArtist) return;
		const playable = selectedArtist.tracks.filter((t) => t.is_missing !== 1);
		const parentAlbum = selectedArtist.albums.find((a) => a.id === track.album_id) || selectedArtist.albums[0] || {
			id: track.album_id || -9999,
			title: track.album_title || `${selectedArtist.name} Tracks`,
			artist: selectedArtist.name,
			cover_url: track.album_cover_url || selectedArtist.cover_url
		};
		player.playTrack(track, parentAlbum as any, playable);
	}

	function playArtistAll() {
		if (!selectedArtist || selectedArtist.tracks.length === 0) return;
		const playable = selectedArtist.tracks.filter((t) => t.is_missing !== 1);
		if (playable.length === 0) return;
		playArtistTrack(playable[0]);
	}

	function playArtistShuffle() {
		if (!selectedArtist || selectedArtist.tracks.length === 0) return;
		const playable = selectedArtist.tracks.filter((t) => t.is_missing !== 1);
		if (playable.length === 0) return;
		const shuffled = [...playable].sort(() => Math.random() - 0.5);
		const parentAlbum = selectedArtist.albums.find((a) => a.id === shuffled[0].album_id) || selectedArtist.albums[0];
		player.playTrack(shuffled[0], parentAlbum as any, shuffled);
	}

	let isRefreshingArtist = $state(false);

	async function refreshCurrentArtist() {
		if (!selectedArtist || isRefreshingArtist) return;
		isRefreshingArtist = true;
		try {
			const res = await fetch('/api/artists/refresh', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ artist: selectedArtist.name })
			});
			const data = await res.json();
			if (data.success && data.artist) {
				selectedArtist.biography = data.artist.biography;
				selectedArtist.musicbrainz_id = data.artist.musicBrainzId;
				selectedArtist.lastfm_url = data.artist.lastFmUrl;
				const ts = Date.now();
				selectedArtist.avatar_url = `/api/artists/${encodeURIComponent(selectedArtist.name)}/avatar?_t=${ts}`;
				// Also sync in main artists list
				const found = artists.find((a) => a.name.toLowerCase() === selectedArtist!.name.toLowerCase());
				if (found) {
					found.biography = data.artist.biography;
					found.avatar_url = selectedArtist.avatar_url;
					found.lastfm_url = data.artist.lastFmUrl;
				}
			}
		} catch (err) {
			console.error('Failed to refresh artist:', err);
		} finally {
			isRefreshingArtist = false;
		}
	}

	let isSavingCompanion = $state(false);
	let isUploadingArtistAvatar = $state(false);
	let artistAvatarFileInputRef = $state<HTMLInputElement | null>(null);

	async function saveCompanionArtistImage() {
		if (!selectedArtist || isSavingCompanion) return;
		isSavingCompanion = true;
		try {
			const res = await fetch(`/api/artists/${encodeURIComponent(selectedArtist.name)}/save-companion`, {
				method: 'POST'
			});
			const data = await res.json();
			if (data.success) {
				await alertAction(`Companion "artist.jpg" was successfully saved to your music folder:\n\n${data.path}\n\nOther media servers like Jellyfin, Plex, and Kodi will now detect this artist portrait!`, 'Artist Image Saved');
			} else {
				await alertAction(data.error || 'Failed to save companion artist image', 'Save Failed');
			}
		} catch (err: any) {
			console.error('Error saving companion artist image:', err);
			await alertAction(err.message || 'An unexpected error occurred while saving companion image', 'Save Failed');
		} finally {
			isSavingCompanion = false;
		}
	}

	function triggerArtistAvatarUpload() {
		artistAvatarFileInputRef?.click();
	}

	async function handleArtistAvatarFileSelected(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !selectedArtist || isUploadingArtistAvatar) return;

		isUploadingArtistAvatar = true;
		try {
			const formData = new FormData();
			formData.append('file', file);
			formData.append('saveToFolder', 'true');

			const res = await fetch(`/api/artists/${encodeURIComponent(selectedArtist.name)}/avatar`, {
				method: 'POST',
				body: formData
			});
			const data = await res.json();
			if (data.success && data.avatarUrl) {
				selectedArtist.avatar_url = data.avatarUrl;
				const found = artists.find((a) => a.name.toLowerCase() === selectedArtist!.name.toLowerCase());
				if (found) {
					found.avatar_url = data.avatarUrl;
				}
				const companionMsg = data.companionSaved ? '\n\nCompanion artist.jpg was also written to your artist directory.' : '';
				await alertAction(`Artist portrait updated successfully!${companionMsg}`, 'Avatar Updated');
			} else {
				await alertAction(data.error || 'Failed to upload artist portrait', 'Upload Failed');
			}
		} catch (err: any) {
			console.error('Failed to upload artist avatar:', err);
			await alertAction(err.message || 'Error uploading artist avatar', 'Upload Failed');
		} finally {
			isUploadingArtistAvatar = false;
			if (input) input.value = '';
		}
	}

	let isResettingAvatar = $state(false);

	async function resetCurrentArtistAvatar() {
		if (!selectedArtist || isResettingAvatar) return;
		const confirmed = await confirmAction({
			title: 'Reset Artist Avatar',
			message: `Are you sure you want to remove the avatar photo for "${selectedArtist.name}" and revert to default?`,
			confirmText: 'Reset Avatar',
			danger: true
		});
		if (!confirmed) return;

		isResettingAvatar = true;
		try {
			const res = await fetch(`/api/artists/${encodeURIComponent(selectedArtist.name)}/avatar`, {
				method: 'DELETE'
			});
			const data = await res.json();
			if (data.success) {
				selectedArtist.avatar_url = null;
				const found = artists.find((a) => a.name.toLowerCase() === selectedArtist!.name.toLowerCase());
				if (found) {
					found.avatar_url = null;
				}
				await alertAction(`Avatar photo for "${selectedArtist.name}" was reset.`, 'Avatar Reset');
			} else {
				await alertAction(data.error || 'Failed to reset avatar', 'Error');
			}
		} catch (err: any) {
			console.error('Failed to reset avatar:', err);
			await alertAction(err.message || 'Error resetting avatar', 'Error');
		} finally {
			isResettingAvatar = false;
		}
	}

	// Auto-fetch artist metadata on selection if not yet loaded
	async function loadArtistMetadataIfMissing(art: PlayerArtist) {
		if (art.biography) return;
		try {
			const res = await fetch(`/api/artists/${encodeURIComponent(art.name)}`);
			if (res.ok) {
				const data = await res.json();
				if (data.success && data.artist && selectedArtist?.name.toLowerCase() === art.name.toLowerCase()) {
					const freshAvatar = `/api/artists/${encodeURIComponent(art.name)}/avatar?_t=${Date.now()}`;
					selectedArtist.biography = data.artist.biography;
					selectedArtist.musicbrainz_id = data.artist.musicBrainzId;
					selectedArtist.lastfm_url = data.artist.lastFmUrl;
					selectedArtist.disambiguation = data.metadata?.disambiguation || selectedArtist.disambiguation;
					selectedArtist.image_url = data.metadata?.image_url || selectedArtist.image_url;
					selectedArtist.avatar_url = freshAvatar;
					const found = artists.find((a) => a.name.toLowerCase() === art.name.toLowerCase());
					if (found) {
						found.biography = data.artist.biography;
						found.musicbrainz_id = data.artist.musicBrainzId;
						found.lastfm_url = data.artist.lastFmUrl;
						found.disambiguation = selectedArtist.disambiguation;
						found.image_url = selectedArtist.image_url;
						found.avatar_url = freshAvatar;
					}
				}
			}
		} catch {}
	}

	// Edit & Match Artist Metadata Modal State
	interface ArtistCandidateItem {
		source: 'deezer' | 'musicbrainz' | 'theaudiodb';
		externalId: string;
		displayId: string;
		name: string;
		subtitle: string;
		imageUrl: string | null;
		externalUrl: string;
		fanCount?: number;
	}

	let showEditArtistModal = $state(false);
	let editArtistTab = $state<'match' | 'manual'>('match');
	let editArtistExternalInput = $state('');
	let editArtistSearchQuery = $state('');
	let editArtistCandidates = $state<ArtistCandidateItem[]>([]);
	let isSearchingArtistCandidates = $state(false);
	let isApplyingExternalArtistId = $state(false);
	let isSavingManualArtist = $state(false);
	let editArtistSaveToFolder = $state(false);

	let editArtistBiography = $state('');
	let editArtistDisambiguation = $state('');
	let editArtistMbid = $state('');
	let editArtistLastFmUrl = $state('');
	let editArtistImageUrl = $state('');

	async function openEditArtistModal(initialTab: 'match' | 'manual' = 'match') {
		if (!selectedArtist) return;
		editArtistTab = initialTab;
		editArtistExternalInput = '';
		editArtistSearchQuery = selectedArtist.name;
		editArtistBiography = selectedArtist.biography || '';
		editArtistDisambiguation = selectedArtist.disambiguation || '';
		editArtistMbid = selectedArtist.musicbrainz_id || '';
		editArtistLastFmUrl = selectedArtist.lastfm_url || `https://www.last.fm/music/${encodeURIComponent(selectedArtist.name)}`;
		editArtistImageUrl = selectedArtist.image_url || '';
		showEditArtistModal = true;

		// Load latest metadata from server and trigger candidate search
		try {
			const res = await fetch(`/api/artists/${encodeURIComponent(selectedArtist.name)}`);
			if (res.ok) {
				const d = await res.json();
				if (d.metadata) {
					editArtistBiography = d.metadata.biography || editArtistBiography;
					editArtistDisambiguation = d.metadata.disambiguation || editArtistDisambiguation;
					editArtistMbid = d.metadata.musicbrainz_id || editArtistMbid;
					editArtistLastFmUrl = d.metadata.lastfm_url || editArtistLastFmUrl;
					editArtistImageUrl = d.metadata.image_url || editArtistImageUrl;
				}
			}
		} catch {}

		searchArtistCandidatesInModal();
	}

	async function searchArtistCandidatesInModal() {
		const q = editArtistSearchQuery.trim();
		if (!q || isSearchingArtistCandidates) return;
		isSearchingArtistCandidates = true;
		try {
			const res = await fetch(`/api/artists/search?q=${encodeURIComponent(q)}`);
			if (res.ok) {
				const d = await res.json();
				editArtistCandidates = d.candidates || [];
			}
		} catch (err) {
			console.error('Error searching artist candidates:', err);
		} finally {
			isSearchingArtistCandidates = false;
		}
	}

	function syncUpdatedArtistState(data: any) {
		if (!selectedArtist) return;
		const freshAvatar = data.avatarUrl || `/api/artists/${encodeURIComponent(selectedArtist.name)}/avatar?_t=${Date.now()}`;
		if (data.artist) {
			selectedArtist.biography = data.artist.biography;
			selectedArtist.musicbrainz_id = data.artist.musicBrainzId;
			selectedArtist.lastfm_url = data.artist.lastFmUrl;
		}
		if (data.metadata) {
			selectedArtist.biography = data.metadata.biography ?? selectedArtist.biography;
			selectedArtist.disambiguation = data.metadata.disambiguation ?? selectedArtist.disambiguation;
			selectedArtist.musicbrainz_id = data.metadata.musicbrainz_id ?? selectedArtist.musicbrainz_id;
			selectedArtist.lastfm_url = data.metadata.lastfm_url ?? selectedArtist.lastfm_url;
			selectedArtist.image_url = data.metadata.image_url ?? selectedArtist.image_url;
		}
		selectedArtist.avatar_url = freshAvatar;

		const found = artists.find((a) => a.name.toLowerCase() === selectedArtist!.name.toLowerCase());
		if (found) {
			found.biography = selectedArtist.biography;
			found.disambiguation = selectedArtist.disambiguation;
			found.musicbrainz_id = selectedArtist.musicbrainz_id;
			found.lastfm_url = selectedArtist.lastfm_url;
			found.image_url = selectedArtist.image_url;
			found.avatar_url = freshAvatar;
		}
	}

	async function applyExternalArtistId(inputValue?: string) {
		const targetInput = (inputValue ?? editArtistExternalInput).trim();
		if (!selectedArtist || !targetInput || isApplyingExternalArtistId) return;
		isApplyingExternalArtistId = true;
		try {
			const res = await fetch(`/api/artists/${encodeURIComponent(selectedArtist.name)}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					externalIdOrUrl: targetInput,
					saveToFolder: editArtistSaveToFolder
				})
			});
			const data = await res.json();
			if (res.ok && data.success) {
				syncUpdatedArtistState(data);
				showEditArtistModal = false;
				const folderMsg = data.companionSaved ? `\n\nCompanion artist.jpg was also saved to:\n${data.companionPath}` : '';
				await alertAction(`Successfully matched and updated artist metadata & portrait for "${selectedArtist.name}"!${folderMsg}`, 'Artist Matched');
			} else {
				await alertAction(data.error || 'Failed to apply artist ID or URL', 'Match Failed');
			}
		} catch (err: any) {
			console.error('Failed to apply artist ID:', err);
			await alertAction(err.message || 'Error applying artist ID', 'Match Failed');
		} finally {
			isApplyingExternalArtistId = false;
		}
	}

	async function saveManualArtistChanges(e?: Event) {
		if (e) e.preventDefault();
		if (!selectedArtist || isSavingManualArtist) return;
		isSavingManualArtist = true;
		try {
			const res = await fetch(`/api/artists/${encodeURIComponent(selectedArtist.name)}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					biography: editArtistBiography,
					disambiguation: editArtistDisambiguation,
					musicbrainz_id: editArtistMbid,
					lastfm_url: editArtistLastFmUrl,
					image_url: editArtistImageUrl,
					saveToFolder: editArtistSaveToFolder
				})
			});
			const data = await res.json();
			if (res.ok && data.success) {
				syncUpdatedArtistState(data);
				showEditArtistModal = false;
				const folderMsg = data.companionSaved ? `\n\nCompanion artist.jpg was also saved to:\n${data.companionPath}` : '';
				await alertAction(`Artist metadata for "${selectedArtist.name}" was saved!${folderMsg}`, 'Metadata Saved');
			} else {
				await alertAction(data.error || 'Failed to save artist metadata', 'Save Failed');
			}
		} catch (err: any) {
			console.error('Failed to save manual artist metadata:', err);
			await alertAction(err.message || 'Error saving artist metadata', 'Save Failed');
		} finally {
			isSavingManualArtist = false;
		}
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
		const confirmed = await confirmAction({
			title: 'Remove Track from Playlist',
			message: `Remove "${track.title}" from "${selectedPlaylist.name}"?`,
			confirmText: 'Remove Track',
			danger: true
		});
		if (!confirmed) return;

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
				await alertAction('Failed to delete playlist', 'Error');
			}
		} catch (err) {
			console.error('Failed to delete playlist:', err);
			await alertAction('Network error while deleting playlist', 'Error');
		} finally {
			isDeletingPlaylist = false;
		}
	}

	// Global Keyboard Shortcuts
	function handleKeyDown(e: KeyboardEvent) {
		const target = e.target as HTMLElement | null;
		if (
			target &&
			(target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.tagName === 'SELECT' ||
				target.isContentEditable ||
				target.getAttribute('role') === 'textbox' ||
				target.closest('dialog, [role="dialog"]'))
		) {
			return;
		}

		if (e.code === 'Space' || e.key === ' ') {
			e.preventDefault();
			e.stopPropagation();
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
		// Restore saved view state if no explicit URL parameters override it
		try {
			const savedViewStr = localStorage.getItem('traxvault_player_view_state');
			if (savedViewStr && !data.initialArtist && !data.initialPlaylistId && !data.initialAlbumId) {
				const savedView = JSON.parse(savedViewStr);
				if (savedView.libraryTab === 'albums' || savedView.libraryTab === 'artists' || savedView.libraryTab === 'playlists') {
					libraryTab = savedView.libraryTab;
				}
				if (savedView.showLyricsDrawer === true) {
					showLyricsDrawer = true;
				}
				if (savedView.showQueueDrawer === true && !showLyricsDrawer) {
					showQueueDrawer = true;
				}
				if (savedView.mobilePlayerTab) {
					mobilePlayerTab = savedView.mobilePlayerTab;
				}

				if (savedView.selectedType === 'artist' && savedView.selectedArtistName) {
					const foundArt = artists.find((a) => a.name.toLowerCase() === savedView.selectedArtistName.toLowerCase().trim());
					if (foundArt) {
						selectArtist(foundArt);
					}
				} else if (savedView.selectedType === 'playlist' && savedView.selectedPlaylistId) {
					const foundPl = playlists.find((p) => p.id === savedView.selectedPlaylistId);
					if (foundPl) {
						selectPlaylist(foundPl);
					}
				} else if (savedView.selectedAlbumId) {
					const foundAlb = albums.find((a) => a.id === savedView.selectedAlbumId);
					if (foundAlb) {
						selectAlbum(foundAlb);
					}
				}
			}
		} catch {}

		// Initial Target Selection from parameters or player state
		if (data.initialArtist) {
			const foundArt = artists.find((a) => a.name.toLowerCase() === data.initialArtist!.toLowerCase().trim());
			if (foundArt) {
				selectArtist(foundArt);
				libraryTab = 'artists';
			}
		} else if (data.initialPlaylistId) {
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
		if (!selectedAlbum && !selectedPlaylist && !selectedArtist) {
			if (libraryTab === 'artists' && artists.length > 0) {
				selectArtist(artists[0]);
			} else if (libraryTab === 'playlists' && playlists.length > 0) {
				selectPlaylist(playlists[0]);
			} else if (albums.length > 0) {
				selectAlbum(albums[0]);
			} else if (artists.length > 0) {
				selectArtist(artists[0]);
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

		// Auto-join shared listening room if ?room=CODE is present in URL
		try {
			const params = new URLSearchParams(window.location.search);
			const roomParam = params.get('room');
			if (roomParam && roomParam.trim()) {
				const code = roomParam.trim().toUpperCase();
				if (player.activeRoom?.code !== code) {
					player.joinListeningRoom(code);
				}
			}
		} catch {}

		// On mobile devices, ensure mobilePlayerTab defaults to 'player' or restores user choice
		if (typeof window !== 'undefined' && window.innerWidth < 768) {
			try {
				const raw = localStorage.getItem('traxvault_player_view_state');
				const saved = raw ? JSON.parse(raw) : null;
				if (saved?.mobilePlayerTab) {
					mobilePlayerTab = saved.mobilePlayerTab;
				} else {
					mobilePlayerTab = 'player';
				}
			} catch {
				mobilePlayerTab = 'player';
			}
		}

		try {
			mobileFullFeatures = localStorage.getItem('traxvault_mobile_full_features') === 'true';
			mobileShowNavbar = localStorage.getItem('traxvault_show_mobile_navbar') === 'true';
		} catch {}

		// Listen to online / offline network status
		const handleOnline = () => { isOffline = false; };
		const handleOffline = () => { isOffline = true; };
		window.addEventListener('online', handleOnline);
		window.addEventListener('offline', handleOffline);

		// Initialize offline storage and merge offline albums & playlists into catalog
		offlineStorage.init().then(async () => {
			const offAlbums = await offlineStorage.getAllOfflineAlbums();
			if (offAlbums.length > 0) {
				for (const off of offAlbums) {
					if (!albums.some((a) => a.id === off.id)) {
						albums.push(off);
					}
				}
			}
			const offPlaylists = await offlineStorage.getAllOfflinePlaylists();
			if (offPlaylists.length > 0) {
				for (const offPl of offPlaylists) {
					if (!playlists.some((p) => p.id === offPl.id)) {
						playlists.push(offPl);
					}
				}
			}
		}).catch(() => {});

		const updateMobileSettings = () => {
			try {
				mobileFullFeatures = localStorage.getItem('traxvault_mobile_full_features') === 'true';
				mobileShowNavbar = localStorage.getItem('traxvault_show_mobile_navbar') === 'true';
			} catch {}
		};

		window.addEventListener('storage', updateMobileSettings);
		window.addEventListener('traxvault:mobile-features-toggle', updateMobileSettings);
		window.addEventListener('traxvault:navbar-toggle', updateMobileSettings);

		return () => {
			window.removeEventListener('online', handleOnline);
			window.removeEventListener('offline', handleOffline);
			window.removeEventListener('storage', updateMobileSettings);
			window.removeEventListener('traxvault:mobile-features-toggle', updateMobileSettings);
			window.removeEventListener('traxvault:navbar-toggle', updateMobileSettings);
		};
	});

	function toggleMobileFullFeatures(enabled: boolean) {
		mobileFullFeatures = enabled;
		try {
			localStorage.setItem('traxvault_mobile_full_features', enabled ? 'true' : 'false');
			window.dispatchEvent(new Event('traxvault:mobile-features-toggle'));
		} catch {}
	}

	function toggleMobileShowNavbar(enabled: boolean) {
		mobileShowNavbar = enabled;
		try {
			localStorage.setItem('traxvault_show_mobile_navbar', enabled ? 'true' : 'false');
			window.dispatchEvent(new Event('traxvault:navbar-toggle'));
		} catch {}
	}

	async function handleMobileLogout() {
		const confirmed = await confirmAction({
			title: 'Sign Out',
			message: 'Are you sure you want to log out of Trax Vault?',
			confirmText: 'Sign Out'
		});
		if (!confirmed) return;

		try {
			await fetch('/api/auth/logout', { method: 'POST' });
			window.location.href = '/login';
		} catch (err: any) {
			await alertAction(err.message || 'Logout failed', 'Error');
		}
	}
</script>

<svelte:window onkeydown={handleKeyDown} />

<!-- Trax Vault Studio Audio Player (Full Viewport, Non-Scrollable Window) -->
<div class="flex-1 h-full flex flex-col bg-neutral-950 text-neutral-100 font-sans select-none overflow-hidden min-h-0">
	<!-- Live Sync / Companion Display / Listen Together Status Bar -->
	{#if player.audioUnlockRequired && player.localAudioEnabled}
		<div class="mx-2 sm:mx-3 mt-2 px-3.5 py-2 rounded-xl bg-emerald-950/90 border border-emerald-500/50 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0 shadow-lg">
			<div class="flex items-center gap-2 text-emerald-200">
				<Volume2 class="w-4 h-4 text-emerald-400 animate-bounce shrink-0" />
				<span>
					<strong>Synced Audio Ready:</strong> Click to unlock synchronized audio playback in this browser tab.
				</span>
			</div>
			<div class="flex items-center gap-2">
				<button
					type="button"
					onclick={() => player.unlockAudioPlayback()}
					class="px-3 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold text-xs transition cursor-pointer"
				>
					Play Synced Audio Here
				</button>
				<button
					type="button"
					onclick={() => player.setLocalAudioMode(false, false)}
					class="px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs transition cursor-pointer"
				>
					Lyrics Companion Only
				</button>
			</div>
		</div>
	{/if}

	<!-- Offline Mode Status Indicator -->
	{#if isOffline}
		<div class="mx-2 sm:mx-3 mt-2 px-3.5 py-1.5 rounded-xl bg-amber-950/80 border border-amber-600/40 flex items-center justify-between gap-2 text-xs shrink-0 shadow-lg text-amber-200">
			<div class="flex items-center gap-2">
				<span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
				<span><strong>Offline Mode:</strong> No network connection. Playing songs stored directly on your device.</span>
			</div>
			<span class="text-[10px] text-amber-300/80 font-mono font-medium">{offlineStorage.downloadedTrackIds.size} downloaded</span>
		</div>
	{/if}

	<!-- Workspace: Side Library + Main Stage + Drawers -->
	<div class="flex-1 flex overflow-hidden min-h-0 p-1.5 sm:p-3 gap-1.5 sm:gap-3">
		<!-- DEDICATED FULL-SCREEN MOBILE NOW PLAYING (Phones < md) -->
		{#if mobilePlayerTab === 'player'}
			<section class="flex md:hidden order-1 flex-1 bg-neutral-900/70 backdrop-blur-xl border border-neutral-800/70 rounded-2xl flex-col overflow-hidden min-h-0 p-3 sm:p-4 shadow-xl justify-between">
				<!-- Top Collapse Header -->
				<div class="flex items-center justify-between w-full max-w-sm mx-auto pb-1 shrink-0">
					<button
						type="button"
						onclick={() => (mobilePlayerTab = mobilePreviousTab || 'library')}
						class="p-1.5 text-neutral-400 hover:text-white rounded-lg cursor-pointer"
						title="Collapse Player"
					>
						<ChevronDown class="w-5 h-5" />
					</button>
					<span class="text-[11px] font-bold text-neutral-400 uppercase tracking-widest">Now Playing</span>
					<button
						type="button"
						onclick={() => player.openSyncModal(player.activeRoom?.type === 'shared' ? 'rooms' : 'devices')}
						class="p-1.5 text-neutral-400 hover:text-emerald-400 rounded-lg cursor-pointer"
						title="Sync Devices"
					>
						<Radio class="w-4 h-4" />
					</button>
				</div>

				{#if player.currentTrack}
					<div class="flex flex-col items-center justify-between flex-1 w-full max-w-sm mx-auto min-h-0 py-0.5">
						<!-- Album Cover (Scales dynamically to fit screen without scrolling) -->
						<div class="relative w-full aspect-square max-h-[26vh] max-w-[190px] xs:max-w-[220px] rounded-2xl overflow-hidden bg-neutral-950 shadow-xl shadow-emerald-950/40 border border-neutral-800/80 group shrink">
							{#if player.currentAlbum?.cover_url}
								<img src={player.currentAlbum.cover_url} alt="Cover" class="w-full h-full object-cover" />
							{:else}
								<div class="w-full h-full flex items-center justify-center bg-neutral-900 text-neutral-600">
									<Disc3 class="w-16 h-16 animate-spin-slow" />
								</div>
							{/if}
						</div>

						<!-- Track Metadata -->
						<div class="w-full text-center space-y-0.5 mt-1 shrink-0">
							<h2 class="text-base sm:text-lg font-bold text-white tracking-tight line-clamp-1" title={player.currentTrack.title}>
								{player.currentTrack.title}
							</h2>
							<div class="flex items-center justify-center gap-2 text-xs text-neutral-300">
								<button
									type="button"
									onclick={() => {
										if (player.currentTrack?.artist || player.currentAlbum?.artist) {
											selectArtist(player.currentTrack?.artist || player.currentAlbum!.artist);
											mobilePlayerTab = 'tracks';
										}
									}}
									class="hover:text-emerald-400 font-semibold truncate transition cursor-pointer"
								>
									{player.currentTrack.artist || player.currentAlbum?.artist || 'Unknown Artist'}
								</button>
								{#if player.currentAlbum?.title}
									<span class="text-neutral-500">&bull;</span>
									<button
										type="button"
										onclick={() => {
											if (player.currentAlbum) {
												selectAlbum(player.currentAlbum);
												mobilePlayerTab = 'tracks';
											}
										}}
										class="text-neutral-400 hover:text-emerald-400 truncate max-w-[140px] transition cursor-pointer"
									>
										{player.currentAlbum.title}
									</button>
								{/if}
							</div>

							<!-- Quality Pill -->
							<div class="flex items-center justify-center gap-2 pt-0.5 relative">
								<button
									type="button"
									onclick={() => (showQualityMenu = !showQualityMenu)}
									class="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono cursor-pointer transition border {player.streamingQuality === 'original'
										? 'bg-neutral-900 hover:bg-neutral-800 text-emerald-400 border-emerald-800/50'
										: 'bg-amber-950/80 hover:bg-amber-900/80 text-amber-300 border-amber-700/60'}"
								>
									{#if player.streamingQuality === 'original'}
										<span class="font-bold">{player.currentTrack.format || 'FLAC'}</span>
										{#if player.currentTrack.bitrate_kbps}
											<span class="text-neutral-400">&bull; {player.currentTrack.bitrate_kbps.toLocaleString()}k</span>
										{/if}
									{:else}
										<span class="font-bold">MP3</span>
										<span class="text-amber-200">&bull; {player.streamingQuality}k</span>
									{/if}
								</button>
								{#if (player.currentTrack.disc_number || 1) > 1}
									<span class="text-[10px] font-mono text-amber-400 font-semibold bg-amber-950/60 px-2 py-0.5 rounded-full border border-amber-800/50">
										CD {player.currentTrack.disc_number}
									</span>
								{/if}

								<!-- Quality Dropdown Popover (Mobile) -->
								{#if showQualityMenu}
									<div
										class="fixed inset-0 z-40"
										onclick={() => (showQualityMenu = false)}
									></div>
									<div
										class="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-60 rounded-xl bg-neutral-900 border border-neutral-700/80 shadow-2xl p-2 text-xs flex flex-col gap-1 backdrop-blur-xl text-left"
									>
										<div class="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-neutral-400 border-b border-neutral-800">
											Streaming Quality
										</div>
										<button
											type="button"
											onclick={() => { player.setStreamingQuality('original'); showQualityMenu = false; }}
											class="px-2 py-1.5 rounded-lg text-left transition flex items-center justify-between cursor-pointer {player.streamingQuality === 'original'
												? 'bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30'
												: 'hover:bg-neutral-800 text-neutral-300'}"
										>
											<div>
												<div class="text-xs">Original Audio</div>
												<div class="text-[10px] text-neutral-500">Lossless / native bit depth</div>
											</div>
											{#if player.streamingQuality === 'original'}
												<CircleCheck class="w-3.5 h-3.5 text-emerald-400" />
											{/if}
										</button>
										<button
											type="button"
											onclick={() => { player.setStreamingQuality('320'); showQualityMenu = false; }}
											class="px-2 py-1.5 rounded-lg text-left transition flex items-center justify-between cursor-pointer {player.streamingQuality === '320'
												? 'bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30'
												: 'hover:bg-neutral-800 text-neutral-300'}"
										>
											<div>
												<div class="text-xs">320 kbps (High Quality)</div>
												<div class="text-[10px] text-neutral-500">Premium MP3 encoding</div>
											</div>
											{#if player.streamingQuality === '320'}
												<CircleCheck class="w-3.5 h-3.5 text-emerald-400" />
											{/if}
										</button>
										<button
											type="button"
											onclick={() => { player.setStreamingQuality('192'); showQualityMenu = false; }}
											class="px-2 py-1.5 rounded-lg text-left transition flex items-center justify-between cursor-pointer {player.streamingQuality === '192'
												? 'bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30'
												: 'hover:bg-neutral-800 text-neutral-300'}"
										>
											<div>
												<div class="text-xs">192 kbps (Standard)</div>
												<div class="text-[10px] text-neutral-500">Balanced bandwidth & quality</div>
											</div>
											{#if player.streamingQuality === '192'}
												<CircleCheck class="w-3.5 h-3.5 text-emerald-400" />
											{/if}
										</button>
										<button
											type="button"
											onclick={() => { player.setStreamingQuality('128'); showQualityMenu = false; }}
											class="px-2 py-1.5 rounded-lg text-left transition flex items-center justify-between cursor-pointer {player.streamingQuality === '128'
												? 'bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30'
												: 'hover:bg-neutral-800 text-neutral-300'}"
										>
											<div>
												<div class="text-xs">128 kbps (Data Saver)</div>
												<div class="text-[10px] text-neutral-500">Low bandwidth, mobile friendly</div>
											</div>
											{#if player.streamingQuality === '128'}
												<CircleCheck class="w-3.5 h-3.5 text-emerald-400" />
											{/if}
										</button>
									</div>
								{/if}
							</div>
						</div>

						<!-- Scrubber Slider -->
						<div class="w-full space-y-0.5 px-1 shrink-0">
							<div class="relative flex items-center group">
								<input
									type="range"
									min="0"
									max={player.duration || 100}
									value={player.currentTime}
									oninput={(e) => player.seekTo(parseFloat(e.currentTarget.value))}
									class="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-emerald-500 focus:outline-none"
								/>
							</div>
							<div class="flex justify-between text-[10px] font-mono text-neutral-400">
								<span>{formatTime(player.currentTime)}</span>
								<span>{formatTime(player.duration)}</span>
							</div>
						</div>

						<!-- Main Playback Controls -->
						<div class="flex items-center justify-between w-full max-w-[270px] shrink-0">
							<!-- Shuffle -->
							<button
								type="button"
								onclick={() => player.toggleShuffle()}
								class="p-2 rounded-xl transition cursor-pointer {player.shuffleEnabled ? 'text-emerald-400 bg-emerald-500/15 ring-1 ring-emerald-500/30' : 'text-neutral-400 hover:text-white'}"
								title="Shuffle ({player.shuffleEnabled ? 'On' : 'Off'})"
							>
								<Shuffle class="w-4 h-4" />
							</button>

							<!-- Skip Back -->
							<button
								type="button"
								onclick={() => player.previousTrack()}
								class="p-2 rounded-xl text-neutral-200 hover:text-white active:scale-95 transition cursor-pointer"
								title="Previous Track"
							>
								<SkipBack class="w-5 h-5 fill-current" />
							</button>

							<!-- Main Giant Play/Pause -->
							<button
								type="button"
								onclick={() => player.togglePlay()}
								class="w-13 h-13 rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-neutral-950 flex items-center justify-center shadow-lg shadow-emerald-500/30 active:scale-95 transition cursor-pointer shrink-0"
								title={player.isPlaying ? 'Pause' : 'Play'}
							>
								{#if player.isPlaying}
									<Pause class="w-6 h-6 fill-current" />
								{:else}
									<Play class="w-6 h-6 fill-current ml-0.5" />
								{/if}
							</button>

							<!-- Skip Forward -->
							<button
								type="button"
								onclick={() => player.nextTrack()}
								class="p-2 rounded-xl text-neutral-200 hover:text-white active:scale-95 transition cursor-pointer"
								title="Next Track"
							>
								<SkipForward class="w-5 h-5 fill-current" />
							</button>

							<!-- Repeat -->
							<button
								type="button"
								onclick={() => player.toggleRepeat()}
								class="p-2 rounded-xl transition cursor-pointer {player.repeatMode !== 'off' ? 'text-emerald-400 bg-emerald-500/15 ring-1 ring-emerald-500/30' : 'text-neutral-400 hover:text-white'}"
								title="Repeat ({player.repeatMode})"
							>
								{#if player.repeatMode === 'one'}
									<Repeat1 class="w-4 h-4" />
								{:else}
									<Repeat class="w-4 h-4" />
								{/if}
							</button>
						</div>

						<!-- Volume Control Slider -->
						<div class="flex items-center gap-2.5 w-full max-w-[240px] shrink-0">
							<button
								type="button"
								onclick={() => player.toggleMute()}
								class="text-neutral-400 hover:text-white p-1 cursor-pointer shrink-0"
							>
								{#if player.isMuted || player.volume === 0}
									<VolumeX class="w-3.5 h-3.5 text-rose-400" />
								{:else if player.volume < 0.5}
									<Volume1 class="w-3.5 h-3.5" />
								{:else}
									<Volume2 class="w-3.5 h-3.5 text-emerald-400" />
								{/if}
							</button>
							<input
								type="range"
								min="0"
								max="1"
								step="0.01"
								value={player.isMuted ? 0 : player.volume}
								oninput={(e) => player.setVolume(parseFloat(e.currentTarget.value))}
								class="w-full h-1 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
							/>
						</div>

						<!-- Quick Action Navigation Pills -->
						<div class="flex items-center justify-center gap-1.5 w-full pt-1.5 border-t border-neutral-800/60 shrink-0">
							<button
								type="button"
								onclick={() => { mobilePlayerTab = 'lyrics'; showLyricsDrawer = true; showQueueDrawer = false; }}
								class="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-neutral-800/80 hover:bg-neutral-800 text-neutral-300 hover:text-white text-[11px] font-semibold border border-neutral-700/60 transition cursor-pointer"
							>
								<Mic class="w-3 h-3 text-emerald-400" />
								<span>Lyrics</span>
							</button>
							<button
								type="button"
								onclick={() => { mobilePlayerTab = 'queue'; showQueueDrawer = true; showLyricsDrawer = false; }}
								class="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-neutral-800/80 hover:bg-neutral-800 text-neutral-300 hover:text-white text-[11px] font-semibold border border-neutral-700/60 transition cursor-pointer"
							>
								<ListMusic class="w-3 h-3 text-emerald-400" />
								<span>Queue</span>
							</button>
							<button
								type="button"
								onclick={() => (mobilePlayerTab = 'tracks')}
								class="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-neutral-800/80 hover:bg-neutral-800 text-neutral-300 hover:text-white text-[11px] font-semibold border border-neutral-700/60 transition cursor-pointer"
							>
								<Disc3 class="w-3 h-3 text-cyan-400" />
								<span>Tracks</span>
							</button>
						</div>
					</div>
				{:else}
					<div class="flex flex-col items-center justify-center flex-1 text-center p-6 space-y-4">
						<div class="w-20 h-20 rounded-full bg-neutral-800/80 border border-neutral-700/60 flex items-center justify-center text-neutral-500 shadow-xl">
							<Disc3 class="w-10 h-10" />
						</div>
						<div>
							<h3 class="text-base font-bold text-white">No Track Playing</h3>
							<p class="text-xs text-neutral-400 mt-1 max-w-xs">
								Choose an album, playlist, or song from your vault to start listening.
							</p>
						</div>
						<button
							type="button"
							onclick={() => { mobilePlayerTab = 'library'; showLyricsDrawer = false; showQueueDrawer = false; }}
							class="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition shadow-lg shadow-emerald-600/30 flex items-center gap-2 cursor-pointer"
						>
							<Library class="w-4 h-4" />
							<span>Browse Library</span>
						</button>
					</div>
				{/if}
			</section>
		{/if}

		<!-- DEDICATED MOBILE SEARCH VIEW -->
		{#if mobilePlayerTab === 'search'}
			<section class="flex md:hidden flex-1 bg-neutral-900/70 backdrop-blur-xl border border-neutral-800/70 rounded-2xl flex-col overflow-hidden min-h-0 shadow-xl">
				<!-- Search Input Header -->
				<div class="p-3 pb-2 border-b border-neutral-800/60 shrink-0">
					<div class="relative">
						<Search class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
						<input
							type="text"
							bind:value={mobileSearchQuery}
							placeholder="Search playlists & albums..."
							class="w-full bg-neutral-950/90 border border-neutral-800 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500"
						/>
						{#if mobileSearchQuery}
							<button
								type="button"
								onclick={() => (mobileSearchQuery = '')}
								class="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white cursor-pointer"
							>
								<X class="w-3.5 h-3.5" />
							</button>
						{/if}
					</div>
				</div>

				<!-- Scrollable Search Results: Playlists list, then Albums grid -->
				<div class="flex-1 overflow-y-auto min-h-0 overscroll-contain p-3 space-y-5">
					<!-- Section 1: Playlists -->
					<div>
						<div class="flex items-center justify-between mb-2">
							<h3 class="text-xs font-bold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
								<ListMusic class="w-3.5 h-3.5 text-emerald-400" />
								<span>Playlists</span>
								<span class="text-neutral-500 font-mono text-[10px]">({mobileFilteredPlaylists.length})</span>
							</h3>
						</div>

						{#if mobileFilteredPlaylists.length > 0}
							<div class="space-y-1.5">
								{#each mobileFilteredPlaylists as pl}
									<button
										type="button"
										onclick={() => { mobilePreviousTab = 'search'; selectPlaylist(pl); mobilePlayerTab = 'tracks'; }}
										class="w-full flex items-center gap-3 p-2 rounded-xl bg-neutral-950/60 hover:bg-neutral-800/60 border border-neutral-800/60 transition cursor-pointer text-left"
									>
										<div class="w-12 h-12 rounded-lg bg-neutral-900 overflow-hidden shrink-0 border border-neutral-800 flex items-center justify-center">
											{#if pl.cover_url}
												<img src={pl.cover_url} alt={pl.name} class="w-full h-full object-cover" />
											{:else}
												<ListMusic class="w-5 h-5 text-emerald-400 opacity-60" />
											{/if}
										</div>
										<div class="flex-1 min-w-0">
											<div class="text-xs font-bold text-white truncate">{pl.name}</div>
											<div class="text-[11px] text-neutral-400 mt-0.5">{pl.tracks.length} songs &bull; {pl.is_public ? 'Public' : 'Private'}</div>
										</div>
										<Play class="w-3.5 h-3.5 text-neutral-500 hover:text-emerald-400 shrink-0" />
									</button>
								{/each}
							</div>
						{:else}
							<div class="p-3 text-center text-xs text-neutral-500">No playlists found</div>
						{/if}
					</div>

					<!-- Section 2: Albums Grid -->
					<div>
						<div class="flex items-center justify-between mb-2">
							<h3 class="text-xs font-bold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
								<Disc3 class="w-3.5 h-3.5 text-emerald-400" />
								<span>Albums</span>
								<span class="text-neutral-500 font-mono text-[10px]">({mobileFilteredAlbums.length})</span>
							</h3>
						</div>

						{#if mobileFilteredAlbums.length > 0}
							<div class="grid grid-cols-2 gap-2.5">
								{#each mobileFilteredAlbums as alb}
									<button
										type="button"
										onclick={() => { mobilePreviousTab = 'search'; selectAlbum(alb); mobilePlayerTab = 'tracks'; }}
										class="flex flex-col p-2 rounded-xl bg-neutral-950/60 hover:bg-neutral-800/60 border border-neutral-800/60 transition cursor-pointer text-left group"
									>
										<div class="w-full aspect-square rounded-lg bg-neutral-900 overflow-hidden shrink-0 border border-neutral-800 relative">
											{#if alb.cover_url}
												<img src={alb.cover_url} alt={alb.title} class="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
											{:else}
												<div class="w-full h-full flex items-center justify-center text-neutral-600">
													<Music class="w-8 h-8" />
												</div>
											{/if}
										</div>
										<div class="mt-2 min-w-0">
											<div class="text-xs font-bold text-white truncate group-hover:text-emerald-400 transition">{alb.title}</div>
											<div class="text-[11px] text-neutral-400 truncate mt-0.5">{alb.artist}</div>
										</div>
									</button>
								{/each}
							</div>
						{:else}
							<div class="p-3 text-center text-xs text-neutral-500">No albums found</div>
						{/if}
					</div>
				</div>
			</section>
		{/if}

		<!-- DEDICATED MOBILE YOUR LIBRARY VIEW -->
		{#if mobilePlayerTab === 'library'}
			<section class="flex md:hidden flex-1 bg-neutral-900/70 backdrop-blur-xl border border-neutral-800/70 rounded-2xl flex-col overflow-hidden min-h-0 shadow-xl">
				<!-- Header -->
				<div class="p-3 pb-2 border-b border-neutral-800/60 flex items-center justify-between shrink-0">
					<div class="flex items-center gap-2">
						<Library class="w-4 h-4 text-emerald-400" />
						<h2 class="text-sm font-bold text-white">Your Library</h2>
					</div>
					<button
						type="button"
						onclick={() => { createPlaylistError = null; showCreatePlaylistModal = true; }}
						class="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 text-xs font-semibold flex items-center gap-1 cursor-pointer"
					>
						<Plus class="w-3.5 h-3.5" />
						<span>New Playlist</span>
					</button>
				</div>

				<!-- Scrollable Content -->
				<div class="flex-1 overflow-y-auto min-h-0 overscroll-contain p-3 space-y-2">
					{#if mobileLibraryTab === 'playlists'}
						<!-- PLAYLISTS (One below another) -->
						{#if mobileLibraryLayout === 'list'}
							<div class="space-y-1.5">
								{#each playlists as pl}
									<button
										type="button"
										onclick={() => { mobilePreviousTab = 'library'; selectPlaylist(pl); mobilePlayerTab = 'tracks'; }}
										class="w-full flex items-center gap-3 p-2.5 rounded-xl bg-neutral-950/60 hover:bg-neutral-800/60 border border-neutral-800/60 transition cursor-pointer text-left"
									>
										<div class="w-14 h-14 rounded-xl bg-neutral-900 overflow-hidden shrink-0 border border-neutral-800 flex items-center justify-center">
											{#if pl.cover_url}
												<img src={pl.cover_url} alt={pl.name} class="w-full h-full object-cover" />
											{:else}
												<ListMusic class="w-6 h-6 text-emerald-400 opacity-60" />
											{/if}
										</div>
										<div class="flex-1 min-w-0">
											<div class="text-xs font-bold text-white truncate">{pl.name}</div>
											<div class="text-[11px] text-neutral-400 mt-0.5">Playlist &bull; {pl.tracks.length} songs</div>
											{#if pl.comment}
												<div class="text-[10px] text-neutral-500 truncate mt-0.5">{pl.comment}</div>
											{/if}
										</div>
										<Play class="w-3.5 h-3.5 text-neutral-500 hover:text-emerald-400 shrink-0" />
									</button>
								{/each}
								{#if playlists.length === 0}
									<div class="p-8 text-center text-xs text-neutral-500">
										No playlists created yet. Tap "New Playlist" or "Create" below!
									</div>
								{/if}
							</div>
						{:else}
							<div class="grid grid-cols-2 gap-2.5">
								{#each playlists as pl}
									<button
										type="button"
										onclick={() => { mobilePreviousTab = 'library'; selectPlaylist(pl); mobilePlayerTab = 'tracks'; }}
										class="flex flex-col p-2 rounded-xl bg-neutral-950/60 hover:bg-neutral-800/60 border border-neutral-800/60 transition cursor-pointer text-left"
									>
										<div class="w-full aspect-square rounded-lg bg-neutral-900 overflow-hidden shrink-0 border border-neutral-800 flex items-center justify-center">
											{#if pl.cover_url}
												<img src={pl.cover_url} alt={pl.name} class="w-full h-full object-cover" />
											{:else}
												<ListMusic class="w-8 h-8 text-emerald-400 opacity-60" />
											{/if}
										</div>
										<div class="mt-1.5 min-w-0">
											<div class="text-xs font-bold text-white truncate">{pl.name}</div>
											<div class="text-[10px] text-neutral-400 truncate">{pl.tracks.length} songs</div>
										</div>
									</button>
								{/each}
							</div>
						{/if}
					{:else if mobileLibraryTab === 'albums'}
						{#if mobileLibraryLayout === 'list'}
							<div class="space-y-1.5">
								{#each albums as alb}
									<button
										type="button"
										onclick={() => { mobilePreviousTab = 'library'; selectAlbum(alb); mobilePlayerTab = 'tracks'; }}
										class="w-full flex items-center gap-3 p-2.5 rounded-xl bg-neutral-950/60 hover:bg-neutral-800/60 border border-neutral-800/60 transition cursor-pointer text-left"
									>
										<div class="w-14 h-14 rounded-xl bg-neutral-950 overflow-hidden shrink-0 border border-neutral-800 flex items-center justify-center">
											{#if alb.cover_url}
												<img src={alb.cover_url} alt={alb.title} class="w-full h-full object-cover" />
											{:else}
												<Music class="w-6 h-6 text-neutral-600" />
											{/if}
										</div>
										<div class="flex-1 min-w-0">
											<div class="text-xs font-bold text-white truncate">{alb.title}</div>
											<div class="text-[11px] text-neutral-400 mt-0.5">{alb.artist} &bull; {alb.tracks.length} tracks</div>
										</div>
										<Play class="w-3.5 h-3.5 text-neutral-500 hover:text-emerald-400 shrink-0" />
									</button>
								{/each}
							</div>
						{:else}
							<div class="grid grid-cols-2 gap-2.5">
								{#each albums as alb}
									<button
										type="button"
										onclick={() => { mobilePreviousTab = 'library'; selectAlbum(alb); mobilePlayerTab = 'tracks'; }}
										class="flex flex-col p-2 rounded-xl bg-neutral-950/60 hover:bg-neutral-800/60 border border-neutral-800/60 transition cursor-pointer text-left"
									>
										<div class="w-full aspect-square rounded-lg bg-neutral-900 overflow-hidden shrink-0 border border-neutral-800">
											{#if alb.cover_url}
												<img src={alb.cover_url} alt={alb.title} class="w-full h-full object-cover" />
											{:else}
												<div class="w-full h-full flex items-center justify-center text-neutral-600">
													<Music class="w-8 h-8" />
												</div>
											{/if}
										</div>
										<div class="mt-1.5 min-w-0">
											<div class="text-xs font-bold text-white truncate">{alb.title}</div>
											<div class="text-[10px] text-neutral-400 truncate">{alb.artist}</div>
										</div>
									</button>
								{/each}
							</div>
						{/if}
					{:else if mobileLibraryTab === 'artists'}
						<div class="space-y-1.5">
							{#each artists as art}
								<button
									type="button"
									onclick={() => { mobilePreviousTab = 'library'; selectArtist(art); mobilePlayerTab = 'tracks'; }}
									class="w-full flex items-center gap-3 p-2.5 rounded-xl bg-neutral-950/60 hover:bg-neutral-800/60 border border-neutral-800/60 transition cursor-pointer text-left"
								>
									<div class="w-12 h-12 rounded-full bg-neutral-900 overflow-hidden shrink-0 border border-neutral-800 flex items-center justify-center">
										{#if art.avatar_url || art.cover_url}
											<img src={art.avatar_url || art.cover_url} alt={art.name} class="w-full h-full object-cover" />
										{:else}
											<User class="w-5 h-5 text-neutral-500" />
										{/if}
									</div>
									<div class="flex-1 min-w-0">
										<div class="text-xs font-bold text-white truncate">{art.name}</div>
										<div class="text-[10px] text-neutral-400 mt-0.5">{art.album_count} albums &bull; {art.song_count} songs</div>
									</div>
								</button>
							{/each}
						</div>
					{:else if mobileLibraryTab === 'songs'}
						<div class="space-y-1">
							{#each filteredSongs.slice(0, 100) as track}
								<button
									type="button"
									onclick={() => playLibrarySong(track)}
									class="w-full flex items-center gap-2.5 p-2 rounded-xl bg-neutral-950/60 hover:bg-neutral-800/60 border border-neutral-800/50 transition cursor-pointer text-left"
								>
									<div class="w-9 h-9 rounded-lg bg-neutral-900 overflow-hidden shrink-0 border border-neutral-800 flex items-center justify-center">
										{#if track.album_cover_url}
											<img src={track.album_cover_url} alt="Cover" class="w-full h-full object-cover" />
										{:else}
											<Music class="w-4 h-4 text-neutral-600" />
										{/if}
									</div>
									<div class="flex-1 min-w-0">
										<div class="text-xs font-bold text-white truncate">{track.title}</div>
										<div class="text-[10px] text-neutral-400 truncate">{track.artist || 'Unknown Artist'}</div>
									</div>
									<span class="text-[10px] font-mono text-neutral-500">{formatDurationMs(track.duration_ms)}</span>
								</button>
							{/each}
						</div>
					{:else if mobileLibraryTab === 'downloaded'}
						<!-- DOWNLOADED MUSIC TAB (Phone storage) -->
						<div class="space-y-2">
							<div class="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-between">
								<div class="flex items-center gap-2">
									<ArrowDownCircle class="w-4 h-4 text-emerald-400" />
									<div>
										<div class="text-xs font-bold text-white">Downloaded to Phone</div>
										<div class="text-[10px] text-emerald-300 font-mono">
											{offlineStorage.downloadedTrackIds.size} songs &bull; {formatBytes(offlineStorage.offlineStorageBytes)}
										</div>
									</div>
								</div>
								{#if offlineStorage.downloadedTrackIds.size > 0}
									<button
										type="button"
										onclick={async () => {
											const confirmed = await confirmAction({
												title: 'Clear All Downloads',
												message: 'Are you sure you want to delete all offline downloaded songs from this device?',
												confirmText: 'Clear All'
											});
											if (confirmed) {
												await offlineStorage.clearAllOfflineMusic();
											}
										}}
										class="px-2 py-1 rounded-lg bg-neutral-900 border border-neutral-700/80 text-rose-300 text-[10px] font-semibold flex items-center gap-1 cursor-pointer hover:bg-neutral-800"
									>
										<Trash2 class="w-3 h-3 text-rose-400" />
										<span>Clear</span>
									</button>
								{/if}
							</div>

							{#if offlineStorage.downloadedTrackIds.size === 0}
								<div class="p-8 text-center text-xs text-neutral-500 space-y-2">
									<ArrowDownCircle class="w-8 h-8 text-neutral-600 mx-auto" />
									<p>No offline songs downloaded yet.</p>
									<p class="text-[10px] text-neutral-500">Tap the Download button on any album, playlist, or track to save it for 100% offline playback!</p>
								</div>
							{:else}
								<div class="space-y-1">
									{#each allLibraryTracks.filter((t) => offlineStorage.isDownloaded(t.id)) as track}
										<div
											class="w-full flex items-center gap-2.5 p-2 rounded-xl bg-neutral-950/60 hover:bg-neutral-800/60 border border-neutral-800/50 transition cursor-pointer text-left"
											onclick={() => playLibrarySong(track)}
										>
											<div class="w-9 h-9 rounded-lg bg-neutral-900 overflow-hidden shrink-0 border border-neutral-800 flex items-center justify-center">
												{#if track.album_cover_url}
													<img src={track.album_cover_url} alt="Cover" class="w-full h-full object-cover" />
												{:else}
													<Music class="w-4 h-4 text-emerald-400" />
												{/if}
											</div>
											<div class="flex-1 min-w-0">
												<div class="text-xs font-bold text-white truncate flex items-center gap-1">
													<span>{track.title}</span>
													<CircleCheck class="w-2.5 h-2.5 text-emerald-400 shrink-0" />
												</div>
												<div class="text-[10px] text-neutral-400 truncate">{track.artist || 'Unknown Artist'}</div>
											</div>
											<button
												type="button"
												onclick={async (e) => {
													e.stopPropagation();
													await offlineStorage.deleteTrack(track.id);
												}}
												class="p-1.5 rounded-lg text-neutral-500 hover:text-rose-400 hover:bg-rose-950/30 transition cursor-pointer"
												title="Delete from phone"
											>
												<Trash2 class="w-3.5 h-3.5" />
											</button>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				</div>

				<!-- SWITCHER BUTTON RIGHT ON TOP OF THE BOTTOM NAVBAR -->
				<div class="p-2 border-t border-neutral-800/80 bg-neutral-950/90 backdrop-blur-md flex items-center justify-between gap-1.5 shrink-0">
					<div class="flex items-center gap-1 overflow-x-auto flex-1">
						<button
							type="button"
							onclick={() => (mobileLibraryTab = 'playlists')}
							class="px-2.5 py-1 rounded-full text-[11px] font-semibold transition cursor-pointer {mobileLibraryTab === 'playlists' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-neutral-800/80 text-neutral-400 hover:text-white'}"
						>
							Playlists
						</button>
						<button
							type="button"
							onclick={() => (mobileLibraryTab = 'albums')}
							class="px-2.5 py-1 rounded-full text-[11px] font-semibold transition cursor-pointer {mobileLibraryTab === 'albums' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-neutral-800/80 text-neutral-400 hover:text-white'}"
						>
							Albums
						</button>
						<button
							type="button"
							onclick={() => (mobileLibraryTab = 'artists')}
							class="px-2.5 py-1 rounded-full text-[11px] font-semibold transition cursor-pointer {mobileLibraryTab === 'artists' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-neutral-800/80 text-neutral-400 hover:text-white'}"
						>
							Artists
						</button>
						<button
							type="button"
							onclick={() => (mobileLibraryTab = 'songs')}
							class="px-2.5 py-1 rounded-full text-[11px] font-semibold transition cursor-pointer {mobileLibraryTab === 'songs' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-neutral-800/80 text-neutral-400 hover:text-white'}"
						>
							Songs
						</button>
						<button
							type="button"
							onclick={() => (mobileLibraryTab = 'downloaded')}
							class="px-2.5 py-1 rounded-full text-[11px] font-semibold transition cursor-pointer flex items-center gap-1 {mobileLibraryTab === 'downloaded' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-neutral-800/80 text-neutral-400 hover:text-white'}"
						>
							<ArrowDownCircle class="w-3 h-3 text-emerald-400" />
							<span>Downloaded</span>
							{#if offlineStorage.downloadedTrackIds.size > 0}
								<span class="ml-0.5 px-1 py-0.2 rounded-full text-[9px] bg-emerald-950 text-emerald-300 font-mono">
									{offlineStorage.downloadedTrackIds.size}
								</span>
							{/if}
						</button>
					</div>

					<!-- Toggle List vs Grid Button -->
					<button
						type="button"
						onclick={() => (mobileLibraryLayout = mobileLibraryLayout === 'list' ? 'grid' : 'list')}
						class="px-2 py-1 rounded-lg bg-neutral-800/80 hover:bg-neutral-700 text-neutral-300 transition cursor-pointer flex items-center gap-1 text-[11px] font-semibold shrink-0"
						title="Toggle layout between List and Grid"
					>
						{#if mobileLibraryLayout === 'list'}
							<Grid class="w-3.5 h-3.5 text-emerald-400" />
							<span>Grid</span>
						{:else}
							<ListMusic class="w-3.5 h-3.5 text-emerald-400" />
							<span>List</span>
						{/if}
					</button>
				</div>
			</section>
		{/if}

		<!-- DEDICATED MOBILE PROFILE & USER SETTINGS VIEW -->
		{#if mobilePlayerTab === 'profile'}
			<section class="flex md:hidden flex-1 bg-neutral-900/70 backdrop-blur-xl border border-neutral-800/70 rounded-2xl flex-col overflow-hidden min-h-0 shadow-xl">
				<!-- Header -->
				<div class="p-3.5 pb-2.5 border-b border-neutral-800/60 flex items-center justify-between shrink-0">
					<div class="flex items-center gap-2">
						<div class="w-7 h-7 rounded-lg bg-emerald-950/80 border border-emerald-600/40 flex items-center justify-center text-emerald-400">
							<User class="w-4 h-4" />
						</div>
						<div>
							<h2 class="text-sm font-bold text-white">Profile & Preferences</h2>
							<p class="text-[10px] text-neutral-400">Mobile experience & vault settings</p>
						</div>
					</div>
					<button
						type="button"
						onclick={() => (mobilePlayerTab = mobilePreviousTab === 'profile' ? 'library' : mobilePreviousTab)}
						class="p-1.5 text-neutral-400 hover:text-white rounded-lg cursor-pointer"
						title="Close Profile"
					>
						<X class="w-4 h-4" />
					</button>
				</div>

				<!-- Scrollable Content -->
				<div class="flex-1 overflow-y-auto min-h-0 overscroll-contain p-3 space-y-3.5">
					<!-- User Card -->
					<div class="p-4 rounded-xl bg-neutral-950/70 border border-neutral-800/80 flex items-center justify-between gap-3 shadow-md">
						<div class="flex items-center gap-3 min-w-0">
							<div class="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-600 to-teal-800 text-white font-black text-lg flex items-center justify-center border-2 border-emerald-500/40 shadow-lg shadow-emerald-950/50 shrink-0">
								{(data.user?.username || 'U')[0].toUpperCase()}
							</div>
							<div class="min-w-0">
								<div class="text-sm font-bold text-white truncate flex items-center gap-1.5">
									<span>{data.user?.username || 'Guest / Synthetic Admin'}</span>
								</div>
								<div class="flex items-center gap-2 mt-0.5">
									<span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider {data.user?.role === 'admin' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-neutral-800 text-neutral-400 border border-neutral-700'}">
										{data.user?.role || 'Admin'}
									</span>
									{#if data.authDisabled}
										<span class="text-[10px] text-amber-400">Auth Bypassed</span>
									{/if}
								</div>
							</div>
						</div>
						<a
							href="/settings"
							class="p-2 rounded-lg bg-neutral-800/80 hover:bg-neutral-700 text-neutral-300 hover:text-white transition cursor-pointer shrink-0"
							title="Open Full Settings"
						>
							<Settings class="w-4 h-4" />
						</a>
					</div>

					<!-- Mobile Experience Mode Card (Requested by user) -->
					<div class="p-4 rounded-xl bg-neutral-950/70 border border-neutral-800/80 space-y-3 shadow-md">
						<div class="flex items-center gap-2 border-b border-neutral-800/60 pb-2.5">
							<Wrench class="w-4 h-4 text-emerald-400" />
							<div>
								<div class="text-xs font-bold text-white">Mobile Feature Suite</div>
								<div class="text-[10px] text-neutral-400">Listening mode vs full editing suite</div>
							</div>
						</div>

						<div class="flex items-start justify-between gap-3 pt-1">
							<div class="space-y-0.5 min-w-0">
								<div class="text-xs font-semibold text-white flex items-center gap-1.5">
									<span>Enable Full Editing Features</span>
									{#if mobileFullFeatures}
										<span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-500/25 text-emerald-300 border border-emerald-500/30">Active</span>
									{/if}
								</div>
								<p class="text-[11px] text-neutral-400 leading-relaxed">
									By default, Trax Vault on mobile is streamlined purely for listening. Turn this on to unlock all curation and editing tools (The Fixer, MusicBrainz Tagger, LRC Maker, Scanner, and Vault album catalog) on phone screens.
								</p>
							</div>
							<label class="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
								<input
									type="checkbox"
									checked={mobileFullFeatures}
									onchange={(e) => toggleMobileFullFeatures((e.target as HTMLInputElement).checked)}
									class="sr-only peer"
								/>
								<div class="w-11 h-6 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
							</label>
						</div>

						{#if mobileFullFeatures}
							<!-- Vault Editing Suite Launchers -->
							<div class="pt-2 border-t border-neutral-800/60 space-y-2">
								<div class="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Quick Studio Launchers</div>
								<div class="grid grid-cols-2 gap-2">
									<a
										href="/issues"
										class="p-2.5 rounded-lg bg-neutral-900/90 hover:bg-neutral-800/90 border border-neutral-800 flex items-center gap-2.5 transition text-left"
									>
										<div class="w-7 h-7 rounded-md bg-amber-950/80 border border-amber-600/40 text-amber-400 flex items-center justify-center shrink-0">
											<AlertTriangle class="w-3.5 h-3.5" />
										</div>
										<div class="min-w-0">
											<div class="text-xs font-bold text-white truncate">The Fixer</div>
											<div class="text-[10px] text-neutral-400 truncate">Fix bad audio & lyrics</div>
										</div>
									</a>

									<a
										href="/tagger"
										class="p-2.5 rounded-lg bg-neutral-900/90 hover:bg-neutral-800/90 border border-neutral-800 flex items-center gap-2.5 transition text-left"
									>
										<div class="w-7 h-7 rounded-md bg-purple-950/80 border border-purple-500/40 text-purple-400 flex items-center justify-center shrink-0">
											<Music class="w-3.5 h-3.5" />
										</div>
										<div class="min-w-0">
											<div class="text-xs font-bold text-white truncate">Tagger Studio</div>
											<div class="text-[10px] text-neutral-400 truncate">MusicBrainz matching</div>
										</div>
									</a>

									<a
										href="/lrc-maker"
										class="p-2.5 rounded-lg bg-neutral-900/90 hover:bg-neutral-800/90 border border-neutral-800 flex items-center gap-2.5 transition text-left"
									>
										<div class="w-7 h-7 rounded-md bg-blue-950/80 border border-blue-500/40 text-blue-400 flex items-center justify-center shrink-0">
											<Mic class="w-3.5 h-3.5" />
										</div>
										<div class="min-w-0">
											<div class="text-xs font-bold text-white truncate">LRC Maker</div>
											<div class="text-[10px] text-neutral-400 truncate">Sync karaoke lyrics</div>
										</div>
									</a>

									<a
										href="/scan"
										class="p-2.5 rounded-lg bg-neutral-900/90 hover:bg-neutral-800/90 border border-neutral-800 flex items-center gap-2.5 transition text-left"
									>
										<div class="w-7 h-7 rounded-md bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 flex items-center justify-center shrink-0">
											<RefreshCw class="w-3.5 h-3.5" />
										</div>
										<div class="min-w-0">
											<div class="text-xs font-bold text-white truncate">Scanner</div>
											<div class="text-[10px] text-neutral-400 truncate">Rescan disk files</div>
										</div>
									</a>

									<a
										href="/"
										class="col-span-2 p-2.5 rounded-lg bg-neutral-900/90 hover:bg-neutral-800/90 border border-neutral-800 flex items-center gap-2.5 transition text-left"
									>
										<div class="w-7 h-7 rounded-md bg-teal-950/80 border border-teal-500/40 text-teal-400 flex items-center justify-center shrink-0">
											<Disc3 class="w-3.5 h-3.5" />
										</div>
										<div class="min-w-0">
											<div class="text-xs font-bold text-white truncate">Full Vault Catalog</div>
											<div class="text-[10px] text-neutral-400 truncate">Browse all albums with fixer rules & track replacements</div>
										</div>
									</a>
								</div>
							</div>

							<!-- Top Header Switch -->
							<div class="flex items-center justify-between gap-3 pt-2 border-t border-neutral-800/60">
								<div class="space-y-0.5">
									<div class="text-xs font-semibold text-white">Show Top Navbar</div>
									<div class="text-[10px] text-neutral-400">Show desktop top header on mobile</div>
								</div>
								<label class="relative inline-flex items-center cursor-pointer shrink-0">
									<input
										type="checkbox"
										checked={mobileShowNavbar}
										onchange={(e) => toggleMobileShowNavbar((e.target as HTMLInputElement).checked)}
										class="sr-only peer"
									/>
									<div class="w-11 h-6 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
								</label>
							</div>
						{/if}
					</div>

					<!-- Streaming Quality Preferences -->
					<div class="p-4 rounded-xl bg-neutral-950/70 border border-neutral-800/80 space-y-3 shadow-md">
						<div class="flex items-center gap-2 border-b border-neutral-800/60 pb-2.5">
							<Radio class="w-4 h-4 text-emerald-400" />
							<div>
								<div class="text-xs font-bold text-white">Streaming Audio Quality</div>
								<div class="text-[10px] text-neutral-400">Bitrate & transcoding mode</div>
							</div>
						</div>

						<div class="grid grid-cols-2 gap-2">
							<button
								type="button"
								onclick={() => player.setStreamingQuality('original')}
								class="p-2.5 rounded-lg border text-left transition cursor-pointer {player.streamingQuality === 'original' ? 'bg-emerald-950/60 border-emerald-500/60 text-white' : 'bg-neutral-900/60 border-neutral-800 text-neutral-400 hover:text-white'}"
							>
								<div class="text-xs font-bold {player.streamingQuality === 'original' ? 'text-emerald-300' : 'text-neutral-300'}">Original Lossless</div>
								<div class="text-[10px] opacity-75">Direct FLAC / Bit-perfect</div>
							</button>

							<button
								type="button"
								onclick={() => player.setStreamingQuality('320')}
								class="p-2.5 rounded-lg border text-left transition cursor-pointer {player.streamingQuality === '320' ? 'bg-emerald-950/60 border-emerald-500/60 text-white' : 'bg-neutral-900/60 border-neutral-800 text-neutral-400 hover:text-white'}"
							>
								<div class="text-xs font-bold {player.streamingQuality === '320' ? 'text-emerald-300' : 'text-neutral-300'}">High (320 kbps)</div>
								<div class="text-[10px] opacity-75">MP3 Transcode</div>
							</button>

							<button
								type="button"
								onclick={() => player.setStreamingQuality('192')}
								class="p-2.5 rounded-lg border text-left transition cursor-pointer {player.streamingQuality === '192' ? 'bg-emerald-950/60 border-emerald-500/60 text-white' : 'bg-neutral-900/60 border-neutral-800 text-neutral-400 hover:text-white'}"
							>
								<div class="text-xs font-bold {player.streamingQuality === '192' ? 'text-emerald-300' : 'text-neutral-300'}">Standard (192 kbps)</div>
								<div class="text-[10px] opacity-75">Balanced data usage</div>
							</button>

							<button
								type="button"
								onclick={() => player.setStreamingQuality('128')}
								class="p-2.5 rounded-lg border text-left transition cursor-pointer {player.streamingQuality === '128' ? 'bg-emerald-950/60 border-emerald-500/60 text-white' : 'bg-neutral-900/60 border-neutral-800 text-neutral-400 hover:text-white'}"
							>
								<div class="text-xs font-bold {player.streamingQuality === '128' ? 'text-emerald-300' : 'text-neutral-300'}">Data Saver (128 kbps)</div>
								<div class="text-[10px] opacity-75">Low bandwidth</div>
							</button>
						</div>
					</div>

					<!-- Links & Shortcuts -->
					<div class="p-2 rounded-xl bg-neutral-950/70 border border-neutral-800/80 space-y-1 shadow-md">
						<a
							href="/settings"
							class="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-neutral-800/60 text-xs font-semibold text-neutral-300 hover:text-white transition"
						>
							<div class="flex items-center gap-2.5">
								<Shield class="w-4 h-4 text-emerald-400" />
								<span>Account & Password Settings</span>
							</div>
							<ExternalLink class="w-3.5 h-3.5 text-neutral-500" />
						</a>

						<a
							href="/settings?tab=subsonic"
							class="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-neutral-800/60 text-xs font-semibold text-neutral-300 hover:text-white transition"
						>
							<div class="flex items-center gap-2.5">
								<Radio class="w-4 h-4 text-purple-400" />
								<span>Subsonic & Mobile Apps (Symfonium/Feishin)</span>
							</div>
							<ExternalLink class="w-3.5 h-3.5 text-neutral-500" />
						</a>

						<button
							type="button"
							onclick={() => player.openSyncModal(player.activeRoom?.type === 'shared' ? 'rooms' : 'devices')}
							class="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-neutral-800/60 text-xs font-semibold text-neutral-300 hover:text-white transition cursor-pointer"
						>
							<div class="flex items-center gap-2.5">
								<Users class="w-4 h-4 text-emerald-400" />
								<span>Multi-Device Sync & Listen Together</span>
							</div>
							<span class="text-[10px] text-emerald-400 font-mono font-bold">
								{player.activeRoom ? `#${player.activeRoom.code}` : 'Off'}
							</span>
						</button>
					</div>

					{#if !data.authDisabled}
						<button
							type="button"
							onclick={handleMobileLogout}
							class="w-full py-2.5 rounded-xl bg-red-950/40 hover:bg-red-900/50 border border-red-800/50 text-red-300 font-semibold text-xs transition cursor-pointer flex items-center justify-center gap-2"
						>
							<LogOut class="w-4 h-4" />
							<span>Sign Out</span>
						</button>
					{/if}
				</div>
			</section>
		{/if}

		<!-- DEDICATED MOBILE STUDIO VIEW (When Full Editing Suite is Enabled) -->
		{#if mobilePlayerTab === 'studio' && mobileFullFeatures}
			<section class="flex md:hidden flex-1 bg-neutral-900/70 backdrop-blur-xl border border-neutral-800/70 rounded-2xl flex-col overflow-hidden min-h-0 shadow-xl">
				<!-- Header -->
				<div class="p-3.5 pb-2.5 border-b border-neutral-800/60 flex items-center justify-between shrink-0">
					<div class="flex items-center gap-2">
						<div class="w-7 h-7 rounded-lg bg-emerald-950/80 border border-emerald-600/40 flex items-center justify-center text-emerald-400">
							<Wrench class="w-4 h-4" />
						</div>
						<div>
							<h2 class="text-sm font-bold text-white">Trax Vault Studio</h2>
							<p class="text-[10px] text-neutral-400">Curation, tagging & lyrics editing</p>
						</div>
					</div>
					<button
						type="button"
						onclick={() => (mobilePlayerTab = mobilePreviousTab === 'studio' ? 'library' : mobilePreviousTab)}
						class="p-1.5 text-neutral-400 hover:text-white rounded-lg cursor-pointer"
						title="Close Studio"
					>
						<X class="w-4 h-4" />
					</button>
				</div>

				<!-- Scrollable Content -->
				<div class="flex-1 overflow-y-auto min-h-0 overscroll-contain p-3 space-y-3">
					<div class="p-3.5 rounded-xl bg-neutral-950/70 border border-neutral-800/80 space-y-1">
						<div class="text-xs font-bold text-white">Library Curation & Editing Suite</div>
						<div class="text-[11px] text-neutral-400 leading-relaxed">
							All powerful desktop editing features are accessible right on your phone. Tap any tool below to launch:
						</div>
					</div>

					<div class="space-y-2">
						<a
							href="/issues"
							class="w-full flex items-center gap-3 p-3 rounded-xl bg-neutral-950/60 hover:bg-neutral-800/60 border border-neutral-800/60 transition group text-left"
						>
							<div class="w-10 h-10 rounded-lg bg-amber-950/80 border border-amber-600/40 text-amber-400 flex items-center justify-center shrink-0">
								<AlertTriangle class="w-5 h-5" />
							</div>
							<div class="flex-1 min-w-0">
								<div class="text-xs font-bold text-white group-hover:text-amber-400 transition">The Fixer</div>
								<div class="text-[11px] text-neutral-400">Audit audio quality, missing lyrics & explicit flags</div>
							</div>
							<ExternalLink class="w-4 h-4 text-neutral-500 group-hover:text-amber-400 transition shrink-0" />
						</a>

						<a
							href="/tagger"
							class="w-full flex items-center gap-3 p-3 rounded-xl bg-neutral-950/60 hover:bg-neutral-800/60 border border-neutral-800/60 transition group text-left"
						>
							<div class="w-10 h-10 rounded-lg bg-purple-950/80 border border-purple-500/40 text-purple-400 flex items-center justify-center shrink-0">
								<Music class="w-5 h-5" />
							</div>
							<div class="flex-1 min-w-0">
								<div class="text-xs font-bold text-white group-hover:text-purple-400 transition">MusicBrainz Tagger Studio</div>
								<div class="text-[11px] text-neutral-400">Match releases and embed high-res tags & cover art</div>
							</div>
							<ExternalLink class="w-4 h-4 text-neutral-500 group-hover:text-purple-400 transition shrink-0" />
						</a>

						<a
							href="/lrc-maker"
							class="w-full flex items-center gap-3 p-3 rounded-xl bg-neutral-950/60 hover:bg-neutral-800/60 border border-neutral-800/60 transition group text-left"
						>
							<div class="w-10 h-10 rounded-lg bg-blue-950/80 border border-blue-500/40 text-blue-400 flex items-center justify-center shrink-0">
								<Mic class="w-5 h-5" />
							</div>
							<div class="flex-1 min-w-0">
								<div class="text-xs font-bold text-white group-hover:text-blue-400 transition">LRC Maker Studio</div>
								<div class="text-[11px] text-neutral-400">Record and time-sync karaoke lyrics line by line</div>
							</div>
							<ExternalLink class="w-4 h-4 text-neutral-500 group-hover:text-blue-400 transition shrink-0" />
						</a>

						<a
							href="/scan"
							class="w-full flex items-center gap-3 p-3 rounded-xl bg-neutral-950/60 hover:bg-neutral-800/60 border border-neutral-800/60 transition group text-left"
						>
							<div class="w-10 h-10 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 flex items-center justify-center shrink-0">
								<RefreshCw class="w-5 h-5" />
							</div>
							<div class="flex-1 min-w-0">
								<div class="text-xs font-bold text-white group-hover:text-emerald-400 transition">Library Scanner</div>
								<div class="text-[11px] text-neutral-400">Rescan disk files and index newly added music</div>
							</div>
							<ExternalLink class="w-4 h-4 text-neutral-500 group-hover:text-emerald-400 transition shrink-0" />
						</a>

						<a
							href="/"
							class="w-full flex items-center gap-3 p-3 rounded-xl bg-neutral-950/60 hover:bg-neutral-800/60 border border-neutral-800/60 transition group text-left"
						>
							<div class="w-10 h-10 rounded-lg bg-teal-950/80 border border-teal-500/40 text-teal-400 flex items-center justify-center shrink-0">
								<Disc3 class="w-5 h-5" />
							</div>
							<div class="flex-1 min-w-0">
								<div class="text-xs font-bold text-white group-hover:text-teal-400 transition">Vault Catalog & Albums</div>
								<div class="text-[11px] text-neutral-400">Full album grid, fixer rules, and track replacements</div>
							</div>
							<ExternalLink class="w-4 h-4 text-neutral-500 group-hover:text-teal-400 transition shrink-0" />
						</a>
					</div>
				</div>
			</section>
		{/if}

		<!-- LEFT SIDEBAR: Vault Audio Library & Playlists (Desktop) -->
		<aside class="hidden md:flex order-1 w-full md:w-72 lg:w-80 bg-neutral-900/60 backdrop-blur-xl border border-neutral-800/70 rounded-2xl flex-col overflow-hidden shrink-0 shadow-xl">
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

				<!-- Segmented Switcher: Albums vs Artists vs Songs vs Playlists -->
				<div class="grid grid-cols-4 p-0.5 rounded-xl bg-neutral-950/80 border border-neutral-800 mb-2.5">
					<button
						type="button"
						onclick={() => (libraryTab = 'albums')}
						class="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold transition cursor-pointer {libraryTab === 'albums'
							? 'bg-neutral-800 text-white shadow-sm'
							: 'text-neutral-400 hover:text-neutral-200'}"
					>
						<Disc3 class="w-3 h-3 {libraryTab === 'albums' ? 'text-emerald-400' : ''}" />
						<span class="truncate">Albums</span>
					</button>

					<button
						type="button"
						onclick={() => (libraryTab = 'artists')}
						class="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold transition cursor-pointer {libraryTab === 'artists'
							? 'bg-neutral-800 text-white shadow-sm'
							: 'text-neutral-400 hover:text-neutral-200'}"
					>
						<User class="w-3 h-3 {libraryTab === 'artists' ? 'text-emerald-400' : ''}" />
						<span class="truncate">Artists</span>
					</button>

					<button
						type="button"
						onclick={() => (libraryTab = 'songs')}
						class="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold transition cursor-pointer {libraryTab === 'songs'
							? 'bg-neutral-800 text-white shadow-sm'
							: 'text-neutral-400 hover:text-neutral-200'}"
					>
						<Music class="w-3 h-3 {libraryTab === 'songs' ? 'text-emerald-400' : ''}" />
						<span class="truncate">Songs</span>
					</button>

					<button
						type="button"
						onclick={() => (libraryTab = 'playlists')}
						class="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold transition cursor-pointer {libraryTab === 'playlists'
							? 'bg-neutral-800 text-white shadow-sm'
							: 'text-neutral-400 hover:text-neutral-200'}"
					>
						<ListMusic class="w-3 h-3 {libraryTab === 'playlists' ? 'text-emerald-400' : ''}" />
						<span class="truncate">Playlists</span>
					</button>
				</div>

				<!-- Search Input -->
				<div class="relative">
					<Search class="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
					<input
						type="text"
						bind:value={librarySearch}
						placeholder={libraryTab === 'albums' ? 'Search album, artist...' : (libraryTab === 'artists' ? 'Search artists...' : (libraryTab === 'songs' ? 'Search all songs...' : 'Search playlists...'))}
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
				{#if libraryTab === 'albums'}
					<div class="flex items-center gap-1.5 mt-2.5 overflow-x-auto no-scrollbar pb-1 text-xs">
						{#each [
							{ id: 'all', label: 'All' },
							{ id: 'downloaded', label: 'Downloaded' },
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
					</div>
				{:else if libraryTab === 'playlists'}
					<div class="flex items-center gap-1.5 mt-2.5 overflow-x-auto no-scrollbar pb-1 text-xs">
						{#each [
							{ id: 'all', label: 'All Playlists' },
							{ id: 'downloaded', label: 'Downloaded' },
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
					</div>
				{/if}
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
				{:else if libraryTab === 'artists'}
					{#each filteredArtists as artist}
						{@const isSelected = selectedType === 'artist' && selectedArtist?.name.toLowerCase() === artist.name.toLowerCase()}
						<div
							role="button"
							tabindex="0"
							onclick={() => selectArtist(artist)}
							onkeydown={(e) => {
								if (e.key === 'Enter') selectArtist(artist);
							}}
							class="w-full flex items-center gap-2.5 p-2 rounded-xl transition text-left cursor-pointer group border {isSelected
								? 'bg-neutral-800/80 border-emerald-500/40 text-white shadow-md'
								: 'border-transparent text-neutral-300 hover:bg-neutral-800/40 hover:text-white'}"
						>
							<!-- Artist Avatar -->
							<div class="relative w-11 h-11 rounded-full overflow-hidden bg-neutral-950 shrink-0 border border-neutral-800 shadow-sm flex items-center justify-center">
								{#if artist.avatar_url || artist.cover_url}
									<img
										src={artist.avatar_url || artist.cover_url}
										alt={artist.name}
										loading="lazy"
										decoding="async"
										class="w-full h-full object-cover"
										onerror={(e) => {
											const img = e.currentTarget as HTMLImageElement;
											if (artist.cover_url && img.src !== artist.cover_url) {
												img.src = artist.cover_url;
											} else {
												img.style.display = 'none';
											}
										}}
									/>
								{:else}
									<User class="w-5 h-5 text-neutral-500" />
								{/if}
							</div>

							<!-- Details -->
							<div class="min-w-0 flex-1">
								<div class="text-xs font-semibold truncate {isSelected ? 'text-emerald-400' : 'text-neutral-100'}">
									{artist.name}
								</div>
								<div class="text-[10px] text-neutral-400 truncate mt-0.5 flex items-center gap-1.5">
									<span>{artist.album_count} {artist.album_count === 1 ? 'album' : 'albums'}</span>
									<span>&bull;</span>
									<span>{artist.song_count} {artist.song_count === 1 ? 'song' : 'songs'}</span>
								</div>
							</div>

							<!-- Instant Play Trigger on Hover -->
							<button
								type="button"
								onclick={(e) => {
									e.stopPropagation();
									selectArtist(artist);
									if (artist.tracks.length > 0) {
										playArtistTrack(artist.tracks[0]);
									}
								}}
								class="w-7 h-7 rounded-full bg-emerald-500 hover:bg-emerald-400 text-neutral-950 flex items-center justify-center opacity-0 group-hover:opacity-100 transition shadow-md cursor-pointer shrink-0"
								title="Play {artist.name}"
							>
								<Play class="w-3.5 h-3.5 fill-current ml-0.5" />
							</button>
						</div>
					{/each}

					{#if filteredArtists.length === 0}
						<div class="p-6 text-center text-xs text-neutral-500">
							No artists found matching your search.
						</div>
					{/if}
				{:else if libraryTab === 'songs'}
					<!-- ALL SONGS LIST -->
					{#each filteredSongs as track}
						{@const isCurrentTrack = player.currentTrack?.id === track.id}
						{@const isCurrentPlaying = isCurrentTrack && player.isPlaying}
						{@const isMissing = track.is_missing === 1}
						<div
							role="button"
							tabindex="0"
							onclick={() => {
								if (!isMissing) playLibrarySong(track);
							}}
							onkeydown={(e) => {
								if (e.key === 'Enter' && !isMissing) playLibrarySong(track);
							}}
							class="w-full flex items-center gap-2.5 p-2 rounded-xl transition text-left cursor-pointer group border {isCurrentTrack
								? 'bg-neutral-800/80 border-emerald-500/40 text-white shadow-md'
								: 'border-transparent text-neutral-300 hover:bg-neutral-800/40 hover:text-white'}"
						>
							<div class="relative w-10 h-10 rounded-lg overflow-hidden bg-neutral-950 shrink-0 border border-neutral-800 shadow-sm flex items-center justify-center">
								{#if track.album_cover_url}
									<img src={track.album_cover_url} alt={track.title} class="w-full h-full object-cover" />
								{:else}
									<Music class="w-4 h-4 text-neutral-600" />
								{/if}
								{#if isCurrentPlaying}
									<div class="absolute inset-0 bg-neutral-950/70 flex items-center justify-center">
										<div class="flex items-end gap-0.5 h-3">
											<span class="w-0.5 bg-emerald-400 animate-pulse h-full"></span>
											<span class="w-0.5 bg-emerald-400 animate-pulse h-1.5"></span>
											<span class="w-0.5 bg-emerald-400 animate-pulse h-full"></span>
										</div>
									</div>
								{/if}
							</div>

							<div class="min-w-0 flex-1">
								<div class="text-xs font-semibold truncate {isCurrentTrack ? 'text-emerald-300' : 'text-white'}">
									{track.title}
								</div>
								<div class="text-[10px] text-neutral-400 truncate">
									{track.artist || track.album_artist || 'Unknown Artist'} &bull; {track.album_title || ''}
								</div>
							</div>

							<div class="text-right shrink-0">
								<span class="text-[10px] font-mono text-neutral-500 block">{formatDurationMs(track.duration_ms)}</span>
								{#if track.format}
									<span class="text-[9px] font-mono text-neutral-400">{track.format}</span>
								{/if}
							</div>
						</div>
					{/each}

					{#if filteredSongs.length === 0}
						<div class="p-6 text-center text-xs text-neutral-500">
							No songs found matching your search.
						</div>
					{/if}
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
		{#if showLyricsDrawer || mobilePlayerTab === 'lyrics'}
			<section class="{mobilePlayerTab === 'lyrics' ? 'flex' : (showLyricsDrawer ? 'hidden md:flex' : 'hidden')} order-2 flex-1 bg-neutral-900/60 backdrop-blur-xl border border-neutral-800/70 rounded-2xl flex-col overflow-hidden min-h-0 shadow-xl animate-in fade-in duration-200">
				<!-- Lyrics Header -->
				<div class="p-3.5 px-5 border-b border-neutral-800/60 flex items-center justify-between shrink-0">
					<div class="flex items-center gap-2.5">
						<div class="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
							<Mic class="w-4 h-4" />
						</div>
						<div>
							<div class="flex items-center gap-1.5">
								<h3 class="font-bold text-xs text-white">Live Synced Lyrics</h3>
								{#if player.currentTrack?.lyrics === 'censored_lrc'}
									<span class="px-1.5 py-0.2 rounded text-[9px] bg-orange-950/80 border border-orange-700/80 text-orange-300 font-semibold uppercase">
										Censored
									</span>
								{/if}
							</div>
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
								if (mobilePlayerTab === 'lyrics') mobilePlayerTab = 'tracks';
							}}
							class="text-neutral-400 hover:text-white p-1.5 rounded-lg hover:bg-neutral-800 cursor-pointer transition"
							title="Close Lyrics"
						>
							<X class="w-4 h-4" />
						</button>
					</div>
				</div>

				<!-- Lyrics Scrollable Body Container -->
				<div class="relative flex-1 min-h-0 flex flex-col">
					<div
						class="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 flex flex-col min-h-0"
						onwheel={() => {
							userScrolledLyrics = true;
						}}
						ontouchmove={() => {
							userScrolledLyrics = true;
						}}
						onpointerdown={(e) => {
							if (e.target === e.currentTarget) {
								userScrolledLyrics = true;
							}
						}}
					>
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
										onclick={() => {
											if (line.time !== null) {
												player.seekTo(line.time);
												userScrolledLyrics = false;
											}
										}}
										class="w-full text-left cursor-pointer rounded-2xl px-4 py-2.5 text-[18px] sm:text-[20px] font-semibold leading-relaxed transition-all duration-200 border-0 outline-none {isActive
											? 'text-emerald-300 bg-neutral-800/40 drop-shadow-[0_0_16px_rgba(16,185,129,0.25)] scale-[1.04] origin-left'
											: i < activeLyricLineIndex
											? 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/30'
											: 'text-neutral-300 hover:text-white hover:bg-neutral-800/30'}"
									>
										{#if isActive && line.words && line.words.length > 0}
											{#each line.words as w}
												{@const isWordSung = player.currentTime >= w.time}
												<span class="transition-colors duration-100 font-semibold {isWordSung ? 'text-emerald-300 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'text-neutral-400 opacity-60'}">
													{w.text}
												</span>
											{/each}
										{:else}
											{line.text}
										{/if}
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

					<!-- Floating "Sync with song" Button when user has scrolled away -->
					{#if userScrolledLyrics && activeLyricLineIndex >= 0 && lyricsLines.length > 0}
						<div class="absolute bottom-5 inset-x-0 flex justify-center pointer-events-none z-20 animate-in fade-in slide-in-from-bottom-2 duration-200">
							<button
								type="button"
								onclick={() => {
									userScrolledLyrics = false;
									const el = document.getElementById(`lyrics-line-${activeLyricLineIndex}`);
									el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
								}}
								class="pointer-events-auto flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-600/95 hover:bg-emerald-500 text-white text-xs font-bold shadow-2xl backdrop-blur-md border border-emerald-400/40 cursor-pointer transition hover:scale-105 active:scale-95"
							>
								<Compass class="w-3.5 h-3.5" />
								<span>Sync with song</span>
							</button>
						</div>
					{/if}
				</div>
			</section>
		{/if}

		<!-- SONGS & HERO PANEL: Main Viewport (Center when lyrics closed, Right when lyrics open) -->
		<main class="{mobilePlayerTab === 'tracks' ? 'flex' : 'hidden'} md:flex {showLyricsDrawer ? 'order-3 flex-1 min-w-0 md:min-w-[320px] lg:min-w-[380px] lg:max-w-[480px] xl:max-w-[540px]' : 'order-2 flex-1 min-w-0'} bg-neutral-900/60 backdrop-blur-xl border border-neutral-800/70 rounded-2xl flex-col overflow-y-auto overscroll-contain md:overflow-hidden min-h-0 shadow-xl transition-all duration-200">
			<!-- Mobile Back Navigation Button (To Library or Search) -->
			<div class="md:hidden flex items-center justify-between p-2.5 pb-1 border-b border-neutral-800/40 shrink-0">
				<button
					type="button"
					onclick={() => (mobilePlayerTab = mobilePreviousTab || 'library')}
					class="flex items-center gap-1 text-xs font-semibold text-neutral-300 hover:text-white px-2.5 py-1 rounded-lg bg-neutral-800/80 cursor-pointer active:scale-95 transition"
				>
					<ChevronLeft class="w-4 h-4 text-emerald-400" />
					<span>Back</span>
				</button>
				<span class="text-[11px] font-bold text-neutral-400 truncate max-w-[200px]">
					{selectedType === 'album' ? selectedAlbum?.title : (selectedType === 'playlist' ? selectedPlaylist?.name : selectedArtist?.name)}
				</span>
			</div>

			{#if selectedType === 'album' && selectedAlbum}
				<!-- ALBUM HERO BANNER -->
				<div class="{showLyricsDrawer ? 'p-3 sm:p-4 pb-2 sm:pb-3' : 'p-3 sm:p-6 pb-3 sm:pb-4'} border-b border-neutral-800/60 shrink-0">
					<div class="flex flex-row items-center sm:items-end gap-3 sm:gap-4">
						<!-- Big Album Cover -->
						<div class="relative {showLyricsDrawer ? 'w-16 h-16 sm:w-24 sm:h-24' : 'w-20 h-20 sm:w-36 sm:h-36 md:w-44 md:h-44'} rounded-xl sm:rounded-2xl overflow-hidden bg-neutral-950 shrink-0 shadow-xl sm:shadow-2xl border border-neutral-800">
							{#if selectedAlbum.cover_url}
								<img src={selectedAlbum.cover_url} alt={selectedAlbum.title} class="w-full h-full object-cover" />
							{:else}
								<div class="w-full h-full flex items-center justify-center bg-neutral-900 text-neutral-600">
									<Music class={showLyricsDrawer ? 'w-8 h-8' : 'w-10 h-10 sm:w-14 sm:h-14'} />
								</div>
							{/if}
						</div>

						<!-- Album Metadata Header -->
						<div class="flex-1 min-w-0 text-left space-y-1">
							<div class="flex flex-wrap items-center justify-start gap-1 sm:gap-1.5">
								<span class="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-950/60 px-1.5 sm:px-2 py-0.5 rounded-full border border-emerald-800/50">
									Album
								</span>

								{#if selectedAlbum.tracks.some(t => t.format === 'FLAC')}
									<span class="text-[9px] sm:text-[10px] font-mono text-cyan-300 bg-cyan-950/60 px-1.5 sm:px-2 py-0.5 rounded-full border border-cyan-800/50">
										Lossless FLAC
									</span>
								{/if}

								{#if (selectedAlbum.track_count || 0) > 0 && selectedAlbum.checked_count === selectedAlbum.track_count}
									<span class="text-[9px] sm:text-[10px] font-semibold text-emerald-300 bg-emerald-950/80 px-1.5 sm:px-2 py-0.5 rounded-full border border-emerald-600 flex items-center gap-1">
										<CircleCheck class="w-2.5 h-2.5 sm:w-3 sm:h-3 text-emerald-400" />
										Verified
									</span>
								{/if}
							</div>

							<h1 class="{showLyricsDrawer ? 'text-base sm:text-xl font-bold' : 'text-base sm:text-2xl md:text-3xl lg:text-4xl font-extrabold'} text-white tracking-tight leading-tight line-clamp-2">
								{selectedAlbum.title}
							</h1>

							<div class="flex flex-wrap items-center justify-start gap-1.5 text-xs text-neutral-300">
								<button
									type="button"
									onclick={() => selectArtist(selectedAlbum!.artist)}
									class="font-bold text-white hover:text-emerald-400 hover:underline transition truncate max-w-[150px] sm:max-w-[200px] cursor-pointer"
									title="View {selectedAlbum.artist} discography & songs"
								>
									{selectedAlbum.artist}
								</button>
								{#if selectedAlbum.release_year}
									<span>&bull;</span>
									<span class="text-neutral-400">{selectedAlbum.release_year}</span>
								{/if}
								<span>&bull;</span>
								<span class="text-neutral-400">{selectedAlbum.tracks.length} tracks{albumHasMultipleDiscs ? ` (${albumDiscCount} CDs)` : ''}</span>
								{#if selectedAlbum.genre && !showLyricsDrawer}
									<span class="hidden sm:inline">&bull;</span>
									<span class="hidden sm:inline-block px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700/60 text-[10px]">
										{selectedAlbum.genre}
									</span>
								{/if}
							</div>

							<!-- Action Bar -->
							<div class="pt-1 flex flex-wrap items-center justify-start gap-1.5 sm:gap-2">
								<!-- Play Button -->
								<button
									type="button"
									onclick={() => {
										if (player.currentAlbum?.id === selectedAlbum!.id && player.isPlaying) {
											player.togglePlay();
										} else {
											const playable = selectedAlbum!.tracks.filter((t) => t.is_missing !== 1);
											if (playable.length > 0) {
												player.playTrack(playable[0], selectedAlbum!, playable);
											}
										}
									}}
									class="px-3 sm:px-4 py-1 sm:py-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-neutral-950 font-bold text-xs shadow-lg shadow-emerald-500/20 hover:scale-105 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
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
											const playable = selectedAlbum!.tracks.filter((t) => t.is_missing !== 1);
											if (playable.length > 0) {
												player.playTrack(playable[0], selectedAlbum!, playable);
											}
										}
									}}
									class="p-1 sm:p-1.5 rounded-xl border text-xs font-semibold transition flex items-center gap-1.5 {player.shuffleEnabled && player.currentAlbum?.id === selectedAlbum!.id ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400 shadow-sm shadow-emerald-500/20' : 'bg-neutral-800/80 border-neutral-700/70 text-neutral-300 hover:text-white hover:bg-neutral-700'}"
									title="Shuffle Play ({player.shuffleEnabled ? 'On' : 'Off'})"
								>
									<Shuffle class="w-3.5 h-3.5" />
									<span class="hidden sm:inline">Shuffle</span>
								</button>

								<!-- Open in Album Details -->
								<a
									href="/album/{selectedAlbum.id}"
									class="p-1 sm:p-1.5 rounded-xl bg-neutral-800/80 border border-neutral-700/70 text-neutral-300 hover:text-white hover:bg-neutral-700 text-xs font-semibold transition flex items-center gap-1"
									title="View Album Details & Fixer Rules"
								>
									<ExternalLink class="w-3.5 h-3.5" />
									<span class="hidden sm:inline">Details</span>
								</a>

								<!-- Add Album to Playlist -->
								<button
									type="button"
									onclick={() => openAddToPlaylist(selectedAlbum!.tracks.map((t) => t.id), selectedAlbum!.title)}
									class="p-1 sm:p-1.5 rounded-xl bg-neutral-800/80 border border-neutral-700/70 text-neutral-300 hover:text-white hover:bg-neutral-700 text-xs font-semibold transition flex items-center gap-1"
									title="Add entire album to a playlist"
								>
									<ListPlus class="w-3.5 h-3.5 text-emerald-400" />
									<span class="hidden sm:inline">Add</span>
								</button>

								<!-- Download Album for Offline Playback -->
								<button
									type="button"
									onclick={async () => {
										if (!selectedAlbum) return;
										if (offlineStorage.isAlbumDownloaded(selectedAlbum.id)) {
											const confirmed = await confirmAction({
												title: 'Remove Offline Album',
												message: `Remove "${selectedAlbum?.title}" and its tracks from offline downloads?`,
												confirmText: 'Remove'
											});
											if (confirmed) {
												await offlineStorage.deleteAlbum(selectedAlbum.id);
											}
										} else {
											await offlineStorage.downloadAlbum(selectedAlbum);
										}
									}}
									disabled={offlineStorage.isDownloading}
									class="p-1 sm:p-1.5 rounded-xl border text-xs font-semibold transition flex items-center gap-1 cursor-pointer {selectedAlbum && offlineStorage.isAlbumDownloaded(selectedAlbum.id)
										? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
										: 'bg-neutral-800/80 border-neutral-700/70 text-neutral-300 hover:text-white hover:bg-neutral-700'}"
									title={selectedAlbum && offlineStorage.isAlbumDownloaded(selectedAlbum.id) ? 'Downloaded to phone (Tap to remove)' : 'Download entire album to phone for offline playback'}
								>
									{#if selectedAlbum && offlineStorage.isDownloading && offlineStorage.currentDownloadLabel.includes(selectedAlbum.title)}
										<RefreshCw class="w-3.5 h-3.5 animate-spin text-emerald-400" />
										<span class="hidden sm:inline">Downloading...</span>
									{:else if selectedAlbum && offlineStorage.isAlbumDownloaded(selectedAlbum.id)}
										<CircleCheck class="w-3.5 h-3.5 text-emerald-400" />
										<span class="hidden sm:inline">Downloaded</span>
									{:else}
										<ArrowDownCircle class="w-3.5 h-3.5 text-emerald-400" />
										<span class="hidden sm:inline">Download</span>
									{/if}
								</button>

								<!-- Search in Album -->
								<div class="relative ml-auto w-32 sm:w-40 md:w-48">
									<Search class="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
									<input
										type="text"
										bind:value={albumTrackSearch}
										placeholder="Search songs..."
										class="w-full bg-neutral-950/80 text-xs text-white placeholder-neutral-500 rounded-xl pl-7 pr-2.5 py-1 border border-neutral-800 focus:outline-none focus:border-emerald-500/60"
									/>
								</div>
							</div>
						</div>
					</div>
				</div>

				<!-- Tracklist Table Container -->
				<div class="md:flex-1 md:overflow-y-auto px-2 sm:px-4 py-2 min-h-0">
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
														const discTracks = selectedAlbum!.tracks.filter((t) => (t.disc_number || 1) === currentDisc && t.is_missing !== 1);
														if (discTracks.length > 0) {
															player.playTrack(discTracks[0], selectedAlbum!, discTracks);
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

								{@const isMissing = track.is_missing === 1}
								{@const isCurrent = player.currentTrack?.id === track.id}
								{@const isCurrentPlaying = isCurrent && player.isPlaying}
								<tr
									onclick={() => {
										if (isMissing) return;
										const playable = selectedAlbum!.tracks.filter((t) => t.is_missing !== 1);
										player.playTrack(track, selectedAlbum!, playable);
									}}
									class="group transition rounded-xl h-12 {isMissing ? 'opacity-60 bg-rose-950/10 cursor-not-allowed' : 'hover:bg-neutral-800/50 cursor-pointer'} {isCurrent ? 'bg-emerald-950/20 text-white' : 'text-neutral-300'}"
								>
									<!-- Track # or Play Action -->
									<td class="text-center font-mono w-10">
										{#if isMissing}
											<AlertTriangle class="w-3.5 h-3.5 text-rose-400 mx-auto" />
										{:else if isCurrentPlaying}
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
										<div class="font-semibold truncate flex items-center gap-1.5 {isMissing ? 'text-rose-200' : isCurrent ? 'text-emerald-300' : 'text-neutral-100'}">
											<span>{track.title}</span>
											{#if offlineStorage.isDownloaded(track.id)}
												<span title="Downloaded for offline playback">
													<CircleCheck class="w-3 h-3 text-emerald-400 shrink-0 inline" />
												</span>
											{/if}
											{#if isMissing}
												<span class="rounded bg-rose-500/20 px-1.5 py-0.2 text-[9px] font-bold text-rose-300 border border-rose-500/30 shrink-0">
													Missing
												</span>
											{/if}
										</div>
										<div class="text-[10px] text-neutral-400 truncate">
											<button
												type="button"
												onclick={(e) => {
													e.stopPropagation();
													selectArtist(track.artist || selectedAlbum!.artist);
												}}
												class="hover:text-emerald-300 hover:underline transition truncate max-w-[200px] text-left cursor-pointer"
											>
												{track.artist || selectedAlbum!.artist}
											</button>
										</div>
									</td>

									{#if !showLyricsDrawer}
										<!-- Quality Badge -->
										<td class="hidden sm:table-cell pr-3">
											{#if isMissing}
												<span class="px-2 py-0.5 rounded text-[10px] font-mono bg-rose-950/60 text-rose-300 border border-rose-800/50">
													Missing File
												</span>
											{:else}
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
											{/if}
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
											{:else if track.lyrics === 'censored_lrc'}
												<button
													type="button"
													onclick={(e) => {
														e.stopPropagation();
														player.playTrack(track, selectedAlbum!, selectedAlbum!.tracks);
														showLyricsDrawer = true;
													}}
													class="px-2 py-0.5 rounded text-[10px] bg-orange-950/50 hover:bg-orange-900/50 text-orange-300 border border-orange-800/40 cursor-pointer transition font-medium"
													title="View Censored Synced Lyrics"
												>
													Censored LRC
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

									<!-- Add to Playlist & Download Actions -->
									<td class="text-center pr-3 whitespace-nowrap">
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

										<div class="relative inline-block ml-1">
											<button
												type="button"
												onclick={(e) => {
													e.stopPropagation();
													activeDownloadTrackId = activeDownloadTrackId === track.id ? null : track.id;
												}}
												class="p-1 rounded text-neutral-500 hover:text-emerald-400 hover:bg-neutral-800 transition"
												title="Download Track (Select Quality)"
											>
												<Download class="w-3.5 h-3.5" />
											</button>
											{#if activeDownloadTrackId === track.id}
												<div
													class="fixed inset-0 z-40"
													onclick={(e) => {
														e.stopPropagation();
														activeDownloadTrackId = null;
													}}
												></div>
												<div
													class="absolute right-0 bottom-full mb-1 z-50 w-52 rounded-xl bg-neutral-900 border border-neutral-700/80 shadow-2xl p-1.5 text-xs flex flex-col gap-1 backdrop-blur-xl text-left"
												>
													<div class="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-neutral-400 border-b border-neutral-800">
														Offline & Downloads
													</div>
													{#if offlineStorage.isDownloaded(track.id)}
														<button
															type="button"
															onclick={async (e) => {
																e.stopPropagation();
																activeDownloadTrackId = null;
																await offlineStorage.deleteTrack(track.id);
															}}
															class="px-2 py-1.5 rounded-lg hover:bg-rose-950/40 text-rose-300 flex items-center justify-between text-left cursor-pointer"
														>
															<span>Remove from Phone</span>
															<Trash2 class="w-3.5 h-3.5 text-rose-400" />
														</button>
													{:else}
														<button
															type="button"
															onclick={async (e) => {
																e.stopPropagation();
																activeDownloadTrackId = null;
																await offlineStorage.downloadTrack(track, selectedAlbum || undefined);
															}}
															disabled={offlineStorage.isDownloadingTrack(track.id)}
															class="px-2 py-1.5 rounded-lg hover:bg-emerald-950/40 text-emerald-300 flex items-center justify-between text-left cursor-pointer"
														>
															<span>Download to Phone</span>
															{#if offlineStorage.isDownloadingTrack(track.id)}
																<RefreshCw class="w-3.5 h-3.5 animate-spin text-emerald-400" />
															{:else}
																<ArrowDownCircle class="w-3.5 h-3.5 text-emerald-400" />
															{/if}
														</button>
													{/if}
													<div class="h-px bg-neutral-800/80 my-0.5"></div>
													<div class="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-neutral-500">
														Export Audio File
													</div>
													<a
														href="/api/tracks/{track.id}/audio?download=true"
														download
														onclick={() => (activeDownloadTrackId = null)}
														class="px-2 py-1.5 rounded-lg hover:bg-neutral-800 text-neutral-200 hover:text-emerald-300 flex items-center justify-between"
													>
														<span>Original ({track.format || 'Audio'})</span>
														<span class="text-[10px] font-mono text-neutral-500">Full</span>
													</a>
													<a
														href="/api/tracks/{track.id}/audio?download=true&bitrate=320&format=mp3"
														download
														onclick={() => (activeDownloadTrackId = null)}
														class="px-2 py-1.5 rounded-lg hover:bg-neutral-800 text-neutral-200 hover:text-emerald-300 flex items-center justify-between"
													>
														<span>320 kbps MP3</span>
														<span class="text-[10px] font-mono text-emerald-400 font-semibold">HQ</span>
													</a>
													<a
														href="/api/tracks/{track.id}/audio?download=true&bitrate=192&format=mp3"
														download
														onclick={() => (activeDownloadTrackId = null)}
														class="px-2 py-1.5 rounded-lg hover:bg-neutral-800 text-neutral-200 hover:text-emerald-300 flex items-center justify-between"
													>
														<span>192 kbps MP3</span>
														<span class="text-[10px] font-mono text-neutral-400">Normal</span>
													</a>
													<a
														href="/api/tracks/{track.id}/audio?download=true&bitrate=128&format=mp3"
														download
														onclick={() => (activeDownloadTrackId = null)}
														class="px-2 py-1.5 rounded-lg hover:bg-neutral-800 text-neutral-200 hover:text-emerald-300 flex items-center justify-between"
													>
														<span>128 kbps MP3</span>
														<span class="text-[10px] font-mono text-amber-400 font-semibold">Saver</span>
													</a>
												</div>
											{/if}
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else if selectedType === 'playlist' && selectedPlaylist}
				<!-- PLAYLIST HERO BANNER -->
				<div class="{showLyricsDrawer ? 'p-3 sm:p-4 pb-2 sm:pb-3' : 'p-3 sm:p-6 pb-3 sm:pb-4'} border-b border-neutral-800/60 shrink-0">
					<div class="flex flex-row items-center sm:items-end gap-3 sm:gap-4">
						<!-- Big Playlist Cover Art -->
						<div class="relative {showLyricsDrawer ? 'w-16 h-16 sm:w-24 sm:h-24' : 'w-20 h-20 sm:w-36 sm:h-36 md:w-44 md:h-44'} rounded-xl sm:rounded-2xl overflow-hidden bg-neutral-950 shrink-0 shadow-xl sm:shadow-2xl border border-neutral-800">
							{#if selectedPlaylist.cover_url}
								<img src={selectedPlaylist.cover_url} alt={selectedPlaylist.name} class="w-full h-full object-cover" />
							{:else}
								<div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-neutral-900 via-neutral-950 to-emerald-950/20 text-emerald-400">
									<ListMusic class={showLyricsDrawer ? 'w-8 h-8' : 'w-10 h-10 sm:w-16 sm:h-16'} opacity-40 />
								</div>
							{/if}
						</div>

						<!-- Playlist Metadata Header -->
						<div class="flex-1 min-w-0 text-left space-y-1">
							<div class="flex flex-wrap items-center justify-start gap-1 sm:gap-1.5">
								<span class="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-800/50">
									Playlist
								</span>

								{#if selectedPlaylist.is_public}
									<span class="text-[9px] sm:text-[10px] font-medium text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-600/50 flex items-center gap-1">
										<Globe class="w-2.5 h-2.5 sm:w-3 sm:h-3 text-emerald-400" />
										Public
									</span>
								{:else}
									<span class="text-[9px] sm:text-[10px] font-medium text-neutral-400 bg-neutral-900/80 px-2 py-0.5 rounded-full border border-neutral-700/60 flex items-center gap-1">
										<Lock class="w-2.5 h-2.5 sm:w-3 sm:h-3 text-neutral-400" />
										Private
									</span>
								{/if}
							</div>

							<h1 class="{showLyricsDrawer ? 'text-base sm:text-xl font-bold' : 'text-base sm:text-2xl md:text-3xl lg:text-4xl font-extrabold'} text-white tracking-tight leading-tight line-clamp-2">
								{selectedPlaylist.name}
							</h1>

							{#if selectedPlaylist.comment && !showLyricsDrawer}
								<p class="text-xs text-neutral-300 line-clamp-1 sm:line-clamp-2 max-w-xl">
									{selectedPlaylist.comment}
								</p>
							{/if}

							<div class="flex flex-wrap items-center justify-start gap-1 sm:gap-1.5 text-xs text-neutral-400">
								<span class="text-neutral-200 font-semibold">{selectedPlaylist.tracks.length} songs</span>
								<span>&bull;</span>
								<span>{formatTotalAlbumDuration(selectedPlaylist.tracks)}</span>
							</div>

							<!-- Playlist Action Bar -->
							<div class="pt-1 flex flex-wrap items-center justify-start gap-1.5 sm:gap-2">
								<!-- Play Button -->
								<button
									type="button"
									onclick={playPlaylistAll}
									disabled={selectedPlaylist.tracks.length === 0}
									class="px-3 sm:px-4 py-1 sm:py-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-neutral-950 font-bold text-xs shadow-lg shadow-emerald-500/20 hover:scale-105 active:scale-95 disabled:opacity-40 transition-all flex items-center gap-1.5 cursor-pointer"
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
									class="p-1 sm:p-1.5 rounded-xl border text-xs font-semibold disabled:opacity-40 transition flex items-center gap-1.5 {player.shuffleEnabled ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400 shadow-sm shadow-emerald-500/20' : 'bg-neutral-800/80 border-neutral-700/70 text-neutral-300 hover:text-white hover:bg-neutral-700'}"
									title="Shuffle Play ({player.shuffleEnabled ? 'On' : 'Off'})"
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
									class="p-1 sm:p-1.5 rounded-xl bg-neutral-800/80 border border-neutral-700/70 text-neutral-300 hover:text-white hover:bg-neutral-700 text-xs font-semibold transition flex items-center gap-1"
									title="Edit Playlist Details"
								>
									<Pencil class="w-3.5 h-3.5 text-neutral-300" />
									<span class="hidden sm:inline">Edit</span>
								</button>

								<!-- Delete Playlist Button -->
								<button
									type="button"
									onclick={() => (showDeletePlaylistModal = true)}
									class="p-1 sm:p-1.5 rounded-xl bg-rose-950/20 border border-rose-900/40 text-rose-300 hover:bg-rose-950/50 hover:text-rose-200 text-xs font-semibold transition flex items-center gap-1"
									title="Delete Playlist"
								>
									<Trash2 class="w-3.5 h-3.5" />
									<span class="hidden sm:inline">Delete</span>
								</button>

								<!-- Download Playlist Offline -->
								<button
									type="button"
									onclick={async () => {
										if (!selectedPlaylist) return;
										if (offlineStorage.isPlaylistDownloaded(selectedPlaylist.id)) {
											const confirmed = await confirmAction({
												title: 'Remove Offline Playlist',
												message: `Remove "${selectedPlaylist.name}" from offline downloads?`,
												confirmText: 'Remove'
											});
											if (confirmed) {
												await offlineStorage.deletePlaylist(selectedPlaylist.id);
											}
										} else {
											await offlineStorage.downloadPlaylist(selectedPlaylist);
										}
									}}
									disabled={offlineStorage.isDownloading || !selectedPlaylist || selectedPlaylist.tracks.length === 0}
									class="p-1 sm:p-1.5 rounded-xl border text-xs font-semibold transition flex items-center gap-1 cursor-pointer {selectedPlaylist && offlineStorage.isPlaylistDownloaded(selectedPlaylist.id)
										? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
										: 'bg-neutral-800/80 border-neutral-700/70 text-neutral-300 hover:text-white hover:bg-neutral-700'}"
									title={selectedPlaylist && offlineStorage.isPlaylistDownloaded(selectedPlaylist.id) ? 'Downloaded to phone (Tap to remove)' : 'Download playlist to phone for offline playback'}
								>
									{#if selectedPlaylist && offlineStorage.isDownloading && offlineStorage.currentDownloadLabel.includes(selectedPlaylist.name)}
										<RefreshCw class="w-3.5 h-3.5 animate-spin text-emerald-400" />
										<span class="hidden sm:inline">Downloading...</span>
									{:else if selectedPlaylist && offlineStorage.isPlaylistDownloaded(selectedPlaylist.id)}
										<CircleCheck class="w-3.5 h-3.5 text-emerald-400" />
										<span class="hidden sm:inline">Downloaded</span>
									{:else}
										<ArrowDownCircle class="w-3.5 h-3.5 text-emerald-400" />
										<span class="hidden sm:inline">Download</span>
									{/if}
								</button>

								<!-- Search in Playlist -->
								<div class="relative ml-auto w-32 sm:w-40 md:w-48">
									<Search class="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
									<input
										type="text"
										bind:value={albumTrackSearch}
										placeholder="Search songs..."
										class="w-full bg-neutral-950/80 text-xs text-white placeholder-neutral-500 rounded-xl pl-7 pr-2.5 py-1 border border-neutral-800 focus:outline-none focus:border-emerald-500/60"
									/>
								</div>
							</div>
						</div>
					</div>
				</div>

				<!-- Playlist Tracklist Table Container -->
				<div class="md:flex-1 md:overflow-y-auto px-2 sm:px-4 py-2 min-h-0">
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
											<div class="font-semibold truncate flex items-center gap-1.5 {isCurrent ? 'text-emerald-300' : 'text-neutral-100'}">
												<span>{track.title}</span>
												{#if offlineStorage.isDownloaded(track.id)}
													<span title="Downloaded for offline playback">
														<CircleCheck class="w-3 h-3 text-emerald-400 shrink-0 inline" />
													</span>
												{/if}
											</div>
											<div class="text-[10px] text-neutral-400 truncate">
												{#if track.artist}
													<button
														type="button"
														onclick={(e) => {
															e.stopPropagation();
															selectArtist(track.artist!);
														}}
														class="hover:text-emerald-300 hover:underline transition truncate max-w-[200px] text-left cursor-pointer"
													>
														{track.artist}
													</button>
												{:else}
													<span>Unknown Artist</span>
												{/if}
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

												<!-- Download Track -->
												<div class="relative inline-block">
													<button
														type="button"
														onclick={(e) => {
															e.stopPropagation();
															activeDownloadTrackId = activeDownloadTrackId === track.id ? null : track.id;
														}}
														class="p-1 rounded text-neutral-400 hover:bg-neutral-800 hover:text-emerald-400 transition"
														title="Download Track"
													>
														<Download class="w-3.5 h-3.5" />
													</button>
													{#if activeDownloadTrackId === track.id}
														<div
															class="fixed inset-0 z-40"
															onclick={(e) => {
																e.stopPropagation();
																activeDownloadTrackId = null;
															}}
														></div>
														<div
															class="absolute right-0 bottom-full mb-1 z-50 w-52 rounded-xl bg-neutral-900 border border-neutral-700/80 shadow-2xl p-1.5 text-xs flex flex-col gap-1 backdrop-blur-xl text-left font-normal"
														>
															<div class="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-neutral-400 border-b border-neutral-800">
																Offline & Downloads
															</div>
															{#if offlineStorage.isDownloaded(track.id)}
																<button
																	type="button"
																	onclick={async (e) => {
																		e.stopPropagation();
																		activeDownloadTrackId = null;
																		await offlineStorage.deleteTrack(track.id);
																	}}
																	class="px-2 py-1.5 rounded-lg hover:bg-rose-950/40 text-rose-300 flex items-center justify-between text-left cursor-pointer"
																>
																	<span>Remove from Phone</span>
																	<Trash2 class="w-3.5 h-3.5 text-rose-400" />
																</button>
															{:else}
																<button
																	type="button"
																	onclick={async (e) => {
																		e.stopPropagation();
																		activeDownloadTrackId = null;
																		await offlineStorage.downloadTrack(track);
																	}}
																	disabled={offlineStorage.isDownloadingTrack(track.id)}
																	class="px-2 py-1.5 rounded-lg hover:bg-emerald-950/40 text-emerald-300 flex items-center justify-between text-left cursor-pointer"
																>
																	<span>Download to Phone</span>
																	{#if offlineStorage.isDownloadingTrack(track.id)}
																		<RefreshCw class="w-3.5 h-3.5 animate-spin text-emerald-400" />
																	{:else}
																		<ArrowDownCircle class="w-3.5 h-3.5 text-emerald-400" />
																	{/if}
																</button>
															{/if}
															<div class="h-px bg-neutral-800/80 my-0.5"></div>
															<div class="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-neutral-500">
																Export Audio File
															</div>
															<a
																href="/api/tracks/{track.id}/audio?download=true"
																download
																onclick={() => (activeDownloadTrackId = null)}
																class="px-2 py-1.5 rounded-lg hover:bg-neutral-800 text-neutral-200 hover:text-emerald-300 flex items-center justify-between"
															>
																<span>Original ({track.format || 'Audio'})</span>
																<span class="text-[10px] font-mono text-neutral-500">Full</span>
															</a>
															<a
																href="/api/tracks/{track.id}/audio?download=true&bitrate=320&format=mp3"
																download
																onclick={() => (activeDownloadTrackId = null)}
																class="px-2 py-1.5 rounded-lg hover:bg-neutral-800 text-neutral-200 hover:text-emerald-300 flex items-center justify-between"
															>
																<span>320 kbps MP3</span>
																<span class="text-[10px] font-mono text-emerald-400 font-semibold">HQ</span>
															</a>
															<a
																href="/api/tracks/{track.id}/audio?download=true&bitrate=192&format=mp3"
																download
																onclick={() => (activeDownloadTrackId = null)}
																class="px-2 py-1.5 rounded-lg hover:bg-neutral-800 text-neutral-200 hover:text-emerald-300 flex items-center justify-between"
															>
																<span>192 kbps MP3</span>
																<span class="text-[10px] font-mono text-neutral-400">Normal</span>
															</a>
															<a
																href="/api/tracks/{track.id}/audio?download=true&bitrate=128&format=mp3"
																download
																onclick={() => (activeDownloadTrackId = null)}
																class="px-2 py-1.5 rounded-lg hover:bg-neutral-800 text-neutral-200 hover:text-emerald-300 flex items-center justify-between"
															>
																<span>128 kbps MP3</span>
																<span class="text-[10px] font-mono text-amber-400 font-semibold">Saver</span>
															</a>
														</div>
													{/if}
												</div>

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
			{:else if selectedType === 'artist' && selectedArtist}
				<!-- ARTIST VIEW -->
				<div class="relative overflow-hidden bg-gradient-to-b from-neutral-800/40 via-neutral-900/60 to-transparent p-3 sm:p-6 pb-3 sm:pb-4 border-b border-neutral-800/80 shrink-0">
					<!-- Hero -->
					<div class="flex flex-row items-center sm:items-end gap-3 sm:gap-5">
						<!-- Artist Circular Avatar -->
						<div class="relative group w-16 h-16 sm:w-28 sm:h-28 md:w-36 md:h-36 rounded-full overflow-hidden bg-neutral-950 shadow-xl sm:shadow-2xl border-2 border-neutral-700/60 shrink-0 flex items-center justify-center">
							{#if selectedArtist.avatar_url || selectedArtist.cover_url}
								<img
									src={selectedArtist.avatar_url || selectedArtist.cover_url}
									alt={selectedArtist.name}
									class="w-full h-full object-cover"
									onerror={(e) => {
										const img = e.currentTarget as HTMLImageElement;
										if (selectedArtist?.cover_url && img.src !== selectedArtist.cover_url) {
											img.src = selectedArtist.cover_url;
										} else {
											img.style.display = 'none';
										}
									}}
								/>
							{:else}
								<User class="w-8 h-8 sm:w-14 sm:h-14 text-neutral-600" />
							{/if}

							<!-- Hover Overlay to Upload Custom Artist Portrait -->
							<button
								type="button"
								onclick={triggerArtistAvatarUpload}
								class="absolute inset-0 bg-black/65 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white gap-1 cursor-pointer"
								title="Upload custom portrait for {selectedArtist.name}"
							>
								{#if isUploadingArtistAvatar}
									<RefreshCw class="w-5 h-5 text-emerald-400 animate-spin" />
									<span class="text-[8px] font-bold uppercase tracking-wider">Uploading...</span>
								{:else}
									<Camera class="w-5 h-5 text-emerald-400" />
									<span class="text-[8px] font-bold uppercase tracking-wider">Change Photo</span>
								{/if}
							</button>
						</div>

						<!-- Hidden file input for uploading custom artist avatar -->
						<input
							type="file"
							accept="image/*"
							bind:this={artistAvatarFileInputRef}
							onchange={handleArtistAvatarFileSelected}
							class="hidden"
						/>

						<!-- Artist Meta -->
						<div class="flex-1 min-w-0 text-left space-y-1">
							<div class="flex items-center justify-start gap-2">
								<span class="text-[9px] sm:text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
									Artist
								</span>
								<span class="text-[11px] sm:text-xs text-neutral-400 font-mono">
									{selectedArtist.album_count} {selectedArtist.album_count === 1 ? 'album' : 'albums'} &bull; {selectedArtist.song_count} {selectedArtist.song_count === 1 ? 'song' : 'songs'}
								</span>
							</div>

							<h1 class="text-lg sm:text-3xl md:text-4xl font-black text-white tracking-tight truncate leading-tight">
								{selectedArtist.name}
							</h1>

							<!-- Action Buttons -->
							<div class="flex flex-wrap items-center justify-start gap-1.5 sm:gap-2.5 pt-1">
								<!-- Play All Button -->
								<button
									type="button"
									onclick={playArtistAll}
									class="flex items-center gap-1.5 px-3.5 sm:px-5 py-1.5 sm:py-2 rounded-xl sm:rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-400 text-neutral-950 font-bold text-xs shadow-lg shadow-emerald-500/25 hover:scale-[1.02] active:scale-[0.98] transition cursor-pointer"
								>
									<Play class="w-3.5 h-3.5 fill-current" />
									<span>Play All</span>
								</button>

								<!-- Shuffle Button -->
								<button
									type="button"
									onclick={playArtistShuffle}
									class="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl sm:rounded-2xl bg-neutral-800/80 hover:bg-neutral-700 border border-neutral-700/60 text-white font-semibold text-xs transition cursor-pointer"
								>
									<Shuffle class="w-3.5 h-3.5 text-emerald-400" />
									<span class="hidden sm:inline">Shuffle</span>
								</button>

								<!-- Add All to Playlist -->
								<button
									type="button"
									onclick={() => openAddToPlaylist(selectedArtist!.tracks.map((t) => t.id), selectedArtist!.name)}
									class="p-1.5 sm:p-2 rounded-xl sm:rounded-2xl bg-neutral-800/80 border border-neutral-700/60 text-neutral-300 hover:text-white hover:bg-neutral-700 transition cursor-pointer"
									title="Add all songs by this artist to a playlist"
								>
									<ListPlus class="w-3.5 h-3.5 text-emerald-400" />
								</button>

								<!-- Edit / Match Artist by ID or URL Button -->
								<button
									type="button"
									onclick={() => openEditArtistModal('match')}
									class="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl sm:rounded-2xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 hover:text-emerald-200 font-semibold text-xs transition cursor-pointer"
									title="Match artist by pasting a MusicBrainz / Deezer / TheAudioDB ID or URL, or manually edit artist biography & portrait"
								>
									<Pencil class="w-3 h-3 text-emerald-400" />
									<span class="hidden sm:inline">Edit / Match ID</span>
								</button>

								<!-- Refresh Artist Metadata Button -->
								<button
									type="button"
									onclick={refreshCurrentArtist}
									disabled={isRefreshingArtist}
									class="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl sm:rounded-2xl bg-neutral-800/80 hover:bg-neutral-700 border border-neutral-700/60 text-neutral-300 hover:text-white font-semibold text-xs transition cursor-pointer disabled:opacity-50"
									title="Re-fetch artist biography, avatar, and relations from Deezer & MusicBrainz"
								>
									<RefreshCw class="w-3 h-3 text-emerald-400 {isRefreshingArtist ? 'animate-spin' : ''}" />
									<span class="hidden sm:inline">{isRefreshingArtist ? 'Updating...' : 'Update Info'}</span>
								</button>

								<!-- Save Companion artist.jpg Button -->
								<button
									type="button"
									onclick={saveCompanionArtistImage}
									disabled={isSavingCompanion}
									class="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl sm:rounded-2xl bg-neutral-800/80 hover:bg-neutral-700 border border-neutral-700/60 text-neutral-300 hover:text-white font-semibold text-xs transition cursor-pointer disabled:opacity-50"
									title="Save companion artist.jpg directly into artist music directory on disk"
								>
									<FolderDown class="w-3 h-3 text-emerald-400 {isSavingCompanion ? 'animate-bounce' : ''}" />
									<span class="hidden sm:inline">{isSavingCompanion ? 'Saving...' : 'Save artist.jpg'}</span>
								</button>

								<!-- Reset Avatar Button -->
								{#if selectedArtist.avatar_url}
									<button
										type="button"
										onclick={resetCurrentArtistAvatar}
										disabled={isResettingAvatar}
										class="p-1.5 sm:p-2 rounded-xl sm:rounded-2xl bg-neutral-800/80 hover:bg-rose-950/60 border border-neutral-700/60 hover:border-rose-700/50 text-neutral-400 hover:text-rose-300 transition cursor-pointer disabled:opacity-50"
										title="Remove custom or downloaded avatar and revert to default"
									>
										<Trash2 class="w-3.5 h-3.5" />
									</button>
								{/if}

								<!-- Search in Artist Tracks -->
								<div class="relative ml-auto w-32 sm:w-40 md:w-52">
									<Search class="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
									<input
										type="text"
										bind:value={albumTrackSearch}
										placeholder="Search songs..."
										class="w-full bg-neutral-950/80 text-xs text-white placeholder-neutral-500 rounded-xl pl-7 pr-2.5 py-1 sm:py-1.5 border border-neutral-800 focus:outline-none focus:border-emerald-500/60"
									/>
								</div>
							</div>

							<!-- Biography & External Links -->
							{#if selectedArtist.biography}
								<div class="mt-2 p-2.5 rounded-xl bg-neutral-900/70 border border-neutral-800/80 text-xs text-neutral-300 leading-relaxed text-left">
									<div class="flex items-center justify-between mb-1 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
										<div class="flex items-center gap-2">
											<span class="text-emerald-400">About {selectedArtist.name}</span>
											{#if selectedArtist.disambiguation}
												<span class="text-neutral-500 normal-case font-normal">({selectedArtist.disambiguation})</span>
											{/if}
										</div>
										<div class="flex items-center gap-2.5">
											<button
												type="button"
												onclick={() => openEditArtistModal('manual')}
												class="text-neutral-400 hover:text-emerald-400 flex items-center gap-1 cursor-pointer"
												title="Manually edit artist biography & metadata"
											>
												<Pencil class="w-2.5 h-2.5" />
												<span>Edit</span>
											</button>
											{#if selectedArtist.musicbrainz_id}
												<a
													href="https://musicbrainz.org/artist/{selectedArtist.musicbrainz_id}"
													target="_blank"
													rel="noreferrer"
													class="text-neutral-400 hover:text-emerald-400 flex items-center gap-1"
													title="View on MusicBrainz"
												>
													<span>MusicBrainz</span>
													<ExternalLink class="w-2.5 h-2.5" />
												</a>
											{/if}
											{#if selectedArtist.lastfm_url}
												<a
													href={selectedArtist.lastfm_url}
													target="_blank"
													rel="noreferrer"
													class="text-neutral-400 hover:text-emerald-400 flex items-center gap-1"
													title="View on Last.fm"
												>
													<span>Last.fm</span>
													<ExternalLink class="w-2.5 h-2.5" />
												</a>
											{/if}
										</div>
									</div>
									<p class="line-clamp-2 sm:line-clamp-3 hover:line-clamp-none transition-all cursor-pointer font-sans" title="Click to expand/collapse">
										{selectedArtist.biography}
									</p>
								</div>
							{/if}
						</div>
					</div>
				</div>

				<!-- Artist Scrollable Body: Discography Albums Grid + All Songs Table -->
				<div class="md:flex-1 md:overflow-y-auto px-3 sm:px-4 py-3 min-h-0 space-y-6">
					<!-- Section 1: Discography Albums -->
					{#if selectedArtist.albums.length > 0}
						<div class="space-y-2.5">
							<div class="flex items-center justify-between">
								<h3 class="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-1.5">
									<Disc3 class="w-3.5 h-3.5 text-emerald-400" />
									<span>Discography & Albums ({selectedArtist.albums.length})</span>
								</h3>
							</div>

							<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
								{#each selectedArtist.albums as alb (alb.id)}
									<div
										role="button"
										tabindex="0"
										onclick={() => selectAlbum(alb)}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') selectAlbum(alb);
										}}
										class="group/alb p-2.5 rounded-2xl bg-neutral-950/60 border border-neutral-800/80 hover:bg-neutral-850 hover:border-neutral-700 transition cursor-pointer text-left flex flex-col space-y-2 shadow-sm"
									>
										<!-- Artwork -->
										<div class="aspect-square rounded-xl overflow-hidden bg-neutral-900 border border-neutral-800 relative shadow-inner">
											{#if alb.cover_url}
												<img src={alb.cover_url} alt={alb.title} class="w-full h-full object-cover group-hover/alb:scale-105 transition duration-300" />
											{:else}
												<div class="w-full h-full flex items-center justify-center text-neutral-600">
													<Disc3 class="w-8 h-8 opacity-40" />
												</div>
											{/if}
										</div>

										<!-- Title & Year -->
										<div class="min-w-0">
											<h4 class="text-xs font-bold text-neutral-100 truncate group-hover/alb:text-emerald-400 transition">
												{alb.title}
											</h4>
											<p class="text-[10px] text-neutral-400 truncate mt-0.5">
												{alb.release_year || 'Unknown Year'} &bull; {alb.tracks.length} {alb.tracks.length === 1 ? 'song' : 'songs'}
											</p>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Section 2: All Songs Table -->
					<div class="space-y-2">
						<div class="flex items-center justify-between">
							<h3 class="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-1.5">
								<Music class="w-3.5 h-3.5 text-emerald-400" />
								<span>All Songs ({displayedTracks.length})</span>
							</h3>
						</div>

						<table class="w-full text-left text-xs border-collapse">
							<thead class="text-neutral-400 border-b border-neutral-800/60 sticky top-0 bg-neutral-900/90 backdrop-blur z-10">
								<tr class="h-8">
									<th class="w-10 text-center font-semibold">#</th>
									<th class="font-semibold">Title</th>
									<th class="font-semibold hidden sm:table-cell">Album</th>
									{#if !showLyricsDrawer}
										<th class="font-semibold hidden md:table-cell">Quality</th>
									{/if}
									<th class="w-14 text-right pr-2 font-semibold"><Clock class="w-3.5 h-3.5 inline text-neutral-500" /></th>
									<th class="w-8 text-center pr-3 font-semibold"></th>
								</tr>
							</thead>
							<tbody class="divide-y divide-neutral-800/30">
								{#each displayedTracks as track, idx (track.id)}
									{@const isMissing = track.is_missing === 1}
									{@const isCurrent = player.currentTrack?.id === track.id}
									{@const isCurrentPlaying = isCurrent && player.isPlaying}

									<tr
										onclick={() => {
											if (isMissing) return;
											playArtistTrack(track);
										}}
										class="group transition rounded-xl h-12 {isMissing ? 'opacity-60 bg-rose-950/10 cursor-not-allowed' : 'hover:bg-neutral-800/50 cursor-pointer'} {isCurrent ? 'bg-emerald-950/20 text-white' : 'text-neutral-300'}"
									>
										<!-- Track # or Play Action -->
										<td class="text-center font-mono w-10">
											<div class="flex items-center justify-center">
												{#if isCurrentPlaying}
													<div class="flex items-end justify-center gap-0.5 h-3.5 w-3.5">
														<span class="w-0.5 bg-emerald-400 animate-[bounce_0.8s_infinite] h-full rounded-full"></span>
														<span class="w-0.5 bg-emerald-400 animate-[bounce_0.6s_infinite] h-2/3 rounded-full"></span>
														<span class="w-0.5 bg-emerald-400 animate-[bounce_1.0s_infinite] h-4/5 rounded-full"></span>
													</div>
												{:else if isCurrent}
													<Play class="w-3.5 h-3.5 text-emerald-400 fill-current" />
												{:else}
													<span class="group-hover:hidden text-neutral-500 text-[11px]">{idx + 1}</span>
													<Play class="w-3.5 h-3.5 text-white fill-current hidden group-hover:block transition" />
												{/if}
											</div>
										</td>

										<!-- Title -->
										<td class="py-2 pr-3">
											<div class="flex items-center gap-2">
												<div class="truncate">
													<div class="font-semibold text-xs truncate {isCurrent ? 'text-emerald-400' : 'text-neutral-100'}">
														{track.title}
													</div>
													{#if track.artist && track.artist.toLowerCase() !== selectedArtist.name.toLowerCase()}
														<div class="text-[10px] text-neutral-400 truncate">
															feat. {track.artist}
														</div>
													{/if}
												</div>
											</div>
										</td>

										<!-- Album (Clickable) -->
										<td class="py-2 pr-3 hidden sm:table-cell">
											<button
												type="button"
												onclick={(e) => {
													e.stopPropagation();
													const foundAlb = albums.find((a) => a.id === track.album_id);
													if (foundAlb) selectAlbum(foundAlb);
												}}
												class="text-neutral-400 hover:text-emerald-300 hover:underline truncate text-left max-w-[200px] cursor-pointer"
											>
												{track.album_title || 'Unknown Album'}
											</button>
										</td>

										<!-- Quality Pill -->
										{#if !showLyricsDrawer}
											<td class="py-2 pr-3 hidden md:table-cell">
												<div class="flex items-center gap-1.5">
													<span class="font-mono text-[9px] uppercase px-1.5 py-0.5 rounded bg-neutral-800/80 border border-neutral-700/60 {track.format === 'FLAC' || track.format === 'WAV' || track.format === 'ALAC' ? 'text-emerald-300 border-emerald-500/30' : 'text-neutral-400'}">
														{track.format || 'AUDIO'}
													</span>
													{#if track.bitrate_kbps}
														<span class="font-mono text-[9px] text-neutral-400">
															{track.bitrate_kbps} kbps
														</span>
													{/if}
												</div>
											</td>
										{/if}

										<!-- Duration -->
										<td class="text-right pr-2 font-mono tabular-nums text-xs text-neutral-400">
											{formatDurationMs(track.duration_ms)}
										</td>

										<!-- Action: Add to Playlist -->
										<td class="text-center pr-3">
											<button
												type="button"
												onclick={(e) => {
													e.stopPropagation();
													openAddToPlaylist([track.id], track.title);
												}}
												class="p-1 rounded text-neutral-500 hover:text-emerald-400 hover:bg-neutral-800 transition cursor-pointer"
												title="Add to playlist"
											>
												<ListPlus class="w-3.5 h-3.5" />
											</button>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>

						{#if displayedTracks.length === 0}
							<div class="py-12 text-center text-xs text-neutral-500">
								No songs match your search in this artist.
							</div>
						{/if}
					</div>
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
		{#if showQueueDrawer || mobilePlayerTab === 'queue'}
			<aside class="{mobilePlayerTab === 'queue' ? 'flex' : (showQueueDrawer ? 'hidden md:flex' : 'hidden')} order-3 w-full md:w-80 lg:w-96 bg-neutral-900/70 backdrop-blur-xl border border-neutral-800/70 rounded-2xl flex-col overflow-hidden shrink-0 shadow-2xl animate-in slide-in-from-right duration-200 min-h-0">
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
							if (mobilePlayerTab === 'queue') mobilePlayerTab = 'tracks';
						}}
						class="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-neutral-800 cursor-pointer"
						title="Close Queue"
					>
						<X class="w-4 h-4" />
					</button>
				</div>

				<!-- Queue Search Input -->
				<div class="px-3.5 py-2 border-b border-neutral-800/40 shrink-0">
					<div class="relative">
						<Search class="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
						<input
							type="text"
							bind:value={queueSearch}
							placeholder="Search in queue..."
							class="w-full bg-neutral-950/80 text-xs text-white placeholder-neutral-500 rounded-lg pl-8 pr-3 py-1.5 border border-neutral-800 focus:outline-none focus:border-emerald-500/60 transition"
						/>
						{#if queueSearch}
							<button
								type="button"
								onclick={() => (queueSearch = '')}
								class="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white text-xs"
							>
								✕
							</button>
						{/if}
					</div>
				</div>

				<!-- Drawer Scrollable Body -->
				<div class="flex-1 overflow-y-auto overscroll-contain p-4 flex flex-col min-h-0">
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
						{#each filteredQueueTracks as nextTr}
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

						{#if queueSearch.trim() && filteredQueueTracks.length === 0}
							<div class="p-4 text-center text-xs text-neutral-500">
								No queued songs match "{queueSearch}".
							</div>
						{/if}
					</div>
				</div>
			</aside>
		{/if}
	</div>

	<!-- BOTTOM FLOATING AUDIO CONTROL DOCK (Desktop) -->
	<footer class="hidden md:flex h-20 bg-neutral-900/85 backdrop-blur-2xl border-t border-neutral-800/80 px-2 sm:px-6 items-center justify-between gap-2 sm:gap-4 z-40 shrink-0 shadow-2xl">
		<!-- Track Info Pill -->
		<div
			role="button"
			tabindex="0"
			onclick={() => { mobilePlayerTab = 'player'; }}
			onkeydown={(e) => { if (e.key === 'Enter') mobilePlayerTab = 'player'; }}
			class="flex items-center gap-2 sm:gap-3 flex-1 sm:flex-initial sm:w-1/4 min-w-0 sm:min-w-[160px] sm:max-w-[280px] cursor-pointer group"
			title="Open Now Playing"
		>
			{#if player.currentTrack}
				<div class="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-neutral-950 overflow-hidden shrink-0 border border-neutral-800 shadow-md relative group-hover:border-emerald-500/50 transition">
					{#if player.currentAlbum?.cover_url}
						<img src={player.currentAlbum.cover_url} alt="Cover" class="w-full h-full object-cover" />
					{:else}
						<div class="w-full h-full flex items-center justify-center bg-neutral-900 text-neutral-500">
							<Disc3 class="w-5 h-5 sm:w-6 sm:h-6 animate-spin-slow" />
						</div>
					{/if}
				</div>

				<div class="min-w-0 flex-1">
					<div class="text-xs font-bold text-white truncate group-hover:text-emerald-400 transition" title={player.currentTrack.title}>
						{player.currentTrack.title}
					</div>
					<div class="text-[10px] text-neutral-400 truncate mt-0.5" title={player.currentTrack.artist || player.currentAlbum?.artist}>
						{player.currentTrack.artist || player.currentAlbum?.artist || 'Unknown Artist'}
					</div>
					<div class="hidden xs:flex sm:flex items-center gap-1.5 mt-0.5 text-[9px] font-mono relative">
						{#if player.isCurrentTrackOffline}
							<span class="text-emerald-400 font-semibold bg-emerald-950/80 px-1 py-0.2 rounded border border-emerald-700/60 flex items-center gap-0.5" title="Playing directly from local phone storage (0 data used)">
								<CircleCheck class="w-2.5 h-2.5" />
								<span>Offline</span>
							</span>
							<span class="text-neutral-500">&bull;</span>
						{/if}
						{#if (player.currentTrack.disc_number || 1) > 1}
							<span class="text-amber-400 font-semibold bg-amber-950/60 px-1 rounded border border-amber-800/50">CD {player.currentTrack.disc_number}</span>
							<span class="text-neutral-500">&bull;</span>
						{/if}
						<button
							type="button"
							onclick={(e) => { e.stopPropagation(); showQualityMenu = !showQualityMenu; }}
							class="flex items-center gap-1 px-1.5 py-0.5 rounded cursor-pointer transition border {player.streamingQuality === 'original'
								? 'bg-neutral-900/90 hover:bg-neutral-800 text-emerald-400 border-emerald-800/40 hover:border-emerald-500/50'
								: 'bg-amber-950/80 hover:bg-amber-900/80 text-amber-300 border-amber-700/60 shadow-[0_0_8px_rgba(245,158,11,0.2)]'}"
							title="Streaming quality: {player.streamingQuality === 'original' ? 'Original Lossless' : player.streamingQuality + 'k MP3'}. Click to configure."
						>
							{#if player.streamingQuality === 'original'}
								<span class="font-bold">{player.currentTrack.format}</span>
								{#if player.currentTrack.bitrate_kbps}
									<span class="text-neutral-400">&bull; {player.currentTrack.bitrate_kbps.toLocaleString()}k</span>
								{/if}
							{:else}
								<span class="font-bold">MP3</span>
								<span class="text-amber-200">&bull; {player.streamingQuality}k</span>
							{/if}
						</button>

						{#if showQualityMenu}
							<div
								class="fixed inset-0 z-40"
								onclick={() => (showQualityMenu = false)}
							></div>
							<div
								class="absolute left-0 bottom-full mb-2 z-50 w-60 rounded-xl bg-neutral-900 border border-neutral-700/80 shadow-2xl p-2 text-xs flex flex-col gap-1 backdrop-blur-xl"
							>
								<div class="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-neutral-400 border-b border-neutral-800">
									Streaming Quality
								</div>
								<button
									type="button"
									onclick={() => {
										player.setStreamingQuality('original');
										showQualityMenu = false;
									}}
									class="px-2 py-1.5 rounded-lg text-left transition flex items-center justify-between cursor-pointer {player.streamingQuality === 'original'
										? 'bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30'
										: 'hover:bg-neutral-800 text-neutral-300'}"
								>
									<div>
										<div class="text-xs">Original Audio</div>
										<div class="text-[10px] text-neutral-500">Lossless / native bit depth</div>
									</div>
									{#if player.streamingQuality === 'original'}
										<CircleCheck class="w-3.5 h-3.5 text-emerald-400" />
									{/if}
								</button>
								<button
									type="button"
									onclick={() => {
										player.setStreamingQuality('320');
										showQualityMenu = false;
									}}
									class="px-2 py-1.5 rounded-lg text-left transition flex items-center justify-between cursor-pointer {player.streamingQuality === '320'
										? 'bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30'
										: 'hover:bg-neutral-800 text-neutral-300'}"
								>
									<div>
										<div class="text-xs">320 kbps (High Quality)</div>
										<div class="text-[10px] text-neutral-500">Crisp, transparent MP3</div>
									</div>
									{#if player.streamingQuality === '320'}
										<CircleCheck class="w-3.5 h-3.5 text-emerald-400" />
									{/if}
								</button>
								<button
									type="button"
									onclick={() => {
										player.setStreamingQuality('192');
										showQualityMenu = false;
									}}
									class="px-2 py-1.5 rounded-lg text-left transition flex items-center justify-between cursor-pointer {player.streamingQuality === '192'
										? 'bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30'
										: 'hover:bg-neutral-800 text-neutral-300'}"
								>
									<div>
										<div class="text-xs">192 kbps (Standard)</div>
										<div class="text-[10px] text-neutral-500">Balanced bandwidth & quality</div>
									</div>
									{#if player.streamingQuality === '192'}
										<CircleCheck class="w-3.5 h-3.5 text-emerald-400" />
									{/if}
								</button>
								<button
									type="button"
									onclick={() => {
										player.setStreamingQuality('128');
										showQualityMenu = false;
									}}
									class="px-2 py-1.5 rounded-lg text-left transition flex items-center justify-between cursor-pointer {player.streamingQuality === '128'
										? 'bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30'
										: 'hover:bg-neutral-800 text-neutral-300'}"
								>
									<div>
										<div class="text-xs">128 kbps (Data Saver)</div>
										<div class="text-[10px] text-neutral-500">Low bandwidth, mobile friendly</div>
									</div>
									{#if player.streamingQuality === '128'}
										<CircleCheck class="w-3.5 h-3.5 text-emerald-400" />
									{/if}
								</button>
							</div>
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
			<div class="flex items-center gap-2 sm:gap-4 md:gap-6">
				<!-- Shuffle -->
				<button
					type="button"
					onclick={() => player.toggleShuffle()}
					class="relative p-1.5 rounded-lg transition-all duration-200 cursor-pointer flex items-center justify-center {player.shuffleEnabled ? 'text-emerald-400 bg-emerald-500/15 ring-1 ring-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.25)]' : 'text-neutral-400 hover:text-white hover:bg-neutral-800/40'}"
					title="Shuffle ({player.shuffleEnabled ? 'On' : 'Off'})"
				>
					<Shuffle class="w-4 h-4" />
					{#if player.shuffleEnabled}
						<span class="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981]"></span>
					{/if}
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
					class="relative p-1.5 rounded-lg transition-all duration-200 cursor-pointer flex items-center justify-center {player.repeatMode !== 'off' ? 'text-emerald-400 bg-emerald-500/15 ring-1 ring-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.25)]' : 'text-neutral-400 hover:text-white hover:bg-neutral-800/40'}"
					title="Repeat ({player.repeatMode === 'one' ? 'Repeat One' : player.repeatMode === 'all' ? 'Repeat All' : 'Off'})"
				>
					{#if player.repeatMode === 'one'}
						<Repeat1 class="w-4 h-4" />
					{:else}
						<Repeat class="w-4 h-4" />
					{/if}
					{#if player.repeatMode !== 'off'}
						<span class="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981]"></span>
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
						class="w-full h-1 bg-neutral-800 hover:bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 slider-compact"
					/>
				</div>
				<span class="w-9 text-left tabular-nums">{formatTime(player.duration)}</span>
			</div>
		</div>

		<!-- Right Side Utilities (Lyrics Drawer Toggle, Queue, Volume) -->
		<div class="hidden sm:flex items-center justify-end gap-2 md:gap-3 sm:w-1/4 sm:min-w-[120px] md:min-w-[160px] max-w-[280px]">
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

			<!-- Multi-Device Sync & Listen Together Modal Trigger -->
			<button
				type="button"
				onclick={() => player.openSyncModal(player.activeRoom?.type === 'shared' ? 'rooms' : 'devices')}
				class="px-2.5 py-2 rounded-xl transition cursor-pointer border flex items-center gap-1.5 text-xs font-bold {player.activeRoom?.type === 'shared'
					? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-md'
					: !player.standaloneMode && !player.localAudioEnabled
						? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-md'
						: !player.standaloneMode && player.connectedDevices.filter((d) => !d.isStandalone).length > 1
							? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60'
							: 'bg-neutral-800/80 text-neutral-400 border-neutral-700/60 hover:text-white hover:bg-neutral-700'}"
				title="Sync Devices & Listen Together"
			>
				{#if player.activeRoom?.type === 'shared'}
					<Users class="w-4 h-4 text-emerald-400" />
					<span class="hidden lg:inline font-mono text-[11px]">{player.activeRoom.code}</span>
				{:else if !player.standaloneMode && !player.localAudioEnabled}
					<Radio class="w-4 h-4 text-cyan-400" />
					<span class="hidden lg:inline text-[10px]">Companion</span>
				{:else if !player.standaloneMode && player.connectedDevices.filter((d) => !d.isStandalone).length > 1}
					<Radio class="w-4 h-4 text-emerald-400" />
					<span class="text-[11px]">{player.connectedDevices.filter((d) => !d.isStandalone).length}</span>
				{:else}
					<Radio class="w-4 h-4 text-neutral-400" />
				{/if}
			</button>

			<!-- Volume Controls -->
			<div class="hidden md:flex items-center gap-1.5">
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
					class="w-16 sm:w-20 h-1 bg-neutral-800 hover:bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 slider-compact"
				/>
			</div>
		</div>
	</footer>

	<!-- MOBILE FLOATING MINI-PLAYER DOCK (When not on full Player view) -->
	{#if mobilePlayerTab !== 'player'}
		<div
			role="button"
			tabindex="0"
			onclick={() => (mobilePlayerTab = 'player')}
			onkeydown={(e) => { if (e.key === 'Enter') mobilePlayerTab = 'player'; }}
			class="md:hidden mx-2 mb-1 p-2 rounded-xl bg-neutral-900/95 border border-neutral-800/90 shadow-2xl flex items-center justify-between gap-3 shrink-0 cursor-pointer backdrop-blur-xl group hover:border-emerald-500/40 transition z-20"
		>
			<div class="flex items-center gap-2.5 min-w-0 flex-1">
				<div class="w-10 h-10 rounded-lg bg-neutral-950 overflow-hidden shrink-0 border border-neutral-800 shadow-sm relative">
					{#if player.currentAlbum?.cover_url}
						<img src={player.currentAlbum.cover_url} alt="Cover" class="w-full h-full object-cover" />
					{:else}
						<div class="w-full h-full flex items-center justify-center bg-neutral-900 text-neutral-500">
							<Disc3 class="w-5 h-5 {player.isPlaying ? 'animate-spin-slow' : ''}" />
						</div>
					{/if}
				</div>
				<div class="min-w-0 flex-1">
					<div class="text-xs font-bold text-white truncate group-hover:text-emerald-400 transition">
						{player.currentTrack?.title || 'Trax Vault Player'}
					</div>
					<div class="text-[10px] text-neutral-400 truncate">
						{player.currentTrack?.artist || player.currentAlbum?.artist || 'Tap to open player'}
					</div>
				</div>
			</div>

			<div class="flex items-center gap-1 shrink-0" onclick={(e) => e.stopPropagation()}>
				<button
					type="button"
					onclick={() => player.togglePlay()}
					class="w-8 h-8 rounded-full bg-emerald-500 text-neutral-950 flex items-center justify-center hover:bg-emerald-400 transition cursor-pointer"
					title={player.isPlaying ? 'Pause' : 'Play'}
				>
					{#if player.isPlaying}
						<Pause class="w-4 h-4 fill-current" />
					{:else}
						<Play class="w-4 h-4 fill-current ml-0.5" />
					{/if}
				</button>
				<button
					type="button"
					onclick={() => player.nextTrack()}
					class="p-1.5 text-neutral-400 hover:text-white transition cursor-pointer"
					title="Next Track"
				>
					<SkipForward class="w-4 h-4 fill-current" />
				</button>
			</div>
		</div>
	{/if}

	<!-- MOBILE BOTTOM NAVBAR (Fixed at bottom on phones < md) -->
	<nav class="md:hidden h-[calc(3.5rem+env(safe-area-inset-bottom,0px))] pb-[env(safe-area-inset-bottom,0px)] bg-neutral-950/95 backdrop-blur-2xl border-t border-neutral-800/80 px-2 sm:px-4 flex items-center justify-between shrink-0 z-30">
		<button
			type="button"
			onclick={() => { mobilePreviousTab = 'search'; mobilePlayerTab = 'search'; showLyricsDrawer = false; showQueueDrawer = false; }}
			class="flex flex-col items-center justify-center gap-1 py-1 transition cursor-pointer flex-1 {mobilePlayerTab === 'search' ? 'text-emerald-400 font-bold' : 'text-neutral-400 hover:text-white'}"
		>
			<Search class="w-4 h-4" />
			<span class="text-[10px]">Search</span>
		</button>

		<button
			type="button"
			onclick={() => { mobilePreviousTab = 'library'; mobilePlayerTab = 'library'; showLyricsDrawer = false; showQueueDrawer = false; }}
			class="flex flex-col items-center justify-center gap-1 py-1 transition cursor-pointer flex-1 {mobilePlayerTab === 'library' || mobilePlayerTab === 'tracks' ? 'text-emerald-400 font-bold' : 'text-neutral-400 hover:text-white'}"
		>
			<Library class="w-4 h-4" />
			<span class="text-[10px]">Your Library</span>
		</button>

		<button
			type="button"
			onclick={() => {
				createPlaylistError = null;
				showCreatePlaylistModal = true;
			}}
			class="flex flex-col items-center justify-center gap-1 py-1 transition cursor-pointer flex-1 text-neutral-400 hover:text-emerald-400 active:scale-95"
		>
			<Plus class="w-4 h-4" />
			<span class="text-[10px]">Create</span>
		</button>

		{#if mobileFullFeatures}
			<button
				type="button"
				onclick={() => { mobilePreviousTab = 'studio'; mobilePlayerTab = 'studio'; showLyricsDrawer = false; showQueueDrawer = false; }}
				class="flex flex-col items-center justify-center gap-1 py-1 transition cursor-pointer flex-1 {mobilePlayerTab === 'studio' ? 'text-emerald-400 font-bold' : 'text-neutral-400 hover:text-white'}"
			>
				<Wrench class="w-4 h-4" />
				<span class="text-[10px]">Studio</span>
			</button>
		{/if}

		<button
			type="button"
			onclick={() => { mobilePreviousTab = 'profile'; mobilePlayerTab = 'profile'; showLyricsDrawer = false; showQueueDrawer = false; }}
			class="flex flex-col items-center justify-center gap-1 py-1 transition cursor-pointer flex-1 {mobilePlayerTab === 'profile' ? 'text-emerald-400 font-bold' : 'text-neutral-400 hover:text-white'}"
		>
			<User class="w-4 h-4" />
			<span class="text-[10px]">Profile</span>
		</button>
	</nav>

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

	<!-- Edit & Match Artist Metadata Modal -->
	{#if showEditArtistModal && selectedArtist}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
			<div class="relative w-full max-w-2xl max-h-[90dvh] flex flex-col rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl overflow-hidden">
				<!-- Modal Header -->
				<div class="flex items-center justify-between px-5 py-4 border-b border-neutral-800 bg-neutral-950/60 shrink-0">
					<div class="flex items-center gap-3 min-w-0">
						<div class="w-10 h-10 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 shrink-0 flex items-center justify-center">
							{#if selectedArtist.avatar_url || selectedArtist.cover_url}
								<img
									src={selectedArtist.avatar_url || selectedArtist.cover_url}
									alt={selectedArtist.name}
									class="w-full h-full object-cover"
								/>
							{:else}
								<User class="w-5 h-5 text-emerald-400" />
							{/if}
						</div>
						<div class="min-w-0">
							<h3 class="text-sm sm:text-base font-bold text-white truncate">
								Manage Artist: {selectedArtist.name}
							</h3>
							<p class="text-[11px] text-neutral-400 truncate">
								Match by Deezer / MusicBrainz / TheAudioDB ID or URL, or manually edit artist data
							</p>
						</div>
					</div>
					<button
						type="button"
						onclick={() => (showEditArtistModal = false)}
						class="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition cursor-pointer"
						title="Close"
					>
						<X class="h-4 w-4" />
					</button>
				</div>

				<!-- Mode Switcher Tabs -->
				<div class="flex items-center gap-2 px-5 pt-3 pb-2 border-b border-neutral-800/80 bg-neutral-900/90 shrink-0">
					<button
						type="button"
						onclick={() => (editArtistTab = 'match')}
						class="px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 {editArtistTab === 'match'
							? 'bg-emerald-500 text-neutral-950 shadow-sm'
							: 'bg-neutral-800/80 text-neutral-300 hover:text-white hover:bg-neutral-800'}"
					>
						<Search class="w-3.5 h-3.5" />
						<span>Match by ID / URL or Search</span>
					</button>
					<button
						type="button"
						onclick={() => (editArtistTab = 'manual')}
						class="px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 {editArtistTab === 'manual'
							? 'bg-emerald-500 text-neutral-950 shadow-sm'
							: 'bg-neutral-800/80 text-neutral-300 hover:text-white hover:bg-neutral-800'}"
					>
						<Pencil class="w-3.5 h-3.5" />
						<span>Manual Metadata Editor</span>
					</button>
				</div>

				<!-- Modal Body -->
				<div class="flex-1 overflow-y-auto p-5 space-y-5 min-h-0">
					{#if editArtistTab === 'match'}
						<!-- Section 1: Direct Paste ID or URL -->
						<div class="p-4 rounded-xl bg-neutral-950/70 border border-neutral-800 space-y-3">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<label for="artist-external-id-input" class="text-xs font-bold text-emerald-400 uppercase tracking-wider">
									1. Paste Artist ID or URL (Works like Album Tagger)
								</label>
								<div class="flex items-center gap-2 text-[11px]">
									<a
										href="https://www.deezer.com/search/{encodeURIComponent(selectedArtist.name)}/artist"
										target="_blank"
										rel="noreferrer"
										class="text-neutral-400 hover:text-emerald-400 flex items-center gap-1 underline underline-offset-2"
										title="Find artist on Deezer and copy URL or ID from address bar"
									>
										<span>Find on Deezer</span>
										<ExternalLink class="w-2.5 h-2.5" />
									</a>
									<span class="text-neutral-700">&bull;</span>
									<a
										href="https://musicbrainz.org/search?query={encodeURIComponent(selectedArtist.name)}&type=artist"
										target="_blank"
										rel="noreferrer"
										class="text-neutral-400 hover:text-emerald-400 flex items-center gap-1 underline underline-offset-2"
										title="Find artist on MusicBrainz and copy Artist URL or MBID"
									>
										<span>Find on MusicBrainz</span>
										<ExternalLink class="w-2.5 h-2.5" />
									</a>
								</div>
							</div>

							<p class="text-[11px] text-neutral-400 leading-relaxed">
								Copy an artist URL or ID from <strong class="text-neutral-200">Deezer</strong> (e.g. <code class="text-emerald-300 bg-neutral-900 px-1 py-0.5 rounded">https://www.deezer.com/artist/13</code> or <code class="text-emerald-300 bg-neutral-900 px-1 py-0.5 rounded">13</code>), <strong class="text-neutral-200">MusicBrainz</strong> (e.g. <code class="text-emerald-300 bg-neutral-900 px-1 py-0.5 rounded">https://musicbrainz.org/artist/b95ce3ff-...</code> or UUID), <strong class="text-neutral-200">TheAudioDB</strong>, or a direct image link:
							</p>

							<div class="flex items-center gap-2">
								<input
									id="artist-external-id-input"
									type="text"
									bind:value={editArtistExternalInput}
									onkeydown={(e) => {
										if (e.key === 'Enter') {
											e.preventDefault();
											applyExternalArtistId();
										}
									}}
									placeholder="Paste Deezer URL/ID (e.g. 13), MusicBrainz URL/MBID, or direct Image URL..."
									class="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 px-3.5 py-2 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
								/>
								<button
									type="button"
									onclick={() => applyExternalArtistId()}
									disabled={!editArtistExternalInput.trim() || isApplyingExternalArtistId}
									class="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-neutral-950 font-bold text-xs transition cursor-pointer shrink-0 flex items-center gap-1.5"
								>
									{#if isApplyingExternalArtistId}
										<RefreshCw class="w-3.5 h-3.5 animate-spin" />
										<span>Applying...</span>
									{:else}
										<CircleCheck class="w-3.5 h-3.5" />
										<span>Apply ID / URL</span>
									{/if}
								</button>
							</div>
						</div>

						<!-- Section 2: Visual Candidate Search & 1-Click Picker -->
						<div class="space-y-3">
							<div class="flex items-center justify-between">
								<label for="artist-candidate-search-input" class="text-xs font-bold text-neutral-300 uppercase tracking-wider">
									2. Or Search & Pick Candidate Directly
								</label>
							</div>

							<div class="flex items-center gap-2">
								<div class="relative flex-1">
									<Search class="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
									<input
										id="artist-candidate-search-input"
										type="text"
										bind:value={editArtistSearchQuery}
										onkeydown={(e) => {
											if (e.key === 'Enter') {
												e.preventDefault();
												searchArtistCandidatesInModal();
											}
										}}
										placeholder="Search artist name or paste ID to preview..."
										class="w-full rounded-xl border border-neutral-700 bg-neutral-950 pl-9 pr-3.5 py-2 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
									/>
								</div>
								<button
									type="button"
									onclick={searchArtistCandidatesInModal}
									disabled={isSearchingArtistCandidates || !editArtistSearchQuery.trim()}
									class="px-3.5 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-white font-semibold text-xs transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
								>
									<RefreshCw class="w-3.5 h-3.5 text-emerald-400 {isSearchingArtistCandidates ? 'animate-spin' : ''}" />
									<span>Search</span>
								</button>
							</div>

							{#if isSearchingArtistCandidates}
								<div class="py-10 text-center text-xs text-neutral-400 flex flex-col items-center gap-2">
									<RefreshCw class="w-5 h-5 text-emerald-400 animate-spin" />
									<span>Searching Deezer & MusicBrainz for "{editArtistSearchQuery}"...</span>
								</div>
							{:else if editArtistCandidates.length > 0}
								<div class="grid grid-cols-1 gap-2 max-h-72 overflow-y-auto pr-1">
									{#each editArtistCandidates as cand}
										<div class="flex items-center gap-3 p-2.5 rounded-xl bg-neutral-950/80 border border-neutral-800 hover:border-emerald-500/40 transition">
											<!-- Candidate Portrait Preview -->
											<div class="w-12 h-12 rounded-full overflow-hidden bg-neutral-900 border border-neutral-700 shrink-0 flex items-center justify-center">
												{#if cand.imageUrl}
													<img
														src={cand.imageUrl}
														alt={cand.name}
														loading="lazy"
														class="w-full h-full object-cover"
													/>
												{:else}
													<User class="w-5 h-5 text-neutral-500" />
												{/if}
											</div>

											<!-- Candidate Info -->
											<div class="min-w-0 flex-1">
												<div class="flex items-center gap-2">
													<span class="text-xs font-bold text-white truncate">{cand.name}</span>
													<span class="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded border {cand.source === 'deezer'
														? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
														: cand.source === 'musicbrainz'
															? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
															: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'}">
														{cand.source}
													</span>
												</div>
												<div class="text-[11px] text-neutral-400 truncate mt-0.5">
													{cand.subtitle}
												</div>
												<div class="flex items-center gap-2 mt-0.5">
													<code class="text-[10px] text-emerald-400/90 font-mono bg-neutral-900 px-1.5 py-0.5 rounded select-all">
														{cand.externalId}
													</code>
													<a
														href={cand.externalUrl}
														target="_blank"
														rel="noreferrer"
														class="text-[10px] text-neutral-400 hover:text-emerald-400 flex items-center gap-0.5"
													>
														<span>Open</span>
														<ExternalLink class="w-2.5 h-2.5" />
													</a>
												</div>
											</div>

											<!-- Apply Candidate Button -->
											<button
												type="button"
												onclick={() => applyExternalArtistId(cand.externalId)}
												disabled={isApplyingExternalArtistId}
												class="px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500 text-emerald-300 hover:text-neutral-950 border border-emerald-500/40 font-bold text-xs transition cursor-pointer shrink-0"
											>
												Use This
											</button>
										</div>
									{/each}
								</div>
							{:else}
								<div class="py-6 text-center text-xs text-neutral-500">
									No candidates found. Try searching a different name or paste a direct URL/ID above.
								</div>
							{/if}
						</div>

						<!-- Save Companion artist.jpg Option -->
						<div class="flex items-center gap-2.5 pt-2 border-t border-neutral-800/80">
							<input
								id="match-artist-save-folder"
								type="checkbox"
								bind:checked={editArtistSaveToFolder}
								class="h-4 w-4 rounded border-neutral-700 bg-neutral-950 text-emerald-500 focus:ring-emerald-500"
							/>
							<label for="match-artist-save-folder" class="text-xs text-neutral-300 select-none cursor-pointer">
								Also save companion <code class="text-emerald-400">artist.jpg</code> to artist's music folder (if a dedicated artist directory exists)
							</label>
						</div>
					{:else}
						<!-- MANUAL ARTIST METADATA EDITOR TAB -->
						<form onsubmit={saveManualArtistChanges} class="space-y-4">
							<!-- Custom Portrait Upload / URL -->
							<div class="p-3.5 rounded-xl bg-neutral-950/70 border border-neutral-800 flex flex-col sm:flex-row items-center gap-4">
								<div class="relative w-16 h-16 rounded-full overflow-hidden bg-neutral-900 border border-neutral-700 shrink-0 flex items-center justify-center">
									{#if editArtistImageUrl || selectedArtist.avatar_url || selectedArtist.cover_url}
										<img
											src={editArtistImageUrl || selectedArtist.avatar_url || selectedArtist.cover_url}
											alt={selectedArtist.name}
											class="w-full h-full object-cover"
										/>
									{:else}
										<User class="w-7 h-7 text-neutral-500" />
									{/if}
								</div>
								<div class="flex-1 w-full space-y-2">
									<div class="flex flex-wrap items-center justify-between gap-2">
										<label for="manual-artist-img-url" class="text-xs font-semibold text-neutral-200">
											Portrait Image URL (or Upload File)
										</label>
										<button
											type="button"
											onclick={triggerArtistAvatarUpload}
											disabled={isUploadingArtistAvatar}
											class="px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-[11px] font-semibold text-emerald-400 flex items-center gap-1.5 cursor-pointer"
										>
											<Upload class="w-3 h-3" />
											<span>{isUploadingArtistAvatar ? 'Uploading...' : 'Upload Image File'}</span>
										</button>
									</div>
									<input
										id="manual-artist-img-url"
										type="text"
										bind:value={editArtistImageUrl}
										placeholder="https://... direct image URL or Deezer artist link"
										class="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
									/>
								</div>
							</div>

							<div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
								<div>
									<label for="manual-artist-disambig" class="block text-xs font-semibold text-neutral-300 mb-1">
										Disambiguation / Subtitle
									</label>
									<input
										id="manual-artist-disambig"
										type="text"
										bind:value={editArtistDisambiguation}
										placeholder="e.g. US rapper, Detroit hip hop"
										class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
									/>
								</div>

								<div>
									<label for="manual-artist-mbid" class="block text-xs font-semibold text-neutral-300 mb-1">
										MusicBrainz Artist ID (MBID)
									</label>
									<input
										id="manual-artist-mbid"
										type="text"
										bind:value={editArtistMbid}
										placeholder="e.g. b95ce3ff-3d05-4e87-9e01-c97b66af13d4"
										class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs font-mono text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
									/>
								</div>
							</div>

							<div>
								<label for="manual-artist-lastfm" class="block text-xs font-semibold text-neutral-300 mb-1">
									Last.fm Profile URL
								</label>
								<input
									id="manual-artist-lastfm"
									type="text"
									bind:value={editArtistLastFmUrl}
									placeholder="https://www.last.fm/music/..."
									class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
								/>
							</div>

							<div>
								<label for="manual-artist-bio" class="block text-xs font-semibold text-neutral-300 mb-1">
									Artist Biography
								</label>
								<textarea
									id="manual-artist-bio"
									bind:value={editArtistBiography}
									rows="5"
									placeholder="Write or paste the artist biography here..."
									class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none leading-relaxed"
								></textarea>
							</div>

							<div class="flex items-center gap-2.5 pt-1">
								<input
									id="manual-artist-save-folder"
									type="checkbox"
									bind:checked={editArtistSaveToFolder}
									class="h-4 w-4 rounded border-neutral-700 bg-neutral-950 text-emerald-500 focus:ring-emerald-500"
								/>
								<label for="manual-artist-save-folder" class="text-xs text-neutral-300 select-none cursor-pointer">
									Also save companion <code class="text-emerald-400">artist.jpg</code> to artist's music folder
								</label>
							</div>

							<div class="flex items-center justify-end gap-3 pt-3 border-t border-neutral-800">
								<button
									type="button"
									onclick={() => (showEditArtistModal = false)}
									class="rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-700 transition cursor-pointer"
								>
									Cancel
								</button>
								<button
									type="submit"
									disabled={isSavingManualArtist}
									class="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-neutral-950 hover:bg-emerald-400 disabled:opacity-50 transition cursor-pointer"
								>
									{#if isSavingManualArtist}
										<RefreshCw class="h-3.5 w-3.5 animate-spin" />
										<span>Saving...</span>
									{:else}
										<CircleCheck class="h-3.5 w-3.5" />
										<span>Save Artist Metadata</span>
									{/if}
								</button>
							</div>
						</form>
					{/if}
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
