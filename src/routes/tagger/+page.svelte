<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types.js';
	import type {
		Album,
		Track,
		MusicBrainzReleaseItem,
		MusicBrainzReleaseDetail,
		MusicBrainzReleaseTrack,
		TrackMatch,
		ScannedFolderItem
	} from '$lib/types/index.js';
	import { formatDuration, extractMusicBrainzId } from '$lib/utils.js';
	import {
		Tag,
		Sparkles,
		Search,
		Check,
		CheckCircle2,
		AlertTriangle,
		Disc3,
		RefreshCw,
		Layers,
		ArrowRight,
		SlidersHorizontal,
		ExternalLink,
		ChevronRight,
		FolderSync,
		Folder,
		X,
		Music,
		Image as ImageIcon,
		CheckCheck,
		Hash,
		Copy,
		ZoomIn,
		Eye,
		FileText,
		GripVertical,
		ArrowLeftRight,
		PanelLeftClose,
		PanelLeftOpen
	} from '@lucide/svelte';

	let { data }: { data: PageData } = $props();

	// Mode: 'albums' (database vault albums) or 'folders' (scanned library folders on disk)
	let taggerMode = $state<'albums' | 'folders'>(data.initialFolderPath ? 'folders' : 'albums');

	// Library albums list
	let albums = $state<Album[]>([...(data.albums || [])]);

	function deduplicateFoldersList(items: ScannedFolderItem[]): ScannedFolderItem[] {
		const map = new Map<string, ScannedFolderItem>();
		for (const item of items || []) {
			if (!item || !item.folder_path) continue;
			const existing = map.get(item.folder_path);
			if (existing) {
				existing.track_count = (existing.track_count || 0) + (item.track_count || 0);
				existing.already_in_vault = existing.already_in_vault || item.already_in_vault;
				existing.cover_url = existing.cover_url || item.cover_url;
			} else {
				map.set(item.folder_path, { ...item });
			}
		}
		return Array.from(map.values());
	}

	// Scanned music folders list
	let folders = $state<ScannedFolderItem[]>(deduplicateFoldersList(data.folders || []));
	let isRefreshingFolders = $state(false);

	async function refreshFolders(force = true) {
		isRefreshingFolders = true;
		try {
			const res = await fetch(`/api/tagger/folders?force=${force ? 'true' : 'false'}`);
			if (res.ok) {
				const json = await res.json();
				if (Array.isArray(json.folders)) {
					folders = deduplicateFoldersList(json.folders);
					if (taggerMode === 'folders' && (!selectedFolderPath || !folders.some((f) => f.folder_path === selectedFolderPath))) {
						selectedFolderPath = folders[0]?.folder_path || null;
					}
				}
			}
		} catch (err) {
			console.error('Failed to refresh folders:', err);
		} finally {
			isRefreshingFolders = false;
		}
	}

	// Sidebar filter state for albums
	let sidebarSearch = $state('');
	let sidebarFilter = $state<'all' | 'unverified' | 'needs_attention' | 'lossy'>('all');

	// Sidebar filter state for folders
	let folderSearch = $state('');
	let folderFilter = $state<'all' | 'unimported' | 'in_vault'>('all');

	// Active Album State
	let selectedAlbumId = $state<number | null>(data.initialAlbumId || (albums.length > 0 ? albums[0].id : null));
	let selectedAlbum = $derived(albums.find((a) => a.id === selectedAlbumId) || null);

	// Active Folder State
	let selectedFolderPath = $state<string | null>(
		data.initialFolderPath || (folders.length > 0 ? folders[0].folder_path : null)
	);
	let currentFolderData = $state<{
		folder_path: string;
		folder_name: string;
		folder_title: string;
		folder_artist: string;
		folder_year: number | null;
		cover_url: string | null;
		already_in_vault: boolean;
		existing_album_id: number | null;
		is_writable?: boolean;
		permission_error?: string | null;
		unwritable_files?: string[];
	} | null>(null);

	let albumIsWritable = $state<boolean>(true);
	let albumPermissionError = $state<string | null>(null);
	let albumPermissionPath = $state<string | null>(null);
	let albumUnwritableFiles = $state<string[]>([]);

	// MusicBrainz Query & Candidate State
	let mbSearchQuery = $state('');
	let isSearchingMB = $state(false);
	let candidateReleases = $state<MusicBrainzReleaseItem[]>([]);
	let selectedReleaseMbid = $state<string | null>(null);
	let releaseDetail = $state<MusicBrainzReleaseDetail | null>(null);

	// MBID Direct Lookup State
	let isMbidModalOpen = $state(false);
	let mbidInput = $state('');
	let isLookingUpMbid = $state(false);
	let mbidError = $state<string | null>(null);

	// Artwork Preview Modal State
	let isArtworkModalOpen = $state(false);
	let previewArtworkUrl = $state<string | null>(null);
	let previewArtworkTitle = $state<string>('');
	let previewArtworkSubtitle = $state<string>('');
	let previewArtworkSource = $state<string>('');
	let previewArtworkTab = $state<'musicbrainz' | 'local'>('musicbrainz');

	let currentCoverUrl = $derived(
		taggerMode === 'albums' ? selectedAlbum?.cover_url : currentFolderData?.cover_url
	);
	let currentSourceTitle = $derived(
		taggerMode === 'albums' ? (selectedAlbum?.title || '') : (currentFolderData?.folder_title || 'Unknown Title')
	);
	let currentSourceArtist = $derived(
		taggerMode === 'albums' ? (selectedAlbum?.artist || '') : (currentFolderData?.folder_artist || 'Unknown Artist')
	);
	let isCurrentArtistUnknown = $derived(
		!currentSourceArtist || /^(unknown(\s+artist)?|various(\s+artists)?)$/i.test(currentSourceArtist.trim())
	);

	function openArtworkModal(
		url: string,
		title: string,
		subtitle: string,
		source: string,
		defaultTab: 'musicbrainz' | 'local' = 'musicbrainz'
	) {
		previewArtworkUrl = url;
		previewArtworkTitle = title;
		previewArtworkSubtitle = subtitle;
		previewArtworkSource = source;
		previewArtworkTab = defaultTab;
		isArtworkModalOpen = true;
	}

	// Alignment Matches State
	interface EditableMatch {
		localTrack: Track;
		mbTrack: MusicBrainzReleaseTrack | null;
		score: number;
		matchType: 'exact' | 'high' | 'medium' | 'low' | 'unmatched';
		selected: boolean;
		titleDiff: boolean;
		artistDiff: boolean;
		numberDiff: boolean;
		durationDiff: boolean;
	}

	let matches = $state<EditableMatch[]>([]);
	let missingTracks = $state<MusicBrainzReleaseTrack[]>([]);
	let overallScore = $state(0);
	let isLoadingMatches = $state(false);
	let isApplyingTags = $state(false);
	let statusMessage = $state<{
		type: 'success' | 'error' | 'info';
		text: string;
		link?: { url: string; label: string };
		details?: Array<{ file: string; path?: string; error: string; isPermissionDenied?: boolean }>;
		coverError?: string | null;
		isPermission?: boolean;
		fixCommand?: string;
	} | null>(null);

	// Fullscreen workspace state
	let showLibrarySidebar = $state(true);
	let isDragOverStorageCol = $state(false);

	// Apply Options
	let optUpdateCover = $state(true);
	let optUpdateAlbumTitle = $state(true);
	let optUpdateArtist = $state(true);
	let optUpdateYear = $state(true);
	let optImportToVault = $state(false);
	let optRenameFiles = $state(true);

	const totalReleaseDiscs = $derived(
		releaseDetail ? releaseDetail.tracks.reduce((max, t) => Math.max(max, t.disc_number || 1), 1) : 1
	);

	const releaseDiscs = $derived.by(() => {
		if (!releaseDetail) return [];
		const discsMap = new Map<number, MusicBrainzReleaseTrack[]>();
		for (const tr of releaseDetail.tracks) {
			const d = tr.disc_number || 1;
			if (!discsMap.has(d)) discsMap.set(d, []);
			discsMap.get(d)!.push(tr);
		}
		return Array.from(discsMap.entries())
			.sort(([a], [b]) => a - b)
			.map(([discNumber, tracks]) => ({
				discNumber,
				tracks: tracks.sort((a, b) => a.track_number - b.track_number)
			}));
	});

	const unmatchedLocalMatches = $derived.by(() => {
		return matches.filter((m) => !m.mbTrack);
	});

	function getTargetFilenamePreview(
		localTrack: Track,
		mbTrack: MusicBrainzReleaseTrack | null | undefined,
		totalDiscs: number
	): { currentName: string; targetName: string; willRename: boolean } {
		const currentName = localTrack.file_path ? localTrack.file_path.split(/[/\\]/).pop() || '' : '';
		if (!mbTrack || !currentName) {
			return { currentName, targetName: '', willRename: false };
		}
		const extMatch = currentName.match(/\.[^.]+$/);
		const ext = extMatch ? extMatch[0] : '.mp3';

		const trackNum = mbTrack.track_number || localTrack.track_number || 1;
		const discNum = mbTrack.disc_number || localTrack.disc_number || 1;
		const isMultiDisc = totalDiscs > 1 || discNum > 1;
		const prefix = isMultiDisc ? `${discNum}-${String(trackNum).padStart(2, '0')}` : String(trackNum).padStart(2, '0');

		const rawArtist = (mbTrack.artist || releaseDetail?.artist || localTrack.artist || '').trim();
		const rawTitle = (mbTrack.title || localTrack.title || '').trim();

		const cleanArtist = rawArtist
			.replace(/[/\\:]+/g, ' - ')
			.replace(/[*?"<>|]+/g, '')
			.replace(/\s+/g, ' ')
			.trim() || 'Unknown Artist';

		const cleanTitle = rawTitle
			.replace(/[/\\:]+/g, ' - ')
			.replace(/[*?"<>|]+/g, '')
			.replace(/\s+/g, ' ')
			.trim() || 'Unknown Title';

		const baseName = `${prefix}. ${cleanArtist} - ${cleanTitle}`.trim().replace(/[. ]+$/, '');
		const targetName = `${baseName}${ext}`;
		const willRename = currentName !== targetName;
		return { currentName, targetName, willRename };
	}

	// Filtered Library Albums
	const filteredAlbums = $derived(
		albums.filter((a) => {
			const q = sidebarSearch.trim().toLowerCase();
			const matchesText =
				!q ||
				String(a.title || '').toLowerCase().includes(q) ||
				String(a.artist || '').toLowerCase().includes(q);

			if (!matchesText) return false;

			if (sidebarFilter === 'unverified') {
				return (a.checked_count || 0) < (a.track_count || 1);
			}
			if (sidebarFilter === 'needs_attention') {
				return (a.bad_quality_count || 0) > 0 || (a.censored_count || 0) > 0 || (a.missing_lyrics_count || 0) > 0;
			}
			if (sidebarFilter === 'lossy') {
				return (a.bad_quality_count || 0) > 0;
			}
			return true;
		})
	);

	// Filtered Scanned Folders
	const filteredFolders = $derived(
		folders.filter((f) => {
			const q = folderSearch.trim().toLowerCase();
			const matchesText =
				!q ||
				String(f.title || '').toLowerCase().includes(q) ||
				String(f.artist || '').toLowerCase().includes(q) ||
				String(f.folder_path || '').toLowerCase().includes(q);

			if (!matchesText) return false;

			if (folderFilter === 'unimported') {
				return !f.already_in_vault;
			}
			if (folderFilter === 'in_vault') {
				return f.already_in_vault;
			}
			return true;
		})
	);

	// Summary stats
	const selectedCount = $derived(matches.filter((m) => m.selected && m.mbTrack).length);
	const allSelected = $derived(
		matches.filter((m) => m.mbTrack).length > 0 && matches.filter((m) => m.mbTrack).every((m) => m.selected)
	);

	function toggleSelectAll() {
		const next = !allSelected;
		for (const m of matches) {
			if (m.mbTrack) {
				m.selected = next;
			}
		}
	}

	// Trigger match on album selection in Album mode
	$effect(() => {
		if (taggerMode === 'albums' && selectedAlbumId) {
			loadAlbumAndMatch(selectedAlbumId);
		}
	});

	// Trigger match on folder selection in Folder mode
	$effect(() => {
		if (taggerMode === 'folders' && selectedFolderPath) {
			loadFolderAndMatch(selectedFolderPath);
		}
	});

	function formatErrorMessage(err: any, fallback: string): string {
		const msg = err?.message || String(err || '');
		if (/networkerror|failed to fetch|load failed|network request failed/i.test(msg)) {
			return 'Network connection error or request timed out. Please check server connectivity or try again.';
		}
		return `${fallback}: ${msg}`;
	}

	async function loadAlbumAndMatch(albumId: number, targetMbid?: string) {
		isLoadingMatches = true;
		statusMessage = null;
		matches = [];
		missingTracks = [];
		candidateReleases = [];
		releaseDetail = null;

		const currentAlb = albums.find((a) => a.id === albumId);
		if (currentAlb) {
			const isUnknown = !currentAlb.artist || /^(unknown(\s+artist)?|various(\s+artists)?)$/i.test(currentAlb.artist.trim());
			mbSearchQuery = isUnknown ? currentAlb.title : `${currentAlb.title} - ${currentAlb.artist}`;
		}

		try {
			const url = targetMbid
				? `/api/tagger/albums/${albumId}/match?mbid=${encodeURIComponent(targetMbid)}`
				: `/api/tagger/albums/${albumId}/match`;

			const res = await fetch(url);
			const data = await res.json();

			if (!res.ok || data.error) {
				statusMessage = { type: 'error', text: data.error || 'Failed to match tracks.' };
				return;
			}

			candidateReleases = data.candidates || [];
			releaseDetail = data.release || null;
			selectedReleaseMbid = data.release?.id || null;
			overallScore = data.overall_score || 0;
			missingTracks = data.missing_tracks || [];
			albumIsWritable = data.is_writable ?? true;
			albumPermissionError = data.permission_error ?? null;
			albumPermissionPath = data.permission_path ?? null;
			albumUnwritableFiles = data.unwritable_files ?? [];

			if (Array.isArray(data.matches)) {
				matches = data.matches.map((m: TrackMatch) => ({
					localTrack: m.local_track,
					mbTrack: m.mb_track,
					score: m.score,
					matchType: m.match_type,
					selected: m.mb_track !== null && m.score >= 40,
					titleDiff: m.title_diff,
					artistDiff: m.artist_diff,
					numberDiff: m.number_diff,
					durationDiff: m.duration_diff
				}));
			}

			if (data.message && matches.length === 0) {
				statusMessage = { type: 'info', text: data.message };
			}
		} catch (err: any) {
			console.error('Match error:', err);
			statusMessage = { type: 'error', text: formatErrorMessage(err, 'Error loading matches') };
		} finally {
			isLoadingMatches = false;
		}
	}

	async function loadFolderAndMatch(folderPath: string, targetMbid?: string) {
		isLoadingMatches = true;
		statusMessage = null;
		matches = [];
		missingTracks = [];
		candidateReleases = [];
		releaseDetail = null;

		try {
			const url = `/api/tagger/folder/match?folderPath=${encodeURIComponent(folderPath)}${targetMbid ? `&mbid=${encodeURIComponent(targetMbid)}` : ''}`;
			const res = await fetch(url);
			const resData = await res.json();

			if (!res.ok || resData.error) {
				statusMessage = { type: 'error', text: resData.error || 'Failed to match folder audio files.' };
				return;
			}

			currentFolderData = {
				folder_path: resData.folder_path,
				folder_name: resData.folder_name,
				folder_title: resData.folder_title,
				folder_artist: resData.folder_artist,
				folder_year: resData.folder_year,
				cover_url: resData.cover_url,
				already_in_vault: resData.already_in_vault,
				existing_album_id: resData.existing_album_id,
				is_writable: resData.is_writable ?? true,
				permission_error: resData.permission_error ?? null,
				unwritable_files: resData.unwritable_files ?? []
			};

			const isUnknown = !resData.folder_artist || /^(unknown(\s+artist)?|various(\s+artists)?)$/i.test(resData.folder_artist.trim());
			mbSearchQuery = isUnknown ? resData.folder_title : `${resData.folder_title} - ${resData.folder_artist}`;
			candidateReleases = resData.candidates || [];
			releaseDetail = resData.release || null;
			selectedReleaseMbid = resData.release?.id || null;
			overallScore = resData.overall_score || 0;
			missingTracks = resData.missing_tracks || [];

			if (Array.isArray(resData.matches)) {
				matches = resData.matches.map((m: TrackMatch) => ({
					localTrack: m.local_track,
					mbTrack: m.mb_track,
					score: m.score,
					matchType: m.match_type,
					selected: m.mb_track !== null && m.score >= 40,
					titleDiff: m.title_diff,
					artistDiff: m.artist_diff,
					numberDiff: m.number_diff,
					durationDiff: m.duration_diff
				}));
			}

			if (resData.message && matches.length === 0) {
				statusMessage = { type: 'info', text: resData.message };
			}
		} catch (err: any) {
			console.error('Folder match error:', err);
			statusMessage = { type: 'error', text: formatErrorMessage(err, 'Error loading folder matches') };
		} finally {
			isLoadingMatches = false;
		}
	}

	function selectCandidateRelease(relId: string) {
		if (taggerMode === 'albums' && selectedAlbumId) {
			loadAlbumAndMatch(selectedAlbumId, relId);
		} else if (taggerMode === 'folders' && selectedFolderPath) {
			loadFolderAndMatch(selectedFolderPath, relId);
		}
	}

	async function lookupReleaseByMbid(input: string) {
		const extracted = extractMusicBrainzId(input);
		const targetMbid = extracted ? extracted.mbid : input.trim();
		if (!targetMbid) {
			mbidError = 'Please enter a valid MusicBrainz Release ID or URL.';
			return;
		}

		if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetMbid)) {
			mbidError = 'Invalid MBID format. MBID must be a 36-character UUID (e.g. 31d3ab1e-49dc-434b-bf0b-b43dc0f1d626).';
			return;
		}

		isLookingUpMbid = true;
		mbidError = null;
		statusMessage = null;

		try {
			const res = await fetch(`/api/tagger/release/${encodeURIComponent(targetMbid)}`);
			const data = await res.json();

			if (!res.ok || data.error || !data.release) {
				const errMsg = data.error || `No release found on MusicBrainz for MBID: ${targetMbid}`;
				mbidError = errMsg;
				statusMessage = { type: 'error', text: errMsg };
				return;
			}

			const rel = data.release;
			if (!candidateReleases.some((c) => c.id === rel.id)) {
				candidateReleases = [
					{
						id: rel.id,
						title: rel.title,
						artist: rel.artist,
						year: rel.release_year,
						track_count: rel.tracks.length,
						media_format: rel.media_type || 'Digital',
						cover_url: rel.cover_url || null,
						barcode: rel.barcode || null
					},
					...candidateReleases
				];
			}

			selectCandidateRelease(rel.id);
			isMbidModalOpen = false;
			mbidInput = '';
			statusMessage = {
				type: 'success',
				text: `Matched release "${rel.title}" by ${rel.artist} from MusicBrainz ID!`
			};
		} catch (err: any) {
			const errMsg = formatErrorMessage(err, 'Failed to lookup MBID');
			mbidError = errMsg;
			statusMessage = { type: 'error', text: errMsg };
		} finally {
			isLookingUpMbid = false;
		}
	}

	async function searchMusicBrainzReleases() {
		const query = mbSearchQuery.trim();
		if (!query) return;

		// If user typed or pasted an MBID / MusicBrainz URL, route directly to MBID lookup!
		const extracted = extractMusicBrainzId(query);
		if (extracted && extracted.type === 'release') {
			await lookupReleaseByMbid(extracted.mbid);
			return;
		}

		isSearchingMB = true;
		statusMessage = null;

		try {
			const res = await fetch(`/api/tagger/search?query=${encodeURIComponent(query)}`);
			const data = await res.json();
			if (data.releases) {
				candidateReleases = data.releases;
				if (candidateReleases.length === 0) {
					statusMessage = { type: 'info', text: 'No MusicBrainz releases found for this query.' };
				}
			}
		} catch (err: any) {
			statusMessage = { type: 'error', text: formatErrorMessage(err, 'Search failed') };
		} finally {
			isSearchingMB = false;
		}
	}

	function applyMatchToTrack(m: EditableMatch, targetMbTrack: MusicBrainzReleaseTrack | null) {
		m.mbTrack = targetMbTrack;
		if (targetMbTrack) {
			m.selected = true;
			m.titleDiff = m.localTrack.title.trim().toLowerCase() !== targetMbTrack.title.trim().toLowerCase();
			m.artistDiff = Boolean(
				m.localTrack.artist &&
				targetMbTrack.artist &&
				m.localTrack.artist.trim().toLowerCase() !== targetMbTrack.artist.trim().toLowerCase()
			);
			m.numberDiff =
				m.localTrack.track_number !== targetMbTrack.track_number ||
				m.localTrack.disc_number !== targetMbTrack.disc_number;
			m.durationDiff = Boolean(
				m.localTrack.duration_ms &&
				targetMbTrack.duration_ms &&
				Math.abs(m.localTrack.duration_ms - targetMbTrack.duration_ms) > 6000
			);
			m.score = m.titleDiff ? 85 : 100;
			m.matchType = m.score >= 95 ? 'exact' : 'high';
		} else {
			m.selected = false;
			m.score = 0;
			m.matchType = 'unmatched';
		}
	}

	function recomputeMissingTracks() {
		if (!releaseDetail) return;
		const matchedMbIds = new Set(matches.map((match) => match.mbTrack?.id).filter(Boolean));
		missingTracks = releaseDetail.tracks.filter((rt) => !matchedMbIds.has(rt.id));
	}

	function handleRemapTrack(matchIndex: number, newMbTrackId: string) {
		if (!releaseDetail) return;
		const targetMbTrack = releaseDetail.tracks.find((t) => t.id === newMbTrackId) || null;
		const m = matches[matchIndex];
		if (!m) return;

		// If another local track already had this newMbTrackId, swap them
		if (targetMbTrack) {
			const existingOccupant = matches.find((other, idx) => idx !== matchIndex && other.mbTrack?.id === newMbTrackId);
			if (existingOccupant) {
				const oldMbTrack = m.mbTrack;
				applyMatchToTrack(m, targetMbTrack);
				applyMatchToTrack(existingOccupant, oldMbTrack);
				recomputeMissingTracks();
				return;
			}
		}

		applyMatchToTrack(m, targetMbTrack);
		recomputeMissingTracks();
	}

	// Native HTML5 Drag and Drop Handlers for Picard Track Matcher
	let draggedLocalTrackId = $state<number | null>(null);
	let dragOverMbTrackId = $state<string | null>(null);
	let isDragOverUnmatchedPool = $state(false);

	function handleDragStart(e: DragEvent, localTrackId: number) {
		draggedLocalTrackId = localTrackId;
		if (e.dataTransfer) {
			e.dataTransfer.setData('text/plain', String(localTrackId));
			e.dataTransfer.effectAllowed = 'move';
		}
	}

	function handleDragEnd() {
		draggedLocalTrackId = null;
		dragOverMbTrackId = null;
		isDragOverUnmatchedPool = false;
		isDragOverStorageCol = false;
	}

	function handleDropOnStorageColumn() {
		if (draggedLocalTrackId === null) return;
		const sourceMatch = matches.find((m) => m.localTrack.id === draggedLocalTrackId);
		if (sourceMatch) {
			applyMatchToTrack(sourceMatch, null);
			recomputeMissingTracks();
		}
		handleDragEnd();
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = 'move';
		}
	}

	function handleDragEnterMb(mbTrackId: string) {
		if (draggedLocalTrackId !== null) {
			dragOverMbTrackId = mbTrackId;
		}
	}

	function handleDragLeaveMb(mbTrackId: string) {
		if (dragOverMbTrackId === mbTrackId) {
			dragOverMbTrackId = null;
		}
	}

	function handleDropOnMbTrack(targetMbTrackId: string) {
		if (draggedLocalTrackId === null || !releaseDetail) return;
		const sourceMatch = matches.find((m) => m.localTrack.id === draggedLocalTrackId);
		if (!sourceMatch) return;

		const targetMbTrack = releaseDetail.tracks.find((t) => t.id === targetMbTrackId) || null;
		if (!targetMbTrack) return;

		// Check if another local track is already assigned to this target MB track
		const existingOccupant = matches.find((m) => m.mbTrack?.id === targetMbTrackId && m.localTrack.id !== sourceMatch.localTrack.id);

		if (existingOccupant) {
			// Picard SWAP: existing occupant takes old source track (or becomes unassigned)
			const oldSourceMbTrack = sourceMatch.mbTrack;
			applyMatchToTrack(sourceMatch, targetMbTrack);
			applyMatchToTrack(existingOccupant, oldSourceMbTrack);
		} else {
			applyMatchToTrack(sourceMatch, targetMbTrack);
		}

		recomputeMissingTracks();
		handleDragEnd();
	}

	function handleDropOnUnmatched() {
		if (draggedLocalTrackId === null) return;
		const sourceMatch = matches.find((m) => m.localTrack.id === draggedLocalTrackId);
		if (sourceMatch) {
			applyMatchToTrack(sourceMatch, null);
			recomputeMissingTracks();
		}
		handleDragEnd();
	}

	function handleUnpairTrack(localTrackId: number) {
		const sourceMatch = matches.find((m) => m.localTrack.id === localTrackId);
		if (sourceMatch) {
			applyMatchToTrack(sourceMatch, null);
			recomputeMissingTracks();
		}
	}

	function handleAssignLocalIdToMbTrack(localId: number, targetMbTrackId: string) {
		if (!releaseDetail) return;
		const sourceMatch = matches.find((m) => m.localTrack.id === localId);
		if (!sourceMatch) return;

		const targetMbTrack = releaseDetail.tracks.find((t) => t.id === targetMbTrackId) || null;
		if (!targetMbTrack) return;

		const existingOccupant = matches.find((m) => m.mbTrack?.id === targetMbTrackId && m.localTrack.id !== localId);
		if (existingOccupant) {
			const oldSourceMbTrack = sourceMatch.mbTrack;
			applyMatchToTrack(sourceMatch, targetMbTrack);
			applyMatchToTrack(existingOccupant, oldSourceMbTrack);
		} else {
			applyMatchToTrack(sourceMatch, targetMbTrack);
		}

		recomputeMissingTracks();
	}

	async function applyConfirmedTags() {
		if (taggerMode === 'albums') {
			if (!selectedAlbumId || !selectedReleaseMbid) return;

			const confirmed = matches
				.filter((m) => m.selected && m.mbTrack)
				.map((m) => ({
					localTrackId: m.localTrack.id,
					mbTrackId: m.mbTrack!.id,
					title: m.mbTrack!.title,
					artist: m.mbTrack!.artist || releaseDetail?.artist || null,
					trackNumber: m.mbTrack!.track_number,
					discNumber: m.mbTrack!.disc_number
				}));

			if (confirmed.length === 0) {
				alert('Please select at least one track to update.');
				return;
			}

			isApplyingTags = true;
			statusMessage = null;

			try {
				const res = await fetch(`/api/tagger/albums/${selectedAlbumId}/apply`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						mbid: selectedReleaseMbid,
						matches: confirmed,
						coverUrl: releaseDetail?.cover_url || null,
						updateCover: optUpdateCover,
						updateAlbumTitle: optUpdateAlbumTitle,
						updateArtist: optUpdateArtist,
						updateYear: optUpdateYear,
						renameFiles: optRenameFiles
					})
				});

				const json = await res.json();
				if (!res.ok || json.error || json.hasPermissionErrors || (json.updatedTracksCount === 0 && confirmed.length > 0)) {
					const errorText = json.error || (json.hasPermissionErrors
						? 'Permission Denied: Trax Vault cannot write to audio files or album folder.'
						: 'Failed to apply tags.');
					const targetDir = albumPermissionPath || './music';
					statusMessage = {
						type: 'error',
						text: errorText,
						details: json.fileErrors || [],
						coverError: json.coverError,
						isPermission: json.hasPermissionErrors,
						fixCommand: json.hasPermissionErrors ? `chmod -R u+rw "${targetDir}"` : undefined
					};
					return;
				}

				// Update in-memory album
				const albIdx = albums.findIndex((a) => a.id === selectedAlbumId);
				if (albIdx !== -1 && json.album) {
					albums[albIdx] = {
						...albums[albIdx],
						...json.album,
						checked_count: json.tracks?.filter((t: Track) => t.manually_checked === 1).length
					};
				}

				let successMsg = `Successfully wrote tags to ${json.updatedTracksCount} audio files`;
				if (json.renamedFilesCount > 0) {
					successMsg += ` and renamed ${json.renamedFilesCount} files (& companion lyrics) on disk`;
				}
				if (json.coverDownloaded) {
					successMsg += ` and downloaded cover.jpg to album folder`;
				} else if (json.coverError) {
					successMsg += ` (⚠️ Note: cover.jpg could not be saved: ${json.coverError})`;
				}
				statusMessage = {
					type: 'success',
					text: `${successMsg}!`,
					coverError: json.coverError
				};

				// Refresh alignment diff
				await loadAlbumAndMatch(selectedAlbumId, selectedReleaseMbid);
			} catch (err: any) {
				console.error('Apply error:', err);
				statusMessage = { type: 'error', text: formatErrorMessage(err, 'Failed to write tags') };
			} finally {
				isApplyingTags = false;
			}
		} else {
			// Folder mode: apply tags to raw folder on disk and optionally import to vault
			if (!selectedFolderPath || !selectedReleaseMbid) return;

			const confirmed = matches
				.filter((m) => m.selected && m.mbTrack)
				.map((m) => ({
					localTrackId: m.localTrack.id,
					filePath: m.localTrack.file_path || undefined,
					mbTrackId: m.mbTrack!.id,
					title: m.mbTrack!.title,
					artist: m.mbTrack!.artist || releaseDetail?.artist || null,
					trackNumber: m.mbTrack!.track_number,
					discNumber: m.mbTrack!.disc_number
				}));

			if (confirmed.length === 0) {
				alert('Please select at least one track to update.');
				return;
			}

			isApplyingTags = true;
			statusMessage = null;

			try {
				const res = await fetch('/api/tagger/folder/apply', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						folderPath: selectedFolderPath,
						mbid: selectedReleaseMbid,
						matches: confirmed,
						coverUrl: releaseDetail?.cover_url || null,
						updateCover: optUpdateCover,
						updateAlbumTitle: optUpdateAlbumTitle,
						updateArtist: optUpdateArtist,
						updateYear: optUpdateYear,
						importToVault: optImportToVault,
						renameFiles: optRenameFiles
					})
				});

				const json = await res.json();
				if (!res.ok || json.error || json.hasPermissionErrors || (json.updatedTracksCount === 0 && confirmed.length > 0)) {
					const errorText = json.error || (json.hasPermissionErrors
						? 'Permission Denied: Trax Vault cannot write to audio files or folder.'
						: 'Failed to apply tags.');
					const targetDir = selectedFolderPath || currentFolderData?.folder_path || './music';
					statusMessage = {
						type: 'error',
						text: errorText,
						details: json.fileErrors || [],
						coverError: json.coverError,
						isPermission: json.hasPermissionErrors,
						fixCommand: json.hasPermissionErrors ? `chmod -R u+rw "${targetDir}"` : undefined
					};
					return;
				}

				// Update folder in local folders list
				const fIdx = folders.findIndex(
					(f) => f.folder_path === selectedFolderPath || f.folder_path === currentFolderData?.folder_path
				);
				const updatedArtist = json.folderArtist || (optUpdateArtist && releaseDetail ? releaseDetail.artist : undefined);
				const updatedTitle = json.folderTitle || (optUpdateAlbumTitle && releaseDetail ? releaseDetail.title : undefined);
				const updatedCover = json.coverUrl || undefined;

				if (fIdx !== -1) {
					folders[fIdx] = {
						...folders[fIdx],
						already_in_vault: json.importedAlbumId ? true : folders[fIdx].already_in_vault,
						title: updatedTitle || folders[fIdx].title,
						artist: updatedArtist || folders[fIdx].artist,
						cover_url: updatedCover || folders[fIdx].cover_url
					};
				}
				if (currentFolderData) {
					currentFolderData.already_in_vault = Boolean(json.importedAlbumId || currentFolderData.already_in_vault);
					currentFolderData.existing_album_id = json.importedAlbumId || currentFolderData.existing_album_id;
					if (updatedArtist) currentFolderData.folder_artist = updatedArtist;
					if (updatedTitle) currentFolderData.folder_title = updatedTitle;
					if (updatedCover) currentFolderData.cover_url = updatedCover;
				}

				let successMsg = `Successfully wrote tags to ${json.updatedTracksCount} audio files`;
				if (json.renamedFilesCount > 0) {
					successMsg += ` and renamed ${json.renamedFilesCount} files (& companion lyrics) on disk`;
				}
				if (json.coverDownloaded) {
					successMsg += ` and saved cover.jpg`;
				} else if (json.coverError) {
					successMsg += ` (⚠️ Note: cover.jpg could not be saved: ${json.coverError})`;
				}
				let linkObj = undefined;

				if (json.importedAlbumId) {
					successMsg += ` and cleanly imported album into Vault!`;
					linkObj = {
						url: `/album/${json.importedAlbumId}`,
						label: 'View in Vault →'
					};
				} else {
					successMsg += ` directly on disk!`;
				}

				statusMessage = {
					type: 'success',
					text: successMsg,
					link: linkObj,
					coverError: json.coverError
				};

				// Refresh folder alignment
				await loadFolderAndMatch(selectedFolderPath, selectedReleaseMbid);
			} catch (err: any) {
				console.error('Apply folder error:', err);
				statusMessage = { type: 'error', text: formatErrorMessage(err, 'Failed to write tags') };
			} finally {
				isApplyingTags = false;
			}
		}
	}
</script>

<svelte:head>
	<title>MusicBrainz Tagger Studio - Trax Vault</title>
</svelte:head>

<div class="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
	<!-- Studio Header -->
	<div class="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
		<div>
			<div class="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-400">
				<Tag class="h-4 w-4" />
				<span>Native Tagging Studio</span>
			</div>
			<h1 class="mt-1 text-2xl sm:text-3xl font-black text-white flex items-center gap-2.5">
				<span>MusicBrainz Auto-Tagger</span>
				<span class="rounded-full bg-emerald-950/80 border border-emerald-500/40 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
					Built-in
				</span>
			</h1>
			<p class="mt-1 text-xs text-neutral-400">
				Search official releases, align tracks, detect missing songs, download high-resolution cover art, and write verified ID3/Vorbis tags directly into audio files before or after importing.
			</p>
		</div>

		<!-- Quick Actions -->
		<div class="flex items-center gap-2 flex-wrap">
			<!-- Toggle Library Sidebar -->
			<button
				type="button"
				onclick={() => (showLibrarySidebar = !showLibrarySidebar)}
				class="flex items-center gap-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 px-3.5 py-2 text-xs font-semibold text-neutral-300 border border-neutral-700 transition cursor-pointer"
				title={showLibrarySidebar ? 'Collapse Library Sidebar to maximize workspace' : 'Expand Library Sidebar'}
			>
				{#if showLibrarySidebar}
					<PanelLeftClose class="h-3.5 w-3.5 text-emerald-400" />
					<span>Hide Library</span>
				{:else}
					<PanelLeftOpen class="h-3.5 w-3.5 text-emerald-400" />
					<span>Show Library</span>
				{/if}
			</button>

			{#if taggerMode === 'albums' && selectedAlbum}
				<a
					href="/album/{selectedAlbum.id}"
					class="flex items-center gap-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 px-3.5 py-2 text-xs font-semibold text-neutral-300 border border-neutral-700 transition"
				>
					<ExternalLink class="h-3.5 w-3.5" />
					<span>View Album Page</span>
				</a>
			{:else if taggerMode === 'folders' && currentFolderData?.existing_album_id}
				<a
					href="/album/{currentFolderData.existing_album_id}"
					class="flex items-center gap-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 px-3.5 py-2 text-xs font-semibold text-neutral-300 border border-neutral-700 transition"
				>
					<ExternalLink class="h-3.5 w-3.5" />
					<span>View Album Page</span>
				</a>
			{/if}
			<a
				href="/scan"
				class="flex items-center gap-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 px-3.5 py-2 text-xs font-semibold text-neutral-300 border border-neutral-700 transition"
			>
				<FolderSync class="h-3.5 w-3.5 text-emerald-400" />
				<span>Library Scanner</span>
			</a>
			<a
				href="/player"
				class="flex items-center gap-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 px-3.5 py-2 text-xs font-semibold text-neutral-300 border border-neutral-700 transition"
			>
				<Disc3 class="h-3.5 w-3.5 text-emerald-400" />
				<span>Open Player</span>
			</a>
		</div>
	</div>

	<!-- Status Banner Toast -->
	{#if statusMessage}
		<div
			class="mb-6 rounded-2xl p-4 flex flex-col gap-2.5 text-xs font-medium border shadow-lg transition-all {statusMessage.type === 'success' ? 'bg-emerald-950/70 border-emerald-600/60 text-emerald-200' : statusMessage.type === 'error' ? 'bg-rose-950/70 border-rose-600/60 text-rose-200' : 'bg-neutral-900 border-neutral-700 text-neutral-300'}"
		>
			<div class="flex items-center justify-between gap-3">
				<div class="flex items-center gap-2.5">
					{#if statusMessage.type === 'success'}
						<CheckCircle2 class="h-4 w-4 text-emerald-400 shrink-0" />
					{:else if statusMessage.type === 'error'}
						<AlertTriangle class="h-4 w-4 text-rose-400 shrink-0" />
					{:else}
						<Sparkles class="h-4 w-4 text-indigo-400 shrink-0" />
					{/if}
					<span class="font-semibold">{statusMessage.text}</span>
					{#if statusMessage.link}
						<a
							href={statusMessage.link.url}
							class="ml-2 font-bold text-emerald-400 hover:underline inline-flex items-center gap-1"
						>
							<span>{statusMessage.link.label}</span>
						</a>
					{/if}
				</div>
				<button
					type="button"
					onclick={() => (statusMessage = null)}
					class="p-1 rounded text-neutral-400 hover:text-white transition cursor-pointer"
				>
					<X class="h-3.5 w-3.5" />
				</button>
			</div>

			{#if statusMessage.fixCommand}
				<div class="mt-1 rounded-xl bg-neutral-950/80 border border-rose-800/40 p-3 space-y-1.5 font-sans">
					<p class="text-[11px] font-bold text-rose-300">
						💡 How to fix write permissions on your host machine:
					</p>
					<div class="flex items-center justify-between gap-2 bg-neutral-900 px-2.5 py-1.5 rounded-lg border border-neutral-800 font-mono text-[11px] text-amber-300 select-all">
						<span>{statusMessage.fixCommand}</span>
					</div>
					<p class="text-[10px] text-neutral-400">
						If running via Docker, make sure your music volume mount in <code class="text-neutral-300">docker-compose.yml</code> is read-write (<code class="text-neutral-300">:rw</code>).
					</p>
				</div>
			{/if}

			{#if statusMessage.coverError}
				<div class="mt-0.5 rounded-lg bg-rose-900/30 border border-rose-800/30 px-3 py-1.5 text-[11px] text-rose-300 flex items-center gap-2">
					<ImageIcon class="h-3.5 w-3.5 shrink-0 text-rose-400" />
					<span>Cover Art Error: {statusMessage.coverError}</span>
				</div>
			{/if}

			{#if statusMessage.details && statusMessage.details.length > 0}
				<div class="mt-1 space-y-1">
					<p class="text-[11px] font-bold text-rose-300">Affected files ({statusMessage.details.length}):</p>
					<ul class="max-h-32 overflow-y-auto space-y-1 text-[10px] font-mono bg-neutral-950/60 p-2 rounded-lg border border-rose-900/40">
						{#each statusMessage.details as errItem}
							<li class="text-rose-300/90 truncate" title={errItem.error}>
								• <span class="font-bold text-rose-200">{errItem.file}:</span> {errItem.error}
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	{/if}

	<!-- 2-Pane Layout: Drawer (Left) & Studio Diff Stage (Right) -->
	<div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
		<!-- Left Pane: Mode Switcher & Item List (col-span-3 when open) -->
		{#if showLibrarySidebar}
			<div class="lg:col-span-3 min-w-0 rounded-3xl border border-neutral-800 bg-neutral-900/50 p-4 sm:p-5 backdrop-blur-xl shadow-xl space-y-4 animate-in fade-in duration-200">
			<!-- Mode Switcher Tabs: Vault Albums vs Scanned Folders -->
			<div class="grid grid-cols-2 p-1 rounded-2xl bg-neutral-950 border border-neutral-800/90 shadow-inner">
				<button
					type="button"
					onclick={() => {
						taggerMode = 'albums';
						if (!selectedAlbumId && albums.length > 0) {
							selectedAlbumId = albums[0].id;
						}
					}}
					class="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold transition cursor-pointer {taggerMode === 'albums' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30' : 'text-neutral-400 hover:text-white'}"
				>
					<Disc3 class="h-3.5 w-3.5" />
					<span>Vault Albums</span>
					<span class="text-[10px] px-1.5 py-0.2 rounded-full {taggerMode === 'albums' ? 'bg-emerald-700 text-white' : 'bg-neutral-800 text-neutral-400'}">
						{albums.length}
					</span>
				</button>

				<button
					type="button"
					onclick={() => {
						taggerMode = 'folders';
						if (folders.length === 0) {
							refreshFolders(false);
						} else if (!selectedFolderPath || !folders.some((f) => f.folder_path === selectedFolderPath)) {
							selectedFolderPath = folders[0].folder_path;
						}
					}}
					class="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold transition cursor-pointer {taggerMode === 'folders' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30' : 'text-neutral-400 hover:text-white'}"
				>
					<FolderSync class="h-3.5 w-3.5" />
					<span>Scanned Folders</span>
					<span class="text-[10px] px-1.5 py-0.2 rounded-full {taggerMode === 'folders' ? 'bg-emerald-700 text-white' : 'bg-neutral-800 text-neutral-400'}">
						{folders.length}
					</span>
				</button>
			</div>

			<!-- Search & Filter Controls based on Mode -->
			{#if taggerMode === 'albums'}
				<div class="space-y-2">
					<div class="relative">
						<Search class="absolute left-3 top-2.5 h-3.5 w-3.5 text-neutral-500" />
						<input
							type="text"
							bind:value={sidebarSearch}
							placeholder="Search artist or album..."
							class="w-full rounded-xl border border-neutral-700 bg-neutral-950 pl-9 pr-3 py-2 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
						/>
					</div>

					<div class="flex items-center gap-1 overflow-x-auto pb-1 text-[11px]">
						<button
							type="button"
							onclick={() => (sidebarFilter = 'all')}
							class="px-2.5 py-1 rounded-lg border transition whitespace-nowrap {sidebarFilter === 'all' ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300 font-bold' : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'}"
						>
							All
						</button>
						<button
							type="button"
							onclick={() => (sidebarFilter = 'unverified')}
							class="px-2.5 py-1 rounded-lg border transition whitespace-nowrap {sidebarFilter === 'unverified' ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300 font-bold' : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'}"
						>
							Needs Verification
						</button>
						<button
							type="button"
							onclick={() => (sidebarFilter = 'needs_attention')}
							class="px-2.5 py-1 rounded-lg border transition whitespace-nowrap {sidebarFilter === 'needs_attention' ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300 font-bold' : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'}"
						>
							Has Issues
						</button>
					</div>
				</div>

				<!-- Album Cards List -->
				<div class="space-y-1.5 max-h-[580px] overflow-y-auto pr-1">
					{#each filteredAlbums as alb (alb.id)}
						<button
							type="button"
							onclick={() => {
								selectedAlbumId = alb.id;
							}}
							class="w-full text-left p-2.5 rounded-2xl border transition flex items-center gap-3 cursor-pointer {selectedAlbumId === alb.id ? 'bg-emerald-950/60 border-emerald-500/70 shadow-md shadow-emerald-950/50' : 'bg-neutral-950/40 border-neutral-800/70 hover:bg-neutral-800/40 hover:border-neutral-700'}"
						>
							<!-- Album Cover Thumbnail -->
							<div class="h-11 w-11 shrink-0 rounded-xl overflow-hidden bg-neutral-900 border border-neutral-800 relative">
								{#if alb.cover_url}
									<img src={alb.cover_url} alt={alb.title} class="h-full w-full object-cover" />
								{:else}
									<div class="h-full w-full flex items-center justify-center text-neutral-600">
										<Music class="h-4 w-4" />
									</div>
								{/if}
							</div>

							<div class="min-w-0 flex-1">
								<h3 class="text-xs font-bold text-white truncate {selectedAlbumId === alb.id ? 'text-emerald-300' : ''}">
									{alb.title}
								</h3>
								<p class="text-[11px] text-neutral-400 truncate">
									{alb.artist}
								</p>
								<div class="flex items-center gap-2 mt-0.5 text-[10px] text-neutral-500">
									<span>{alb.track_count || 0} tracks</span>
									{#if alb.release_year}
										<span>• {alb.release_year}</span>
									{/if}
									{#if alb.checked_count === alb.track_count && (alb.track_count || 0) > 0}
										<span class="text-emerald-400 font-semibold">• Verified</span>
									{/if}
								</div>
							</div>

							<ChevronRight class="h-4 w-4 shrink-0 text-neutral-600 {selectedAlbumId === alb.id ? 'text-emerald-400' : ''}" />
						</button>
					{:else}
						<div class="py-8 text-center text-xs text-neutral-500">
							No albums match your filter.
						</div>
					{/each}
				</div>
			{:else}
				<!-- Folders Mode Search & Filter -->
				<div class="space-y-2">
					<div class="flex items-center gap-1.5">
						<div class="relative flex-1">
							<Search class="absolute left-3 top-2.5 h-3.5 w-3.5 text-neutral-500" />
							<input
								type="text"
								bind:value={folderSearch}
								placeholder="Search scanned folder or artist..."
								class="w-full rounded-xl border border-neutral-700 bg-neutral-950 pl-9 pr-3 py-2 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
							/>
						</div>
						<button
							type="button"
							onclick={() => refreshFolders(true)}
							disabled={isRefreshingFolders}
							title="Rescan music directory folders"
							class="p-2 rounded-xl border border-neutral-700 bg-neutral-900 text-neutral-300 hover:text-emerald-400 hover:border-emerald-600 transition disabled:opacity-50 cursor-pointer"
						>
							<RefreshCw class="h-3.5 w-3.5 {isRefreshingFolders ? 'animate-spin text-emerald-400' : ''}" />
						</button>
					</div>

					<div class="flex items-center gap-1 overflow-x-auto pb-1 text-[11px]">
						<button
							type="button"
							onclick={() => (folderFilter = 'all')}
							class="px-2.5 py-1 rounded-lg border transition whitespace-nowrap {folderFilter === 'all' ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300 font-bold' : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'}"
						>
							All Folders
						</button>
						<button
							type="button"
							onclick={() => (folderFilter = 'unimported')}
							class="px-2.5 py-1 rounded-lg border transition whitespace-nowrap {folderFilter === 'unimported' ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300 font-bold' : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'}"
						>
							Unimported Only
						</button>
						<button
							type="button"
							onclick={() => (folderFilter = 'in_vault')}
							class="px-2.5 py-1 rounded-lg border transition whitespace-nowrap {folderFilter === 'in_vault' ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300 font-bold' : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'}"
						>
							In Vault
						</button>
					</div>
				</div>

				<!-- Scanned Folder Cards List -->
				<div class="space-y-1.5 max-h-[580px] overflow-y-auto pr-1">
					{#each filteredFolders as fld, idx (`${fld.folder_path}::${idx}`)}
						<button
							type="button"
							onclick={() => {
								selectedFolderPath = fld.folder_path;
							}}
							class="w-full text-left p-2.5 rounded-2xl border transition flex items-center gap-3 cursor-pointer {selectedFolderPath === fld.folder_path ? 'bg-emerald-950/60 border-emerald-500/70 shadow-md shadow-emerald-950/50' : 'bg-neutral-950/40 border-neutral-800/70 hover:bg-neutral-800/40 hover:border-neutral-700'}"
						>
							<!-- Folder / Artwork Thumbnail -->
							<div class="h-11 w-11 shrink-0 rounded-xl overflow-hidden bg-neutral-900 border border-neutral-800 relative">
								{#if fld.cover_url}
									<img src={fld.cover_url} alt={fld.title} class="h-full w-full object-cover" />
								{:else}
									<div class="h-full w-full flex items-center justify-center text-neutral-600">
										<Folder class="h-4 w-4" />
									</div>
								{/if}
							</div>

							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-1.5">
									<h3 class="text-xs font-bold text-white truncate {selectedFolderPath === fld.folder_path ? 'text-emerald-300' : ''}">
										{fld.title}
									</h3>
									{#if fld.already_in_vault}
										<span class="rounded bg-emerald-950/80 border border-emerald-600/50 px-1.5 py-0.2 text-[9px] font-bold text-emerald-400 shrink-0">
											In Vault
										</span>
									{:else}
										<span class="rounded bg-amber-950/80 border border-amber-600/50 px-1.5 py-0.2 text-[9px] font-bold text-amber-400 shrink-0">
											Unimported
										</span>
									{/if}
								</div>
								<p class="text-[11px] text-neutral-400 truncate">
									{fld.artist}
								</p>
								<div class="flex items-center gap-2 mt-0.5 text-[10px] text-neutral-500">
									<span>{fld.track_count || 0} songs</span>
									{#if fld.year}
										<span>• {fld.year}</span>
									{/if}
								</div>
							</div>

							<ChevronRight class="h-4 w-4 shrink-0 text-neutral-600 {selectedFolderPath === fld.folder_path ? 'text-emerald-400' : ''}" />
						</button>
					{:else}
						<div class="py-8 text-center text-xs text-neutral-500">
							No scanned folders found.
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Right Pane: Main Tagger Studio (col-span-9 when sidebar open, col-span-12 when collapsed) -->
	<div class="{showLibrarySidebar ? 'lg:col-span-9' : 'lg:col-span-12'} min-w-0 space-y-6 transition-all duration-200">
			{#if (taggerMode === 'albums' && !selectedAlbum) || (taggerMode === 'folders' && !selectedFolderPath)}
				<div class="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-12 text-center backdrop-blur-xl">
					<Tag class="h-10 w-10 text-neutral-600 mx-auto mb-3" />
					<h3 class="text-base font-bold text-white">
						{taggerMode === 'albums' ? 'Select an Album to Tag' : 'Select a Folder to Tag'}
					</h3>
					<p class="text-xs text-neutral-400 mt-1 max-w-sm mx-auto">
						Choose any album from your library or a scanned music folder on the left to start automatic MusicBrainz matching, missing track detection, and tag alignment.
					</p>
				</div>
			{:else}
				<!-- Album / Folder Active Hero & MusicBrainz Search Box -->
				<div class="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-5 backdrop-blur-xl shadow-xl space-y-5">
					<div class="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5">
						<div class="flex flex-col sm:flex-row items-start sm:items-center gap-4 min-w-0 flex-1">
							<!-- Album Artwork Preview Strip / Comparison Cards -->
							<div class="flex items-center gap-2.5 shrink-0">
								<!-- Current Local Artwork Card -->
								<div class="flex flex-col items-center gap-1">
									<div
										class="h-20 w-20 sm:h-24 sm:w-24 shrink-0 rounded-2xl overflow-hidden bg-neutral-950 border border-neutral-700 shadow-lg relative group/art cursor-pointer"
										onclick={() => {
											if (currentCoverUrl) {
												openArtworkModal(currentCoverUrl, currentSourceTitle, currentSourceArtist, 'Local Folder (cover.jpg)', 'local');
											}
										}}
										title={currentCoverUrl ? 'Click to preview local artwork' : 'No local cover image found'}
										role="button"
										tabindex="0"
										onkeydown={(e) => {
											if ((e.key === 'Enter' || e.key === ' ') && currentCoverUrl) {
												openArtworkModal(currentCoverUrl, currentSourceTitle, currentSourceArtist, 'Local Folder (cover.jpg)', 'local');
											}
										}}
									>
										{#if currentCoverUrl}
											<img src={currentCoverUrl} alt={currentSourceTitle} class="h-full w-full object-cover" />
											<div class="absolute inset-0 bg-black/60 opacity-0 group-hover/art:opacity-100 flex flex-col items-center justify-center gap-1 text-white transition">
												<ZoomIn class="h-5 w-5" />
												<span class="text-[9px] font-bold">Preview</span>
											</div>
										{:else}
											<div class="h-full w-full flex flex-col items-center justify-center text-neutral-600 gap-1 p-2 text-center">
												{#if taggerMode === 'folders'}
													<FolderSync class="h-6 w-6 text-emerald-400" />
												{:else}
													<Music class="h-6 w-6" />
												{/if}
												<span class="text-[8px] text-neutral-500 font-semibold leading-tight">No Local Cover</span>
											</div>
										{/if}
									</div>
									<span class="text-[9px] font-bold uppercase tracking-wider text-neutral-400">Local Art</span>
								</div>

								{#if releaseDetail}
									<div class="flex flex-col items-center justify-center px-0.5">
										<ArrowRight class="h-4 w-4 text-emerald-400" />
									</div>

									<!-- Target MusicBrainz Cover Art Card -->
									<div class="flex flex-col items-center gap-1">
										<div
											class="h-20 w-20 sm:h-24 sm:w-24 shrink-0 rounded-2xl overflow-hidden bg-neutral-950 border {releaseDetail.cover_url ? 'border-emerald-500/80 shadow-emerald-950/60 ring-1 ring-emerald-500/40' : 'border-neutral-800'} shadow-lg relative group/art cursor-pointer"
											onclick={() => {
												if (releaseDetail?.cover_url) {
													openArtworkModal(releaseDetail.cover_url, releaseDetail.title, releaseDetail.artist, 'MusicBrainz Cover Art Archive', 'musicbrainz');
												}
											}}
											title={releaseDetail.cover_url ? 'Click to preview high-res MusicBrainz artwork' : 'No Cover Art Archive image found'}
											role="button"
											tabindex="0"
											onkeydown={(e) => {
												if ((e.key === 'Enter' || e.key === ' ') && releaseDetail?.cover_url) {
													openArtworkModal(releaseDetail.cover_url, releaseDetail.title, releaseDetail.artist, 'MusicBrainz Cover Art Archive', 'musicbrainz');
												}
											}}
										>
											{#if releaseDetail.cover_url}
												<img src={releaseDetail.cover_url} alt={releaseDetail.title} class="h-full w-full object-cover" />
												<div class="absolute inset-0 bg-black/60 opacity-0 group-hover/art:opacity-100 flex flex-col items-center justify-center gap-1 text-emerald-300 transition">
													<ZoomIn class="h-5 w-5" />
													<span class="text-[9px] font-bold">Preview 500px</span>
												</div>
											{:else}
												<div class="h-full w-full flex flex-col items-center justify-center text-neutral-600 gap-1 p-2 text-center">
													<ImageIcon class="h-6 w-6" />
													<span class="text-[8px] text-neutral-500 font-semibold leading-tight">No CAA Art</span>
												</div>
											{/if}
										</div>
										<span class="text-[9px] font-bold uppercase tracking-wider text-emerald-400">MusicBrainz Art</span>
									</div>
								{/if}
							</div>

							<!-- Release Title, Artist & Diff Info -->
							<div class="min-w-0 flex-1 space-y-1">
								<div class="flex items-center gap-2 flex-wrap">
									<span class="text-[10px] font-bold uppercase tracking-widest text-emerald-400">
										{taggerMode === 'albums' ? 'Library Album' : 'Scanned Folder'}
									</span>
									{#if taggerMode === 'folders'}
										{#if currentFolderData?.already_in_vault}
											<span class="rounded-full bg-emerald-950/80 border border-emerald-500/50 px-2 py-0.2 text-[9px] font-bold text-emerald-300">
												In Vault
											</span>
										{:else}
											<span class="rounded-full bg-amber-950/80 border border-amber-500/50 px-2 py-0.2 text-[9px] font-bold text-amber-300">
												Unimported Folder
											</span>
										{/if}
									{/if}
									{#if releaseDetail && releaseDetail.tracks.length === 1}
										<span class="rounded-full bg-purple-950/80 border border-purple-500/50 px-2 py-0.2 text-[9px] font-bold text-purple-300">
											Single Track
										</span>
									{/if}
								</div>

								{#if releaseDetail}
									<!-- Matched MusicBrainz Target Title & Artist -->
									<h2 class="text-xl font-black text-white flex items-center gap-2 truncate" title={releaseDetail.title}>
										{releaseDetail.title}
									</h2>
									<div class="text-sm font-extrabold text-emerald-400 flex items-center gap-1.5 flex-wrap">
										<span>{releaseDetail.artist}</span>
										{#if releaseDetail.release_year}<span>• {releaseDetail.release_year}</span>{/if}
										<span>• {releaseDetail.media_type || 'Digital'}</span>
										<span>• {releaseDetail.tracks.length} {releaseDetail.tracks.length === 1 ? 'track' : 'tracks'}</span>
									</div>
									<div class="text-[11px] text-neutral-400 flex items-center gap-1.5 flex-wrap pt-0.5">
										<span class="text-neutral-500">Source:</span>
										<span class="font-medium text-neutral-300">{currentSourceTitle}</span>
										<span class="text-neutral-600">by</span>
										<span class="{isCurrentArtistUnknown ? 'text-amber-400/90 italic font-semibold' : 'text-neutral-300'}">{currentSourceArtist}</span>
										{#if isCurrentArtistUnknown}
											<span class="text-[10px] text-emerald-300 font-bold bg-emerald-950/80 border border-emerald-500/50 px-1.5 py-0.5 rounded-full">➔ will update to {releaseDetail.artist}</span>
										{/if}
									</div>
								{:else}
									<!-- Default Folder / Album Heading -->
									<h2 class="text-lg font-black text-white truncate">
										{currentSourceTitle}
									</h2>
									<p class="text-xs text-neutral-300 font-medium">
										{currentSourceArtist} {taggerMode === 'albums' ? (selectedAlbum?.release_year ? `(${selectedAlbum.release_year})` : '') : (currentFolderData?.folder_year ? `(${currentFolderData.folder_year})` : '')} • {taggerMode === 'albums' ? selectedAlbum?.track_count : matches.length} tracks
									</p>
								{/if}

								{#if taggerMode === 'folders' && selectedFolderPath}
									<p class="font-mono text-[10px] text-neutral-500 truncate max-w-md pt-0.5" title={selectedFolderPath}>
										📁 {selectedFolderPath}
									</p>
								{/if}
							</div>
						</div>

						<!-- Match Confidence Score & Action Buttons -->
						{#if releaseDetail}
							<div class="flex flex-col items-start lg:items-end gap-2 shrink-0">
								<div class="flex items-center gap-2">
									<span class="rounded-full px-3 py-1 text-xs font-black border {overallScore >= 90 ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300' : overallScore >= 70 ? 'bg-cyan-950/80 border-cyan-500 text-cyan-300' : 'bg-amber-950/80 border-amber-500 text-amber-300'}">
										{overallScore}% Match
									</span>
									<a
										href="https://musicbrainz.org/release/{releaseDetail.id}"
										target="_blank"
										rel="noopener noreferrer"
										class="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-mono font-semibold bg-neutral-900 border border-neutral-700 text-neutral-300 hover:text-purple-300 hover:border-purple-600 transition"
										title="Open release on MusicBrainz.org"
									>
										<span>MBID: {releaseDetail.id.slice(0, 8)}...</span>
										<ExternalLink class="h-2.5 w-2.5 opacity-70" />
									</a>
								</div>

								<!-- Dedicated Artwork Preview Button -->
								<button
									type="button"
									onclick={() => {
										const targetUrl = releaseDetail?.cover_url || currentCoverUrl || '';
										if (targetUrl) {
											openArtworkModal(targetUrl, releaseDetail ? releaseDetail.title : currentSourceTitle, releaseDetail ? releaseDetail.artist : currentSourceArtist, releaseDetail?.cover_url ? 'MusicBrainz Cover Art Archive' : 'Local Folder (cover.jpg)', releaseDetail?.cover_url ? 'musicbrainz' : 'local');
										}
									}}
									class="flex items-center gap-1.5 rounded-xl bg-neutral-800/80 hover:bg-neutral-800 border border-neutral-700 px-3 py-1 text-[11px] font-semibold text-neutral-200 transition cursor-pointer shadow-sm"
								>
									<Eye class="h-3.5 w-3.5 text-emerald-400" />
									<span>Preview Artwork</span>
								</button>
							</div>
						{/if}
					</div>

					<!-- MusicBrainz Query Search Input & MBID Direct Lookup -->
					<div class="pt-4 border-t border-neutral-800/80 flex flex-col sm:flex-row gap-2">
						<div class="relative flex-1">
							<Search class="absolute left-3 top-2.5 h-4 w-4 text-neutral-500" />
							<input
								type="text"
								bind:value={mbSearchQuery}
								onkeydown={(e) => {
									if (e.key === 'Enter') searchMusicBrainzReleases();
								}}
								placeholder="Search release, artist, or paste MBID / URL..."
								class="w-full rounded-xl border border-neutral-700 bg-neutral-950 pl-9 pr-3 py-2 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
							/>
						</div>
						<div class="flex items-center gap-2">
							<button
								type="button"
								onclick={searchMusicBrainzReleases}
								disabled={isSearchingMB}
								class="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 px-4 py-2 text-xs font-bold text-neutral-200 border border-neutral-700 transition disabled:opacity-50 cursor-pointer"
							>
								{#if isSearchingMB}
									<RefreshCw class="h-3.5 w-3.5 animate-spin text-emerald-400" />
									<span>Searching...</span>
								{:else}
									<Search class="h-3.5 w-3.5 text-emerald-400" />
									<span>Search</span>
								{/if}
							</button>

							<button
								type="button"
								onclick={() => {
									mbidError = null;
									mbidInput = '';
									isMbidModalOpen = true;
								}}
								class="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 rounded-xl bg-purple-950/60 hover:bg-purple-900/60 px-3.5 py-2 text-xs font-bold text-purple-300 border border-purple-700/60 transition cursor-pointer"
								title="Find exact album details based on MusicBrainz Release ID (MBID) or URL"
							>
								<Hash class="h-3.5 w-3.5 text-purple-400" />
								<span>Lookup MBID</span>
							</button>
						</div>
					</div>

					<!-- Candidate Releases Selector -->
					{#if candidateReleases.length > 0}
						<div class="space-y-2">
							<div class="flex items-center justify-between text-[11px] text-neutral-400 font-semibold uppercase tracking-wider">
								<span>Select MusicBrainz Release ({candidateReleases.length} candidates):</span>
							</div>

							<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-56 overflow-y-auto pr-1">
								{#each candidateReleases as rel (rel.id)}
									<div
										role="button"
										tabindex="0"
										onclick={() => selectCandidateRelease(rel.id)}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												selectCandidateRelease(rel.id);
											}
										}}
										class="p-2.5 rounded-2xl border text-left flex items-start gap-2.5 transition cursor-pointer select-none {selectedReleaseMbid === rel.id ? 'bg-emerald-950/70 border-emerald-500 shadow-md shadow-emerald-950/60 ring-1 ring-emerald-500' : 'bg-neutral-950/50 border-neutral-800 hover:bg-neutral-800/50 hover:border-neutral-700'}"
									>
										<!-- Release Thumbnail with Zoom Preview -->
										<div class="h-10 w-10 shrink-0 rounded-lg overflow-hidden bg-neutral-900 border border-neutral-800 relative group/thumb">
											{#if rel.cover_url}
												<img src={rel.cover_url} alt={rel.title} class="h-full w-full object-cover" />
												<button
													type="button"
													title="Preview high-res cover"
													onclick={(e) => {
														e.stopPropagation();
														openArtworkModal(rel.cover_url!, rel.title, rel.artist, 'MusicBrainz Candidate Release', 'musicbrainz');
													}}
													class="absolute inset-0 bg-black/60 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center transition cursor-pointer"
												>
													<ZoomIn class="h-3.5 w-3.5 text-white" />
												</button>
											{:else}
												<div class="h-full w-full flex items-center justify-center text-neutral-600">
													<Disc3 class="h-4 w-4" />
												</div>
											{/if}
										</div>

										<div class="min-w-0 flex-1">
											<div class="text-xs font-bold text-white truncate {selectedReleaseMbid === rel.id ? 'text-emerald-300' : ''}">
												{rel.title}
											</div>
											<div class="text-[10px] text-neutral-400 truncate">
												{rel.artist}
											</div>
											<div class="text-[9px] text-neutral-500 flex items-center justify-between gap-1.5 mt-0.5">
												<div class="flex items-center gap-1.5 truncate">
													<span>{rel.media_format || 'CD'}</span>
													{#if rel.year}<span>• {rel.year}</span>{/if}
													{#if rel.track_count}<span>• {rel.track_count} tr</span>{/if}
													{#if rel.country}<span>• {rel.country}</span>{/if}
												</div>
												<span class="font-mono text-[8px] text-neutral-500 opacity-75 shrink-0">{rel.id.slice(0, 8)}</span>
											</div>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>

				<!-- Proactive Write Permission Alert Banner -->
				{#if (taggerMode === 'folders' && currentFolderData?.is_writable === false) || (taggerMode === 'albums' && !albumIsWritable)}
					<div class="rounded-3xl border border-rose-500/50 bg-rose-950/40 p-4 sm:p-5 text-xs text-rose-200 shadow-xl backdrop-blur-xl space-y-2.5">
						<div class="flex items-center gap-2.5">
							<AlertTriangle class="h-5 w-5 text-rose-400 shrink-0" />
							<div>
								<h4 class="font-black text-rose-200 text-sm">File Write Permission Denied (Read-Only)</h4>
								<p class="text-[11px] text-rose-300/90 mt-0.5">
									Trax Vault does not have write access to this {taggerMode === 'folders' ? 'music folder' : 'album files'}. Writing audio tags and saving <code class="font-mono bg-rose-900/60 px-1 py-0.5 rounded text-rose-100">cover.jpg</code> will fail until permissions are granted.
								</p>
							</div>
						</div>
						<div class="rounded-xl bg-neutral-950/80 border border-rose-900/40 p-3 space-y-1">
							<p class="text-[11px] font-bold text-neutral-300">Run this command on your host machine to grant write permissions:</p>
							<div class="font-mono text-[11px] text-amber-300 bg-neutral-900 px-2.5 py-1.5 rounded-lg border border-neutral-800 select-all">
								chmod -R u+rw "{taggerMode === 'folders' ? selectedFolderPath : (albumPermissionPath || './music')}"
							</div>
							<p class="text-[10px] text-neutral-400 mt-1">
								If running inside Docker, also verify that the volume mount in <code class="text-neutral-300">docker-compose.yml</code> is mounted read-write (<code class="text-neutral-300">:rw</code>).
							</p>
						</div>
					</div>
				{/if}

				<!-- Tag Options & Action Toolbar -->
				{#if releaseDetail}
					<div class="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-4 sm:p-5 backdrop-blur-xl shadow-xl space-y-4">
						<div class="flex flex-wrap items-center justify-between gap-4">
							<div class="flex flex-wrap items-center gap-4 text-xs font-medium text-neutral-300">
								<label class="flex items-center gap-2 cursor-pointer select-none">
									<input
										type="checkbox"
										bind:checked={optUpdateCover}
										class="rounded border-neutral-700 text-emerald-600 focus:ring-emerald-500 bg-neutral-950"
									/>
									<span class="flex items-center gap-1">
										<ImageIcon class="h-3.5 w-3.5 text-emerald-400" />
										Download Cover Art
									</span>
								</label>

								<label class="flex items-center gap-2 cursor-pointer select-none">
									<input
										type="checkbox"
										bind:checked={optUpdateAlbumTitle}
										class="rounded border-neutral-700 text-emerald-600 focus:ring-emerald-500 bg-neutral-950"
									/>
									<span>Update Title</span>
								</label>

								<label class="flex items-center gap-2 cursor-pointer select-none">
									<input
										type="checkbox"
										bind:checked={optUpdateArtist}
										class="rounded border-neutral-700 text-emerald-600 focus:ring-emerald-500 bg-neutral-950"
									/>
									<span>Update Artist</span>
								</label>

								<label class="flex items-center gap-2 cursor-pointer select-none">
									<input
										type="checkbox"
										bind:checked={optUpdateYear}
										class="rounded border-neutral-700 text-emerald-600 focus:ring-emerald-500 bg-neutral-950"
									/>
									<span>Update Year</span>
								</label>

								<label class="flex items-center gap-2 cursor-pointer select-none">
									<input
										type="checkbox"
										bind:checked={optRenameFiles}
										class="rounded border-neutral-700 text-emerald-600 focus:ring-emerald-500 bg-neutral-950"
									/>
									<span class="flex items-center gap-1 font-semibold {optRenameFiles ? 'text-emerald-300' : 'text-neutral-400'}">
										<FileText class="h-3.5 w-3.5 text-emerald-400" />
										Rename Files on Disk
									</span>
								</label>

								{#if taggerMode === 'folders'}
									<label class="flex items-center gap-2 cursor-pointer select-none {currentFolderData?.already_in_vault ? 'opacity-70 cursor-not-allowed' : ''}">
										<input
											type="checkbox"
											bind:checked={optImportToVault}
											disabled={currentFolderData?.already_in_vault}
											class="rounded border-neutral-700 text-emerald-600 focus:ring-emerald-500 bg-neutral-950"
										/>
										<span class="flex items-center gap-1 font-bold {optImportToVault ? 'text-emerald-300' : 'text-neutral-400'}">
											<Sparkles class="h-3.5 w-3.5 text-emerald-400" />
											{currentFolderData?.already_in_vault ? 'Already in Vault' : 'Import to Vault Now'}
										</span>
									</label>
								{/if}
							</div>

							<!-- Apply Button -->
							<button
								type="button"
								onclick={applyConfirmedTags}
								disabled={isApplyingTags || selectedCount === 0}
								class="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-500 px-5 py-2.5 text-xs font-black text-white shadow-xl shadow-emerald-600/30 hover:brightness-110 active:scale-95 transition disabled:opacity-50 cursor-pointer"
							>
								{#if isApplyingTags}
									<RefreshCw class="h-4 w-4 animate-spin text-white" />
									<span>Writing Tags to Files...</span>
								{:else}
									<Sparkles class="h-4 w-4 text-emerald-200" />
									{#if taggerMode === 'folders'}
										<span>Write Tags {optRenameFiles ? '& Rename Files' : ''} {optImportToVault && !currentFolderData?.already_in_vault ? '& Import' : ''} ({selectedCount} songs)</span>
									{:else}
										<span>Write Tags {optRenameFiles ? '& Rename Files' : ''} & Library ({selectedCount} songs)</span>
									{/if}
								{/if}
							</button>
						</div>
					</div>
				{/if}

				<!-- Missing Songs Alert Banner (Compact Notice) -->
				{#if releaseDetail && missingTracks.length > 0}
					<div class="rounded-2xl border border-amber-600/50 bg-amber-950/30 p-3.5 backdrop-blur-xl shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
						<div class="flex items-center gap-3 min-w-0">
							<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40">
								<AlertTriangle class="h-4 w-4" />
							</div>
							<div class="min-w-0">
								<div class="flex items-center gap-2">
									<h4 class="text-xs font-bold text-amber-200">
										{missingTracks.length} {missingTracks.length === 1 ? 'Track' : 'Tracks'} Missing from Storage
									</h4>
									<span class="rounded-full bg-amber-900/80 border border-amber-500/50 px-2 py-0.2 text-[9px] font-bold text-amber-300">
										{releaseDetail.tracks.length - missingTracks.length} / {releaseDetail.tracks.length} Paired
									</span>
								</div>
								<p class="text-[11px] text-amber-300/80 truncate mt-0.5">
									Missing release tracks appear as empty drop slots in Column 2. Drag any file from Column 1 onto them to pair.
								</p>
							</div>
						</div>
					</div>
				{/if}

				<!-- 2-Column Tagger Architecture: Storage Files (Col 1) & Dual-Subcolumn Alignment (Col 2) -->
				{#if isLoadingMatches}
					<div class="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-16 text-center text-xs text-neutral-400 backdrop-blur-xl shadow-xl">
						<RefreshCw class="h-6 w-6 animate-spin text-emerald-400 mx-auto mb-2" />
						<span>Querying MusicBrainz and aligning audio tracks...</span>
					</div>
				{:else if matches.length === 0}
					<div class="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-16 text-center text-xs text-neutral-400 backdrop-blur-xl shadow-xl">
						<Tag class="h-6 w-6 text-neutral-600 mx-auto mb-2" />
						<span>No audio files found in this selection.</span>
					</div>
				{:else if !releaseDetail}
					<div class="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-16 text-center text-xs text-neutral-400 backdrop-blur-xl shadow-xl">
						<Tag class="h-6 w-6 text-neutral-600 mx-auto mb-2" />
						<span>Please select a candidate release above to align tracks.</span>
					</div>
				{:else}
					<div class="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start min-w-0">
						<!-- COLUMN 1: Songs You Have in Storage (Left Column, col-span-4) -->
						<div
							class="xl:col-span-4 min-w-0 rounded-3xl border transition-all duration-200 bg-neutral-900/70 backdrop-blur-xl shadow-xl p-4 space-y-3 {isDragOverStorageCol
								? 'ring-2 ring-amber-500 bg-amber-950/40 border-amber-400'
								: 'border-neutral-800'}"
							ondragover={handleDragOver}
							ondragenter={() => (isDragOverStorageCol = true)}
							ondragleave={() => (isDragOverStorageCol = false)}
							ondrop={(e) => {
								e.preventDefault();
								handleDropOnStorageColumn();
							}}
							role="region"
							aria-label="Storage files column"
						>
							<!-- Column 1 Header -->
							<div class="flex items-center justify-between pb-2.5 border-b border-neutral-800/80">
								<div class="flex items-center gap-2 min-w-0">
									<FolderSync class="h-4 w-4 text-emerald-400 shrink-0" />
									<h3 class="text-xs font-bold text-white truncate">1. Files in Storage</h3>
									<span class="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-semibold text-neutral-400 shrink-0">
										{matches.length}
									</span>
								</div>

								<span class="text-[10px] text-neutral-400 shrink-0 font-medium">
									{unmatchedLocalMatches.length} unassigned
								</span>
							</div>

							<!-- Column 1 Subheader Legend -->
							<div class="flex items-center gap-2 px-2 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
								<span class="w-3.5 shrink-0"></span>
								<span class="w-5 shrink-0 text-center">#</span>
								<span class="flex-1 min-w-0 truncate">File Title</span>
								<span class="w-9 text-center shrink-0">Fmt</span>
								<span class="w-9 text-right shrink-0">Time</span>
								<span class="w-12 text-right shrink-0">Slot</span>
							</div>

							<!-- List of Files in Storage (Strict 1-line per song) -->
							<div class="space-y-1 max-h-[75vh] overflow-y-auto pr-1 min-w-0">
								{#each matches as m (m.localTrack.id)}
									{@const isAssigned = Boolean(m.mbTrack)}
									<div
										class="h-9 px-2 py-1 rounded-xl border transition-all duration-150 flex items-center gap-1.5 text-xs select-none cursor-grab active:cursor-grabbing {isAssigned
											? 'bg-neutral-950/70 border-neutral-800/80 hover:border-neutral-700'
											: 'bg-amber-950/20 border-amber-800/60 hover:border-amber-700 text-amber-200'}"
										draggable="true"
										ondragstart={(e) => handleDragStart(e, m.localTrack.id)}
										ondragend={handleDragEnd}
										title={`Drag onto any track in Column 2: ${m.localTrack.title}`}
										role="listitem"
									>
										<GripVertical class="h-3.5 w-3.5 text-neutral-500 shrink-0" />
										<span class="font-mono text-[10px] text-neutral-400 w-5 shrink-0 text-center">
											{m.localTrack.track_number.toString().padStart(2, '0')}
										</span>
										<span class="font-medium text-xs text-neutral-200 truncate flex-1 min-w-0" title={m.localTrack.file_path || m.localTrack.title}>
											{m.localTrack.title}
										</span>
										<span class="text-[9px] font-mono uppercase px-1 py-0.2 rounded bg-neutral-900 border border-neutral-800 text-neutral-400 shrink-0">
											{m.localTrack.format || 'AUDIO'}
										</span>
										<span class="text-[10px] font-mono text-neutral-400 w-9 text-right shrink-0">
											{formatDuration(m.localTrack.duration_ms)}
										</span>

										<!-- Slot indicator -->
										<div class="w-12 flex justify-end shrink-0">
											{#if m.mbTrack}
												<span
													class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-950/80 border border-emerald-600/50 text-emerald-300 truncate"
													title={`Paired with MusicBrainz track: ${m.mbTrack.disc_number > 1 ? `${m.mbTrack.disc_number}-` : ''}${m.mbTrack.track_number}. ${m.mbTrack.title}`}
												>
													➔ {m.mbTrack.disc_number > 1 ? `${m.mbTrack.disc_number}-` : ''}{m.mbTrack.track_number.toString().padStart(2, '0')}
												</span>
											{:else}
												<span class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-950/80 border border-amber-600/50 text-amber-300">
													Free
												</span>
											{/if}
										</div>
									</div>
								{/each}
							</div>

							<!-- Drop target instruction footer -->
							<div class="pt-2 border-t border-neutral-800/80 text-[11px] text-neutral-500 flex items-center justify-between">
								<span>💡 Drag files from here to pair</span>
								<span>Drop here to unpair</span>
							</div>
						</div>

						<!-- COLUMN 2: Album Tag Alignment with 2 Synchronized Subcolumns (Right Column, col-span-8) -->
						<div class="xl:col-span-8 min-w-0 rounded-3xl border border-neutral-800 bg-neutral-900/70 backdrop-blur-xl shadow-xl p-4 space-y-3 flex flex-col">
							<!-- Column 2 Header -->
							<div class="flex flex-col sm:flex-row sm:items-center justify-between pb-2.5 border-b border-neutral-800/80 gap-2">
								<div class="flex items-center gap-2 min-w-0">
									<SlidersHorizontal class="h-4 w-4 text-emerald-400 shrink-0" />
									<h3 class="text-xs font-bold text-white truncate">2. Album Tag Alignment (Release vs Storage)</h3>
									<span class="rounded-full bg-emerald-950/80 border border-emerald-600/50 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 shrink-0">
										{selectedCount} / {releaseDetail.tracks.length} paired
									</span>
								</div>

								<div class="flex items-center gap-3 shrink-0">
									<button
										type="button"
										onclick={toggleSelectAll}
										class="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition font-medium cursor-pointer"
									>
										<CheckCheck class="h-3.5 w-3.5 text-emerald-400" />
										<span>{allSelected ? 'Deselect All' : 'Select All'}</span>
									</button>
								</div>
							</div>

							<!-- Dual Subcolumns Legend Header (Strictly Single Line) -->
							<div class="flex items-center gap-2 px-2 text-[10px] font-bold uppercase tracking-wider text-neutral-500 min-w-0">
								<!-- Subcolumn 1 Header -->
								<div class="flex-1 min-w-0 flex items-center gap-2 truncate">
									<span class="w-4 shrink-0 text-center">✓</span>
									<span class="truncate">Subcolumn 1: Storage File (Assigned)</span>
								</div>
								<!-- Center Match Header -->
								<div class="w-12 text-center shrink-0">Match</div>
								<!-- Subcolumn 2 Header -->
								<div class="flex-1 min-w-0 flex items-center justify-between gap-2 truncate">
									<span class="truncate">Subcolumn 2: MusicBrainz Track (Target)</span>
									<span class="w-10 text-right shrink-0">Time</span>
								</div>
							</div>

							<!-- Paired Rows List (Strict 1-line per row!) -->
							<div class="space-y-4 max-h-[75vh] overflow-y-auto pr-1 min-w-0">
								{#each releaseDiscs as disc (disc.discNumber)}
									<div class="space-y-1 min-w-0">
										<!-- Disc Header if multi-disc release -->
										{#if releaseDiscs.length > 1}
											<div class="flex items-center gap-2 px-2 py-1 text-xs font-bold text-neutral-400 bg-neutral-950/80 rounded-xl border border-neutral-800">
												<Disc3 class="h-3.5 w-3.5 text-purple-400 shrink-0" />
												<span>Disc {disc.discNumber} ({disc.tracks.length} tracks)</span>
											</div>
										{/if}

										<!-- Track Rows in this Disc -->
										{#each disc.tracks as mbTr (mbTr.id)}
											{@const matched = matches.find((m) => m.mbTrack?.id === mbTr.id)}
											{@const isDragTarget = dragOverMbTrackId === mbTr.id}

											<div
												class="h-9 sm:h-10 px-2 py-1 rounded-xl border transition-all duration-150 flex items-center gap-2 text-xs min-w-0 {isDragTarget
													? 'ring-2 ring-emerald-500 bg-emerald-950/60 border-emerald-400 shadow-xl scale-[1.004]'
													: matched
													? (matched.selected ? 'bg-neutral-950/60 border-neutral-800/80 hover:border-neutral-700' : 'bg-neutral-950/30 border-neutral-900 opacity-60')
													: 'bg-amber-950/10 border-dashed border-amber-900/50'}"
												ondragover={handleDragOver}
												ondragenter={() => handleDragEnterMb(mbTr.id)}
												ondragleave={() => handleDragLeaveMb(mbTr.id)}
												ondrop={(e) => {
													e.preventDefault();
													handleDropOnMbTrack(mbTr.id);
												}}
												role="region"
												aria-label="Track slot {mbTr.track_number}"
											>
												<!-- SUBCOLUMN 1: The Local File From Storage (Left Subcolumn) -->
												<div class="flex-1 min-w-0 flex items-center gap-1.5">
													{#if matched}
														<input
															type="checkbox"
															bind:checked={matched.selected}
															class="rounded border-neutral-700 text-emerald-600 focus:ring-emerald-500 bg-neutral-950 cursor-pointer shrink-0"
															title="Include in tag write and rename"
														/>
														<div
															class="cursor-grab active:cursor-grabbing p-0.5 text-neutral-500 hover:text-emerald-400 transition shrink-0 select-none"
															title="Drag to swap with another track slot"
															draggable="true"
															ondragstart={(e) => handleDragStart(e, matched.localTrack.id)}
															ondragend={handleDragEnd}
															role="button"
															tabindex="0"
														>
															<GripVertical class="h-3.5 w-3.5" />
														</div>

														<span class="font-mono text-[10px] text-neutral-400 shrink-0">
															{matched.localTrack.disc_number > 1 ? `${matched.localTrack.disc_number}-` : ''}{matched.localTrack.track_number.toString().padStart(2, '0')}
														</span>

														<span
															class="font-semibold text-xs text-neutral-200 truncate flex-1 min-w-0 cursor-grab active:cursor-grabbing"
															title={matched.localTrack.file_path || matched.localTrack.title}
															draggable="true"
															ondragstart={(e) => handleDragStart(e, matched.localTrack.id)}
															ondragend={handleDragEnd}
															role="button"
															tabindex="0"
														>
															{matched.localTrack.title}
														</span>

														<!-- Inline Disk Rename Indicator if enabled -->
														{#if optRenameFiles}
															{@const preview = getTargetFilenamePreview(matched.localTrack, mbTr, totalReleaseDiscs)}
															{#if preview.willRename}
																<span
																	class="flex items-center gap-0.5 text-[10px] font-mono text-amber-400 bg-amber-950/60 border border-amber-800/50 px-1 py-0.2 rounded shrink-0 cursor-help"
																	title={`Renames on disk to: ${preview.targetName} (and any companion .lrc)`}
																>
																	<FileText class="h-3 w-3" />
																	<span class="text-[9px]">Rename</span>
																</span>
															{/if}
														{/if}

														<span class="text-[10px] font-mono text-neutral-400 shrink-0">
															{formatDuration(matched.localTrack.duration_ms)}
														</span>

														<button
															type="button"
															onclick={() => handleUnpairTrack(matched.localTrack.id)}
															class="p-0.5 rounded text-neutral-500 hover:text-rose-400 hover:bg-neutral-800 transition cursor-pointer shrink-0"
															title="Unpair (move back to storage)"
														>
															<X class="h-3.5 w-3.5" />
														</button>
													{:else}
														<!-- Empty Drop Zone Slot (Missing Song) -->
														<div class="flex-1 min-w-0 h-7 rounded-lg border border-dashed border-neutral-700/80 bg-neutral-950/40 flex items-center justify-center gap-1.5 text-neutral-500 text-[11px] truncate">
															<GripVertical class="h-3 w-3 text-neutral-600 shrink-0" />
															<span class="font-medium truncate">Drop file here to pair</span>
														</div>
													{/if}
												</div>

												<!-- CENTER DIVIDER: Match Status Pill -->
												<div class="w-12 flex items-center justify-center shrink-0">
													{#if matched}
														{#if matched.matchType === 'exact'}
															<span class="rounded bg-emerald-950/80 border border-emerald-600/50 px-1.5 py-0.2 text-[9px] font-bold text-emerald-300">
																100%
															</span>
														{:else if matched.matchType === 'high'}
															<span class="rounded bg-cyan-950/80 border border-cyan-600/50 px-1.5 py-0.2 text-[9px] font-bold text-cyan-300">
																{matched.score}%
															</span>
														{:else}
															<span class="rounded bg-amber-950/80 border border-amber-600/50 px-1.5 py-0.2 text-[9px] font-bold text-amber-300">
																Diff
															</span>
														{/if}
													{:else}
														<span class="rounded bg-amber-950/60 border border-amber-700/50 px-1.5 py-0.2 text-[9px] font-bold text-amber-400">
															Empty
														</span>
													{/if}
												</div>

												<!-- SUBCOLUMN 2: The MusicBrainz Release Track (Right Subcolumn) -->
												<div class="flex-1 min-w-0 flex items-center gap-1.5">
													<span class="font-mono text-[10px] text-emerald-400 font-bold shrink-0">
														{mbTr.disc_number > 1 ? `${mbTr.disc_number}-` : ''}{mbTr.track_number.toString().padStart(2, '0')}.
													</span>
													<span class="font-bold text-xs text-white truncate flex-1 min-w-0" title={mbTr.title}>
														{mbTr.title}
													</span>
													<span class="text-[10px] text-neutral-400 truncate max-w-[110px] shrink-0 hidden sm:inline" title={mbTr.artist || releaseDetail.artist}>
														{mbTr.artist || releaseDetail.artist}
													</span>
													<span class="text-[10px] font-mono text-neutral-400 shrink-0">
														{formatDuration(mbTr.duration_ms)}
													</span>

													<!-- Quick-pair Dropdown Trigger -->
													<div class="shrink-0">
														<select
															value={matched ? matched.localTrack.id : ''}
															onchange={(e) => {
																const val = e.currentTarget.value;
																if (val) {
																	handleAssignLocalIdToMbTrack(parseInt(val, 10), mbTr.id);
																} else if (matched) {
																	handleUnpairTrack(matched.localTrack.id);
																}
															}}
															class="rounded border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 text-[10px] text-neutral-300 focus:outline-none focus:border-emerald-500 max-w-[80px] sm:max-w-[100px] truncate cursor-pointer"
															title="Quick pick storage file for this slot"
														>
															<option value="">{matched ? 'Swap...' : '(Assign)'}</option>
															{#each matches as m (m.localTrack.id)}
																<option value={m.localTrack.id}>
																	{m.localTrack.track_number}. {m.localTrack.title}
																</option>
															{/each}
														</select>
													</div>
												</div>
											</div>
										{/each}
									</div>
								{/each}
							</div>
						</div>
					</div>
				{/if}
			{/if}
		</div>
	</div>

	<!-- MBID Lookup Modal -->
	{#if isMbidModalOpen}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
			role="dialog"
			aria-modal="true"
		>
			<div
				class="relative w-full max-w-lg rounded-3xl border border-neutral-800 bg-neutral-900/95 p-6 shadow-2xl backdrop-blur-xl animate-in zoom-in-95 duration-200"
			>
				<!-- Close button -->
				<button
					type="button"
					onclick={() => (isMbidModalOpen = false)}
					class="absolute right-5 top-5 rounded-full p-2 text-neutral-400 hover:bg-neutral-800 hover:text-white transition cursor-pointer"
					aria-label="Close dialog"
				>
					<X class="h-4 w-4" />
				</button>

				<div class="flex items-center gap-3 mb-4">
					<div
						class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-purple-950/80 border border-purple-500/40 text-purple-300"
					>
						<Hash class="h-5 w-5" />
					</div>
					<div>
						<h3 class="text-base font-bold text-white">Find Album by MusicBrainz ID</h3>
						<p class="text-xs text-neutral-400">Match release details using an exact MBID or MusicBrainz URL</p>
					</div>
				</div>

				<div class="space-y-4">
					<div>
						<label for="mbid-modal-input" class="block text-xs font-semibold text-neutral-300 mb-1.5">
							MusicBrainz Release MBID or URL
						</label>
						<div class="relative">
							<Hash class="absolute left-3.5 top-3 h-4 w-4 text-purple-400" />
							<input
								id="mbid-modal-input"
								type="text"
								bind:value={mbidInput}
								onkeydown={(e) => {
									if (e.key === 'Enter') lookupReleaseByMbid(mbidInput);
								}}
								placeholder="e.g. 31d3ab1e-49dc-434b-bf0b-b43dc0f1d626 or https://musicbrainz.org/release/..."
								class="w-full rounded-xl border border-neutral-700 bg-neutral-950 pl-10 pr-4 py-2.5 text-xs text-white placeholder-neutral-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono"
							/>
						</div>
					</div>

					<!-- Quick fill suggestions -->
					{#if (taggerMode === 'albums' && selectedAlbum?.musicbrainz_id) || (selectedReleaseMbid && selectedReleaseMbid !== mbidInput)}
						<div class="flex flex-wrap items-center gap-2 pt-1">
							<span class="text-[10px] text-neutral-400 font-semibold uppercase tracking-wider">Quick Fill:</span>
							{#if taggerMode === 'albums' && selectedAlbum?.musicbrainz_id}
								<button
									type="button"
									onclick={() => (mbidInput = selectedAlbum.musicbrainz_id!)}
									class="rounded-full bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 px-2.5 py-0.5 text-[10px] font-mono text-purple-300 transition cursor-pointer"
								>
									Vault MBID: {selectedAlbum.musicbrainz_id.slice(0, 8)}...
								</button>
							{/if}
							{#if selectedReleaseMbid}
								<button
									type="button"
									onclick={() => (mbidInput = selectedReleaseMbid!)}
									class="rounded-full bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 px-2.5 py-0.5 text-[10px] font-mono text-emerald-300 transition cursor-pointer"
								>
									Current: {selectedReleaseMbid.slice(0, 8)}...
								</button>
							{/if}
						</div>
					{/if}

					{#if mbidError}
						<div class="flex items-start gap-2.5 rounded-xl border border-rose-500/40 bg-rose-950/30 p-3 text-xs text-rose-300">
							<AlertTriangle class="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
							<div class="flex-1 leading-relaxed">{mbidError}</div>
						</div>
					{/if}

					<div class="rounded-2xl border border-neutral-800/80 bg-neutral-950/60 p-3.5 text-[11px] text-neutral-400 leading-relaxed">
						<div class="font-bold text-neutral-300 mb-1 flex items-center gap-1.5">
							<ExternalLink class="h-3 w-3 text-purple-400" />
							<span>Finding an MBID on MusicBrainz</span>
						</div>
						Visit <a href="https://musicbrainz.org" target="_blank" rel="noopener noreferrer" class="text-purple-400 hover:underline">musicbrainz.org</a>, find your album, and copy either the page URL (e.g. <code>https://musicbrainz.org/release/...</code>) or copy the <strong>Release MBID</strong> UUID.
					</div>

					<div class="flex items-center justify-end gap-2.5 pt-2">
						<button
							type="button"
							onclick={() => (isMbidModalOpen = false)}
							class="rounded-xl border border-neutral-800 bg-neutral-800/60 hover:bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-300 transition cursor-pointer"
						>
							Cancel
						</button>

						<button
							type="button"
							onclick={() => lookupReleaseByMbid(mbidInput)}
							disabled={isLookingUpMbid || !mbidInput.trim()}
							class="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-purple-900/30 transition disabled:opacity-50 cursor-pointer"
						>
							{#if isLookingUpMbid}
								<RefreshCw class="h-3.5 w-3.5 animate-spin" />
								<span>Looking up...</span>
							{:else}
								<Check class="h-3.5 w-3.5" />
								<span>Fetch & Match Release</span>
							{/if}
						</button>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- Full-Size Album Artwork Preview Modal -->
	{#if isArtworkModalOpen}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200"
			role="dialog"
			aria-modal="true"
		>
			<div
				class="relative w-full max-w-2xl rounded-3xl border border-neutral-800 bg-neutral-900/95 p-6 shadow-2xl backdrop-blur-xl animate-in zoom-in-95 duration-200 space-y-4 flex flex-col max-h-[90vh]"
			>
				<!-- Close button -->
				<button
					type="button"
					onclick={() => (isArtworkModalOpen = false)}
					class="absolute right-5 top-5 rounded-full p-2 text-neutral-400 hover:bg-neutral-800 hover:text-white transition cursor-pointer"
					aria-label="Close dialog"
				>
					<X class="h-4 w-4" />
				</button>

				<!-- Modal Header -->
				<div class="flex items-center gap-3 pr-8">
					<div
						class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-950/80 border border-emerald-500/40 text-emerald-300"
					>
						<ImageIcon class="h-5 w-5" />
					</div>
					<div class="min-w-0">
						<h3 class="text-base font-bold text-white truncate">{previewArtworkTitle || currentSourceTitle}</h3>
						<p class="text-xs text-neutral-400 truncate">{previewArtworkSubtitle || currentSourceArtist}</p>
					</div>
				</div>

				<!-- Before / After Segmented Tabs if both local & target cover exist -->
				{#if releaseDetail?.cover_url && currentCoverUrl}
					<div class="flex items-center gap-1 rounded-xl bg-neutral-950 p-1 border border-neutral-800 text-xs font-semibold">
						<button
							type="button"
							onclick={() => (previewArtworkTab = 'musicbrainz')}
							class="flex-1 rounded-lg py-1.5 px-3 transition cursor-pointer flex items-center justify-center gap-1.5 {previewArtworkTab === 'musicbrainz' ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/50 shadow' : 'text-neutral-400 hover:text-white'}"
						>
							<Sparkles class="h-3.5 w-3.5" />
							<span>Target MusicBrainz Cover (CAA)</span>
						</button>
						<button
							type="button"
							onclick={() => (previewArtworkTab = 'local')}
							class="flex-1 rounded-lg py-1.5 px-3 transition cursor-pointer flex items-center justify-center gap-1.5 {previewArtworkTab === 'local' ? 'bg-neutral-800 text-white border border-neutral-700 shadow' : 'text-neutral-400 hover:text-white'}"
						>
							<Folder class="h-3.5 w-3.5" />
							<span>Current Local Cover (cover.jpg)</span>
						</button>
					</div>
				{/if}

				<!-- Image Display Area -->
				<div class="flex-1 min-h-0 flex items-center justify-center rounded-2xl bg-neutral-950/80 border border-neutral-800/80 p-3 overflow-hidden">
					{#if previewArtworkTab === 'local' && currentCoverUrl}
						<img
							src={currentCoverUrl}
							alt={currentSourceTitle}
							class="max-h-[55vh] w-auto max-w-full rounded-xl object-contain shadow-2xl"
						/>
					{:else if previewArtworkUrl || releaseDetail?.cover_url}
						<img
							src={previewArtworkTab === 'local' ? (currentCoverUrl || previewArtworkUrl!) : (previewArtworkUrl || releaseDetail?.cover_url!)}
							alt={previewArtworkTitle}
							class="max-h-[55vh] w-auto max-w-full rounded-xl object-contain shadow-2xl"
						/>
					{:else}
						<div class="flex flex-col items-center justify-center text-neutral-500 py-12 gap-2">
							<ImageIcon class="h-10 w-10 text-neutral-600" />
							<p class="text-xs">No artwork image available to preview</p>
						</div>
					{/if}
				</div>

				<!-- Modal Footer Details & Actions -->
				<div class="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-neutral-800 text-xs">
					<div class="flex items-center gap-2 text-neutral-400 text-[11px]">
						<span class="font-bold text-neutral-300">Source:</span>
						<span>{previewArtworkTab === 'local' ? 'Local Album Folder (cover.jpg)' : previewArtworkSource}</span>
					</div>

					<div class="flex items-center gap-2">
						{#if (previewArtworkTab === 'local' ? currentCoverUrl : (previewArtworkUrl || releaseDetail?.cover_url))}
							<a
								href={previewArtworkTab === 'local' ? currentCoverUrl : (previewArtworkUrl || releaseDetail?.cover_url)}
								target="_blank"
								rel="noopener noreferrer"
								class="flex items-center gap-1.5 rounded-xl border border-neutral-700 bg-neutral-800/70 hover:bg-neutral-800 px-3.5 py-1.5 text-neutral-200 transition text-xs font-semibold"
							>
								<span>Open Original in New Tab</span>
								<ExternalLink class="h-3 w-3 opacity-70" />
							</a>
						{/if}
						<button
							type="button"
							onclick={() => (isArtworkModalOpen = false)}
							class="rounded-xl border border-neutral-800 bg-neutral-800/60 hover:bg-neutral-800 px-4 py-1.5 text-xs font-semibold text-neutral-300 transition cursor-pointer"
						>
							Close
						</button>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>
