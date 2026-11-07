<script lang="ts">
	import type { PageData } from './$types.js';
	import type { Album, ScannedAlbum, ScannedTrack } from '$lib/types/index.js';
	import {
		formatDuration,
		FORMAT_OPTIONS,
		QUALITY_OPTIONS,
		CENSORSHIP_OPTIONS,
		LYRICS_OPTIONS,
		getFormatBadgeClass
	} from '$lib/utils.js';
	import {
		FolderSync,
		Disc,
		Disc3,
		CheckCircle2,
		AlertTriangle,
		ExternalLink,
		Sparkles,
		Layers,
		Check,
		ChevronDown,
		ChevronUp,
		Folder,
		ShieldAlert,
		FileText,
		ArrowRight,
		Search,
		Filter,
		RotateCcw,
		Tag,
		Trash2,
		X
	} from '@lucide/svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import CustomCheckbox from '$lib/components/CustomCheckbox.svelte';
	import { confirmAction, alertAction } from '$lib/services/dialog.svelte.js';

	let { data }: { data: PageData } = $props();

	let libraryPathInput = $state(data.libraryPath);
	let isScanning = $state(false);
	let scannedAlbums = $state<ScannedAlbum[]>(structuredClone(data.albums));
	let vaultAlbums = $state<Album[]>(structuredClone(data.vaultAlbums || []));
	let totalFiles = $state(data.totalFiles);
	let dirExists = $state(data.exists);
	let scannedAt = $state<number | null>(data.scannedAt || null);

	// Merge / Quality Upgrade Modal State
	let mergeModalOpen = $state(false);
	let mergeSourceAlbum = $state<ScannedAlbum | null>(null);
	let mergeMode = $state<'into_vault' | 'scanned_albums'>('into_vault');
	let mergeTargetVaultId = $state<number | null>(null);
	let mergeTargetScannedKey = $state<string>('');
	let mergeOverwriteTags = $state(true);
	let isMerging = $state(false);

	function normKey(str: string): string {
		return (str || '')
			.toLowerCase()
			.replace(/\s*[\(\[][^)\]]*(?:explicit|clean|deluxe|remaster|edition|version|expanded|bonus|anniversary|special|flac|hi-res|24bit|16bit|web)[^)\]]*[\)\]]/gi, '')
			.replace(/[^a-z0-9\u00c0-\u024f]+/g, ' ')
			.trim();
	}

	function findMatchingScannedAlbums(album: ScannedAlbum): ScannedAlbum[] {
		const nTitle = normKey(album.title);
		const nArtist = normKey(album.artist);
		return scannedAlbums.filter(
			(other) =>
				other.album_key !== album.album_key &&
				(other.folder_path === album.folder_path ||
					(normKey(other.title) === nTitle && (normKey(other.artist) === nArtist || nTitle.length > 3)))
		);
	}

	function findMatchingVaultAlbums(album: ScannedAlbum): Album[] {
		const nTitle = normKey(album.title);
		const nArtist = normKey(album.artist);
		return vaultAlbums.filter(
			(va) =>
				va.id === album.existing_album_id ||
				(normKey(va.title) === nTitle && (normKey(va.artist) === nArtist || nTitle.length > 3))
		);
	}

	const duplicateScannedPairs = $derived.by(() => {
		const pairs: Array<{ primary: ScannedAlbum; secondary: ScannedAlbum }> = [];
		const seen = new Set<string>();
		for (const alb of scannedAlbums) {
			if (seen.has(alb.album_key)) continue;
			const matches = findMatchingScannedAlbums(alb);
			if (matches.length > 0) {
				const primary = alb.already_in_vault ? alb : matches.find((m) => m.already_in_vault) || alb;
				const secondary = primary.album_key === alb.album_key ? matches[0] : alb;
				seen.add(primary.album_key);
				seen.add(secondary.album_key);
				pairs.push({ primary, secondary });
			}
		}
		return pairs;
	});

	function openMergeModal(album: ScannedAlbum) {
		mergeSourceAlbum = album;
		const matchingScanned = findMatchingScannedAlbums(album);
		const matchingVault = findMatchingVaultAlbums(album);

		if (matchingScanned.length > 0) {
			mergeTargetScannedKey = matchingScanned[0].album_key;
		} else {
			const otherScanned = scannedAlbums.find((a) => a.album_key !== album.album_key);
			mergeTargetScannedKey = otherScanned?.album_key || '';
		}

		if (matchingVault.length > 0) {
			mergeTargetVaultId = matchingVault[0].id;
		} else {
			mergeTargetVaultId = vaultAlbums[0]?.id ?? null;
		}

		if (matchingScanned.length > 0 && !album.already_in_vault && matchingScanned[0].already_in_vault && matchingScanned[0].existing_album_id) {
			mergeMode = 'into_vault';
			mergeTargetVaultId = matchingScanned[0].existing_album_id;
		} else if (matchingVault.length > 0) {
			mergeMode = 'into_vault';
		} else if (matchingScanned.length > 0) {
			mergeMode = 'scanned_albums';
		} else {
			mergeMode = vaultAlbums.length > 0 ? 'into_vault' : 'scanned_albums';
		}

		mergeOverwriteTags = true;
		mergeModalOpen = true;
	}

	async function executeMerge() {
		if (!mergeSourceAlbum) return;
		isMerging = true;
		try {
			if (mergeMode === 'into_vault') {
				if (!mergeTargetVaultId) {
					await alertAction('Please select a target Vault album to merge into.', 'Warning');
					return;
				}
				const selectedTracks = mergeSourceAlbum.tracks.filter((t) => t.selected);
				const tracksToUse = selectedTracks.length > 0 ? selectedTracks : mergeSourceAlbum.tracks;

				const res = await fetch('/api/library/merge', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						type: 'into_vault',
						targetAlbumId: mergeTargetVaultId,
						sourceAlbumId: mergeSourceAlbum.existing_album_id || undefined,
						scannedAlbumKey: mergeSourceAlbum.album_key,
						tracks: tracksToUse,
						overwriteTags: mergeOverwriteTags,
						coverUrl: mergeSourceAlbum.cover_url,
						musicbrainzId: mergeSourceAlbum.musicbrainz_id,
						year: mergeSourceAlbum.year,
						title: mergeSourceAlbum.title,
						artist: mergeSourceAlbum.artist
					})
				});
				const result = await res.json();
				if (!res.ok) {
					await alertAction(result.error || 'Failed to merge into Vault album.', 'Error');
					return;
				}
				mergeModalOpen = false;
				await invalidateAll();
				await rescan();
				await alertAction(
					`Upgraded ${result.upgradedCount} track(s) and added ${result.insertedCount} new track(s) into "${result.album?.title || 'Vault Album'}".`,
					'Album Merged & Upgraded'
				);
			} else {
				if (!mergeTargetScannedKey) {
					await alertAction('Please select another scanned album to combine with.', 'Warning');
					return;
				}
				const res = await fetch('/api/library/merge', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						type: 'scanned_albums',
						sourceAlbumKey: mergeSourceAlbum.album_key,
						targetAlbumKey: mergeTargetScannedKey
					})
				});
				const result = await res.json();
				if (!res.ok) {
					await alertAction(result.error || 'Failed to merge scanned albums.', 'Error');
					return;
				}
				scannedAlbums = result.albums || scannedAlbums;
				mergeModalOpen = false;
				await invalidateAll();
				await alertAction(
					`Combined into "${result.mergedAlbum?.title || 'Album'}" (${result.mergedAlbum?.track_count || 0} tracks).`,
					'Scanned Albums Combined'
				);
			}
		} catch (err: any) {
			console.error('Merge failed:', err);
			await alertAction(`Merge error: ${err.message || 'Unknown error'}`, 'Error');
		} finally {
			isMerging = false;
		}
	}

	function formatScannedAt(timestamp: number | null): string {
		if (!timestamp) return 'Never scanned';
		const diffSec = Math.floor((Date.now() - timestamp) / 1000);
		if (diffSec < 60) return 'Just now';
		const diffMin = Math.floor(diffSec / 60);
		if (diffMin < 60) return `${diffMin}m ago`;
		const diffHours = Math.floor(diffMin / 60);
		if (diffHours < 24) return `${diffHours}h ago`;
		return new Date(timestamp).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	// Expanded album cards map
	let expandedAlbums = $state<{ [key: string]: boolean }>({});
	let importingAlbumKey = $state<string | null>(null);
	let importedAlbumIds = $state<{ [key: string]: number }>({});
	let isBatchImporting = $state(false);
	let batchProgress = $state({ current: 0, total: 0 });
	let isUnvaulting = $state<string | null>(null);

	const selectedAlbumsToImport = $derived(
		scannedAlbums.filter((a) => !a.already_in_vault && a.tracks.some((t) => t.selected))
	);

	const totalSelectedTracksCount = $derived(
		selectedAlbumsToImport.reduce((sum, a) => sum + a.tracks.filter((t) => t.selected).length, 0)
	);

	// Autocomplete state
	let pathSuggestions = $state<string[]>([]);
	let showSuggestions = $state(false);
	let quickPaths = $state<string[]>(['/music', './music']);
	let autocompleteTimeout: any = null;

	// Local search and filter state for discovered tracks
	let scanSearch = $state('');
	let scanFilter = $state<string>('all');

	// Keep updated if server data changes
	$effect(() => {
		scannedAlbums = structuredClone(data.albums);
		vaultAlbums = structuredClone(data.vaultAlbums || []);
		totalFiles = data.totalFiles;
		dirExists = data.exists;
		libraryPathInput = data.libraryPath;
		scannedAt = data.scannedAt || null;
	});

	// Autocomplete fetcher
	async function fetchSuggestions(pathQuery: string) {
		try {
			const res = await fetch(`/api/library/browse?path=${encodeURIComponent(pathQuery.trim())}`);
			if (res.ok) {
				const result = await res.json();
				pathSuggestions = result.suggestions || [];
				if (result.quickPaths && result.quickPaths.length > 0) {
					quickPaths = result.quickPaths;
				}
			}
		} catch (err) {
			console.error('Failed to fetch path suggestions:', err);
		}
	}

	function handlePathInput() {
		showSuggestions = true;
		clearTimeout(autocompleteTimeout);
		autocompleteTimeout = setTimeout(() => {
			fetchSuggestions(libraryPathInput);
		}, 150);
	}

	function handlePathFocus() {
		showSuggestions = true;
		fetchSuggestions(libraryPathInput);
	}

	function selectPath(pathVal: string, autoScan = false) {
		libraryPathInput = pathVal;
		showSuggestions = false;
		if (autoScan) {
			rescan();
		}
	}

	function toggleExpand(key: string) {
		expandedAlbums[key] = !expandedAlbums[key];
	}

	function toggleAlbumSelected(album: ScannedAlbum) {
		const orig = scannedAlbums.find((a) => a.album_key === album.album_key) || album;
		const nextSelected = !orig.tracks.some((t) => t.selected);
		orig.selected = nextSelected;
		album.selected = nextSelected;
		for (const tr of orig.tracks) {
			tr.selected = nextSelected;
		}
		for (const tr of album.tracks) {
			tr.selected = nextSelected;
		}
	}

	function toggleTrackSelected(album: ScannedAlbum, track: ScannedTrack) {
		const orig = scannedAlbums.find((a) => a.album_key === album.album_key) || album;
		const origTrack = orig.tracks.find((t) => t.file_path === track.file_path) || track;
		track.selected = !track.selected;
		origTrack.selected = track.selected;
		orig.selected = orig.tracks.some((t) => t.selected);
		album.selected = orig.selected;
	}

	function selectAllTracks(album: ScannedAlbum, select: boolean) {
		const orig = scannedAlbums.find((a) => a.album_key === album.album_key) || album;
		orig.selected = select;
		album.selected = select;
		for (const tr of orig.tracks) {
			tr.selected = select;
		}
		for (const tr of album.tracks) {
			tr.selected = select;
		}
	}

	async function rescan() {
		showSuggestions = false;
		isScanning = true;
		try {
			const res = await fetch(`/api/library/scan?force=true&path=${encodeURIComponent(libraryPathInput.trim())}`);
			if (res.ok) {
				const result = await res.json();
				scannedAlbums = result.albums;
				totalFiles = result.totalFiles;
				dirExists = result.exists;
				scannedAt = result.scannedAt || Date.now();
			}
		} catch (err) {
			console.error('Scan failed:', err);
		} finally {
			isScanning = false;
		}
	}

	async function importSingleAlbum(album: ScannedAlbum) {
		const selectedPaths = album.tracks.filter((t) => t.selected).map((t) => t.file_path);
		if (selectedPaths.length === 0) {
			await alertAction('Please select at least one song to import from this album.', 'Warning');
			return;
		}

		importingAlbumKey = album.album_key;
		try {
			const res = await fetch('/api/library/import', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					album,
					selectedTrackPaths: selectedPaths
				})
			});

			if (res.ok) {
				const data = await res.json();
				album.already_in_vault = true;
				importedAlbumIds[album.album_key] = data.albumId;
				await invalidateAll();
			} else {
				await alertAction('Failed to import album. Please verify file access.', 'Error');
			}
		} catch (err) {
			console.error('Import failed:', err);
			await alertAction('Import error occurred', 'Error');
		} finally {
			importingAlbumKey = null;
		}
	}

	async function importAllSelected() {
		const toImport = selectedAlbumsToImport;
		if (toImport.length === 0) {
			await alertAction('No selected albums to import.', 'Warning');
			return;
		}

		isBatchImporting = true;
		batchProgress = { current: 0, total: toImport.length };

		try {
			for (let i = 0; i < toImport.length; i++) {
				const album = toImport[i];
				batchProgress.current = i + 1;
				const selectedPaths = album.tracks.filter((t) => t.selected).map((t) => t.file_path);
				if (selectedPaths.length === 0) continue;

				const res = await fetch('/api/library/import', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						album,
						selectedTrackPaths: selectedPaths
					})
				});

				if (res.ok) {
					const data = await res.json();
					album.already_in_vault = true;
					importedAlbumIds[album.album_key] = data.albumId;
				}
			}
			await invalidateAll();
		} catch (err) {
			console.error('Batch import failed:', err);
			await alertAction('Some albums could not be imported.', 'Error');
		} finally {
			isBatchImporting = false;
		}
	}

	async function unvaultAlbum(album: ScannedAlbum) {
		const albumId = album.existing_album_id || importedAlbumIds[album.album_key];
		if (!albumId) {
			await alertAction('Could not determine album ID in Vault to remove.', 'Warning');
			return;
		}

		const confirmed = await confirmAction({
			title: 'Unvault Album',
			message: `Remove album "${album.title}" from Vault?\n\nAudio files on disk will NOT be deleted, and the album will remain here in the Scanner ready to be imported or re-tagged whenever you want.`,
			confirmText: 'Unvault Album',
			danger: true
		});
		if (!confirmed) return;

		isUnvaulting = album.album_key;
		try {
			const res = await fetch(`/api/albums/${albumId}`, { method: 'DELETE' });
			if (res.ok) {
				const orig = scannedAlbums.find((a) => a.album_key === album.album_key) || album;
				orig.already_in_vault = false;
				orig.existing_album_id = null;
				orig.selected = true;
				for (const t of orig.tracks) {
					t.selected = true;
				}
				album.already_in_vault = false;
				album.existing_album_id = null;
				album.selected = true;
				for (const t of album.tracks) {
					t.selected = true;
				}
				delete importedAlbumIds[album.album_key];
			} else {
				const errData = await res.json().catch(() => ({}));
				await alertAction(`Failed to remove album: ${errData.error || res.statusText}`, 'Error');
			}
		} catch (err: any) {
			console.error('Failed to unvault album:', err);
			await alertAction(`Failed to remove album: ${err.message}`, 'Error');
		} finally {
			isUnvaulting = null;
		}
	}

	async function unvaultAllFiltered() {
		const albumsToUnvault = displayedAlbums.filter((a) => a.already_in_vault && (a.existing_album_id || importedAlbumIds[a.album_key]));
		if (albumsToUnvault.length === 0) return;

		const confirmed = await confirmAction({
			title: 'Unvault Filtered Albums',
			message: `Remove all ${albumsToUnvault.length} filtered albums from the Vault?\n\nAudio files on disk will NOT be deleted and will remain in Library Scanner.`,
			confirmText: `Unvault ${albumsToUnvault.length} Albums`,
			danger: true
		});
		if (!confirmed) return;

		for (const alb of albumsToUnvault) {
			const albumId = alb.existing_album_id || importedAlbumIds[alb.album_key];
			if (albumId) {
				try {
					await fetch(`/api/albums/${albumId}`, { method: 'DELETE' });
					alb.already_in_vault = false;
					alb.existing_album_id = null;
					alb.selected = true;
					for (const t of alb.tracks) t.selected = true;
					const orig = scannedAlbums.find((a) => a.album_key === alb.album_key);
					if (orig) {
						orig.already_in_vault = false;
						orig.existing_album_id = null;
						orig.selected = true;
						for (const t of orig.tracks) t.selected = true;
					}
					delete importedAlbumIds[alb.album_key];
				} catch (err) {
					console.error(`Failed to unvault ${alb.title}:`, err);
				}
			}
		}
	}

	// Filtered view of scanned albums & tracks
	const displayedAlbums = $derived.by(() => {
		const query = scanSearch.trim().toLowerCase();

		return scannedAlbums
			.map((album) => {
				const albumMatchesQuery =
					!query ||
					album.title.toLowerCase().includes(query) ||
					album.artist.toLowerCase().includes(query) ||
					album.folder_path.toLowerCase().includes(query);

				const matchingTracks = album.tracks.filter((t) => {
					// Search query match
					if (query && !albumMatchesQuery) {
						const trTitleMatch = t.title.toLowerCase().includes(query);
						const trArtistMatch = (t.artist || '').toLowerCase().includes(query);
						if (!trTitleMatch && !trArtistMatch) return false;
					}

					// Category filter
					if (scanFilter === 'censored') {
						if (t.censorship !== 'censored') return false;
					} else if (scanFilter === 'missing_lyrics') {
						if (t.lyrics !== 'missing') return false;
					} else if (scanFilter === 'censored_lrc') {
						if (t.lyrics !== 'censored_lrc') return false;
					} else if (scanFilter === 'unsynced_lrc') {
						if (t.lyrics !== 'unsynced_lrc') return false;
					} else if (scanFilter === 'bad_quality') {
						if (t.quality_rating !== 'bad' && t.quality_rating !== 'needs_upgrade') return false;
					} else if (scanFilter === 'not_in_vault') {
						if (album.already_in_vault) return false;
					} else if (scanFilter === 'in_vault') {
						if (!album.already_in_vault) return false;
					}

					return true;
				});

				// Include album if it has matching tracks, or if no category filter and album title matched
				const includeAlbum =
					matchingTracks.length > 0 ||
					(albumMatchesQuery &&
						(scanFilter === 'all' ||
							(scanFilter === 'in_vault' && album.already_in_vault) ||
							(scanFilter === 'not_in_vault' && !album.already_in_vault)));

				return {
					...album,
					visibleTracks: matchingTracks,
					hasFilterMatches: matchingTracks.length > 0,
					includeAlbum
				};
			})
			.filter((a) => a.includeAlbum);
	});

	// Select / Deselect filtered tracks
	function selectAllFiltered(select: boolean) {
		for (const album of displayedAlbums) {
			if (album.already_in_vault) continue;
			for (const track of album.visibleTracks) {
				track.selected = select;
			}
			const origAlbum = scannedAlbums.find((a) => a.album_key === album.album_key);
			if (origAlbum) {
				for (const origTr of origAlbum.tracks) {
					if (album.visibleTracks.some((vt) => vt.file_path === origTr.file_path)) {
						origTr.selected = select;
					}
				}
				origAlbum.selected = origAlbum.tracks.some((t) => t.selected);
				album.selected = origAlbum.selected;
			}
		}
	}
</script>

<svelte:window onclick={(e) => {
	const target = e.target as HTMLElement;
	if (!target.closest('#path-input-container')) {
		showSuggestions = false;
	}
}} />

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<!-- Page Header -->
	<div class="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
		<div>
			<div class="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-400">
				<FolderSync class="h-4 w-4" />
				Music File Scanner
			</div>
			<h1 class="mt-1 text-2xl sm:text-3xl font-black text-white">
				Scan Library & Import Tracks
			</h1>
			<div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
				<span>Scan local files, read metadata and lyrics, and import to your vault.</span>
				{#if scannedAt}
					<span class="inline-flex items-center gap-1.5 rounded-full bg-neutral-900 border border-neutral-800 px-2.5 py-0.5 text-[10px] font-mono text-neutral-300">
						<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981]"></span>
						Snapshot: {formatScannedAt(scannedAt)} ({totalFiles} files)
					</span>
				{/if}
			</div>
		</div>

		<!-- Actions -->
		<div class="flex flex-wrap items-center gap-2">
			{#if selectedAlbumsToImport.length > 0}
				<button
					type="button"
					onclick={importAllSelected}
					disabled={isBatchImporting || isScanning}
					class="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-600/30 transition hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
				>
					{#if isBatchImporting}
						<FolderSync class="h-4 w-4 animate-spin" />
						<span>Importing ({batchProgress.current}/{batchProgress.total})...</span>
					{:else}
						<Check class="h-4 w-4" />
						<span>Import All Selected ({selectedAlbumsToImport.length} albums, {totalSelectedTracksCount} tracks)</span>
					{/if}
				</button>
			{/if}

			<button
				type="button"
				onclick={rescan}
				disabled={isScanning || isBatchImporting}
				class="flex items-center gap-2 rounded-xl bg-neutral-800 px-4 py-2.5 text-xs font-bold text-neutral-200 transition hover:bg-neutral-700 disabled:opacity-50 cursor-pointer"
				title="Run full library scan to discover new audio files on disk"
			>
				<FolderSync class="h-4 w-4 {isScanning ? 'animate-spin text-emerald-400' : ''}" />
				<span>{isScanning ? 'Scanning Library...' : 'Full Scan / Rescan Library'}</span>
			</button>
		</div>
	</div>

	<!-- Live Scanning Progress Alert -->
	{#if isScanning}
		<div class="mb-6 rounded-2xl border border-emerald-500/40 bg-emerald-950/30 p-4 sm:p-5 text-xs text-emerald-200 flex items-center gap-3.5 shadow-xl animate-pulse">
			<FolderSync class="h-6 w-6 text-emerald-400 animate-spin shrink-0" />
			<div class="flex-1">
				<div class="font-bold text-white text-sm">Full Library Rescan in Progress...</div>
				<p class="text-neutral-300 mt-0.5">
					Trax Vault is walking your music directory, extracting audio metadata and bitrates, and finding companion lyrics. Your library will refresh automatically.
				</p>
			</div>
		</div>
	{/if}

	<!-- MusicBrainz Tagger Studio Helper Banner -->
	<div class="mb-6 rounded-2xl border border-emerald-900/60 bg-gradient-to-r from-emerald-950/40 via-neutral-900/50 to-neutral-900/40 p-4 sm:p-5 backdrop-blur-md shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
		<div class="flex items-start gap-3.5">
			<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-950/80 border border-emerald-500/40 text-emerald-400">
				<Tag class="h-5 w-5" />
			</div>
			<div class="text-xs leading-relaxed">
				<div class="flex items-center gap-2">
					<h3 class="font-bold text-white text-sm">Need to tag or identify unknown audio files?</h3>
					<span class="rounded-md bg-emerald-900/60 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-300 uppercase tracking-wider">
						Tagger Studio
					</span>
				</div>
				<p class="text-neutral-400 mt-1">
					Use Trax Vault's native MusicBrainz Tagger to search official releases, align tracks, download high-res artwork, and write embedded tags directly to your library.
				</p>
			</div>
		</div>
		<a
			href="/tagger"
			class="shrink-0 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-600/30 hover:bg-emerald-500 transition active:scale-95"
		>
			<Tag class="h-4 w-4" />
			<span>Open Tagger Studio</span>
		</a>
	</div>

	{#if duplicateScannedPairs.length > 0}
		<div class="mb-6 rounded-2xl border border-amber-500/40 bg-amber-950/25 p-4 sm:p-5 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
			<div class="flex items-start gap-3.5">
				<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-950/80 border border-amber-500/40 text-amber-400">
					<Layers class="h-5 w-5" />
				</div>
				<div class="text-xs leading-relaxed">
					<div class="flex items-center gap-2">
						<h3 class="font-bold text-white text-sm">
							{duplicateScannedPairs.length} Duplicate / Upgraded Album{duplicateScannedPairs.length > 1 ? 's' : ''} Detected
						</h3>
						<span class="rounded-md bg-amber-900/60 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold text-amber-300 uppercase tracking-wider">
							Quality Upgrade Ready
						</span>
					</div>
					<p class="text-neutral-300 mt-1">
						We detected albums with matching titles (e.g. <strong class="text-white">{duplicateScannedPairs[0].primary.title}</strong>). Use <strong class="text-amber-300">Merge / Upgrade</strong> to combine them and upgrade existing Vault tracks in-place without losing play counts or playlists.
					</p>
				</div>
			</div>
			<button
				type="button"
				onclick={() => openMergeModal(duplicateScannedPairs[0].secondary)}
				class="shrink-0 flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-amber-600/30 hover:bg-amber-500 transition active:scale-95 cursor-pointer"
			>
				<Layers class="h-4 w-4" />
				<span>Merge / Upgrade "{duplicateScannedPairs[0].secondary.title}"</span>
			</button>
		</div>
	{/if}

	<!-- Library Path Configuration Box with Autocomplete -->
	<div class="mb-8 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 sm:p-5">
		<div class="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
			<div id="path-input-container" class="relative flex-1 w-full">
				<div class="flex items-center gap-3">
					<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-800 text-emerald-400">
						<Folder class="h-5 w-5" />
					</div>
					<div class="min-w-0 flex-1">
						<label class="block text-xs font-semibold text-neutral-300">
							Server Music Directory Path
						</label>
						<div class="relative mt-1">
							<input
								type="text"
								bind:value={libraryPathInput}
								oninput={handlePathInput}
								onfocus={handlePathFocus}
								onkeydown={(e) => {
									if (e.key === 'Enter') {
										rescan();
									}
								}}
								placeholder="/music or ./music"
								class="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs font-mono text-neutral-200 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
							/>

							<!-- Autocomplete Dropdown Menu -->
							{#if showSuggestions && pathSuggestions.length > 0}
								<div class="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl divide-y divide-neutral-800">
									<div class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400 bg-neutral-950/60">
										Matching System Folders:
									</div>
									{#each pathSuggestions as suggestion}
										<button
											type="button"
											onclick={() => selectPath(suggestion)}
											class="w-full text-left px-3 py-2 text-xs font-mono text-neutral-300 hover:bg-emerald-950/60 hover:text-emerald-300 flex items-center justify-between transition"
										>
											<span class="truncate">{suggestion}</span>
											<span class="text-[10px] text-neutral-500 ml-2 shrink-0">Select</span>
										</button>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				</div>

				<!-- Quick Path Badges -->
				<div class="mt-2.5 flex flex-wrap items-center gap-1.5 pl-13">
					<span class="text-[11px] text-neutral-500">Quick folders:</span>
					{#each quickPaths as qPath}
						<button
							type="button"
							onclick={() => selectPath(qPath, true)}
							class="rounded-md bg-neutral-800/90 px-2 py-0.5 text-[11px] font-mono text-neutral-300 hover:bg-emerald-900/60 hover:text-emerald-300 border border-neutral-700/60 transition"
						>
							{qPath}
						</button>
					{/each}
				</div>
			</div>

			<!-- Status indicator on right -->
			<div class="text-xs text-neutral-400 sm:text-right shrink-0">
				{#if dirExists}
					<span class="inline-flex items-center gap-1 text-emerald-400 font-semibold">
						<CheckCircle2 class="h-3.5 w-3.5" />
						Directory Connected
					</span>
					<p class="text-[11px] text-neutral-500 mt-0.5">{totalFiles} audio files discovered</p>
				{:else}
					<span class="inline-flex items-center gap-1 text-amber-400 font-semibold">
						<AlertTriangle class="h-3.5 w-3.5" />
						Directory not found
					</span>
					<p class="text-[11px] text-neutral-500 mt-0.5">Mount folder in Docker or pick an existing directory</p>
				{/if}
			</div>
		</div>
	</div>

	<!-- Scanned Albums & Tracks List -->
	{#if scannedAlbums.length > 0}
		<div class="space-y-4">
			<!-- Header & Local Search / Filter Toolbar -->
			<div class="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 shadow-sm">
				<div class="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
					<!-- Local search input -->
					<div class="relative flex-1 max-w-md">
						<Search class="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
						<input
							type="text"
							bind:value={scanSearch}
							placeholder="Filter discovered songs or albums..."
							class="w-full rounded-xl border border-neutral-700 bg-neutral-950 pl-10 pr-4 py-1.5 text-xs text-neutral-200 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
						/>
					</div>

					<!-- Filter Pills -->
					<div class="flex flex-wrap items-center gap-1.5">
						<button
							type="button"
							onclick={() => (scanFilter = 'all')}
							class="rounded-lg px-2.5 py-1 text-xs font-semibold transition {scanFilter === 'all' ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30' : 'bg-neutral-800 text-neutral-400 hover:text-white'}"
						>
							All
						</button>
						<button
							type="button"
							onclick={() => (scanFilter = 'censored')}
							class="rounded-lg px-2.5 py-1 text-xs font-semibold transition {scanFilter === 'censored' ? 'bg-rose-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-white'}"
						>
							Censored
						</button>
						<button
							type="button"
							onclick={() => (scanFilter = 'missing_lyrics')}
							class="rounded-lg px-2.5 py-1 text-xs font-semibold transition {scanFilter === 'missing_lyrics' ? 'bg-amber-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-white'}"
						>
							Missing Lyrics
						</button>
						<button
							type="button"
							onclick={() => (scanFilter = 'unsynced_lrc')}
							class="rounded-lg px-2.5 py-1 text-xs font-semibold transition {scanFilter === 'unsynced_lrc' ? 'bg-amber-700 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-white'}"
						>
							Unsynced LRC
						</button>
						<button
							type="button"
							onclick={() => (scanFilter = 'censored_lrc')}
							class="rounded-lg px-2.5 py-1 text-xs font-semibold transition {scanFilter === 'censored_lrc' ? 'bg-orange-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-white'}"
						>
							Censored LRC
						</button>
						<button
							type="button"
							onclick={() => (scanFilter = 'bad_quality')}
							class="rounded-lg px-2.5 py-1 text-xs font-semibold transition {scanFilter === 'bad_quality' ? 'bg-rose-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-white'}"
						>
							Bad Quality
						</button>
						<button
							type="button"
							onclick={() => (scanFilter = 'not_in_vault')}
							class="rounded-lg px-2.5 py-1 text-xs font-semibold transition {scanFilter === 'not_in_vault' ? 'bg-teal-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-white'}"
						>
							Not In Vault
						</button>
						<button
							type="button"
							onclick={() => (scanFilter = 'in_vault')}
							class="rounded-lg px-2.5 py-1 text-xs font-semibold transition {scanFilter === 'in_vault' ? 'bg-emerald-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-white'}"
						>
							In Vault
						</button>
					</div>

					<!-- Selection shortcuts -->
					<div class="flex items-center gap-2 border-t md:border-t-0 md:border-l border-neutral-800 pt-2 md:pt-0 md:pl-3 text-xs">
						<button
							type="button"
							onclick={() => selectAllFiltered(true)}
							class="text-emerald-400 hover:underline font-semibold"
						>
							Select Filtered
						</button>
						<span class="text-neutral-600">•</span>
						<button
							type="button"
							onclick={() => selectAllFiltered(false)}
							class="text-neutral-400 hover:underline font-semibold"
						>
							Deselect Filtered
						</button>
					</div>
				</div>

				<div class="mt-2.5 flex items-center justify-between text-[11px] text-neutral-400">
					<span>
						Showing <strong class="text-white font-bold">{displayedAlbums.length}</strong> of {scannedAlbums.length} albums
					</span>
					{#if scanFilter === 'in_vault' && displayedAlbums.some((a) => a.already_in_vault)}
						<button
							type="button"
							onclick={unvaultAllFiltered}
							class="text-xs font-bold text-rose-400 hover:text-rose-300 transition"
						>
							Remove All Filtered from Vault ({displayedAlbums.filter((a) => a.already_in_vault).length} albums) →
						</button>
					{:else if selectedAlbumsToImport.length > 0}
						<button
							type="button"
							onclick={importAllSelected}
							disabled={isBatchImporting}
							class="text-xs font-bold text-emerald-400 hover:text-emerald-300 transition"
						>
							Import All Selected ({selectedAlbumsToImport.length} albums) →
						</button>
					{/if}
				</div>
			</div>

			{#each displayedAlbums as album (album.album_key)}
				{@const isExpanded = !!expandedAlbums[album.album_key]}
				{@const selectedCount = album.tracks.filter((t) => t.selected).length}
				{@const isAlbumSelected = selectedCount > 0}
				{@const isImporting = importingAlbumKey === album.album_key}

				<div class="rounded-2xl border border-neutral-800 bg-neutral-900/50 shadow-md transition hover:border-neutral-700 {album.already_in_vault ? 'opacity-85' : ''}">
					<!-- Album Card Header -->
					<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4">
						<div class="flex items-center gap-4 min-w-0 flex-1">
							<!-- Checkbox for entire album -->
							<CustomCheckbox
								checked={isAlbumSelected}
								disabled={album.already_in_vault}
								title="Select all tracks in this album"
								onchange={() => toggleAlbumSelected(album)}
							/>

							<!-- Cover Art & Titles (Click anywhere on the album to show/hide songs) -->
							<div
								role="button"
								tabindex="0"
								onclick={() => toggleExpand(album.album_key)}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										toggleExpand(album.album_key);
									}
								}}
								class="flex items-center gap-4 min-w-0 flex-1 cursor-pointer select-none group/album-header"
								title="Click to {isExpanded ? 'hide' : 'show'} songs in this album"
							>
								<!-- Cover Art / Thumbnail -->
								<div class="relative aspect-square h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-neutral-950 border border-neutral-800 transition duration-150 group-hover/album-header:border-emerald-500/50">
									{#if album.cover_url}
										<img
											src={album.cover_url}
											alt={album.title}
											class="h-full w-full object-cover"
											onerror={(e) => {
												(e.currentTarget as HTMLElement).style.display = 'none';
											}}
										/>
									{:else}
										<div class="flex h-full w-full items-center justify-center text-neutral-600">
											<Disc class="h-8 w-8 opacity-40 group-hover/album-header:scale-110 transition" />
										</div>
									{/if}
								</div>

								<!-- Album & Artist Title -->
								<div class="min-w-0 flex-1">
									<div class="flex flex-wrap items-center gap-2">
										<h3 class="truncate text-base font-bold text-white group-hover/album-header:text-emerald-300 transition" title={album.title}>
											{album.title}
										</h3>

										{#if album.already_in_vault}
											<span class="inline-flex items-center gap-1 rounded-full bg-emerald-950/80 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 border border-emerald-700/60">
												<Check class="h-3 w-3" />
												In Vault
											</span>
										{/if}

										{#if findMatchingScannedAlbums(album).length > 0 || (!album.already_in_vault && findMatchingVaultAlbums(album).length > 0)}
											<button
												type="button"
												onclick={(e) => {
													e.stopPropagation();
													openMergeModal(album);
												}}
												class="inline-flex items-center gap-1 rounded-full bg-amber-950/80 px-2 py-0.5 text-[10px] font-semibold text-amber-300 border border-amber-600/60 hover:bg-amber-900/80 hover:text-white transition cursor-pointer"
												title="Matching album found — click to merge or upgrade audio quality"
											>
												<Layers class="h-3 w-3" />
												Duplicate / Upgrade Ready
											</button>
										{/if}

										{#if album.musicbrainz_id}
											<a
												href="https://musicbrainz.org/release/{album.musicbrainz_id}"
												target="_blank"
												rel="noreferrer"
												onclick={(e) => e.stopPropagation()}
												class="inline-flex items-center gap-1 rounded bg-emerald-950/60 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 border border-emerald-700/50 hover:text-white"
												title="MusicBrainz Album ID detected in song tags"
											>
												<Sparkles class="h-3 w-3" />
												MBID: {album.musicbrainz_id.substring(0, 8)}...
												<ExternalLink class="h-2.5 w-2.5" />
											</a>
										{/if}
									</div>

									<p class="truncate text-xs font-medium text-neutral-300 mt-0.5">
										{album.artist}
									</p>

									<div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
										<span>{album.year || 'Unknown Year'}</span>
										<span>•</span>
										<span class="font-medium text-emerald-400">{selectedCount} of {album.track_count} songs selected</span>
										<span>•</span>
										<span class="text-neutral-500 flex items-center gap-1 group-hover/album-header:text-emerald-400 transition">
											{#if isExpanded}
												<ChevronUp class="h-3 w-3" />
												<span>Click to hide songs</span>
											{:else}
												<ChevronDown class="h-3 w-3" />
												<span>Click to show songs</span>
											{/if}
										</span>
									</div>
								</div>
							</div>
						</div>

						<!-- Action Controls -->
						<div class="flex flex-wrap items-center gap-2 sm:justify-end">
							<button
								type="button"
								onclick={() => openMergeModal(album)}
								class="flex items-center gap-1.5 rounded-xl bg-neutral-800/80 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-950/60 hover:text-amber-200 border border-neutral-700/60 hover:border-amber-600/50 transition cursor-pointer"
								title="Merge with another album or upgrade existing Vault album tracks"
							>
								<Layers class="h-3.5 w-3.5" />
								<span>Merge / Upgrade</span>
							</button>

							<a
								href="/tagger?folderPath={encodeURIComponent(album.folder_path)}"
								class="flex items-center gap-1.5 rounded-xl bg-neutral-800/80 px-3 py-2 text-xs font-semibold text-emerald-400 hover:bg-neutral-700 hover:text-emerald-300 border border-neutral-700/60 transition"
								title="Tag audio files with MusicBrainz before or after import"
							>
								<Tag class="h-3.5 w-3.5" />
								<span>Tag</span>
							</a>

							<button
								type="button"
								onclick={() => toggleExpand(album.album_key)}
								class="flex items-center gap-1.5 rounded-xl bg-neutral-800/80 px-3 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-700 hover:text-white transition"
								title="{isExpanded ? 'Hide' : 'Show'} songs"
							>
								<span>{isExpanded ? 'Hide Songs' : 'Show Songs'} ({selectedCount})</span>
								{#if isExpanded}
									<ChevronUp class="h-4 w-4" />
								{:else}
									<ChevronDown class="h-4 w-4" />
								{/if}
							</button>

							{#if album.already_in_vault}
								{@const vaultId = album.existing_album_id || importedAlbumIds[album.album_key]}
								<div class="flex items-center gap-1.5">
									{#if vaultId}
										<a
											href="/album/{vaultId}"
											class="flex items-center gap-1 rounded-xl bg-neutral-800/80 px-3 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-700 hover:text-white transition border border-neutral-700/60"
											title="View album in Vault"
										>
											<span>In Vault</span>
											<ArrowRight class="h-3 w-3 text-emerald-400" />
										</a>
									{:else}
										<span class="rounded-xl bg-neutral-800/80 px-3 py-2 text-xs font-semibold text-neutral-400 border border-neutral-700/60">
											In Vault
										</span>
									{/if}

									<button
										type="button"
										onclick={() => unvaultAlbum(album)}
										disabled={isUnvaulting === album.album_key}
										class="flex items-center gap-1 rounded-xl bg-rose-950/40 hover:bg-rose-950/80 px-3 py-2 text-xs font-semibold text-rose-300 border border-rose-800/50 hover:border-rose-600 transition disabled:opacity-50"
										title="Remove album from Vault (keeps audio files on disk)"
									>
										<Trash2 class="h-3.5 w-3.5 text-rose-400" />
										<span>{isUnvaulting === album.album_key ? 'Removing...' : 'Remove'}</span>
									</button>
								</div>
							{:else}
								<button
									type="button"
									onclick={() => importSingleAlbum(album)}
									disabled={isImporting || selectedCount === 0}
									class="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-xs font-bold text-white shadow-md shadow-emerald-600/30 transition disabled:opacity-50"
								>
									<Check class="h-3.5 w-3.5" />
									<span>{isImporting ? 'Importing...' : 'Add Selected'}</span>
								</button>
							{/if}
						</div>
					</div>

					<!-- Expandable Tracklist Table -->
					{#if isExpanded}
						<div class="border-t border-neutral-800/80 bg-neutral-950/70 p-4">
							<div class="mb-3 flex items-center justify-between text-xs">
								<div class="flex items-center gap-2">
									<span class="font-semibold text-neutral-300">Choose Songs to Track:</span>
									<button
										type="button"
										onclick={() => selectAllTracks(album, true)}
										class="text-emerald-400 hover:underline font-medium"
									>
										Select All
									</button>
									<span>•</span>
									<button
										type="button"
										onclick={() => selectAllTracks(album, false)}
										class="text-neutral-400 hover:underline font-medium"
									>
										Deselect All
									</button>
								</div>
							</div>

							<div class="divide-y divide-neutral-800/50 rounded-xl border border-neutral-800 overflow-hidden bg-neutral-950">
								{#each album.visibleTracks as track}
									<div class="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 p-2.5 text-xs transition hover:bg-neutral-900/60 {track.selected ? '' : 'opacity-50 bg-neutral-900/10'}">
										<!-- Track Selection Checkbox & Info -->
										<div class="flex items-center gap-3 min-w-0 flex-1">
											<CustomCheckbox
												checked={track.selected}
												title="Select track to import"
												onchange={() => toggleTrackSelected(album, track)}
											/>

											<span class="w-6 text-right font-mono text-neutral-500 text-[11px]">
												{track.track_number}
											</span>

											<div class="min-w-0 flex-1">
												<div class="flex items-center gap-2">
													<span class="truncate font-semibold text-neutral-100" title={track.title}>
														{track.title}
													</span>
													{#if track.musicbrainz_track_id}
														<span class="rounded bg-neutral-800/80 px-1 text-[9px] font-mono text-neutral-400" title="MB Track ID">
															MB
														</span>
													{/if}
												</div>

												<div class="flex items-center gap-2 text-[11px] text-neutral-400">
													{#if track.artist !== album.artist}
														<span class="truncate text-neutral-400">{track.artist}</span>
														<span>•</span>
													{/if}
													<span class="font-mono text-neutral-500">{formatDuration(track.duration_ms)}</span>
													{#if track.bitrate_kbps}
														<span>•</span>
														<span class="text-neutral-500">{track.bitrate_kbps} kbps</span>
													{/if}
												</div>
											</div>
										</div>

										<!-- Badges & Overrides -->
										<div class="flex flex-wrap items-center gap-2">
											<!-- Format Dropdown -->
											<select
												bind:value={track.format}
												class="rounded-lg border px-2 py-0.5 text-[11px] font-semibold uppercase {getFormatBadgeClass(track.format)}"
												title="Detected audio format (click to change)"
											>
												{#each FORMAT_OPTIONS as opt}
													<option value={opt.value} class="bg-neutral-900 text-neutral-200">
														{opt.label}
													</option>
												{/each}
											</select>

											<!-- Quality Dropdown -->
											<select
												bind:value={track.quality_rating}
												class="rounded-lg border px-2 py-0.5 text-[11px] font-medium {QUALITY_OPTIONS.find(q => q.value === track.quality_rating)?.color}"
												title="Audio quality"
											>
												{#each QUALITY_OPTIONS as q}
													<option value={q.value} class="bg-neutral-900 text-neutral-200">
														{q.label}
													</option>
												{/each}
											</select>

											<!-- Censorship Dropdown -->
											<select
												bind:value={track.censorship}
												class="rounded-lg border px-2 py-0.5 text-[11px] font-medium {CENSORSHIP_OPTIONS.find(c => c.value === track.censorship)?.color}"
												title="Censorship status"
											>
												{#each CENSORSHIP_OPTIONS as c}
													<option value={c.value} class="bg-neutral-900 text-neutral-200">
														{c.label}
													</option>
												{/each}
											</select>

											<!-- Lyrics Dropdown & Source Badge -->
											<div class="inline-flex items-center gap-1">
												<select
													bind:value={track.lyrics}
													class="rounded-lg border px-2 py-0.5 text-[11px] font-medium {LYRICS_OPTIONS.find(l => l.value === track.lyrics)?.color}"
													title="Lyrics status (.lrc file detected, unsynced, or missing)"
												>
													{#each LYRICS_OPTIONS as l}
														<option value={l.value} class="bg-neutral-900 text-neutral-200">
															{l.label}
														</option>
													{/each}
												</select>
												{#if track.has_lrc_file}
													<span class="text-[10px] text-emerald-400 font-mono bg-emerald-950/50 border border-emerald-800/50 rounded px-1.5 py-0.5" title="Companion .lrc file in album directory">.lrc file</span>
												{:else if track.has_txt_file}
													<span class="text-[10px] text-sky-400 font-mono bg-sky-950/50 border border-sky-800/50 rounded px-1.5 py-0.5" title="Companion .txt file in album directory">.txt file</span>
												{:else if track.has_embedded_lyrics}
													<span class="text-[10px] text-amber-400 font-mono bg-amber-950/50 border border-amber-800/50 rounded px-1.5 py-0.5" title="Embedded in audio tags">embedded</span>
												{/if}
											</div>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{:else}
		<!-- Empty State / Setup Instructions -->
		<div class="rounded-3xl border border-dashed border-neutral-800 bg-neutral-900/30 p-12 text-center">
			<FolderSync class="mx-auto h-12 w-12 text-emerald-400 mb-3 opacity-60" />
			<h3 class="text-lg font-bold text-white">No Audio Files Found in Library Path</h3>
			<p class="mt-1 text-xs text-neutral-400 max-w-md mx-auto">
				We couldn't find audio files (.flac, .mp3, .m4a, etc.) at <code class="text-emerald-300 font-mono">{libraryPathInput}</code>.
			</p>

			<div class="mt-6 max-w-lg mx-auto rounded-2xl border border-neutral-800 bg-neutral-950 p-4 text-left text-xs text-neutral-400 space-y-2">
				<p class="font-bold text-neutral-200">How to mount your music library in Docker:</p>
				<p>1. Open <code class="text-emerald-300 font-mono">docker-compose.yml</code></p>
				<p>2. Add your server music folder under volumes:</p>
				<pre class="bg-neutral-900 p-2.5 rounded-lg text-emerald-400 font-mono text-[11px] overflow-x-auto">
volumes:
  - ./data:/app/data
  - /media/Music:/music:ro</pre>
				<p>3. Run <code class="text-emerald-300 font-mono">docker-compose up -d</code> and your entire music collection will appear here instantly!</p>
			</div>
		</div>
	{/if}
</div>

<!-- Merge & Quality Upgrade Modal -->
{#if mergeModalOpen && mergeSourceAlbum}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
		role="dialog"
		aria-modal="true"
	>
		<div class="w-full max-w-xl rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl overflow-hidden">
			<!-- Modal Header -->
			<div class="flex items-center justify-between border-b border-neutral-800 bg-neutral-950/60 px-5 py-4">
				<div class="flex items-center gap-2.5">
					<div class="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-950/80 border border-amber-500/40 text-amber-400">
						<Layers class="h-4.5 w-4.5" />
					</div>
					<div>
						<h3 class="text-sm font-bold text-white">Merge & Quality Upgrade Album</h3>
						<p class="text-[11px] text-neutral-400">
							Combine split albums or upgrade audio files in your Vault without losing play history
						</p>
					</div>
				</div>
				<button
					type="button"
					onclick={() => (mergeModalOpen = false)}
					class="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white transition cursor-pointer"
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<div class="p-5 space-y-4 text-xs">
				<!-- Source Album Card -->
				<div class="rounded-xl border border-neutral-800 bg-neutral-950/80 p-3.5">
					<div class="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1">
						Source Scanned Album
					</div>
					<div class="font-bold text-white text-sm">{mergeSourceAlbum.title}</div>
					<div class="text-neutral-300 mt-0.5">
						{mergeSourceAlbum.artist} • {mergeSourceAlbum.track_count} tracks
					</div>
					<div class="text-[11px] font-mono text-neutral-500 mt-1 truncate">
						{mergeSourceAlbum.folder_path}
					</div>
				</div>

				<!-- Mode Selector -->
				<div class="grid grid-cols-2 gap-2">
					<button
						type="button"
						onclick={() => (mergeMode = 'into_vault')}
						class="rounded-xl border p-3 text-left transition cursor-pointer {mergeMode === 'into_vault'
							? 'border-emerald-500/60 bg-emerald-950/30 text-white'
							: 'border-neutral-800 bg-neutral-950/50 text-neutral-400 hover:text-neutral-200'}"
					>
						<div class="font-bold text-xs flex items-center gap-1.5">
							<Sparkles class="h-3.5 w-3.5 text-emerald-400" />
							<span>Upgrade Vault Album</span>
						</div>
						<p class="text-[11px] text-neutral-400 mt-1">
							Replace/upgrade audio files in an existing Vault album in-place.
						</p>
					</button>

					<button
						type="button"
						onclick={() => (mergeMode = 'scanned_albums')}
						class="rounded-xl border p-3 text-left transition cursor-pointer {mergeMode === 'scanned_albums'
							? 'border-amber-500/60 bg-amber-950/30 text-white'
							: 'border-neutral-800 bg-neutral-950/50 text-neutral-400 hover:text-neutral-200'}"
					>
						<div class="font-bold text-xs flex items-center gap-1.5">
							<Layers class="h-3.5 w-3.5 text-amber-400" />
							<span>Combine Scanned Albums</span>
						</div>
						<p class="text-[11px] text-neutral-400 mt-1">
							Merge two split albums in Scanner, keeping the highest quality tracks.
						</p>
					</button>
				</div>

				{#if mergeMode === 'into_vault'}
					<div class="space-y-3">
						<div>
							<label for="merge-target-vault" class="block text-xs font-semibold text-neutral-300 mb-1.5">
								Target Vault Album to Upgrade
							</label>
							{#if vaultAlbums.length > 0}
								<select
									id="merge-target-vault"
									bind:value={mergeTargetVaultId}
									class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
								>
									{#each vaultAlbums as va (va.id)}
										<option value={va.id}>
											{va.title} — {va.artist} ({va.track_count} tracks{va.release_year ? `, ${va.release_year}` : ''})
										</option>
									{/each}
								</select>
							{:else}
								<div class="rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-neutral-400">
									No albums are currently in your Vault. Switch to "Combine Scanned Albums" or import an album first.
								</div>
							{/if}
						</div>

						<label class="flex items-center gap-2.5 cursor-pointer select-none text-neutral-300">
							<input
								type="checkbox"
								bind:checked={mergeOverwriteTags}
								class="rounded border-neutral-700 bg-neutral-950 text-emerald-500 focus:ring-emerald-500"
							/>
							<span>Update album metadata & cover art from scanned files</span>
						</label>

						<div class="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-3 text-[11px] text-neutral-300 leading-relaxed">
							Tracks are matched by track number or song title. Format, bitrate, quality rating, and file paths are upgraded in-place while preserving play counts, playlists, starred status, and manual verification.
						</div>
					</div>
				{:else}
					<div class="space-y-3">
						<div>
							<label for="merge-target-scanned" class="block text-xs font-semibold text-neutral-300 mb-1.5">
								Target Scanned Album to Combine Into
							</label>
							<select
								id="merge-target-scanned"
								bind:value={mergeTargetScannedKey}
								class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-xs text-white focus:border-amber-500 focus:outline-none"
							>
								{#each scannedAlbums.filter((a) => a.album_key !== mergeSourceAlbum?.album_key) as sa (sa.album_key)}
									<option value={sa.album_key}>
										{sa.title} — {sa.artist} ({sa.track_count} tracks{sa.already_in_vault ? ' • In Vault' : ''})
									</option>
								{/each}
							</select>
						</div>

						<div class="rounded-xl border border-amber-900/50 bg-amber-950/20 p-3 text-[11px] text-neutral-300 leading-relaxed">
							Both scanned entries will be combined into a single album. When the same song exists in both entries, Trax Vault automatically keeps the higher-quality audio file (e.g. FLAC / Hi-Res over MP3).
						</div>
					</div>
				{/if}
			</div>

			<!-- Modal Footer -->
			<div class="flex items-center justify-end gap-2 border-t border-neutral-800 bg-neutral-950/60 px-5 py-3.5">
				<button
					type="button"
					onclick={() => (mergeModalOpen = false)}
					class="rounded-xl bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-700 transition cursor-pointer"
				>
					Cancel
				</button>
				<button
					type="button"
					onclick={executeMerge}
					disabled={isMerging || (mergeMode === 'into_vault' ? !mergeTargetVaultId : !mergeTargetScannedKey)}
					class="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-600/30 hover:bg-emerald-500 disabled:opacity-50 transition cursor-pointer"
				>
					<Layers class="h-3.5 w-3.5" />
					<span>{isMerging ? 'Merging...' : 'Merge & Upgrade Now'}</span>
				</button>
			</div>
		</div>
	</div>
{/if}
