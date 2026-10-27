<script lang="ts">
	import type { PageData } from './$types.js';
	import type { Track, AudioFormat, QualityRating, CensorshipStatus, LyricsStatus, FixerRules } from '$lib/types/index.js';
	import TrackRow from '$lib/components/TrackRow.svelte';
	import CustomToggle from '$lib/components/CustomToggle.svelte';
	import CustomCheckbox from '$lib/components/CustomCheckbox.svelte';
	import { formatDuration, FORMAT_OPTIONS, QUALITY_OPTIONS, CENSORSHIP_OPTIONS, LYRICS_OPTIONS } from '$lib/utils.js';
	import { parseSearchQuery, matchesTrackFilters } from '$lib/search.js';
	import {
		Disc,
		Disc3,
		Pencil,
		Trash2,
		Plus,
		Layers,
		CheckCircle2,
		AlertTriangle,
		ArrowLeft,
		Music,
		ExternalLink,
		SlidersHorizontal,
		Search,
		X,
		Tag,
		FolderCheck,
		Mic2,
		Save,
		Check,
		FileText,
		Sparkles,
		ListPlus
	} from '@lucide/svelte';
	import AddToPlaylistModal from '$lib/components/AddToPlaylistModal.svelte';
	import LrcLibModal from '$lib/components/LrcLibModal.svelte';
	import BatchLyricsModal from '$lib/components/BatchLyricsModal.svelte';
	import type { LrcLibCandidate } from '$lib/types/index.js';
	import { goto, invalidateAll } from '$app/navigation';

	let { data }: { data: PageData } = $props();

	let tracks = $state<Track[]>([...data.tracks]);
	let album = $state({ ...data.album });

	let showBatchLyricsModal = $state(false);

	// Track Fixer Rules state
	let showFixerRulesModal = $state(false);
	let fixerApplyToAll = $state(false);
	let isSavingFixerRules = $state(false);

	let ruleFlagLossy = $state(data.album.parsed_fixer_rules?.flag_lossy ?? false);
	let ruleFlagMp3 = $state(data.album.parsed_fixer_rules?.flag_mp3 ?? false);
	let ruleFlagBadQuality = $state(data.album.parsed_fixer_rules?.flag_bad_quality ?? true);
	let ruleFlagNeedsUpgrade = $state(data.album.parsed_fixer_rules?.flag_needs_upgrade ?? true);
	let ruleFlagCensored = $state(data.album.parsed_fixer_rules?.flag_censored ?? true);
	let ruleFlagClean = $state(data.album.parsed_fixer_rules?.flag_clean ?? false);
	let ruleFlagMissingLyrics = $state(data.album.parsed_fixer_rules?.flag_missing_lyrics ?? true);
	let ruleFlagUnsyncedLyrics = $state(data.album.parsed_fixer_rules?.flag_unsynced_lyrics ?? true);
	let ruleFlagPlainLyrics = $state(data.album.parsed_fixer_rules?.flag_plain_lyrics ?? false);
	let ruleFlagCensoredLyrics = $state(data.album.parsed_fixer_rules?.flag_censored_lyrics ?? true);

	const hasCustomFixerRules = $derived(
		ruleFlagLossy || ruleFlagMp3 || !ruleFlagBadQuality || !ruleFlagNeedsUpgrade ||
		!ruleFlagCensored || ruleFlagClean || !ruleFlagMissingLyrics || !ruleFlagUnsyncedLyrics || ruleFlagPlainLyrics ||
		!ruleFlagCensoredLyrics
	);

	// Keep state updated if data changes
	$effect(() => {
		tracks = [...data.tracks];
		album = { ...data.album };
		ruleFlagLossy = data.album.parsed_fixer_rules?.flag_lossy ?? false;
		ruleFlagMp3 = data.album.parsed_fixer_rules?.flag_mp3 ?? false;
		ruleFlagBadQuality = data.album.parsed_fixer_rules?.flag_bad_quality ?? true;
		ruleFlagNeedsUpgrade = data.album.parsed_fixer_rules?.flag_needs_upgrade ?? true;
		ruleFlagCensored = data.album.parsed_fixer_rules?.flag_censored ?? true;
		ruleFlagClean = data.album.parsed_fixer_rules?.flag_clean ?? false;
		ruleFlagMissingLyrics = data.album.parsed_fixer_rules?.flag_missing_lyrics ?? true;
		ruleFlagUnsyncedLyrics = data.album.parsed_fixer_rules?.flag_unsynced_lyrics ?? true;
		ruleFlagPlainLyrics = data.album.parsed_fixer_rules?.flag_plain_lyrics ?? false;
		ruleFlagCensoredLyrics = data.album.parsed_fixer_rules?.flag_censored_lyrics ?? true;
	});

	// Modals and dialogs
	let showBatchModal = $state(false);
	let showEditAlbumModal = $state(false);
	let showAddTrackModal = $state(false);
	let filterIssuesOnly = $state(false);
	let trackSearch = $state('');

	// Batch update form state
	let batchFormat = $state<AudioFormat | ''>('');
	let batchQuality = $state<QualityRating | ''>('');
	let batchCensorship = $state<CensorshipStatus | ''>('');
	let batchLyrics = $state<LyricsStatus | ''>('');
	let batchManuallyChecked = $state<number | ''>('');
	let isBatchSubmitting = $state(false);

	// Edit album form state
	let editTitle = $state(album.title);
	let editArtist = $state(album.artist);
	let editYear = $state(album.release_year ? `${album.release_year}` : '');
	let editGenre = $state(album.genre || '');
	let editCoverUrl = $state(album.cover_url || '');
	let editMediaType = $state(album.media_type || 'Digital');
	let editNotes = $state(album.notes || '');

	// Add track form state
	let newTrackTitle = $state('');
	let newTrackNumber = $state<number>(tracks.length + 1);
	let newTrackDisc = $state<number>(1);
	let newTrackArtist = $state('');
	let newTrackDuration = $state('');
	let newTrackFormat = $state<AudioFormat>('FLAC');
	let newTrackQuality = $state<QualityRating>('good');
	let newTrackCensorship = $state<CensorshipStatus>('clean_original');
	let newTrackLyrics = $state<LyricsStatus>('missing');

	// Calculations
	const totalDurationMs = $derived(
		tracks.reduce((acc, t) => acc + (t.duration_ms || 0), 0)
	);

	const badQualityCount = $derived(
		tracks.filter(t => t.quality_rating === 'bad' || t.quality_rating === 'needs_upgrade').length
	);

	const censoredCount = $derived(
		tracks.filter(t => t.censorship === 'censored').length
	);

	const missingLyricsCount = $derived(
		tracks.filter(t => t.lyrics === 'missing').length
	);

	const unsyncedLyricsCount = $derived(
		tracks.filter(t => t.lyrics === 'unsynced_lrc').length
	);

	const missingTracksCount = $derived(
		tracks.filter(t => t.is_missing === 1).length
	);

	const issuesCount = $derived(
		tracks.filter(t => t.needs_attention === 1).length
	);

	const checkedCount = $derived(
		tracks.filter(t => t.manually_checked === 1).length
	);

	const displayedTracks = $derived.by(() => {
		let list = tracks;
		if (filterIssuesOnly) {
			list = list.filter((t) => t.needs_attention === 1);
		}
		if (trackSearch.trim()) {
			const filters = parseSearchQuery(trackSearch);
			list = list.filter((t) => matchesTrackFilters(t, filters));
		}
		return list;
	});

	async function saveFixerRules() {
		isSavingFixerRules = true;
		try {
			const rules: FixerRules = {
				flag_lossy: ruleFlagLossy,
				flag_mp3: ruleFlagMp3,
				flag_bad_quality: ruleFlagBadQuality,
				flag_needs_upgrade: ruleFlagNeedsUpgrade,
				flag_censored: ruleFlagCensored,
				flag_clean: ruleFlagClean,
				flag_missing_lyrics: ruleFlagMissingLyrics,
				flag_unsynced_lyrics: ruleFlagUnsyncedLyrics,
				flag_plain_lyrics: ruleFlagPlainLyrics,
				flag_censored_lyrics: ruleFlagCensoredLyrics
			};
			const res = await fetch(`/api/albums/${album.id}/fixer-rules`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ rules, applyToAll: fixerApplyToAll })
			});
			if (res.ok) {
				const json = await res.json();
				if (json.tracks) tracks = json.tracks;
				if (json.album) album = json.album;
				showFixerRulesModal = false;
				await invalidateAll();
			}
		} catch (err) {
			console.error('Failed to save fixer rules:', err);
		} finally {
			isSavingFixerRules = false;
		}
	}

	// Group tracks by disc number
	const discGroups = $derived.by(() => {
		const groups: { [disc: number]: Track[] } = {};
		for (const tr of displayedTracks) {
			const disc = tr.disc_number || 1;
			if (!groups[disc]) groups[disc] = [];
			groups[disc].push(tr);
		}
		return Object.entries(groups).map(([disc, trs]) => ({
			disc: parseInt(disc, 10),
			tracks: trs.sort((a, b) => a.track_number - b.track_number)
		})).sort((a, b) => a.disc - b.disc);
	});

	function handleTrackUpdated(updated: Track) {
		const idx = tracks.findIndex(t => t.id === updated.id);
		if (idx !== -1) {
			tracks[idx] = updated;
		}
	}

	function handleTrackDeleted(id: number) {
		tracks = tracks.filter(t => t.id !== id);
	}

	// Quick Lyrics Modal State
	let selectedLyricsTrack = $state<Track | null>(null);
	let lyricsModalLoading = $state(false);
	let lyricsModalText = $state('');
	let lyricsModalFilePath = $state<string | null>(null);
	let lyricsModalSource = $state<'file' | 'db' | 'none'>('none');
	let lyricsModalStatus = $state<LyricsStatus>('missing');
	let lyricsModalSaving = $state(false);
	let lyricsModalMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);
	let showAlbumLrcLibModal = $state(false);

	function handleAlbumLrcLibSelect(result: {
		text: string;
		status: LyricsStatus;
		candidate: LrcLibCandidate;
	}) {
		lyricsModalText = result.text;
		lyricsModalStatus = result.status;
		showAlbumLrcLibModal = false;
		lyricsModalMessage = {
			type: 'success',
			text: `Loaded ${result.status === 'synced_lrc' ? 'synced .lrc' : result.status === 'instrumental' ? 'instrumental' : 'plain'} lyrics for "${result.candidate.trackName}" from LRCLIB. Click Save to write to disk!`
		};
	}

	async function openLyricsModal(track: Track) {
		selectedLyricsTrack = track;
		lyricsModalLoading = true;
		lyricsModalText = '';
		lyricsModalFilePath = null;
		lyricsModalMessage = null;
		lyricsModalStatus = track.lyrics;

		try {
			const res = await fetch(`/api/tracks/${track.id}/lyrics`);
			const json = await res.json();
			if (json.success) {
				lyricsModalText = json.lyrics_text || '';
				lyricsModalFilePath = json.companion_path || json.file_path || null;
				lyricsModalSource = json.source;
				lyricsModalStatus = json.status || track.lyrics;
			}
		} catch (err: any) {
			lyricsModalMessage = { type: 'error', text: `Failed to load lyrics: ${err.message}` };
		} finally {
			lyricsModalLoading = false;
		}
	}

	async function saveLyricsModal() {
		if (!selectedLyricsTrack) return;
		lyricsModalSaving = true;
		lyricsModalMessage = null;

		try {
			const res = await fetch(`/api/tracks/${selectedLyricsTrack.id}/lyrics`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					lyrics_text: lyricsModalText,
					status: lyricsModalStatus,
					save_to_disk: true,
					overwrite: true
				})
			});
			const json = await res.json();
			if (json.success) {
				if (json.companion_path) {
					lyricsModalFilePath = json.companion_path;
				}
				lyricsModalSource = json.saved_to_disk ? 'file' : 'db';
				lyricsModalMessage = {
					type: 'success',
					text: json.saved_to_disk
						? 'Saved lyrics to folder companion file and database!'
						: 'Saved lyrics to database.'
				};

				// Update local track state
				const updatedTrack = {
					...selectedLyricsTrack,
					lyrics: lyricsModalStatus,
					lyrics_text: lyricsModalText,
					needs_attention: json.track?.needs_attention ?? selectedLyricsTrack.needs_attention
				};
				handleTrackUpdated(updatedTrack);
			} else {
				lyricsModalMessage = { type: 'error', text: json.error || 'Failed to save lyrics' };
			}
		} catch (err: any) {
			lyricsModalMessage = { type: 'error', text: `Error saving lyrics: ${err.message}` };
		} finally {
			lyricsModalSaving = false;
		}
	}

	async function submitBatchUpdate() {
		isBatchSubmitting = true;
		try {
			const payload: any = {};
			if (batchFormat) payload.format = batchFormat;
			if (batchQuality) payload.quality_rating = batchQuality;
			if (batchCensorship) payload.censorship = batchCensorship;
			if (batchLyrics) payload.lyrics = batchLyrics;
			if (batchManuallyChecked !== '') payload.manually_checked = batchManuallyChecked;

			const res = await fetch(`/api/albums/${album.id}/batch`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});

			if (res.ok) {
				showBatchModal = false;
				await invalidateAll();
			}
		} catch (err) {
			console.error('Failed to run batch update:', err);
		} finally {
			isBatchSubmitting = false;
		}
	}

	async function setAllVerified(verified: boolean) {
		isBatchSubmitting = true;
		try {
			const res = await fetch(`/api/albums/${album.id}/batch`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ manually_checked: verified ? 1 : 0 })
			});
			if (res.ok) {
				tracks = tracks.map((t) => ({ ...t, manually_checked: verified ? 1 : 0 }));
				await invalidateAll();
			}
		} catch (err) {
			console.error('Failed to update verification status:', err);
		} finally {
			isBatchSubmitting = false;
		}
	}

	async function submitEditAlbum() {
		try {
			const yearNum = editYear.trim() ? parseInt(editYear.trim(), 10) : null;
			const res = await fetch(`/api/albums/${album.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: editTitle,
					artist: editArtist,
					release_year: isNaN(yearNum!) ? null : yearNum,
					genre: editGenre,
					cover_url: editCoverUrl,
					media_type: editMediaType,
					notes: editNotes
				})
			});

			if (res.ok) {
				showEditAlbumModal = false;
				await invalidateAll();
			}
		} catch (err) {
			console.error('Failed to edit album:', err);
		}
	}

	async function submitAddTrack() {
		try {
			// Parse duration mm:ss to ms if provided
			let durationMs: number | null = null;
			if (newTrackDuration.trim()) {
				const parts = newTrackDuration.trim().split(':');
				if (parts.length === 2) {
					const min = parseInt(parts[0], 10);
					const sec = parseInt(parts[1], 10);
					if (!isNaN(min) && !isNaN(sec)) {
						durationMs = (min * 60 + sec) * 1000;
					}
				}
			}

			const res = await fetch(`/api/albums/${album.id}/tracks`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: newTrackTitle,
					disc_number: newTrackDisc,
					track_number: newTrackNumber,
					artist: newTrackArtist || null,
					duration_ms: durationMs,
					format: newTrackFormat,
					quality_rating: newTrackQuality,
					censorship: newTrackCensorship,
					lyrics: newTrackLyrics
				})
			});

			if (res.ok) {
				showAddTrackModal = false;
				newTrackTitle = '';
				newTrackDuration = '';
				await invalidateAll();
			}
		} catch (err) {
			console.error('Failed to add track:', err);
		}
	}

	async function handleDeleteAlbum() {
		if (
			!confirm(
				`Remove album "${album.title}" from Vault?\n\nAudio files on disk in your music directory will NOT be deleted, and the album will return to the Library Scanner.`
			)
		) {
			return;
		}

		try {
			const res = await fetch(`/api/albums/${album.id}`, { method: 'DELETE' });
			if (res.ok) {
				goto('/');
			}
		} catch (err) {
			console.error('Failed to delete album:', err);
		}
	}

	// Add to Playlist Modal State
	let showPlaylistModal = $state(false);
	let playlistModalTrackIds = $state<number[]>([]);
	let playlistModalTitle = $state<string | undefined>(undefined);

	function openAddToPlaylist(trackIds: number[], title?: string) {
		playlistModalTrackIds = trackIds;
		playlistModalTitle = title;
		showPlaylistModal = true;
	}
</script>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<!-- Back Button -->
	<div class="mb-5">
		<a
			href="/"
			class="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-400 transition hover:text-white"
		>
			<ArrowLeft class="h-4 w-4" />
			Back to Vault
		</a>
	</div>

	<!-- Album Hero Banner -->
	<div class="relative overflow-hidden rounded-3xl border border-neutral-800 bg-gradient-to-b from-neutral-900/90 to-neutral-950 p-6 md:p-8 shadow-2xl">
		<div class="flex flex-col md:flex-row gap-6 md:gap-8 items-start">
			<!-- Album Cover Art -->
			<div class="relative aspect-square w-48 sm:w-56 shrink-0 overflow-hidden rounded-2xl bg-neutral-950 shadow-2xl border border-neutral-800">
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
					<div class="flex h-full w-full items-center justify-center bg-neutral-900 text-neutral-600">
						<Disc class="h-20 w-20 opacity-30" />
					</div>
				{/if}

				{#if album.media_type}
					<span class="absolute bottom-3 left-3 rounded bg-black/80 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-neutral-300 backdrop-blur-sm border border-white/10">
						{album.media_type}
					</span>
				{/if}
			</div>

			<!-- Album Metadata & Quick Info -->
			<div class="flex flex-1 flex-col justify-between self-stretch">
				<div>
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-xs font-bold uppercase tracking-widest text-emerald-400">Album</span>
						{#if album.musicbrainz_id}
							<a
								href="https://musicbrainz.org/release/{album.musicbrainz_id}"
								target="_blank"
								rel="noreferrer"
								class="inline-flex items-center gap-1 rounded bg-neutral-800/80 px-2 py-0.5 text-[11px] text-neutral-400 hover:text-emerald-300 border border-neutral-700/60"
								title="View on MusicBrainz"
							>
								<span>MusicBrainz</span>
								<ExternalLink class="h-3 w-3" />
							</a>
						{/if}
					</div>

					<h1 class="mt-2 text-2xl sm:text-4xl font-black tracking-tight text-white">
						{album.title}
					</h1>

					<p class="mt-1 text-lg font-semibold text-neutral-300">
						{album.artist}
					</p>

					<div class="mt-3 flex flex-wrap items-center gap-3 text-xs text-neutral-400">
						{#if album.release_year}
							<span class="font-medium text-neutral-300">{album.release_year}</span>
							<span>•</span>
						{/if}
						<span>{tracks.length} tracks</span>
						{#if totalDurationMs > 0}
							<span>•</span>
							<span>{formatDuration(totalDurationMs)}</span>
						{/if}
						{#if album.genre}
							<span>•</span>
							<span class="rounded bg-neutral-800/60 px-2 py-0.5 text-neutral-300 border border-neutral-700/40">
								{album.genre}
							</span>
						{/if}
					</div>

					{#if album.notes}
						<p class="mt-3 text-xs italic text-neutral-400 bg-neutral-900/50 p-2.5 rounded-xl border border-neutral-800/60">
							"{album.notes}"
						</p>
					{/if}
				</div>

				<!-- Issue Badges & Stats Bar -->
				<div class="mt-6 flex flex-wrap items-center gap-2 border-t border-neutral-800/60 pt-4">
					{#if issuesCount === 0}
						<span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-950/80 px-3 py-1 text-xs font-semibold text-emerald-300 border border-emerald-700 whitespace-nowrap">
							<CheckCircle2 class="h-4 w-4" />
							Vault Ready
						</span>
					{:else}
						<span class="inline-flex items-center gap-1.5 rounded-full bg-amber-950/80 px-3 py-1 text-xs font-semibold text-amber-300 border border-amber-600 whitespace-nowrap">
							<AlertTriangle class="h-4 w-4" />
							{issuesCount} Needs Fix
						</span>
					{/if}

					<!-- Verification Progress Badge -->
					<span
						class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border transition whitespace-nowrap {checkedCount === tracks.length && tracks.length > 0 ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600' : 'bg-neutral-900/80 text-neutral-300 border-neutral-700'}"
						title="Manually checked songs (100% verified metadata & audio)"
					>
						<CheckCircle2 class="h-4 w-4 {checkedCount === tracks.length && tracks.length > 0 ? 'text-emerald-400' : 'text-neutral-500'}" />
						<span>{checkedCount}/{tracks.length} Checked</span>
					</span>

					{#if badQualityCount > 0}
						<span class="rounded-lg bg-rose-950/70 px-2.5 py-1 text-xs font-medium text-rose-300 border border-rose-800 whitespace-nowrap">
							{badQualityCount} Bad Quality
						</span>
					{/if}

					{#if censoredCount > 0}
						<span class="rounded-lg bg-rose-950/70 px-2.5 py-1 text-xs font-medium text-rose-300 border border-rose-800 whitespace-nowrap">
							{censoredCount} Censored
						</span>
					{/if}

					{#if missingLyricsCount > 0}
						<span class="rounded-lg bg-amber-950/70 px-2.5 py-1 text-xs font-medium text-amber-300 border border-amber-800 whitespace-nowrap">
							{missingLyricsCount} No Lyrics
						</span>
					{/if}

					{#if unsyncedLyricsCount > 0}
						<span class="rounded-lg bg-amber-950/70 px-2.5 py-1 text-xs font-medium text-amber-300 border border-amber-800 whitespace-nowrap">
							{unsyncedLyricsCount} Unsynced LRC
						</span>
					{/if}

					{#if missingTracksCount > 0}
						<span class="inline-flex items-center gap-1.5 rounded-lg bg-rose-950/80 px-2.5 py-1 text-xs font-bold text-rose-300 border border-rose-700 whitespace-nowrap shadow-sm">
							<AlertTriangle class="h-3.5 w-3.5 text-rose-400" />
							{missingTracksCount} Missing {missingTracksCount === 1 ? 'Song' : 'Songs'}
						</span>
					{/if}
				</div>
			</div>
		</div>

		<!-- Action Bar at Bottom of Hero -->
		<div class="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-800/80 pt-4">
			<div class="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onclick={() => (showBatchModal = true)}
					class="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow shadow-emerald-600/30 hover:bg-emerald-500 transition"
				>
					<Layers class="h-4 w-4" />
					Batch Update Tracks
				</button>

				<button
					type="button"
					onclick={() => (showAddTrackModal = true)}
					class="flex items-center gap-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 px-3.5 py-2 text-xs font-semibold text-neutral-200 border border-neutral-700 transition"
				>
					<Plus class="h-4 w-4" />
					Add Track
				</button>

				<button
					type="button"
					onclick={() => (showEditAlbumModal = true)}
					class="flex items-center gap-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 px-3.5 py-2 text-xs font-semibold text-neutral-200 border border-neutral-700 transition"
				>
					<Pencil class="h-3.5 w-3.5" />
					Edit Album
				</button>

				<button
					type="button"
					onclick={() => (showFixerRulesModal = true)}
					class="flex items-center gap-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 px-3.5 py-2 text-xs font-semibold text-neutral-200 border border-neutral-700 transition"
					title="Configure what triggers Track Fixer issues for this album"
				>
					<SlidersHorizontal class="h-3.5 w-3.5 text-emerald-400" />
					<span>Fixer Rules</span>
					{#if hasCustomFixerRules}
						<span class="h-1.5 w-1.5 rounded-full bg-emerald-400" title="Custom fixer rules active"></span>
					{/if}
				</button>

				<a
					href={`/tagger?albumId=${album.id}`}
					class="flex items-center gap-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 hover:text-white px-3.5 py-2 text-xs font-semibold text-neutral-300 border border-neutral-700 transition"
					title="Auto-tag album and download cover artwork with MusicBrainz"
				>
					<Sparkles class="h-3.5 w-3.5 text-emerald-400" />
					<span>Auto-Tag with MusicBrainz</span>
				</a>

				<button
					type="button"
					onclick={() => openAddToPlaylist(tracks.map((t) => t.id), album.title)}
					class="flex items-center gap-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 hover:text-white px-3.5 py-2 text-xs font-semibold text-neutral-300 border border-neutral-700 transition"
					title="Add entire album to a playlist"
				>
					<ListPlus class="h-3.5 w-3.5 text-emerald-400" />
					<span>Add to Playlist</span>
				</button>

				<button
					type="button"
					onclick={() => (showBatchLyricsModal = true)}
					class="flex items-center gap-1.5 rounded-xl bg-teal-600/20 hover:bg-teal-600/30 text-teal-300 border border-teal-500/30 px-3.5 py-2 text-xs font-semibold transition"
					title="Batch download missing synced lyrics from LRCLIB for this album"
				>
					<Mic2 class="h-3.5 w-3.5 text-teal-400" />
					<span>Download Lyrics</span>
				</button>
			</div>

			<div class="flex items-center gap-3">
				<!-- Issues Only Custom Toggle Switch -->
				<div class="flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/60 px-3 py-1.5 shadow-sm">
					<AlertTriangle class="h-3.5 w-3.5 {filterIssuesOnly ? 'text-amber-400' : 'text-neutral-500'}" />
					<CustomToggle
						checked={filterIssuesOnly}
						label="Issues Only"
						onchange={(val) => (filterIssuesOnly = val)}
					/>
				</div>

				<button
					type="button"
					onclick={handleDeleteAlbum}
					class="rounded-xl p-2 text-neutral-500 hover:bg-rose-950/60 hover:text-rose-400 transition border border-transparent hover:border-rose-900"
					title="Delete entire album"
				>
					<Trash2 class="h-4 w-4" />
				</button>
			</div>
		</div>
	</div>

	<!-- Missing Tracks Alert Banner -->
	{#if missingTracksCount > 0}
		<div class="mt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-rose-800/60 bg-rose-950/30 p-4 text-xs text-rose-200 shadow-md">
			<div class="flex items-center gap-3">
				<div class="p-2 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-400 shrink-0">
					<AlertTriangle class="h-5 w-5" />
				</div>
				<div>
					<p class="font-bold text-rose-100 text-sm">
						{missingTracksCount} {missingTracksCount === 1 ? 'song is' : 'songs are'} missing from this album release
					</p>
					<p class="text-neutral-400 mt-0.5">
						Missing release songs are highlighted in red below. Copy the missing audio files to this album's folder on disk, and the Library Scanner will auto-link them.
					</p>
				</div>
			</div>
			<a
				href={`/tagger?albumId=${album.id}`}
				class="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-rose-900/60 hover:bg-rose-800/80 text-rose-200 border border-rose-700/60 px-3.5 py-2 font-semibold text-xs transition"
			>
				<Sparkles class="h-3.5 w-3.5 text-rose-300" />
				<span>Review in Tagger</span>
			</a>
		</div>
	{/if}

	<!-- Tracklist Section -->
	<section class="mt-8">
		<!-- Quick Album-Wide Batch Dropdowns (No Tap-Through) & Search -->
		<div class="mb-4 flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-3.5">
			<div class="flex flex-wrap items-center gap-3">
				<div class="flex items-center gap-2">
					<Music class="h-4 w-4 text-emerald-400" />
					<h2 class="text-sm font-bold text-neutral-100">
						Tracklist ({displayedTracks.length})
					</h2>
				</div>

				<!-- Track Search / Filter in Album -->
				<div class="relative w-48 sm:w-60">
					<Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-500" />
					<input
						type="text"
						bind:value={trackSearch}
						placeholder="Filter tracks: !flac, checked, !checked..."
						class="w-full rounded-xl border border-neutral-700 bg-neutral-950 pl-8 pr-2.5 py-1 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-emerald-500"
					/>
				</div>
			</div>

			<!-- Batch quick-apply to whole album -->
			<div class="flex flex-wrap items-center gap-2 text-xs">
				<span class="text-[11px] font-semibold text-neutral-400">Batch album:</span>

				<!-- Batch Verification -->
				<select
					onchange={(e) => {
						if (e.currentTarget.value) {
							setAllVerified(e.currentTarget.value === '1');
							e.currentTarget.value = '';
						}
					}}
					class="rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1 text-xs text-neutral-300 focus:outline-none focus:border-emerald-500 font-medium"
					title="Mark all tracks in this album as verified or unverified"
				>
					<option value="">Set Verification...</option>
					<option value="1">✓ Mark All as Checked</option>
					<option value="0">✗ Unmark All</option>
				</select>

				<select
					onchange={(e) => {
						if (e.currentTarget.value) {
							batchFormat = e.currentTarget.value as AudioFormat;
							submitBatchUpdate();
							e.currentTarget.value = '';
						}
					}}
					class="rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1 text-xs text-neutral-300 focus:outline-none focus:border-emerald-500"
					title="Set format for all tracks in this album"
				>
					<option value="">Set Format...</option>
					{#each FORMAT_OPTIONS as opt}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>

				<select
					onchange={(e) => {
						if (e.currentTarget.value) {
							batchCensorship = e.currentTarget.value as CensorshipStatus;
							submitBatchUpdate();
							e.currentTarget.value = '';
						}
					}}
					class="rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1 text-xs text-neutral-300 focus:outline-none focus:border-emerald-500"
					title="Set censorship for all tracks in this album"
				>
					<option value="">Set Censorship...</option>
					{#each CENSORSHIP_OPTIONS as opt}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>

				<select
					onchange={(e) => {
						if (e.currentTarget.value) {
							batchLyrics = e.currentTarget.value as LyricsStatus;
							submitBatchUpdate();
							e.currentTarget.value = '';
						}
					}}
					class="rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1 text-xs text-neutral-300 focus:outline-none focus:border-emerald-500"
					title="Set lyrics for all tracks in this album"
				>
					<option value="">Set Lyrics...</option>
					{#each LYRICS_OPTIONS as opt}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			</div>
		</div>

		{#if displayedTracks.length > 0}
			<div class="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/30">
				{#each discGroups as group (group.disc)}
					{#if discGroups.length > 1}
						<div class="border-b border-neutral-800 bg-neutral-900/80 px-4 py-2 text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
							<Disc3 class="h-3.5 w-3.5" />
							Disc {group.disc}
						</div>
					{/if}

					<div class="divide-y divide-neutral-800/40">
						{#each group.tracks as track (track.id)}
							<TrackRow
								{track}
								onTrackUpdated={handleTrackUpdated}
								onTrackDeleted={handleTrackDeleted}
								onOpenLyrics={openLyricsModal}
								onAddToPlaylist={(t) => openAddToPlaylist([t.id], t.title)}
							/>
						{/each}
					</div>
				{/each}
			</div>
		{:else}
			<div class="rounded-2xl border border-dashed border-neutral-800 p-8 text-center text-neutral-400">
				{#if filterIssuesOnly}
					<CheckCircle2 class="mx-auto h-8 w-8 text-emerald-400 mb-2" />
					<p class="font-semibold text-neutral-200">No issues found!</p>
					<p class="text-xs text-neutral-500 mt-1">All tracks on this album meet your quality, censorship, and lyrics requirements.</p>
				{:else}
					<p>No tracks in this album yet.</p>
					<button
						type="button"
						onclick={() => (showAddTrackModal = true)}
						class="mt-3 inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition"
					>
						<Plus class="h-4 w-4" /> Add Track
					</button>
				{/if}
			</div>
		{/if}
	</section>
</div>

<!-- Modal: Batch Update Tracks -->
{#if showBatchModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
		<div class="w-full max-w-md rounded-3xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
			<div class="flex items-center justify-between border-b border-neutral-800 pb-4">
				<h3 class="text-base font-bold text-white flex items-center gap-2">
					<Layers class="h-5 w-5 text-emerald-400" />
					Batch Update All Tracks
				</h3>
				<button type="button" onclick={() => (showBatchModal = false)} class="text-neutral-400 hover:text-white">
					<X class="h-5 w-5" />
				</button>
			</div>

			<p class="mt-3 text-xs text-neutral-400">
				Apply settings to all {tracks.length} tracks on this album at once. Leave fields unselected to keep their existing values.
			</p>

			<div class="mt-4 space-y-4">
				<div>
					<label class="block text-xs font-semibold text-neutral-300 mb-1">Set Audio Format</label>
					<select
						bind:value={batchFormat}
						class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
					>
						<option value="">-- Keep Current Format --</option>
						{#each FORMAT_OPTIONS as opt}
							<option value={opt.value}>{opt.label}</option>
						{/each}
					</select>
				</div>

				<div>
					<label class="block text-xs font-semibold text-neutral-300 mb-1">Set Audio Quality</label>
					<select
						bind:value={batchQuality}
						class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
					>
						<option value="">-- Keep Current Quality --</option>
						{#each QUALITY_OPTIONS as opt}
							<option value={opt.value}>{opt.label}</option>
						{/each}
					</select>
				</div>

				<div>
					<label class="block text-xs font-semibold text-neutral-300 mb-1">Set Censorship Status</label>
					<select
						bind:value={batchCensorship}
						class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
					>
						<option value="">-- Keep Current Censorship --</option>
						{#each CENSORSHIP_OPTIONS as opt}
							<option value={opt.value}>{opt.label}</option>
						{/each}
					</select>
				</div>

				<div>
					<label class="block text-xs font-semibold text-neutral-300 mb-1">Set Lyrics Status</label>
					<select
						bind:value={batchLyrics}
						class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
					>
						<option value="">-- Keep Current Lyrics --</option>
						{#each LYRICS_OPTIONS as opt}
							<option value={opt.value}>{opt.label}</option>
						{/each}
					</select>
				</div>

				<div>
					<label class="block text-xs font-semibold text-neutral-300 mb-1">Set Manual Check Status</label>
					<select
						bind:value={batchManuallyChecked}
						class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
					>
						<option value="">-- Keep Current Status --</option>
						<option value={1}>✓ Mark as Manually Checked (100% Verified)</option>
						<option value={0}>✗ Unmark (Unverified)</option>
					</select>
				</div>
			</div>

			<div class="mt-6 flex justify-end gap-3 border-t border-neutral-800 pt-4">
				<button
					type="button"
					onclick={() => (showBatchModal = false)}
					class="rounded-xl bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-700"
				>
					Cancel
				</button>
				<button
					type="button"
					onclick={submitBatchUpdate}
					disabled={isBatchSubmitting}
					class="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-500 shadow-md shadow-emerald-600/30 transition"
				>
					{isBatchSubmitting ? 'Updating...' : 'Apply to All Tracks'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal: Edit Album Metadata -->
{#if showEditAlbumModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
		<div class="w-full max-w-md rounded-3xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
			<div class="flex items-center justify-between border-b border-neutral-800 pb-4">
				<h3 class="text-base font-bold text-white flex items-center gap-2">
					<Pencil class="h-4 w-4 text-emerald-400" />
					Edit Album Info
				</h3>
				<button type="button" onclick={() => (showEditAlbumModal = false)} class="text-neutral-400 hover:text-white">
					<X class="h-5 w-5" />
				</button>
			</div>

			<div class="mt-4 space-y-4">
				<div>
					<label class="block text-xs font-semibold text-neutral-300 mb-1">Album Title *</label>
					<input
						type="text"
						bind:value={editTitle}
						class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
					/>
				</div>

				<div>
					<label class="block text-xs font-semibold text-neutral-300 mb-1">Artist *</label>
					<input
						type="text"
						bind:value={editArtist}
						class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
					/>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div>
						<label class="block text-xs font-semibold text-neutral-300 mb-1">Release Year</label>
						<input
							type="number"
							bind:value={editYear}
							placeholder="e.g. 1994"
							class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
						/>
					</div>

					<div>
						<label class="block text-xs font-semibold text-neutral-300 mb-1">Media Type</label>
						<select
							bind:value={editMediaType}
							class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
						>
							<option value="Digital">Digital / Web</option>
							<option value="CD">CD</option>
							<option value="Vinyl">Vinyl</option>
							<option value="Cassette">Cassette</option>
						</select>
					</div>
				</div>

				<div>
					<label class="block text-xs font-semibold text-neutral-300 mb-1">Genre</label>
					<input
						type="text"
						bind:value={editGenre}
						placeholder="e.g. Electronic, Synthpop, Rock"
						class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
					/>
				</div>

				<div>
					<label class="block text-xs font-semibold text-neutral-300 mb-1">Cover Image URL</label>
					<input
						type="url"
						bind:value={editCoverUrl}
						placeholder="https://..."
						class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
					/>
				</div>

				<div>
					<label class="block text-xs font-semibold text-neutral-300 mb-1">Album Notes</label>
					<textarea
						bind:value={editNotes}
						rows="2"
						placeholder="Notes about release, origin, or rip details..."
						class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
					></textarea>
				</div>
			</div>

			<div class="mt-6 flex justify-end gap-3 border-t border-neutral-800 pt-4">
				<button
					type="button"
					onclick={() => (showEditAlbumModal = false)}
					class="rounded-xl bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-700"
				>
					Cancel
				</button>
				<button
					type="button"
					onclick={submitEditAlbum}
					class="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-500 shadow-md shadow-emerald-600/30 transition"
				>
					Save Changes
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal: Add Single Track -->
{#if showAddTrackModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
		<div class="w-full max-w-md rounded-3xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
			<div class="flex items-center justify-between border-b border-neutral-800 pb-4">
				<h3 class="text-base font-bold text-white flex items-center gap-2">
					<Plus class="h-4 w-4 text-emerald-400" />
					Add Track
				</h3>
				<button type="button" onclick={() => (showAddTrackModal = false)} class="text-neutral-400 hover:text-white">
					<X class="h-5 w-5" />
				</button>
			</div>

			<div class="mt-4 space-y-4">
				<div>
					<label class="block text-xs font-semibold text-neutral-300 mb-1">Track Title *</label>
					<input
						type="text"
						bind:value={newTrackTitle}
						placeholder="Track name"
						class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
					/>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div>
						<label class="block text-xs font-semibold text-neutral-300 mb-1">Track Number</label>
						<input
							type="number"
							bind:value={newTrackNumber}
							class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
						/>
					</div>

					<div>
						<label class="block text-xs font-semibold text-neutral-300 mb-1">Disc Number</label>
						<input
							type="number"
							bind:value={newTrackDisc}
							class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
						/>
					</div>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div>
						<label class="block text-xs font-semibold text-neutral-300 mb-1">Track Artist (optional)</label>
						<input
							type="text"
							bind:value={newTrackArtist}
							placeholder="Leave blank if same as album"
							class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
						/>
					</div>

					<div>
						<label class="block text-xs font-semibold text-neutral-300 mb-1">Duration (mm:ss)</label>
						<input
							type="text"
							bind:value={newTrackDuration}
							placeholder="3:45"
							class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
						/>
					</div>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div>
						<label class="block text-xs font-semibold text-neutral-300 mb-1">Format</label>
						<select
							bind:value={newTrackFormat}
							class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
						>
							{#each FORMAT_OPTIONS as opt}
								<option value={opt.value}>{opt.label}</option>
							{/each}
						</select>
					</div>

					<div>
						<label class="block text-xs font-semibold text-neutral-300 mb-1">Audio Quality</label>
						<select
							bind:value={newTrackQuality}
							class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
						>
							{#each QUALITY_OPTIONS as opt}
								<option value={opt.value}>{opt.label}</option>
							{/each}
						</select>
					</div>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div>
						<label class="block text-xs font-semibold text-neutral-300 mb-1">Censorship</label>
						<select
							bind:value={newTrackCensorship}
							class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
						>
							{#each CENSORSHIP_OPTIONS as opt}
								<option value={opt.value}>{opt.label}</option>
							{/each}
						</select>
					</div>

					<div>
						<label class="block text-xs font-semibold text-neutral-300 mb-1">Lyrics</label>
						<select
							bind:value={newTrackLyrics}
							class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
						>
							{#each LYRICS_OPTIONS as opt}
								<option value={opt.value}>{opt.label}</option>
							{/each}
						</select>
					</div>
				</div>
			</div>

			<div class="mt-6 flex justify-end gap-3 border-t border-neutral-800 pt-4">
				<button
					type="button"
					onclick={() => (showAddTrackModal = false)}
					class="rounded-xl bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-700"
				>
					Cancel
				</button>
				<button
					type="button"
					onclick={submitAddTrack}
					disabled={!newTrackTitle.trim()}
					class="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50 shadow-md shadow-emerald-600/30 transition"
				>
					Add Track
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal: Track Fixer Rules -->
{#if showFixerRulesModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
		<div class="w-full max-w-lg rounded-3xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
			<div class="flex items-center justify-between border-b border-neutral-800 pb-4">
				<div>
					<h3 class="text-base font-bold text-white flex items-center gap-2">
						<SlidersHorizontal class="h-4 w-4 text-emerald-400" />
						Track Fixer Criteria
					</h3>
					<p class="text-xs text-neutral-400 mt-0.5">
						Customize what conditions trigger "Needs Attention" / Track Fixer for this album.
					</p>
				</div>
				<button type="button" onclick={() => (showFixerRulesModal = false)} class="text-neutral-400 hover:text-white">
					<X class="h-5 w-5" />
				</button>
			</div>

			<div class="mt-5 space-y-5">
				<!-- Section 1: Audio Formats -->
				<div class="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4">
					<h4 class="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-1">
						Audio Format Standards
					</h4>
					<p class="text-[11px] text-neutral-400 mb-3">
						Decide whether lossy or compressed formats are considered issues to fix.
					</p>

					<div class="space-y-3">
						<div class="flex items-start justify-between gap-3">
							<div>
								<div class="text-xs font-semibold text-neutral-200">Flag all MP3 formats</div>
								<div class="text-[11px] text-neutral-400">Flags all MP3 files (320k, V0, 128k) as needing lossless upgrade</div>
							</div>
							<CustomToggle checked={ruleFlagMp3} onchange={(v) => (ruleFlagMp3 = v)} />
						</div>

						<div class="flex items-start justify-between gap-3 border-t border-neutral-800/80 pt-3">
							<div>
								<div class="text-xs font-semibold text-neutral-200">Flag any lossy format</div>
								<div class="text-[11px] text-neutral-400">Strict mode: flags MP3, AAC, OGG, WMA (requires FLAC/lossless)</div>
							</div>
							<CustomToggle checked={ruleFlagLossy} onchange={(v) => (ruleFlagLossy = v)} />
						</div>
					</div>
				</div>

				<!-- Section 2: Lyrics Standards -->
				<div class="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4">
					<h4 class="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-1">
						Lyrics Standards
					</h4>
					<p class="text-[11px] text-neutral-400 mb-3">
						Choose required lyrics precision for this album.
					</p>

					<div class="space-y-3">
						<div class="flex items-start justify-between gap-3">
							<div>
								<div class="text-xs font-semibold text-neutral-200">Flag missing lyrics</div>
								<div class="text-[11px] text-neutral-400">Songs with no lyrics file will be marked for attention</div>
							</div>
							<CustomToggle checked={ruleFlagMissingLyrics} onchange={(v) => (ruleFlagMissingLyrics = v)} />
						</div>

						<div class="flex items-start justify-between gap-3 border-t border-neutral-800/80 pt-3">
							<div>
								<div class="text-xs font-semibold text-neutral-200">Flag unsynced lyrics</div>
								<div class="text-[11px] text-neutral-400">Flags lyrics where timestamps are shifted or out of sync</div>
							</div>
							<CustomToggle checked={ruleFlagUnsyncedLyrics} onchange={(v) => (ruleFlagUnsyncedLyrics = v)} />
						</div>

						<div class="flex items-start justify-between gap-3 border-t border-neutral-800/80 pt-3">
							<div>
								<div class="text-xs font-semibold text-neutral-200">Require Synced LRC</div>
								<div class="text-[11px] text-neutral-400">Flags plain text .txt lyrics as needing upgrade to synced .lrc</div>
							</div>
							<CustomToggle checked={ruleFlagPlainLyrics} onchange={(v) => (ruleFlagPlainLyrics = v)} />
						</div>

						<div class="flex items-start justify-between gap-3 border-t border-neutral-800/80 pt-3">
							<div>
								<div class="text-xs font-semibold text-neutral-200">Flag censored lyrics</div>
								<div class="text-[11px] text-neutral-400">Flags synced .lrc with bleeped words/asterisks for uncensored replacement</div>
							</div>
							<CustomToggle checked={ruleFlagCensoredLyrics} onchange={(v) => (ruleFlagCensoredLyrics = v)} />
						</div>
					</div>
				</div>

				<!-- Section 3: Censorship & Quality -->
				<div class="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4">
					<h4 class="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-1">
						Censorship & Quality
					</h4>
					<p class="text-[11px] text-neutral-400 mb-3">
						Flag audio imperfections or radio edited tracks.
					</p>

					<div class="space-y-3">
						<div class="flex items-start justify-between gap-3">
							<div>
								<div class="text-xs font-semibold text-neutral-200">Flag censored versions</div>
								<div class="text-[11px] text-neutral-400">Flags clean radio edits / muted words for explicit replacement</div>
							</div>
							<CustomToggle checked={ruleFlagCensored} onchange={(v) => (ruleFlagCensored = v)} />
						</div>

						<div class="flex items-start justify-between gap-3 border-t border-neutral-800/80 pt-3">
							<div>
								<div class="text-xs font-semibold text-neutral-200">Require Explicit</div>
								<div class="text-[11px] text-neutral-400">Flags clean original tracks as needing explicit versions</div>
							</div>
							<CustomToggle checked={ruleFlagClean} onchange={(v) => (ruleFlagClean = v)} />
						</div>

						<div class="flex items-start justify-between gap-3 border-t border-neutral-800/80 pt-3">
							<div>
								<div class="text-xs font-semibold text-neutral-200">Flag bad quality & low bitrate</div>
								<div class="text-[11px] text-neutral-400">Audible distortion, low frequency cutoff, bad rips</div>
							</div>
							<CustomToggle checked={ruleFlagBadQuality} onchange={(v) => (ruleFlagBadQuality = v)} />
						</div>

						<div class="flex items-start justify-between gap-3 border-t border-neutral-800/80 pt-3">
							<div>
								<div class="text-xs font-semibold text-neutral-200">Flag "needs upgrade" rating</div>
								<div class="text-[11px] text-neutral-400">Tracks explicitly labeled as needing an upgrade</div>
							</div>
							<CustomToggle checked={ruleFlagNeedsUpgrade} onchange={(v) => (ruleFlagNeedsUpgrade = v)} />
						</div>
					</div>
				</div>

				<!-- Apply to all vault albums option -->
				<div class="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-950/50 p-3">
					<CustomCheckbox
						checked={fixerApplyToAll}
						onchange={(v) => (fixerApplyToAll = v)}
						title="Apply rules to all albums"
					/>
					<div class="text-xs text-neutral-300 select-none">
						<span class="font-semibold text-emerald-300">Apply to all albums in Vault</span>
						<span class="block text-[11px] text-neutral-500">Also update and recompute fixer issues across your entire collection</span>
					</div>
				</div>
			</div>

			<div class="mt-6 flex justify-end gap-3 border-t border-neutral-800 pt-4">
				<button
					type="button"
					onclick={() => (showFixerRulesModal = false)}
					class="rounded-xl bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-700"
				>
					Cancel
				</button>
				<button
					type="button"
					onclick={saveFixerRules}
					disabled={isSavingFixerRules}
					class="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-500 shadow-md shadow-emerald-600/30 transition disabled:opacity-50"
				>
					{isSavingFixerRules ? 'Saving...' : 'Save Fixer Rules'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Quick Lyrics File Viewer & Editor Modal -->
{#if selectedLyricsTrack}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
		<div class="w-full max-w-2xl rounded-3xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl flex flex-col max-h-[90vh]">
			<div class="flex items-center justify-between border-b border-neutral-800 pb-4 shrink-0">
				<div class="flex items-center gap-2.5">
					<div class="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
						<FileText class="h-5 w-5" />
					</div>
					<div>
						<h3 class="text-base font-bold text-white flex items-center gap-2">
							Lyrics File Editor
							<span class="text-[11px] font-mono px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">
								Track {selectedLyricsTrack.track_number}
							</span>
						</h3>
						<p class="text-xs text-neutral-400 mt-0.5">
							{selectedLyricsTrack.title} &bull; {selectedLyricsTrack.artist || album.artist}
						</p>
					</div>
				</div>
				<button
					type="button"
					onclick={() => (selectedLyricsTrack = null)}
					class="text-neutral-400 hover:text-white transition p-1"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<!-- Companion Folder File Indicator -->
			<div class="mt-4 p-3 rounded-xl bg-neutral-950 border border-neutral-800 flex items-center justify-between gap-3 text-xs shrink-0">
				<div class="flex items-center gap-2 min-w-0">
					<FolderCheck class="h-4 w-4 {lyricsModalFilePath ? 'text-emerald-400' : 'text-neutral-500'} shrink-0" />
					<span class="text-neutral-400 shrink-0">Song Folder File:</span>
					{#if lyricsModalFilePath}
						<code class="px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-emerald-300 font-mono text-[11px] truncate max-w-md" title={lyricsModalFilePath}>
							{lyricsModalFilePath}
						</code>
					{:else}
						<span class="text-neutral-500 italic text-[11px]">
							No companion file yet (will create .lrc in track folder on save)
						</span>
					{/if}
				</div>

				<a
					href="/lrc-maker?trackId={selectedLyricsTrack.id}"
					class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30 text-xs font-medium transition shrink-0"
				>
					<Mic2 class="h-3 w-3" />
					<span>Open LRC Studio</span>
				</a>
			</div>

			<!-- Status Banner -->
			{#if lyricsModalMessage}
				<div class="mt-3 p-2.5 rounded-xl border text-xs flex items-center justify-between shrink-0 {lyricsModalMessage.type === 'success' ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300' : 'bg-rose-950/40 border-rose-800/60 text-rose-300'}">
					<div class="flex items-center gap-2">
						{#if lyricsModalMessage.type === 'success'}
							<Check class="h-4 w-4 text-emerald-400 shrink-0" />
						{:else}
							<AlertTriangle class="h-4 w-4 text-rose-400 shrink-0" />
						{/if}
						<span>{lyricsModalMessage.text}</span>
					</div>
					<button type="button" onclick={() => (lyricsModalMessage = null)} class="text-neutral-400 hover:text-white text-xs">✕</button>
				</div>
			{/if}

			<!-- Lyrics Editor Textarea -->
			<div class="mt-4 flex-1 flex flex-col min-h-0">
				<div class="flex items-center justify-between text-xs text-neutral-400 mb-2 shrink-0">
					<span>Lyrics content (plain text or synced [mm:ss.xx] timestamps):</span>
					<div class="flex items-center gap-2">
						<button
							type="button"
							onclick={() => (showAlbumLrcLibModal = true)}
							class="px-2.5 py-0.5 rounded bg-indigo-950/70 border border-indigo-700/70 text-indigo-300 hover:bg-indigo-900/80 text-[11px] font-semibold transition cursor-pointer flex items-center gap-1 shadow-sm"
							title="Search and select lyrics candidates from LRCLIB"
						>
							<Sparkles class="h-3 w-3 text-indigo-400" />
							<span>Fetch LRCLIB</span>
						</button>
						<button
							type="button"
							onclick={() => {
								lyricsModalStatus = 'instrumental';
								lyricsModalText = '[00:00.00]♪';
							}}
							class="px-2 py-0.5 rounded bg-purple-950/60 border border-purple-800/60 text-purple-300 hover:bg-purple-900/60 text-[11px] font-medium transition cursor-pointer flex items-center gap-1"
							title="Mark track as instrumental ([00:00.00]♪)"
						>
							<span class="font-serif">♪</span>
							<span>Mark Instrumental</span>
						</button>
						<button
							type="button"
							onclick={() => {
								lyricsModalStatus = 'censored_lrc';
							}}
							class="px-2 py-0.5 rounded bg-orange-950/60 border border-orange-800/60 text-orange-300 hover:bg-orange-900/60 text-[11px] font-medium transition cursor-pointer flex items-center gap-1"
							title="Mark lyrics as censored .lrc (requires uncensored replacement)"
						>
							<AlertTriangle class="h-3 w-3 text-orange-400" />
							<span>Mark Censored</span>
						</button>
						<span class="text-[11px] text-neutral-500">Lyrics Status:</span>
						<select
							bind:value={lyricsModalStatus}
							class="rounded bg-neutral-950 border border-neutral-700 px-2 py-0.5 text-xs text-neutral-200 focus:outline-none focus:border-emerald-500"
						>
							{#each LYRICS_OPTIONS as opt}
								<option value={opt.value}>{opt.label}</option>
							{/each}
						</select>
					</div>
				</div>

				{#if lyricsModalLoading}
					<div class="flex-1 flex items-center justify-center p-8 bg-neutral-950 border border-neutral-800 rounded-xl text-neutral-500 text-xs">
						Loading lyrics from song folder...
					</div>
				{:else}
					<textarea
						bind:value={lyricsModalText}
						placeholder="Paste or write lyrics here..."
						rows="12"
						class="w-full flex-1 bg-neutral-950 border border-neutral-800 rounded-xl p-3.5 font-mono text-xs text-neutral-200 focus:outline-none focus:border-emerald-500 resize-none leading-relaxed"
					></textarea>
				{/if}
			</div>

			<!-- Footer Actions -->
			<div class="mt-4 flex items-center justify-between border-t border-neutral-800 pt-3 shrink-0">
				<span class="text-[11px] text-neutral-500">
					{lyricsModalText.split('\n').filter(l => l.trim()).length} lines &bull; Writes directly to disk & database
				</span>

				<div class="flex items-center gap-2">
					<button
						type="button"
						onclick={() => (selectedLyricsTrack = null)}
						class="rounded-xl bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-700 transition"
					>
						Close
					</button>
					<button
						type="button"
						onclick={saveLyricsModal}
						disabled={lyricsModalSaving || lyricsModalLoading}
						class="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 transition shadow-md shadow-emerald-600/30 disabled:opacity-50"
					>
						<Save class="h-3.5 w-3.5" />
						<span>{lyricsModalSaving ? 'Saving...' : 'Save to File & Vault'}</span>
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

{#if selectedLyricsTrack}
	<LrcLibModal
		open={showAlbumLrcLibModal}
		trackTitle={selectedLyricsTrack.title}
		trackArtist={selectedLyricsTrack.artist || album.artist}
		albumTitle={album.title}
		durationSeconds={selectedLyricsTrack.duration_ms ? selectedLyricsTrack.duration_ms / 1000 : 0}
		onSelectLyrics={handleAlbumLrcLibSelect}
		onClose={() => (showAlbumLrcLibModal = false)}
	/>
{/if}

<AddToPlaylistModal
	isOpen={showPlaylistModal}
	trackIds={playlistModalTrackIds}
	trackTitle={playlistModalTitle}
	onClose={() => (showPlaylistModal = false)}
/>

<BatchLyricsModal
	isOpen={showBatchLyricsModal}
	currentAlbumId={album.id}
	currentAlbumTitle={album.title}
	onClose={() => (showBatchLyricsModal = false)}
	onComplete={async () => {
		await invalidateAll();
	}}
/>
