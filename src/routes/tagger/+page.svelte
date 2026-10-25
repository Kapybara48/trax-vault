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
		TrackMatch
	} from '$lib/types/index.js';
	import { formatDuration } from '$lib/utils.js';
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
		X,
		Music,
		Image as ImageIcon,
		CheckCheck
	} from '@lucide/svelte';

	let { data }: { data: PageData } = $props();

	// Library albums list
	let albums = $state<Album[]>([...data.albums]);

	// Sidebar filter state
	let sidebarSearch = $state('');
	let sidebarFilter = $state<'all' | 'unverified' | 'needs_attention' | 'lossy'>('all');

	// Active Album & MusicBrainz State
	let selectedAlbumId = $state<number | null>(data.initialAlbumId || (albums.length > 0 ? albums[0].id : null));
	let selectedAlbum = $derived(albums.find((a) => a.id === selectedAlbumId) || null);

	let mbSearchQuery = $state('');
	let isSearchingMB = $state(false);
	let candidateReleases = $state<MusicBrainzReleaseItem[]>([]);
	let selectedReleaseMbid = $state<string | null>(null);
	let releaseDetail = $state<MusicBrainzReleaseDetail | null>(null);

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
	let overallScore = $state(0);
	let isLoadingMatches = $state(false);
	let isApplyingTags = $state(false);
	let statusMessage = $state<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

	// Apply Options
	let optUpdateCover = $state(true);
	let optUpdateAlbumTitle = $state(true);
	let optUpdateArtist = $state(true);
	let optUpdateYear = $state(true);

	// Filtered Library Albums
	const filteredAlbums = $derived(
		albums.filter((a) => {
			const matchesText =
				!sidebarSearch.trim() ||
				a.title.toLowerCase().includes(sidebarSearch.toLowerCase()) ||
				a.artist.toLowerCase().includes(sidebarSearch.toLowerCase());

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

	// Summary stats
	const selectedCount = $derived(matches.filter((m) => m.selected && m.mbTrack).length);
	const allSelected = $derived(matches.length > 0 && matches.every((m) => m.selected));

	function toggleSelectAll() {
		const next = !allSelected;
		for (const m of matches) {
			m.selected = next;
		}
	}

	// Trigger match on album selection
	$effect(() => {
		if (selectedAlbumId) {
			loadAlbumAndMatch(selectedAlbumId);
		}
	});

	async function loadAlbumAndMatch(albumId: number, targetMbid?: string) {
		isLoadingMatches = true;
		statusMessage = null;
		matches = [];
		candidateReleases = [];
		releaseDetail = null;

		const currentAlb = albums.find((a) => a.id === albumId);
		if (currentAlb) {
			mbSearchQuery = `${currentAlb.title} - ${currentAlb.artist}`;
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
			statusMessage = { type: 'error', text: `Error loading matches: ${err.message}` };
		} finally {
			isLoadingMatches = false;
		}
	}

	async function searchMusicBrainzReleases() {
		if (!mbSearchQuery.trim()) return;
		isSearchingMB = true;
		statusMessage = null;

		try {
			const res = await fetch(`/api/tagger/search?query=${encodeURIComponent(mbSearchQuery.trim())}`);
			const data = await res.json();
			if (data.releases) {
				candidateReleases = data.releases;
				if (candidateReleases.length === 0) {
					statusMessage = { type: 'info', text: 'No MusicBrainz releases found for this query.' };
				}
			}
		} catch (err: any) {
			statusMessage = { type: 'error', text: `Search failed: ${err.message}` };
		} finally {
			isSearchingMB = false;
		}
	}

	function handleRemapTrack(matchIndex: number, newMbTrackId: string) {
		if (!releaseDetail) return;
		const targetMbTrack = releaseDetail.tracks.find((t) => t.id === newMbTrackId) || null;
		const m = matches[matchIndex];
		if (!m) return;

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

	async function applyConfirmedTags() {
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
					updateCover: optUpdateCover,
					updateAlbumTitle: optUpdateAlbumTitle,
					updateArtist: optUpdateArtist,
					updateYear: optUpdateYear
				})
			});

			const json = await res.json();
			if (!res.ok || json.error) {
				statusMessage = { type: 'error', text: json.error || 'Failed to apply tags.' };
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

			statusMessage = {
				type: 'success',
				text: `Successfully wrote tags to ${json.updatedTracksCount} audio files and updated library!`
			};

			// Refresh alignment diff
			await loadAlbumAndMatch(selectedAlbumId, selectedReleaseMbid);
		} catch (err: any) {
			console.error('Apply error:', err);
			statusMessage = { type: 'error', text: `Failed to write tags: ${err.message}` };
		} finally {
			isApplyingTags = false;
		}
	}
</script>

<svelte:head>
	<title>MusicBrainz Tagger Studio - Track Vault</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
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
				Search official releases, align tracks, download high-resolution cover art, and write verified ID3/Vorbis tags directly into audio files.
			</p>
		</div>

		<!-- Quick Actions -->
		<div class="flex items-center gap-2">
			{#if selectedAlbum}
				<a
					href="/album/{selectedAlbum.id}"
					class="flex items-center gap-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 px-3.5 py-2 text-xs font-semibold text-neutral-300 border border-neutral-700 transition"
				>
					<ExternalLink class="h-3.5 w-3.5" />
					<span>View Album Page</span>
				</a>
			{/if}
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
			class="mb-6 rounded-2xl p-4 flex items-center justify-between gap-3 text-xs font-medium border shadow-lg transition-all {statusMessage.type === 'success' ? 'bg-emerald-950/70 border-emerald-600/60 text-emerald-200' : statusMessage.type === 'error' ? 'bg-rose-950/70 border-rose-600/60 text-rose-200' : 'bg-neutral-900 border-neutral-700 text-neutral-300'}"
		>
			<div class="flex items-center gap-2.5">
				{#if statusMessage.type === 'success'}
					<CheckCircle2 class="h-4 w-4 text-emerald-400 shrink-0" />
				{:else if statusMessage.type === 'error'}
					<AlertTriangle class="h-4 w-4 text-rose-400 shrink-0" />
				{:else}
					<Sparkles class="h-4 w-4 text-indigo-400 shrink-0" />
				{/if}
				<span>{statusMessage.text}</span>
			</div>
			<button
				type="button"
				onclick={() => (statusMessage = null)}
				class="p-1 rounded text-neutral-400 hover:text-white transition"
			>
				<X class="h-3.5 w-3.5" />
			</button>
		</div>
	{/if}

	<!-- 2-Pane Layout: Album Drawer (Left) & Studio Diff Stage (Right) -->
	<div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
		<!-- Left Pane: Library Albums (col-span-4) -->
		<div class="lg:col-span-4 rounded-3xl border border-neutral-800 bg-neutral-900/50 p-4 sm:p-5 backdrop-blur-xl shadow-xl space-y-4">
			<div class="flex items-center justify-between pb-3 border-b border-neutral-800/80">
				<div class="flex items-center gap-2">
					<Layers class="h-4 w-4 text-emerald-400" />
					<h2 class="text-sm font-bold text-white">Your Library</h2>
				</div>
				<span class="rounded-full bg-neutral-800 px-2 py-0.5 text-[11px] font-semibold text-neutral-400">
					{albums.length} albums
				</span>
			</div>

			<!-- Search & Filter Controls -->
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
						class="w-full text-left p-2.5 rounded-2xl border transition flex items-center gap-3 {selectedAlbumId === alb.id ? 'bg-emerald-950/60 border-emerald-500/70 shadow-md shadow-emerald-950/50' : 'bg-neutral-950/40 border-neutral-800/70 hover:bg-neutral-800/40 hover:border-neutral-700'}"
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
		</div>

		<!-- Right Pane: Main Tagger Studio (col-span-8) -->
		<div class="lg:col-span-8 space-y-6">
			{#if !selectedAlbum}
				<div class="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-12 text-center backdrop-blur-xl">
					<Tag class="h-10 w-10 text-neutral-600 mx-auto mb-3" />
					<h3 class="text-base font-bold text-white">Select an Album to Tag</h3>
					<p class="text-xs text-neutral-400 mt-1 max-w-sm mx-auto">
						Choose any album from your library on the left to start automatic MusicBrainz matching and tag alignment.
					</p>
				</div>
			{:else}
				<!-- Album Active Hero & MusicBrainz Search Box -->
				<div class="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-5 backdrop-blur-xl shadow-xl space-y-5">
					<div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
						<div class="flex items-center gap-3.5">
							<div class="h-14 w-14 shrink-0 rounded-2xl overflow-hidden bg-neutral-950 border border-neutral-700 shadow-md">
								{#if selectedAlbum.cover_url}
									<img src={selectedAlbum.cover_url} alt={selectedAlbum.title} class="h-full w-full object-cover" />
								{:else}
									<div class="h-full w-full flex items-center justify-center text-neutral-600">
										<Music class="h-6 w-6" />
									</div>
								{/if}
							</div>
							<div>
								<span class="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Current Library Album</span>
								<h2 class="text-lg font-black text-white">{selectedAlbum.title}</h2>
								<p class="text-xs text-neutral-300 font-medium">
									{selectedAlbum.artist} {selectedAlbum.release_year ? `(${selectedAlbum.release_year})` : ''} • {selectedAlbum.track_count} tracks
								</p>
							</div>
						</div>

						<!-- Match Confidence Score -->
						{#if releaseDetail}
							<div class="flex flex-col items-end">
								<span class="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Match Confidence</span>
								<div class="flex items-center gap-1.5 mt-0.5">
									<span class="rounded-full px-3 py-0.5 text-xs font-black border {overallScore >= 90 ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300' : overallScore >= 70 ? 'bg-cyan-950/80 border-cyan-500 text-cyan-300' : 'bg-amber-950/80 border-amber-500 text-amber-300'}">
										{overallScore}% Match
									</span>
								</div>
							</div>
						{/if}
					</div>

					<!-- MusicBrainz Query Search Input -->
					<div class="pt-4 border-t border-neutral-800/80 flex flex-col sm:flex-row gap-2">
						<div class="relative flex-1">
							<Search class="absolute left-3 top-2.5 h-4 w-4 text-neutral-500" />
							<input
								type="text"
								bind:value={mbSearchQuery}
								onkeydown={(e) => {
									if (e.key === 'Enter') searchMusicBrainzReleases();
								}}
								placeholder="Search MusicBrainz by release and artist..."
								class="w-full rounded-xl border border-neutral-700 bg-neutral-950 pl-9 pr-3 py-2 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
							/>
						</div>
						<button
							type="button"
							onclick={searchMusicBrainzReleases}
							disabled={isSearchingMB}
							class="flex items-center justify-center gap-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 px-4 py-2 text-xs font-bold text-neutral-200 border border-neutral-700 transition disabled:opacity-50 cursor-pointer"
						>
							{#if isSearchingMB}
								<RefreshCw class="h-3.5 w-3.5 animate-spin text-emerald-400" />
								<span>Searching...</span>
							{:else}
								<Search class="h-3.5 w-3.5 text-emerald-400" />
								<span>Search Releases</span>
							{/if}
						</button>
					</div>

					<!-- Candidate Releases Selector -->
					{#if candidateReleases.length > 0}
						<div class="space-y-2">
							<div class="flex items-center justify-between text-[11px] text-neutral-400 font-semibold uppercase tracking-wider">
								<span>Select MusicBrainz Release ({candidateReleases.length} candidates):</span>
							</div>

							<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-56 overflow-y-auto pr-1">
								{#each candidateReleases as rel (rel.id)}
									<button
										type="button"
										onclick={() => loadAlbumAndMatch(selectedAlbum!.id, rel.id)}
										class="p-2.5 rounded-2xl border text-left flex items-start gap-2.5 transition cursor-pointer {selectedReleaseMbid === rel.id ? 'bg-emerald-950/70 border-emerald-500 shadow-md shadow-emerald-950/60 ring-1 ring-emerald-500' : 'bg-neutral-950/50 border-neutral-800 hover:bg-neutral-800/50 hover:border-neutral-700'}"
									>
										<!-- Release Thumbnail -->
										<div class="h-10 w-10 shrink-0 rounded-lg overflow-hidden bg-neutral-900 border border-neutral-800 relative">
											{#if rel.cover_url}
												<img src={rel.cover_url} alt={rel.title} class="h-full w-full object-cover" />
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
											<div class="text-[9px] text-neutral-500 flex items-center gap-1.5 mt-0.5">
												<span>{rel.media_format || 'CD'}</span>
												{#if rel.year}<span>• {rel.year}</span>{/if}
												{#if rel.track_count}<span>• {rel.track_count} tr</span>{/if}
												{#if rel.country}<span>• {rel.country}</span>{/if}
											</div>
										</div>
									</button>
								{/each}
							</div>
						</div>
					{/if}
				</div>

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
									<span>Write Tags to Files & Library ({selectedCount} songs)</span>
								{/if}
							</button>
						</div>
					</div>
				{/if}

				<!-- Side-by-Side Track Diff Table -->
				<div class="rounded-3xl border border-neutral-800 bg-neutral-900/60 overflow-hidden backdrop-blur-xl shadow-xl">
					<div class="p-4 sm:p-5 border-b border-neutral-800 flex items-center justify-between">
						<div class="flex items-center gap-2.5">
							<SlidersHorizontal class="h-4 w-4 text-emerald-400" />
							<h3 class="text-sm font-bold text-white">Track Tag Alignment Preview</h3>
							<span class="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-semibold text-neutral-400">
								{matches.length} tracks
							</span>
						</div>

						{#if matches.length > 0}
							<button
								type="button"
								onclick={toggleSelectAll}
								class="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition font-medium cursor-pointer"
							>
								<CheckCheck class="h-3.5 w-3.5 text-emerald-400" />
								<span>{allSelected ? 'Deselect All' : 'Select All'}</span>
							</button>
						{/if}
					</div>

					{#if isLoadingMatches}
						<div class="py-16 text-center text-xs text-neutral-400">
							<RefreshCw class="h-6 w-6 animate-spin text-emerald-400 mx-auto mb-2" />
							<span>Querying MusicBrainz and aligning audio tracks...</span>
						</div>
					{:else if matches.length === 0}
						<div class="py-16 text-center text-xs text-neutral-400">
							<Tag class="h-6 w-6 text-neutral-600 mx-auto mb-2" />
							<span>No track alignment available. Please select a candidate release above.</span>
						</div>
					{:else}
						<div class="overflow-x-auto">
							<table class="w-full text-left text-xs">
								<thead>
									<tr class="border-b border-neutral-800 bg-neutral-950/60 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
										<th class="py-3 px-3 w-10 text-center">Write</th>
										<th class="py-3 px-3">Current Local Track</th>
										<th class="py-3 px-3 text-center">Match</th>
										<th class="py-3 px-3">Target MusicBrainz Track</th>
									</tr>
								</thead>
								<tbody class="divide-y divide-neutral-800/60">
									{#each matches as m, i (m.localTrack.id)}
										<tr class="hover:bg-neutral-800/30 transition {m.selected ? 'bg-neutral-900/30' : 'opacity-60'}">
											<!-- Checkbox -->
											<td class="py-3 px-3 text-center">
												<input
													type="checkbox"
													bind:checked={m.selected}
													disabled={!m.mbTrack}
													class="rounded border-neutral-700 text-emerald-600 focus:ring-emerald-500 bg-neutral-950 cursor-pointer"
												/>
											</td>

											<!-- Current Local Track Details -->
											<td class="py-3 px-3 min-w-[200px]">
												<div class="flex items-center gap-2">
													<span class="font-mono text-[11px] text-neutral-500 w-6 shrink-0">
														{m.localTrack.disc_number > 1 ? `${m.localTrack.disc_number}-` : ''}{m.localTrack.track_number.toString().padStart(2, '0')}
													</span>
													<div class="min-w-0">
														<div class="font-semibold text-neutral-200 truncate {m.titleDiff ? 'text-amber-200' : ''}">
															{m.localTrack.title}
														</div>
														<div class="text-[10px] text-neutral-400 truncate">
															{m.localTrack.artist || selectedAlbum?.artist} • {formatDuration(m.localTrack.duration_ms)} • {m.localTrack.format}
														</div>
													</div>
												</div>
											</td>

											<!-- Match Indicator Pill -->
											<td class="py-3 px-3 text-center whitespace-nowrap">
												{#if m.matchType === 'exact'}
													<span class="inline-flex items-center gap-1 rounded-full bg-emerald-950/80 border border-emerald-600/60 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
														<Check class="h-3 w-3" />
														<span>100% Match</span>
													</span>
												{:else if m.matchType === 'high'}
													<span class="inline-flex items-center gap-1 rounded-full bg-cyan-950/80 border border-cyan-600/60 px-2 py-0.5 text-[10px] font-bold text-cyan-300">
														<Sparkles class="h-3 w-3" />
														<span>{m.score}% Match</span>
													</span>
												{:else if m.matchType === 'medium'}
													<span class="inline-flex items-center gap-1 rounded-full bg-amber-950/80 border border-amber-600/60 px-2 py-0.5 text-[10px] font-bold text-amber-300">
														<AlertTriangle class="h-3 w-3" />
														<span>{m.score}% Diff</span>
													</span>
												{:else}
													<span class="inline-flex items-center gap-1 rounded-full bg-neutral-900 border border-neutral-700 px-2 py-0.5 text-[10px] font-medium text-neutral-400">
														<span>Unmatched</span>
													</span>
												{/if}
											</td>

											<!-- Target MusicBrainz Track & Remap Dropdown -->
											<td class="py-3 px-3 min-w-[260px]">
												{#if releaseDetail}
													<div class="flex items-center gap-2">
														<select
															value={m.mbTrack?.id || ''}
															onchange={(e) => handleRemapTrack(i, e.currentTarget.value)}
															class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-emerald-500 font-medium truncate"
														>
															<option value="">(No Match / Skip)</option>
															{#each releaseDetail.tracks as mbTr (mbTr.id)}
																<option value={mbTr.id}>
																	{mbTr.disc_number > 1 ? `${mbTr.disc_number}-` : ''}{mbTr.track_number.toString().padStart(2, '0')}. {mbTr.title} ({formatDuration(mbTr.duration_ms)})
																</option>
															{/each}
														</select>
													</div>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>
