<script lang="ts">
	import { onMount } from 'svelte';
	import type { Album, AudioFormat, QualityRating, LyricsStatus } from '$lib/types/index.js';
	import { formatDuration } from '$lib/utils.js';
	import {
		Layers,
		ArrowRight,
		ArrowLeftRight,
		Check,
		X,
		Sparkles,
		AlertTriangle,
		Search,
		Music,
		Disc,
		RefreshCw,
		CheckCheck,
		Info,
		Plus,
		ChevronRight,
		ExternalLink
	} from '@lucide/svelte';

	interface MergeTrackItem {
		id: string;
		primary_track_id?: number | null;
		secondary_track_id?: number | null;
		title: string;
		artist: string;
		disc_number: number;
		track_number: number;
		duration_ms: number | null;
		format: AudioFormat;
		bitrate_kbps: number | null;
		quality_rating: QualityRating;
		lyrics: LyricsStatus;
		action: 'keep' | 'add' | 'upgrade' | 'duplicate_skip';
		action_label: string;
		source: 'primary' | 'secondary';
		source_album_title: string;
		source_file_path: string | null;
		upgrade_reason?: string | null;
		selected: boolean;
	}

	interface MergePreviewResult {
		targetAlbum: Album;
		sourceAlbum: Album;
		tracks: MergeTrackItem[];
		summary: {
			existingCount: number;
			addedCount: number;
			upgradedCount: number;
			skippedCount: number;
			totalFinalCount: number;
		};
	}

	let {
		isOpen = $bindable(false),
		initialPrimaryAlbum = null,
		initialSecondaryAlbum = null,
		allAlbums = [],
		onmerged
	}: {
		isOpen: boolean;
		initialPrimaryAlbum?: Album | null;
		initialSecondaryAlbum?: Album | null;
		allAlbums?: Album[];
		onmerged?: (albumId: number) => void;
	} = $props();

	let primaryAlbum = $state<Album | null>(initialPrimaryAlbum);
	let secondaryAlbum = $state<Album | null>(initialSecondaryAlbum);

	let albumsList = $state<Album[]>(allAlbums || []);
	let isLoadingAlbums = $state(false);
	let searchAlbumQuery = $state('');

	let previewResult = $state<MergePreviewResult | null>(null);
	let isLoadingPreview = $state(false);
	let isApplyingMerge = $state(false);
	let errorMessage = $state<string | null>(null);
	let successMessage = $state<string | null>(null);

	let keepMetadataFrom = $state<'primary' | 'secondary'>('primary');
	let filterChangesOnly = $state(false);

	// Sync initial albums when modal opens
	$effect(() => {
		if (isOpen) {
			if (initialPrimaryAlbum) primaryAlbum = initialPrimaryAlbum;
			if (initialSecondaryAlbum) secondaryAlbum = initialSecondaryAlbum;
			if (albumsList.length === 0) {
				fetchAlbumsList();
			}
			if (primaryAlbum && secondaryAlbum) {
				fetchMergePreview(primaryAlbum.id, secondaryAlbum.id);
			}
		} else {
			previewResult = null;
			errorMessage = null;
			successMessage = null;
		}
	});

	async function fetchAlbumsList(query?: string) {
		isLoadingAlbums = true;
		try {
			const url = query ? `/api/albums?q=${encodeURIComponent(query)}` : '/api/albums';
			const res = await fetch(url);
			if (res.ok) {
				const data = await res.json();
				if (Array.isArray(data)) {
					albumsList = data;
				}
			}
		} catch (e) {
			console.error('Failed to fetch albums list:', e);
		} finally {
			isLoadingAlbums = false;
		}
	}

	async function fetchMergePreview(targetId: number, sourceId: number) {
		if (targetId === sourceId) return;
		isLoadingPreview = true;
		errorMessage = null;
		try {
			const res = await fetch(`/api/library/merge?targetAlbumId=${targetId}&sourceAlbumId=${sourceId}`);
			const data = await res.json();
			if (!res.ok || data.error) {
				errorMessage = data.error || 'Failed to generate merge preview.';
				previewResult = null;
				return;
			}
			previewResult = data.preview;
		} catch (e: any) {
			console.error('Merge preview error:', e);
			errorMessage = e.message || 'Failed to fetch merge preview.';
			previewResult = null;
		} finally {
			isLoadingPreview = false;
		}
	}

	function selectSecondaryAlbum(album: Album) {
		secondaryAlbum = album;
		if (primaryAlbum) {
			fetchMergePreview(primaryAlbum.id, album.id);
		}
	}

	function swapAlbums() {
		if (!primaryAlbum || !secondaryAlbum) return;
		const temp = primaryAlbum;
		primaryAlbum = secondaryAlbum;
		secondaryAlbum = temp;
		fetchMergePreview(primaryAlbum.id, secondaryAlbum.id);
	}

	function handleAutoRenumber() {
		if (!previewResult) return;
		const discGroups = new Map<number, MergeTrackItem[]>();
		for (const tr of previewResult.tracks) {
			if (!tr.selected || tr.action === 'duplicate_skip') continue;
			const d = tr.disc_number || 1;
			if (!discGroups.has(d)) discGroups.set(d, []);
			discGroups.get(d)!.push(tr);
		}

		for (const [_, tracks] of discGroups.entries()) {
			let num = 1;
			for (const tr of tracks) {
				tr.track_number = num++;
			}
		}
	}

	function toggleAllTracks(selectAll: boolean) {
		if (!previewResult) return;
		for (const tr of previewResult.tracks) {
			if (tr.action === 'duplicate_skip') continue;
			tr.selected = selectAll;
		}
	}

	async function applyMerge() {
		if (!primaryAlbum || !secondaryAlbum || !previewResult) return;

		const selectedTracks = previewResult.tracks.filter((t) => t.selected);
		if (selectedTracks.length === 0) {
			errorMessage = 'Please select at least one track to include in the merged album.';
			return;
		}

		isApplyingMerge = true;
		errorMessage = null;

		try {
			const res = await fetch('/api/library/merge', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					type: 'vault_albums',
					targetAlbumId: primaryAlbum.id,
					sourceAlbumId: secondaryAlbum.id,
					options: {
						keepMetadataFrom
					},
					customTracks: previewResult.tracks.map((t) => ({
						id: t.id,
						primary_track_id: t.primary_track_id,
						secondary_track_id: t.secondary_track_id,
						disc_number: t.disc_number,
						track_number: t.track_number,
						action: t.action,
						selected: t.selected
					}))
				})
			});

			const data = await res.json();
			if (!res.ok || data.error) {
				errorMessage = data.error || 'Failed to merge albums.';
				return;
			}

			successMessage = data.message || `Successfully merged into "${primaryAlbum.title}".`;
			setTimeout(() => {
				isOpen = false;
				if (onmerged && primaryAlbum) {
					onmerged(primaryAlbum.id);
				} else {
					window.location.reload();
				}
			}, 1200);
		} catch (e: any) {
			console.error('Failed to apply merge:', e);
			errorMessage = e.message || 'Error occurred while applying album merge.';
		} finally {
			isApplyingMerge = false;
		}
	}

	// Filtered album suggestions for secondary picker
	let matchingAlbums = $derived(
		albumsList.filter((a) => {
			if (!primaryAlbum) return false;
			if (a.id === primaryAlbum.id) return false;
			const pTitle = primaryAlbum.title.toLowerCase();
			const aTitle = a.title.toLowerCase();
			const pArtist = primaryAlbum.artist.toLowerCase();
			const aArtist = a.artist.toLowerCase();
			return aTitle.includes(pTitle) || pTitle.includes(aTitle) || aArtist === pArtist;
		})
	);

	let otherAlbums = $derived(
		albumsList.filter((a) => {
			if (!primaryAlbum) return true;
			if (a.id === primaryAlbum.id) return false;
			if (matchingAlbums.some((m) => m.id === a.id)) return false;
			if (!searchAlbumQuery.trim()) return true;
			const q = searchAlbumQuery.toLowerCase();
			return a.title.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q);
		})
	);

	let displayedTableTracks = $derived(
		previewResult
			? previewResult.tracks.filter((t) => {
					if (filterChangesOnly) {
						return t.action === 'add' || t.action === 'upgrade';
					}
					return true;
				})
			: []
	);

	let selectedTracksCount = $derived(
		previewResult ? previewResult.tracks.filter((t) => t.selected && t.action !== 'duplicate_skip').length : 0
	);
</script>

{#if isOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-5 animate-in fade-in duration-200"
		role="dialog"
		aria-modal="true"
	>
		<div
			class="relative w-full max-w-5xl rounded-3xl border border-neutral-800 bg-neutral-900/95 p-5 sm:p-7 shadow-2xl backdrop-blur-xl animate-in zoom-in-95 duration-200 space-y-5 flex flex-col max-h-[92vh]"
		>
			<!-- Close button -->
			<button
				type="button"
				onclick={() => (isOpen = false)}
				class="absolute right-5 top-5 rounded-full p-2 text-neutral-400 hover:bg-neutral-800 hover:text-white transition cursor-pointer"
				aria-label="Close dialog"
			>
				<X class="h-4 w-4" />
			</button>

			<!-- Header -->
			<div class="flex items-center gap-3.5 pr-8">
				<div
					class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-purple-950/80 border border-purple-500/40 text-purple-300 shadow-md shadow-purple-950/50"
				>
					<Layers class="h-5 w-5" />
				</div>
				<div class="min-w-0">
					<h3 class="text-base sm:text-lg font-black text-white flex items-center gap-2">
						<span>Merge Albums</span>
						<span class="rounded-full bg-purple-950 border border-purple-500/50 px-2 py-0.2 text-[10px] font-bold text-purple-300">
							Vault Studio
						</span>
					</h3>
					<p class="text-xs text-neutral-400">
						Combine split albums, append missing songs (e.g. singles/bonus tracks), and upgrade duplicate songs with higher audio quality.
					</p>
				</div>
			</div>

			<!-- Album Selector Comparison Cards -->
			<div class="grid grid-cols-1 md:grid-cols-2 gap-3 items-stretch relative">
				<!-- Primary Album Card (Target / Kept) -->
				<div class="rounded-2xl border border-emerald-500/50 bg-emerald-950/20 p-3.5 flex flex-col justify-between space-y-2">
					<div class="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-emerald-400">
						<span class="flex items-center gap-1.5">
							<span class="h-2 w-2 rounded-full bg-emerald-400"></span>
							Primary Album (Target to Keep)
						</span>
						<span class="text-[9px] bg-emerald-900/60 border border-emerald-600/50 px-2 py-0.5 rounded-full text-emerald-200">
							Preserved in Vault
						</span>
					</div>

					{#if primaryAlbum}
						<div class="flex items-center gap-3 min-w-0">
							<div class="h-14 w-14 shrink-0 rounded-xl overflow-hidden bg-neutral-950 border border-neutral-700 shadow">
								{#if primaryAlbum.cover_url}
									<img src={primaryAlbum.cover_url} alt={primaryAlbum.title} class="h-full w-full object-cover" />
								{:else}
									<div class="h-full w-full flex items-center justify-center text-neutral-600">
										<Disc class="h-6 w-6" />
									</div>
								{/if}
							</div>
							<div class="min-w-0 flex-1">
								<h4 class="text-sm font-bold text-white truncate" title={primaryAlbum.title}>
									{primaryAlbum.title}
								</h4>
								<p class="text-xs text-neutral-300 truncate">
									{primaryAlbum.artist} {#if primaryAlbum.release_year}• {primaryAlbum.release_year}{/if}
								</p>
								<div class="flex items-center gap-2 text-[10px] text-neutral-400 mt-0.5">
									<span>{primaryAlbum.track_count} tracks</span>
									{#if primaryAlbum.media_type}<span>• {primaryAlbum.media_type}</span>{/if}
								</div>
							</div>
						</div>
					{:else}
						<div class="py-4 text-center text-xs text-neutral-400">
							No primary album selected
						</div>
					{/if}
				</div>

				<!-- Swap Button -->
				{#if primaryAlbum && secondaryAlbum}
					<button
						type="button"
						onclick={swapAlbums}
						class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 hidden md:flex items-center justify-center h-8 w-8 rounded-full bg-neutral-800 hover:bg-neutral-700 border border-neutral-600 text-neutral-200 shadow-xl transition cursor-pointer hover:rotate-180 duration-200"
						title="Swap Primary and Secondary albums"
					>
						<ArrowLeftRight class="h-3.5 w-3.5" />
					</button>
				{/if}

				<!-- Secondary Album Card (Source / Merged & Removed) -->
				<div class="rounded-2xl border border-purple-500/50 bg-purple-950/20 p-3.5 flex flex-col justify-between space-y-2">
					<div class="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-purple-400">
						<span class="flex items-center gap-1.5">
							<span class="h-2 w-2 rounded-full bg-purple-400"></span>
							Secondary Album (Source to Merge In)
						</span>
						<span class="text-[9px] bg-purple-900/60 border border-purple-600/50 px-2 py-0.5 rounded-full text-purple-200">
							Tracks will move over
						</span>
					</div>

					{#if secondaryAlbum}
						<div class="flex items-center justify-between gap-3 min-w-0">
							<div class="flex items-center gap-3 min-w-0 flex-1">
								<div class="h-14 w-14 shrink-0 rounded-xl overflow-hidden bg-neutral-950 border border-neutral-700 shadow">
									{#if secondaryAlbum.cover_url}
										<img src={secondaryAlbum.cover_url} alt={secondaryAlbum.title} class="h-full w-full object-cover" />
									{:else}
										<div class="h-full w-full flex items-center justify-center text-neutral-600">
											<Disc class="h-6 w-6" />
										</div>
									{/if}
								</div>
								<div class="min-w-0 flex-1">
									<h4 class="text-sm font-bold text-white truncate" title={secondaryAlbum.title}>
										{secondaryAlbum.title}
									</h4>
									<p class="text-xs text-neutral-300 truncate">
										{secondaryAlbum.artist} {#if secondaryAlbum.release_year}• {secondaryAlbum.release_year}{/if}
									</p>
									<div class="flex items-center gap-2 text-[10px] text-neutral-400 mt-0.5">
										<span>{secondaryAlbum.track_count} tracks</span>
										{#if secondaryAlbum.media_type}<span>• {secondaryAlbum.media_type}</span>{/if}
									</div>
								</div>
							</div>

							<button
								type="button"
								onclick={() => (secondaryAlbum = null)}
								class="rounded-xl border border-neutral-700 bg-neutral-800/80 hover:bg-neutral-800 px-2.5 py-1 text-[11px] font-semibold text-neutral-300 transition cursor-pointer shrink-0"
							>
								Change
							</button>
						</div>
					{:else}
						<!-- Searchable Album Picker -->
						<div class="space-y-2">
							<div class="relative">
								<Search class="absolute left-3 top-2.5 h-3.5 w-3.5 text-neutral-500" />
								<input
									type="text"
									bind:value={searchAlbumQuery}
									oninput={() => fetchAlbumsList(searchAlbumQuery)}
									placeholder="Search album to merge (e.g. Kamikaze)..."
									class="w-full rounded-xl border border-neutral-700 bg-neutral-950 pl-8 pr-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:border-purple-500 focus:outline-none"
								/>
							</div>

							<!-- Suggested Albums List -->
							<div class="max-h-36 overflow-y-auto space-y-1 pr-1 text-xs">
								{#if matchingAlbums.length > 0}
									<div class="text-[9px] font-bold uppercase tracking-wider text-purple-400 pt-1">
										Suggested Matches ({matchingAlbums.length}):
									</div>
									{#each matchingAlbums as ma (ma.id)}
										<button
											type="button"
											onclick={() => selectSecondaryAlbum(ma)}
											class="w-full text-left rounded-xl p-2 bg-purple-950/40 hover:bg-purple-900/60 border border-purple-800/40 flex items-center justify-between gap-2 transition cursor-pointer"
										>
											<div class="min-w-0 flex-1 truncate">
												<span class="font-bold text-white">{ma.title}</span>
												<span class="text-neutral-400"> • {ma.artist} ({ma.track_count} tr)</span>
											</div>
											<span class="text-[9px] bg-purple-800 px-1.5 py-0.2 rounded text-purple-200 shrink-0 font-bold">Select</span>
										</button>
									{/each}
								{/if}

								{#if otherAlbums.length > 0}
									{#if matchingAlbums.length > 0}
										<div class="text-[9px] font-bold uppercase tracking-wider text-neutral-400 pt-1.5">
											Other Albums:
										</div>
									{/if}
									{#each otherAlbums.slice(0, 10) as oa (oa.id)}
										<button
											type="button"
											onclick={() => selectSecondaryAlbum(oa)}
											class="w-full text-left rounded-xl p-2 bg-neutral-950/60 hover:bg-neutral-800/60 border border-neutral-800 flex items-center justify-between gap-2 transition cursor-pointer"
										>
											<div class="min-w-0 flex-1 truncate">
												<span class="font-bold text-neutral-200">{oa.title}</span>
												<span class="text-neutral-500"> • {oa.artist} ({oa.track_count} tr)</span>
											</div>
											<ChevronRight class="h-3 w-3 text-neutral-500 shrink-0" />
										</button>
									{/each}
								{:else if matchingAlbums.length === 0}
									<div class="py-3 text-center text-neutral-500 text-[11px]">
										{isLoadingAlbums ? 'Searching albums...' : 'No other albums found'}
									</div>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			</div>

			<!-- Loading or Error States -->
			{#if isLoadingPreview}
				<div class="py-12 flex flex-col items-center justify-center gap-2 text-neutral-400">
					<RefreshCw class="h-6 w-6 animate-spin text-purple-400" />
					<p class="text-xs font-semibold">Simulating merge and comparing track audio quality...</p>
				</div>
			{:else if errorMessage}
				<div class="rounded-2xl border border-rose-500/40 bg-rose-950/30 p-4 text-xs text-rose-300 flex items-start gap-2.5">
					<AlertTriangle class="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
					<div>{errorMessage}</div>
				</div>
			{:else if successMessage}
				<div class="rounded-2xl border border-emerald-500/40 bg-emerald-950/30 p-4 text-xs text-emerald-300 flex items-center gap-2.5">
					<Check class="h-4 w-4 shrink-0 text-emerald-400" />
					<div class="font-bold">{successMessage}</div>
				</div>
			{:else if previewResult}
				<!-- Merge Options & Summary Banner -->
				<div class="space-y-3 min-h-0 flex-1 flex flex-col">
					<div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-2xl border border-neutral-800 bg-neutral-950/60 p-3 text-xs">
						<div class="flex items-center gap-2">
							<span class="rounded-full bg-purple-950 border border-purple-500/50 px-2.5 py-0.5 text-xs font-bold text-purple-300">
								Final: {previewResult.summary.totalFinalCount} Tracks
							</span>
							<span class="text-neutral-300 text-[11px]">
								({previewResult.summary.existingCount} kept,
								<strong class="text-purple-300">{previewResult.summary.addedCount} new added</strong>,
								<strong class="text-cyan-300">{previewResult.summary.upgradedCount} upgraded</strong>)
							</span>
						</div>

						<div class="flex items-center gap-3">
							<div class="flex items-center gap-1.5 text-[11px] text-neutral-400">
								<span>Keep Metadata:</span>
								<select
									bind:value={keepMetadataFrom}
									class="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 focus:outline-none focus:border-purple-500 cursor-pointer"
								>
									<option value="primary">Primary ("{previewResult.targetAlbum.title}")</option>
									<option value="secondary">Secondary ("{previewResult.sourceAlbum.title}")</option>
								</select>
							</div>

							<button
								type="button"
								onclick={handleAutoRenumber}
								class="rounded-lg border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 px-2.5 py-1 text-[11px] font-semibold text-neutral-200 transition cursor-pointer"
								title="Renumber all active tracks sequentially 1..N without gaps"
							>
								Renumber 1..N
							</button>

							<button
								type="button"
								onclick={() => (filterChangesOnly = !filterChangesOnly)}
								class="rounded-lg border border-neutral-700 px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer {filterChangesOnly ? 'bg-purple-950 text-purple-300 border-purple-600' : 'bg-neutral-900 text-neutral-400 hover:text-white'}"
							>
								{filterChangesOnly ? 'Show All Tracks' : 'Show Changes Only'}
							</button>
						</div>
					</div>

					<!-- Final Tracklist Preview Table -->
					<div class="flex-1 min-h-[220px] max-h-[46vh] overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-950/80">
						<table class="w-full text-left border-collapse text-xs">
							<thead class="sticky top-0 z-10 bg-neutral-900 border-b border-neutral-800 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
								<tr>
									<th class="py-2.5 px-3 text-center w-10">
										<input
											type="checkbox"
											checked={previewResult.tracks.filter((t) => t.action !== 'duplicate_skip').every((t) => t.selected)}
											onchange={(e) => toggleAllTracks(e.currentTarget.checked)}
											class="rounded border-neutral-700 text-purple-600 focus:ring-purple-500 bg-neutral-950 cursor-pointer"
										/>
									</th>
									<th class="py-2.5 px-3 text-center w-16">Track #</th>
									<th class="py-2.5 px-3 text-center w-14">Disc</th>
									<th class="py-2.5 px-3">Song Title & Artist</th>
									<th class="py-2.5 px-3 text-center">Merge Action</th>
									<th class="py-2.5 px-3">Audio Fidelity</th>
									<th class="py-2.5 px-3">Source</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-neutral-800/60">
								{#each displayedTableTracks as tr (tr.id)}
									<tr class="hover:bg-neutral-800/30 transition {tr.action === 'duplicate_skip' ? 'opacity-40 bg-neutral-950' : tr.selected ? '' : 'opacity-40'}">
										<!-- Checkbox -->
										<td class="py-2.5 px-3 text-center">
											<input
												type="checkbox"
												bind:checked={tr.selected}
												disabled={tr.action === 'duplicate_skip'}
												class="rounded border-neutral-700 text-purple-600 focus:ring-purple-500 bg-neutral-950 cursor-pointer"
											/>
										</td>

										<!-- Track Number -->
										<td class="py-2.5 px-3 text-center">
											<input
												type="number"
												bind:value={tr.track_number}
												min="1"
												max="999"
												disabled={!tr.selected || tr.action === 'duplicate_skip'}
												class="w-12 text-center rounded-lg border border-neutral-700 bg-neutral-950 py-1 text-xs font-mono font-bold text-white focus:border-purple-500 focus:outline-none disabled:opacity-40"
											/>
										</td>

										<!-- Disc Number -->
										<td class="py-2.5 px-3 text-center font-mono text-neutral-400 text-xs">
											{tr.disc_number}
										</td>

										<!-- Title & Artist -->
										<td class="py-2.5 px-3 min-w-[200px]">
											<div class="font-bold text-white truncate {tr.action === 'add' ? 'text-purple-200' : ''}" title={tr.title}>
												{tr.title}
											</div>
											<div class="text-[10px] text-neutral-400 truncate">
												{tr.artist}
											</div>
										</td>

										<!-- Action Pill -->
										<td class="py-2.5 px-3 text-center whitespace-nowrap">
											{#if tr.action === 'add'}
												<span class="inline-flex items-center gap-1 rounded-full bg-purple-950 border border-purple-500/60 px-2 py-0.5 text-[10px] font-black text-purple-300">
													<Plus class="h-3 w-3" />
													<span>+ Add Song</span>
												</span>
											{:else if tr.action === 'upgrade'}
												<span class="inline-flex items-center gap-1 rounded-full bg-cyan-950 border border-cyan-500/60 px-2 py-0.5 text-[10px] font-black text-cyan-300" title={tr.upgrade_reason || ''}>
													<Sparkles class="h-3 w-3" />
													<span>Upgrade Audio</span>
												</span>
											{:else if tr.action === 'keep'}
												<span class="inline-flex items-center gap-1 rounded-full bg-emerald-950/70 border border-emerald-600/50 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
													<Check class="h-3 w-3" />
													<span>Keep Existing</span>
												</span>
											{:else}
												<span class="inline-flex items-center gap-1 rounded-full bg-neutral-900 border border-neutral-700 px-2 py-0.5 text-[10px] font-medium text-neutral-400" title={tr.upgrade_reason || ''}>
													<span>Duplicate (Skip)</span>
												</span>
											{/if}
										</td>

										<!-- Audio Fidelity -->
										<td class="py-2.5 px-3 whitespace-nowrap">
											<div class="flex items-center gap-1.5 text-[11px] text-neutral-300">
												<span class="font-bold {tr.format === 'FLAC' || tr.format === 'ALAC' ? 'text-emerald-400' : 'text-neutral-200'}">
													{tr.format}
												</span>
												{#if tr.bitrate_kbps}<span>• {tr.bitrate_kbps} kbps</span>{/if}
												{#if tr.duration_ms}<span>• {formatDuration(tr.duration_ms)}</span>{/if}
											</div>
											{#if tr.upgrade_reason && tr.action === 'upgrade'}
												<div class="text-[9px] text-cyan-400 truncate max-w-xs font-mono mt-0.5">
													{tr.upgrade_reason}
												</div>
											{/if}
										</td>

										<!-- Source Album -->
										<td class="py-2.5 px-3 whitespace-nowrap text-[10px] text-neutral-400">
											<span class="{tr.source === 'secondary' ? 'text-purple-300 font-semibold' : 'text-neutral-400'}">
												{tr.source === 'primary' ? 'Primary Album' : 'Secondary Album'}
											</span>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/if}

			<!-- Footer -->
			<div class="flex items-center justify-between pt-2 border-t border-neutral-800 text-xs">
				<div class="text-neutral-400 text-[11px]">
					{#if previewResult}
						<span>Ready to merge: <strong>{selectedTracksCount}</strong> songs in final album.</span>
					{:else}
						<span>Select both albums above to preview the combined tracklist.</span>
					{/if}
				</div>

				<div class="flex items-center gap-2.5">
					<button
						type="button"
						onclick={() => (isOpen = false)}
						class="rounded-xl border border-neutral-800 bg-neutral-800/60 hover:bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-300 transition cursor-pointer"
					>
						Cancel
					</button>

					<button
						type="button"
						onclick={applyMerge}
						disabled={!previewResult || isApplyingMerge || selectedTracksCount === 0}
						class="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-purple-900/30 transition disabled:opacity-50 cursor-pointer"
					>
						{#if isApplyingMerge}
							<RefreshCw class="h-3.5 w-3.5 animate-spin" />
							<span>Merging Albums...</span>
						{:else}
							<Check class="h-3.5 w-3.5" />
							<span>Apply & Merge Albums ({selectedTracksCount} Tracks)</span>
						{/if}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
