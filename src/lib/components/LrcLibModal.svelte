<script lang="ts">
	import type { LrcLibCandidate, LyricsStatus } from '$lib/types/index.js';
	import {
		Sparkles,
		Search,
		Clock,
		FileText,
		Disc,
		CheckCircle2,
		AlertTriangle,
		Check,
		X,
		Music,
		RotateCw
	} from '@lucide/svelte';

	interface Props {
		open: boolean;
		trackTitle: string;
		trackArtist?: string;
		albumTitle?: string;
		durationSeconds?: number;
		onSelectLyrics: (result: {
			text: string;
			status: LyricsStatus;
			candidate: LrcLibCandidate;
		}) => void;
		onClose: () => void;
	}

	let {
		open = false,
		trackTitle,
		trackArtist = '',
		albumTitle = '',
		durationSeconds = 0,
		onSelectLyrics,
		onClose
	}: Props = $props();

	let searchQuery = $state('');
	let isSearching = $state(false);
	let candidates = $state<LrcLibCandidate[]>([]);
	let selectedCandidateId = $state<number | null>(null);
	let previewMode = $state<'synced' | 'plain'>('synced');
	let errorMessage = $state<string | null>(null);
	let searchPerformed = $state(false);

	const selectedCandidate = $derived(
		candidates.find((c) => c.id === selectedCandidateId) || (candidates.length > 0 ? candidates[0] : null)
	);

	function formatDuration(sec: number): string {
		if (isNaN(sec) || sec <= 0) return '—';
		const m = Math.floor(sec / 60);
		const s = Math.round(sec % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function getDurationDelta(candidateSec: number, localSec?: number): {
		text: string;
		colorClass: string;
		label: string;
	} {
		if (!localSec || localSec <= 0 || !candidateSec || candidateSec <= 0) {
			return {
				text: formatDuration(candidateSec),
				colorClass: 'text-neutral-400 bg-neutral-900 border-neutral-800',
				label: ''
			};
		}

		const diff = Math.round(candidateSec - localSec);
		const diffStr = diff === 0 ? 'Exact length' : diff > 0 ? `+${diff}s` : `${diff}s`;
		const absDiff = Math.abs(diff);

		if (absDiff <= 2) {
			return {
				text: `${formatDuration(candidateSec)} (${diffStr})`,
				colorClass: 'text-emerald-300 bg-emerald-950/60 border-emerald-700/60 font-semibold',
				label: 'Perfect length match'
			};
		} else if (absDiff <= 8) {
			return {
				text: `${formatDuration(candidateSec)} (${diffStr})`,
				colorClass: 'text-amber-300 bg-amber-950/60 border-amber-700/60',
				label: 'Slight timing offset'
			};
		} else {
			return {
				text: `${formatDuration(candidateSec)} (${diffStr})`,
				colorClass: 'text-rose-300 bg-rose-950/60 border-rose-800/60 font-semibold',
				label: 'Different edit / version'
			};
		}
	}

	async function performSearch(overrideQuery?: string) {
		const q = overrideQuery !== undefined ? overrideQuery.trim() : searchQuery.trim();
		if (!q && !trackTitle.trim()) {
			errorMessage = 'Please enter a search query';
			return;
		}

		isSearching = true;
		errorMessage = null;
		searchPerformed = true;

		try {
			const params = new URLSearchParams();
			if (q) {
				params.set('q', q);
			} else {
				if (trackTitle.trim()) params.set('track', trackTitle.trim());
				if (trackArtist.trim()) params.set('artist', trackArtist.trim());
				if (albumTitle.trim()) params.set('album', albumTitle.trim());
			}

			if (durationSeconds > 0) {
				params.set('duration', Math.round(durationSeconds).toString());
			}

			const res = await fetch(`/api/lyrics/search?${params.toString()}`);
			const data = await res.json();

			if (data.success && Array.isArray(data.results) && data.results.length > 0) {
				candidates = data.results;
				// Automatically select the exact match or first candidate with synced lyrics
				const exact = candidates.find((c) => c.isExactMatch);
				const firstSynced = candidates.find((c) => c.hasSynced);
				const candidateToSelect = exact || firstSynced || candidates[0];
				selectedCandidateId = candidateToSelect.id;
				previewMode = candidateToSelect.hasSynced ? 'synced' : 'plain';
			} else {
				candidates = [];
				selectedCandidateId = null;
				errorMessage = data.message || 'No lyrics candidates found on LRCLIB';
			}
		} catch (err: any) {
			console.error('Failed to query LRCLIB candidates:', err);
			candidates = [];
			selectedCandidateId = null;
			errorMessage = `LRCLIB request failed: ${err.message}`;
		} finally {
			isSearching = false;
		}
	}

	function handleCandidateClick(candidate: LrcLibCandidate) {
		selectedCandidateId = candidate.id;
		if (previewMode === 'synced' && !candidate.hasSynced && candidate.hasPlain) {
			previewMode = 'plain';
		} else if (previewMode === 'plain' && !candidate.hasPlain && candidate.hasSynced) {
			previewMode = 'synced';
		}
	}

	function applyChosen(type: 'synced' | 'plain' | 'instrumental') {
		if (!selectedCandidate) return;

		if (type === 'instrumental' || selectedCandidate.instrumental) {
			onSelectLyrics({
				text: '[00:00.00]♪',
				status: 'instrumental',
				candidate: selectedCandidate
			});
			return;
		}

		if (type === 'synced' && selectedCandidate.syncedLyrics) {
			onSelectLyrics({
				text: selectedCandidate.syncedLyrics,
				status: 'synced_lrc',
				candidate: selectedCandidate
			});
			return;
		}

		if (type === 'plain' && selectedCandidate.plainLyrics) {
			onSelectLyrics({
				text: selectedCandidate.plainLyrics,
				status: 'plain_txt',
				candidate: selectedCandidate
			});
		}
	}

	$effect(() => {
		if (open) {
			const initialQ = [trackArtist, trackTitle].filter(Boolean).join(' ').trim();
			searchQuery = initialQ;
			errorMessage = null;
			searchPerformed = false;
			candidates = [];
			selectedCandidateId = null;
			performSearch(initialQ);
		}
	});
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md animate-in fade-in duration-150"
		role="dialog"
		aria-modal="true"
	>
		<div
			class="relative flex flex-col w-full max-w-4xl h-[90vh] max-h-[760px] bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden"
		>
			<!-- Top Header & Search Bar -->
			<div class="border-b border-neutral-800 bg-neutral-950/90 p-4 sm:p-5 shrink-0 space-y-3">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2.5">
						<div class="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
							<Sparkles class="h-4 w-4" />
						</div>
						<div>
							<h2 class="text-sm sm:text-base font-bold text-white flex items-center gap-2">
								<span>LRCLIB Lyrics Candidates</span>
								<span class="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-semibold text-neutral-400">
									LRCGET Engine
								</span>
							</h2>
							<p class="text-xs text-neutral-400">
								{#if trackTitle}
									Searching for: <strong class="text-neutral-200">{trackArtist ? `${trackArtist} - ` : ''}{trackTitle}</strong>
								{/if}
								{#if durationSeconds > 0}
									<span class="ml-1 text-neutral-500">({formatDuration(durationSeconds)})</span>
								{/if}
							</p>
						</div>
					</div>

					<button
						type="button"
						onclick={onClose}
						class="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white transition cursor-pointer"
						title="Close"
					>
						<X class="h-5 w-5" />
					</button>
				</div>

				<!-- Search Input with Execute Button -->
				<form
					onsubmit={(e) => {
						e.preventDefault();
						performSearch();
					}}
					class="relative flex items-center gap-2"
				>
					<div class="relative flex-1">
						<Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
						<input
							type="text"
							bind:value={searchQuery}
							placeholder="Search by artist and song title..."
							class="w-full rounded-xl border border-neutral-700 bg-neutral-900 pl-9 pr-3 py-2 text-xs sm:text-sm text-neutral-100 placeholder-neutral-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
						/>
					</div>

					<button
						type="submit"
						disabled={isSearching}
						class="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs sm:text-sm font-semibold text-white shadow-md transition hover:bg-indigo-500 disabled:opacity-50 cursor-pointer shrink-0"
					>
						{#if isSearching}
							<RotateCw class="h-4 w-4 animate-spin" />
							<span>Searching...</span>
						{:else}
							<Search class="h-4 w-4" />
							<span>Search</span>
						{/if}
					</button>
				</form>
			</div>

			<!-- Main 2-Pane Body -->
			<div class="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0 divide-y md:divide-y-0 md:divide-x divide-neutral-800">
				<!-- Left Pane: Candidates List -->
				<div class="w-full md:w-[45%] flex flex-col min-h-0 bg-neutral-950/40">
					<!-- List Header -->
					<div class="px-3.5 py-2.5 border-b border-neutral-800/80 flex items-center justify-between text-xs text-neutral-400 bg-neutral-900/40">
						<span class="font-medium">
							{#if isSearching}
								Fetching results from LRCLIB...
							{:else if candidates.length > 0}
								<strong class="text-white font-bold">{candidates.length}</strong> {candidates.length === 1 ? 'candidate' : 'candidates'} found
							{:else if searchPerformed}
								No matching candidates
							{:else}
								Ready to search
							{/if}
						</span>

						{#if durationSeconds > 0}
							<span class="text-[11px] text-neutral-500 flex items-center gap-1">
								<Clock class="h-3 w-3" />
								Your audio: <strong class="text-neutral-300">{formatDuration(durationSeconds)}</strong>
							</span>
						{/if}
					</div>

					<!-- Candidate Cards Scrollable -->
					<div class="flex-1 overflow-y-auto p-3 space-y-2">
						{#if isSearching}
							<div class="flex flex-col items-center justify-center py-16 text-center text-neutral-400 space-y-3">
								<RotateCw class="h-7 w-7 text-indigo-400 animate-spin" />
								<p class="text-xs">Querying LRCLIB database...</p>
							</div>
						{:else if candidates.length > 0}
							{#each candidates as candidate (candidate.id)}
								{@const delta = getDurationDelta(candidate.duration, durationSeconds)}
								{@const isSelected = selectedCandidateId === candidate.id}

								<button
									type="button"
									onclick={() => handleCandidateClick(candidate)}
									class="w-full text-left rounded-xl border p-3 transition duration-150 cursor-pointer flex flex-col justify-between gap-2.5 {isSelected ? 'bg-indigo-950/30 border-indigo-500/80 ring-1 ring-indigo-500 shadow-md' : 'bg-neutral-900/60 border-neutral-800/80 hover:bg-neutral-900 hover:border-neutral-700'}"
								>
									<div class="flex items-start justify-between gap-2">
										<div class="min-w-0 flex-1">
											<div class="flex items-center gap-1.5 flex-wrap">
												<span class="font-bold text-xs sm:text-sm text-neutral-100 truncate {isSelected ? 'text-indigo-300' : ''}">
													{candidate.trackName}
												</span>
												{#if candidate.isExactMatch}
													<span class="inline-flex items-center gap-0.5 rounded-full bg-emerald-950 px-1.5 py-0.2 text-[10px] font-semibold text-emerald-300 border border-emerald-700/60">
														<CheckCircle2 class="h-2.5 w-2.5" />
														Exact Match
													</span>
												{/if}
											</div>

											<p class="text-xs font-medium text-neutral-400 truncate mt-0.5">
												{candidate.artistName}
											</p>

											{#if candidate.albumName}
												<div class="flex items-center gap-1 text-[11px] text-neutral-500 truncate mt-1">
													<Disc class="h-3 w-3 shrink-0" />
													<span class="truncate">{candidate.albumName}</span>
												</div>
											{/if}
										</div>

										<!-- Duration Pill with delta -->
										<div class="shrink-0 flex flex-col items-end gap-1">
											<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] {delta.colorClass}" title={delta.label}>
												<Clock class="h-3 w-3 shrink-0" />
												<span>{delta.text}</span>
											</span>
										</div>
									</div>

									<!-- Format Badges -->
									<div class="flex items-center gap-1.5 pt-1 border-t border-neutral-800/50">
										{#if candidate.hasSynced}
											<span class="inline-flex items-center gap-1 rounded bg-indigo-950/80 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300 border border-indigo-700/60">
												<Clock class="h-3 w-3" />
												Synced LRC
											</span>
										{/if}

										{#if candidate.hasPlain}
											<span class="inline-flex items-center gap-1 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-300 border border-neutral-700">
												<FileText class="h-3 w-3" />
												Plain TXT
											</span>
										{/if}

										{#if candidate.instrumental}
											<span class="inline-flex items-center gap-1 rounded bg-purple-950/80 px-1.5 py-0.5 text-[10px] font-semibold text-purple-300 border border-purple-700/60">
												<span>♪</span>
												Instrumental
											</span>
										{/if}
									</div>
								</button>
							{/each}
						{:else}
							<div class="flex flex-col items-center justify-center py-16 text-center text-neutral-400 space-y-2 px-4">
								<AlertTriangle class="h-8 w-8 text-amber-400/80" />
								<p class="text-xs font-semibold text-neutral-200">
									{errorMessage || 'No candidates found'}
								</p>
								<p class="text-[11px] text-neutral-500 max-w-xs">
									Try simplifying your query (e.g. remove featuring artists or special characters) and search again.
								</p>
							</div>
						{/if}
					</div>
				</div>

				<!-- Right Pane: Lyrics Preview -->
				<div class="w-full md:w-[55%] flex flex-col min-h-0 bg-neutral-900/30">
					{#if selectedCandidate}
						<!-- Preview Header Toolbar -->
						<div class="px-4 py-2.5 border-b border-neutral-800 flex items-center justify-between text-xs bg-neutral-950/60">
							<div class="flex items-center gap-2">
								<span class="font-semibold text-neutral-300">Preview:</span>
								<div class="flex items-center rounded-lg border border-neutral-800 bg-neutral-950 p-0.5">
									{#if selectedCandidate.hasSynced}
										<button
											type="button"
											onclick={() => (previewMode = 'synced')}
											class="px-2.5 py-0.5 rounded text-xs font-medium transition cursor-pointer {previewMode === 'synced' ? 'bg-indigo-600 text-white font-semibold' : 'text-neutral-400 hover:text-white'}"
										>
											Synced LRC
										</button>
									{/if}
									{#if selectedCandidate.hasPlain}
										<button
											type="button"
											onclick={() => (previewMode = 'plain')}
											class="px-2.5 py-0.5 rounded text-xs font-medium transition cursor-pointer {previewMode === 'plain' ? 'bg-indigo-600 text-white font-semibold' : 'text-neutral-400 hover:text-white'}"
										>
											Plain Text
										</button>
									{/if}
								</div>
							</div>

							<div class="text-[11px] text-neutral-400">
								{#if previewMode === 'synced' && selectedCandidate.syncedLyrics}
									<span>{selectedCandidate.syncedLyrics.split('\n').filter((l) => l.trim()).length} timed lines</span>
								{:else if selectedCandidate.plainLyrics}
									<span>{selectedCandidate.plainLyrics.split('\n').filter((l) => l.trim()).length} lines</span>
								{/if}
							</div>
						</div>

						<!-- Preview Content Box -->
						<div class="flex-1 overflow-y-auto p-4 bg-neutral-950/80 font-mono text-xs leading-relaxed text-neutral-300 whitespace-pre-wrap select-text">
							{#if selectedCandidate.instrumental}
								<div class="flex flex-col items-center justify-center h-full text-center py-10 space-y-3">
									<div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-950/80 border border-purple-500/40 text-purple-300 text-2xl font-serif">
										♪
									</div>
									<div>
										<h4 class="font-bold text-sm text-purple-200">Track Marked as Instrumental</h4>
										<p class="text-xs text-neutral-400 mt-1 max-w-sm">
											LRCLIB reports this track contains no vocals. You can load it with the universal instrumental marker.
										</p>
									</div>
								</div>
							{:else if previewMode === 'synced' && selectedCandidate.syncedLyrics}
								{selectedCandidate.syncedLyrics}
							{:else if selectedCandidate.plainLyrics}
								{selectedCandidate.plainLyrics}
							{:else}
								<p class="text-neutral-500 italic">No lyrics content available for this mode.</p>
							{/if}
						</div>

						<!-- Action Footer for Selected Candidate -->
						<div class="p-3.5 border-t border-neutral-800 bg-neutral-950/90 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
							<div class="text-xs text-neutral-400 truncate max-w-[220px] sm:max-w-[280px]">
								<strong class="text-white">{selectedCandidate.trackName}</strong>
								<span class="text-neutral-500">({formatDuration(selectedCandidate.duration)})</span>
							</div>

							<div class="flex items-center gap-2">
								{#if selectedCandidate.instrumental}
									<button
										type="button"
										onclick={() => applyChosen('instrumental')}
										class="flex items-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-md transition cursor-pointer"
									>
										<span>♪</span>
										<span>Apply as Instrumental</span>
									</button>
								{:else}
									{#if selectedCandidate.hasPlain}
										<button
											type="button"
											onclick={() => applyChosen('plain')}
											class="rounded-xl border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-200 transition cursor-pointer"
										>
											Use Plain Text
										</button>
									{/if}

									{#if selectedCandidate.hasSynced}
										<button
											type="button"
											onclick={() => applyChosen('synced')}
											class="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3.5 py-1.5 text-xs font-bold text-white shadow-md shadow-emerald-950/40 transition cursor-pointer"
										>
											<Check class="h-3.5 w-3.5" />
											<span>Use Synced LRC</span>
										</button>
									{/if}
								{/if}
							</div>
						</div>
					{:else}
						<div class="flex flex-col items-center justify-center flex-1 p-6 text-center text-neutral-500 space-y-2">
							<Music class="h-8 w-8 text-neutral-600" />
							<p class="text-xs font-medium text-neutral-400">Select a candidate on the left to preview its lyrics</p>
						</div>
					{/if}
				</div>
			</div>

			<!-- Bottom Dismiss Bar -->
			<div class="border-t border-neutral-800 bg-neutral-950 px-4 py-2.5 flex items-center justify-between text-xs text-neutral-500 shrink-0">
				<span>Community-driven lyrics from <strong>lrclib.net</strong></span>
				<button
					type="button"
					onclick={onClose}
					class="rounded-lg px-3 py-1 bg-neutral-900 border border-neutral-800 text-neutral-300 hover:text-white hover:bg-neutral-800 transition cursor-pointer"
				>
					Close
				</button>
			</div>
		</div>
	</div>
{/if}
