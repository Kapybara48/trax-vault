<script lang="ts">
	import type { PageData } from './$types.js';
	import type { Track, AudioFormat, LyricsStatus, CensorshipStatus, QualityRating } from '$lib/types/index.js';
	import {
		formatDuration,
		FORMAT_OPTIONS,
		QUALITY_OPTIONS,
		CENSORSHIP_OPTIONS,
		LYRICS_OPTIONS,
		getFormatBadgeClass,
		getBitrateLabel
	} from '$lib/utils.js';
	import {
		TriangleAlert,
		ShieldAlert,
		FileText,
		Disc3,
		CheckCircle2,
		Search,
		Sparkles,
		Disc,
		ExternalLink,
		ArrowRight,
		Filter,
		RotateCcw,
		Mic2,
		Sliders,
		ChevronDown,
		ChevronUp,
		Info,
		ShieldCheck,
		Music2
	} from '@lucide/svelte';
	import CustomCheckbox from '$lib/components/CustomCheckbox.svelte';
	import { goto, invalidateAll } from '$app/navigation';

	let { data }: { data: PageData } = $props();

	let tracks = $state<Track[]>([...data.tracks]);

	// Global rules details accordion toggle
	let showRulesDetails = $state(false);

	// Local interactive search & filters
	let localSearch = $state(data.searchQuery || '');
	let localCensorship = $state<string>('all');
	let localLyrics = $state<string>('all');
	let localQuality = $state<string>('all');
	let localFormat = $state<string>('all');
	let localChecked = $state<string>('all');

	$effect(() => {
		tracks = [...data.tracks];
	});

	// Client-side computed filtered list
	const filteredTracks = $derived.by(() => {
		return tracks.filter((t) => {
			// Search text filter
			if (localSearch.trim()) {
				const q = localSearch.trim().toLowerCase();
				const titleMatch = t.title.toLowerCase().includes(q);
				const artistMatch = (t.artist || '').toLowerCase().includes(q);
				const albumTitleMatch = (t.album_title || '').toLowerCase().includes(q);
				const albumArtistMatch = (t.album_artist || '').toLowerCase().includes(q);
				if (!titleMatch && !artistMatch && !albumTitleMatch && !albumArtistMatch) {
					return false;
				}
			}

			// Censorship filter
			if (localCensorship !== 'all' && t.censorship !== localCensorship) {
				return false;
			}

			// Lyrics filter
			if (localLyrics !== 'all' && t.lyrics !== localLyrics) {
				return false;
			}

			// Quality filter
			if (localQuality !== 'all') {
				if (localQuality === 'issues') {
					if (t.quality_rating !== 'bad' && t.quality_rating !== 'needs_upgrade') return false;
				} else if (t.quality_rating !== localQuality) {
					return false;
				}
			}

			// Format filter
			if (localFormat !== 'all') {
				if (localFormat === 'lossless') {
					if (!['FLAC', 'ALAC', 'WAV', 'AIFF'].includes(t.format)) return false;
				} else if (localFormat === 'mp3') {
					if (!t.format.startsWith('MP3')) return false;
				} else if (t.format !== localFormat) {
					return false;
				}
			}

			// Manually checked filter
			if (localChecked !== 'all') {
				if ((t.manually_checked || 0).toString() !== localChecked) {
					return false;
				}
			}

			return true;
		});
	});

	function resetFilters() {
		localSearch = '';
		localCensorship = 'all';
		localLyrics = 'all';
		localQuality = 'all';
		localFormat = 'all';
		localChecked = 'all';
	}

	function setIssueType(type: string) {
		const params = new URLSearchParams(window.location.search);
		params.set('type', type);
		goto(`/issues?${params.toString()}`);
	}

	async function quickFix(trackId: number, patch: Partial<Track>) {
		try {
			const res = await fetch(`/api/tracks/${trackId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(patch)
			});

			if (res.ok) {
				const resData = await res.json();
				const updated: Track = resData.track;
				const idx = tracks.findIndex((t) => t.id === trackId);
				if (idx !== -1) {
					tracks[idx] = updated;
				}
				await invalidateAll();
			}
		} catch (err) {
			console.error('Failed to quick-fix track:', err);
		}
	}
</script>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<!-- Page Header -->
	<div class="mb-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
		<div>
			<div class="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-400">
				<TriangleAlert class="h-4 w-4 text-emerald-400" />
				Trax Vault Fixer
			</div>
			<h1 class="mt-1 text-2xl sm:text-3xl font-black text-white">
				Track Fixer
			</h1>
			<p class="mt-1 text-xs text-neutral-400">
				Audit and repair audio fidelity, sync companion lyrics, and resolve library quality issues.
			</p>
		</div>

		<button
			type="button"
			onclick={() => (showRulesDetails = !showRulesDetails)}
			class="self-start md:self-auto flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/80 px-3.5 py-2 text-xs font-semibold text-neutral-300 hover:text-white hover:bg-neutral-800/90 transition shadow-sm cursor-pointer"
		>
			<Sliders class="h-3.5 w-3.5 text-emerald-400" />
			<span>{showRulesDetails ? 'Hide Global Rules' : 'Global Quality Rules & Standards'}</span>
			{#if showRulesDetails}
				<ChevronUp class="h-3.5 w-3.5 text-neutral-400" />
			{:else}
				<ChevronDown class="h-3.5 w-3.5 text-neutral-400" />
			{/if}
		</button>
	</div>

	<!-- Global Rules & Standards Banner -->
	<div class="mb-6 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 sm:p-5 backdrop-blur-md shadow-xl">
		<div class="flex items-center justify-between gap-2 mb-3.5">
			<div class="flex items-center gap-2.5">
				<div class="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
					<ShieldCheck class="h-4 w-4" />
				</div>
				<div>
					<h2 class="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
						Vault Global Quality Standards
						<span class="rounded bg-emerald-950/80 border border-emerald-500/40 px-1.5 py-0.5 text-[10px] font-mono text-emerald-300 font-bold">
							Active
						</span>
					</h2>
					<p class="text-[11px] text-neutral-400 mt-0.5">
						Criteria songs must meet to be considered healthy. Tracks failing any rule are flagged for attention.
					</p>
				</div>
			</div>
		</div>

		<!-- 4 Pillars Grid -->
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
			<!-- 1. Audio Fidelity -->
			<div class="rounded-xl border border-neutral-800/80 bg-neutral-950/50 p-3 flex flex-col justify-between">
				<div>
					<div class="flex items-center justify-between text-xs font-bold text-white mb-1.5">
						<span class="flex items-center gap-1.5">
							<Disc3 class="h-3.5 w-3.5 text-emerald-400" />
							Audio Fidelity
						</span>
						<span class="text-[9px] font-mono font-bold text-emerald-400 bg-emerald-950/60 px-1.5 py-0.2 rounded border border-emerald-500/30">
							Lossless
						</span>
					</div>
					<p class="text-[11px] text-neutral-400 leading-relaxed">
						FLAC or ALAC (16/24-bit) preferred. MP3 320/V0 accepted.
					</p>
				</div>
				<div class="mt-2.5 pt-2 border-t border-neutral-800/60 text-[10px] text-neutral-500 flex items-center gap-1">
					<span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
					<span>Flags &lt;192 kbps or bad quality</span>
				</div>
			</div>

			<!-- 2. Synced Lyrics -->
			<div class="rounded-xl border border-neutral-800/80 bg-neutral-950/50 p-3 flex flex-col justify-between">
				<div>
					<div class="flex items-center justify-between text-xs font-bold text-white mb-1.5">
						<span class="flex items-center gap-1.5">
							<FileText class="h-3.5 w-3.5 text-emerald-400" />
							Lyrics & Karaoke
						</span>
						<span class="text-[9px] font-mono font-bold text-emerald-400 bg-emerald-950/60 px-1.5 py-0.2 rounded border border-emerald-500/30">
							Synced .LRC
						</span>
					</div>
					<p class="text-[11px] text-neutral-400 leading-relaxed">
						Synchronized timestamps or verified ♪ Instrumental status.
					</p>
				</div>
				<div class="mt-2.5 pt-2 border-t border-neutral-800/60 text-[10px] text-neutral-500 flex items-center gap-1">
					<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
					<span>Flags missing or unsynced LRC</span>
				</div>
			</div>

			<!-- 3. Explicit / Censorship -->
			<div class="rounded-xl border border-neutral-800/80 bg-neutral-950/50 p-3 flex flex-col justify-between">
				<div>
					<div class="flex items-center justify-between text-xs font-bold text-white mb-1.5">
						<span class="flex items-center gap-1.5">
							<ShieldAlert class="h-3.5 w-3.5 text-emerald-400" />
							Authenticity
						</span>
						<span class="text-[9px] font-mono font-bold text-emerald-400 bg-emerald-950/60 px-1.5 py-0.2 rounded border border-emerald-500/30">
							Explicit
						</span>
					</div>
					<p class="text-[11px] text-neutral-400 leading-relaxed">
						Original uncensored audio recording and lyric text.
					</p>
				</div>
				<div class="mt-2.5 pt-2 border-t border-neutral-800/60 text-[10px] text-neutral-500 flex items-center gap-1">
					<span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
					<span>Flags radio edits & censored LRC</span>
				</div>
			</div>

			<!-- 4. Release Completeness -->
			<div class="rounded-xl border border-neutral-800/80 bg-neutral-950/50 p-3 flex flex-col justify-between">
				<div>
					<div class="flex items-center justify-between text-xs font-bold text-white mb-1.5">
						<span class="flex items-center gap-1.5">
							<CheckCircle2 class="h-3.5 w-3.5 text-emerald-400" />
							Completeness
						</span>
						<span class="text-[9px] font-mono font-bold text-emerald-400 bg-emerald-950/60 px-1.5 py-0.2 rounded border border-emerald-500/30">
							100% Tracklist
						</span>
					</div>
					<p class="text-[11px] text-neutral-400 leading-relaxed">
						All tracks from the official MusicBrainz release present.
					</p>
				</div>
				<div class="mt-2.5 pt-2 border-t border-neutral-800/60 text-[10px] text-neutral-500 flex items-center gap-1">
					<span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
					<span>Flags missing album tracks</span>
				</div>
			</div>
		</div>

		<!-- Expandable Detailed Rules Breakdown -->
		{#if showRulesDetails}
			<div class="mt-4 pt-4 border-t border-neutral-800/80 text-xs text-neutral-300 animate-in fade-in duration-200">
				<h3 class="font-bold text-white text-xs uppercase tracking-wider mb-2 flex items-center gap-2">
					<Info class="h-3.5 w-3.5 text-emerald-400" />
					Detailed Rules Specification & Overrides
				</h3>
				<div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] text-neutral-400 leading-relaxed">
					<div class="rounded-lg bg-neutral-950/40 p-3 border border-neutral-800/60 space-y-1.5">
						<div class="font-semibold text-neutral-200">Default Global Detection Flags:</div>
						<div class="flex items-center gap-2 text-neutral-300">
							<span class="text-emerald-400 font-bold font-mono">✓</span>
							<span><strong class="text-neutral-200">Bad Quality</strong>: Bitrates &lt; 128 kbps or corrupted audio stream.</span>
						</div>
						<div class="flex items-center gap-2 text-neutral-300">
							<span class="text-emerald-400 font-bold font-mono">✓</span>
							<span><strong class="text-neutral-200">Needs Upgrade</strong>: Lossy bitrates between 128 kbps and 192 kbps.</span>
						</div>
						<div class="flex items-center gap-2 text-neutral-300">
							<span class="text-emerald-400 font-bold font-mono">✓</span>
							<span><strong class="text-neutral-200">Missing Lyrics</strong>: No companion .lrc/.txt file or embedded tag found.</span>
						</div>
						<div class="flex items-center gap-2 text-neutral-300">
							<span class="text-emerald-400 font-bold font-mono">✓</span>
							<span><strong class="text-neutral-200">Unsynced LRC</strong>: Lyrics without precise line timestamps.</span>
						</div>
						<div class="flex items-center gap-2 text-neutral-300">
							<span class="text-emerald-400 font-bold font-mono">✓</span>
							<span><strong class="text-neutral-200">Censored Audio / Lyrics</strong>: Bleeped or muted explicit tracks.</span>
						</div>
					</div>

					<div class="rounded-lg bg-neutral-950/40 p-3 border border-neutral-800/60 space-y-1.5">
						<div class="font-semibold text-neutral-200">Per-Album Rule Customization:</div>
						<p>
							Any album can override these standards in its <strong class="text-neutral-200">Album Details &gt; Fixer Rules</strong> menu. For example, you can enforce strict lossless-only mode (<code class="text-emerald-400">flag_lossy: true</code>), allow clean radio edits for specific records, or permit plain text lyrics.
						</p>
						<p class="pt-1">
							Once you've inspected a track and confirmed it meets your standards, click <strong class="text-neutral-200">Manual Check</strong> (<code class="text-emerald-400">✓</code>) to permanently clear it from attention.
						</p>
					</div>
				</div>
			</div>
		{/if}
	</div>

	<!-- Top Issue Type Tabs -->
	<div class="mb-5 flex flex-wrap items-center gap-2 border-b border-neutral-800 pb-3">
		<button
			type="button"
			onclick={() => setIssueType('all_issues')}
			class="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition {data.activeType === 'all_issues' ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30' : 'bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'}"
		>
			<TriangleAlert class="h-3.5 w-3.5" />
			All Issues ({data.stats.total_needs_attention})
		</button>

		<button
			type="button"
			onclick={() => setIssueType('bad_quality')}
			class="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition {data.activeType === 'bad_quality' ? 'bg-rose-600 text-white shadow-sm shadow-rose-600/30' : 'bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'}"
		>
			<Disc3 class="h-3.5 w-3.5" />
			Bad Quality ({data.stats.bad_quality_count})
		</button>

		<button
			type="button"
			onclick={() => setIssueType('censored')}
			class="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition {data.activeType === 'censored' ? 'bg-rose-600 text-white shadow-sm shadow-rose-600/30' : 'bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'}"
		>
			<ShieldAlert class="h-3.5 w-3.5" />
			Censored ({data.stats.censored_count})
		</button>

		<button
			type="button"
			onclick={() => setIssueType('missing_lyrics')}
			class="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition {data.activeType === 'missing_lyrics' ? 'bg-amber-600 text-white shadow-sm shadow-amber-600/30' : 'bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'}"
		>
			<FileText class="h-3.5 w-3.5" />
			Missing Lyrics ({data.stats.missing_lyrics_count})
		</button>

		<button
			type="button"
			onclick={() => setIssueType('unsynced_lyrics')}
			class="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition {data.activeType === 'unsynced_lyrics' ? 'bg-amber-700 text-white shadow-sm shadow-amber-700/30' : 'bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'}"
		>
			<FileText class="h-3.5 w-3.5 text-amber-300" />
			Unsynced LRC ({data.stats.unsynced_lyrics_count})
		</button>

		<button
			type="button"
			onclick={() => setIssueType('censored_lyrics')}
			class="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition {data.activeType === 'censored_lyrics' ? 'bg-orange-600 text-white shadow-sm shadow-orange-600/30' : 'bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'}"
		>
			<FileText class="h-3.5 w-3.5 text-orange-300" />
			Censored LRC ({data.stats.censored_lyrics_count || 0})
		</button>

		{#if (data.stats.missing_tracks_count || 0) > 0}
			<button
				type="button"
				onclick={() => setIssueType('missing_tracks')}
				class="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition {data.activeType === 'missing_tracks' ? 'bg-rose-700 text-white shadow-sm shadow-rose-700/30' : 'bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'}"
				title="Show missing songs from tagged releases"
			>
				<TriangleAlert class="h-3.5 w-3.5 text-rose-400" />
				Missing Songs ({data.stats.missing_tracks_count})
			</button>
		{/if}

		<button
			type="button"
			onclick={() => setIssueType('unverified')}
			class="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition {data.activeType === 'unverified' ? 'bg-amber-700 text-white shadow-sm shadow-amber-700/30' : 'bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'}"
			title="Show songs not yet manually checked"
		>
			<TriangleAlert class="h-3.5 w-3.5 text-amber-400" />
			Unverified ({data.stats.total_tracks - (data.stats.checked_tracks_count || 0)})
		</button>
	</div>

	<!-- Local Multi-Criteria Filter & Search Toolbar -->
	<div class="mb-6 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 shadow-lg backdrop-blur">
		<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
			<!-- Instant Text Search Input -->
			<div class="relative flex-1">
				<Search class="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
				<input
					type="text"
					bind:value={localSearch}
					placeholder="Instant filter by song title, artist, or album..."
					class="w-full rounded-xl border border-neutral-700 bg-neutral-950 pl-10 pr-4 py-2 text-xs sm:text-sm text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
				/>
			</div>

			<!-- Filter Selects -->
			<div class="flex flex-wrap items-center gap-2">
				<!-- Verification Filter -->
				<select
					bind:value={localChecked}
					class="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-neutral-200 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
				>
					<option value="all">All Verification</option>
					<option value="0">Unverified Only</option>
					<option value="1">Checked Only</option>
				</select>
				<!-- Censorship Filter -->
				<select
					bind:value={localCensorship}
					class="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-neutral-200 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
				>
					<option value="all">All Censorship</option>
					<option value="censored">Censored Only</option>
					<option value="explicit">Explicit Only</option>
					<option value="clean_original">Clean Original</option>
				</select>

				<!-- Lyrics Filter -->
				<select
					bind:value={localLyrics}
					class="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-neutral-200 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
				>
					<option value="all">All Lyrics</option>
					<option value="missing">Missing Lyrics</option>
					<option value="censored_lrc">Censored .LRC</option>
					<option value="unsynced_lrc">Unsynced .LRC</option>
					<option value="plain_txt">Plain TXT</option>
					<option value="synced_lrc">Synced .LRC</option>
					<option value="instrumental">Instrumental</option>
				</select>

				<!-- Quality Filter -->
				<select
					bind:value={localQuality}
					class="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-neutral-200 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
				>
					<option value="all">All Qualities</option>
					<option value="issues">Bad / Needs Upgrade</option>
					<option value="good">Good</option>
					<option value="perfect">Perfect</option>
					<option value="acceptable">Acceptable</option>
				</select>

				<!-- Format Filter -->
				<select
					bind:value={localFormat}
					class="rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs text-neutral-200 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
				>
					<option value="all">All Formats</option>
					<option value="lossless">FLAC / Lossless</option>
					<option value="mp3">MP3 Any Bitrate</option>
					<option value="MP3_320">MP3 320kbps</option>
					<option value="MP3_128">MP3 128kbps (Bad)</option>
				</select>

				{#if localSearch || localCensorship !== 'all' || localLyrics !== 'all' || localQuality !== 'all' || localFormat !== 'all'}
					<button
						type="button"
						onclick={resetFilters}
						class="flex items-center gap-1 rounded-xl bg-neutral-800 px-3 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-700 hover:text-white transition"
						title="Reset all filters"
					>
						<RotateCcw class="h-3 w-3" />
						Reset
					</button>
				{/if}
			</div>
		</div>

		<div class="mt-2.5 flex items-center justify-between text-xs text-neutral-400">
			<span>
				Showing <strong class="text-emerald-400 font-bold">{filteredTracks.length}</strong> of {tracks.length} loaded songs
			</span>
			{#if filteredTracks.length < tracks.length}
				<span class="text-[11px] text-amber-400">
					Filters active
				</span>
			{/if}
		</div>
	</div>

	<!-- Track Issues Table -->
	{#if filteredTracks.length > 0}
		<div class="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/30">
			<div class="divide-y divide-neutral-800/60">
				{#each filteredTracks as track (track.id)}
					<div class="group flex flex-col gap-2.5 p-3.5 transition hover:bg-neutral-900/50 {track.needs_attention ? 'border-l-4 border-l-amber-500/80 bg-amber-500/[0.02]' : track.manually_checked === 1 ? 'border-l-4 border-l-emerald-500/60 bg-emerald-500/[0.02]' : ''}">
						<!-- Line 1: Track & Album Info + Bitrate + Album Link -->
						<div class="flex items-center justify-between gap-3 min-w-0">
							<div class="flex items-center gap-3 min-w-0 flex-1">
								<!-- Manual Checkbox -->
								<div
									class="flex items-center shrink-0"
									title={track.manually_checked === 1 ? 'Marked as manually checked & verified (Click to uncheck)' : 'Click to mark as manually checked'}
								>
									<CustomCheckbox
										checked={track.manually_checked === 1}
										onchange={(checked) => quickFix(track.id, { manually_checked: checked ? 1 : 0 })}
									/>
								</div>

								<!-- Album Cover Thumbnail -->
								<a href="/album/{track.album_id}" class="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-neutral-950 border border-neutral-800">
									{#if track.album_cover_url}
										<img
											src={track.album_cover_url}
											alt={track.album_title || ''}
											class="h-full w-full object-cover"
											onerror={(e) => {
												(e.currentTarget as HTMLElement).style.display = 'none';
											}}
										/>
									{:else}
										<div class="flex h-full w-full items-center justify-center text-neutral-600">
											<Disc class="h-5 w-5 opacity-40" />
										</div>
									{/if}
								</a>

								<!-- Title & Meta -->
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2">
										<span class="w-5 text-right font-mono text-neutral-500 text-xs shrink-0">
											{track.track_number}
										</span>
										<span class="truncate font-bold text-sm {track.manually_checked === 1 ? 'text-emerald-100' : 'text-neutral-100'}" title={track.title}>
											{track.title}
										</span>
										{#if track.manually_checked === 1}
											<span
												class="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/30"
											>
												<CheckCircle2 class="h-3 w-3" />
												Verified
											</span>
										{/if}
									</div>

									<div class="flex flex-wrap items-center gap-1.5 text-xs text-neutral-400 mt-0.5">
										<span class="truncate text-neutral-300">
											{track.artist || track.album_artist || 'Unknown Artist'}
										</span>
										<span>•</span>
										<a
											href="/album/{track.album_id}"
											class="truncate hover:text-emerald-300 transition"
											title="Open album"
										>
											{track.album_title}
										</a>
										{#if track.duration_ms}
											<span>•</span>
											<span class="font-mono text-neutral-500">{formatDuration(track.duration_ms)}</span>
										{/if}
										<span>•</span>
										<span class="rounded bg-neutral-800/80 px-1.5 py-0.2 text-[10px] font-mono text-neutral-300 border border-neutral-700/60">
											{getBitrateLabel(track.format, track.bitrate_kbps)}
										</span>
									</div>
								</div>
							</div>

							<!-- Album Link -->
							<a
								href="/album/{track.album_id}"
								class="shrink-0 rounded-lg bg-neutral-800 p-2 text-neutral-400 hover:text-white hover:bg-neutral-700 transition"
								title="View in Album"
							>
								<ArrowRight class="h-4 w-4" />
							</a>
						</div>

						<!-- Line 2: Direct Choice Selectors + Quick Verify -->
						<div class="flex flex-wrap items-center gap-2 pl-8 sm:pl-13">
							<!-- Format Dropdown -->
							<select
								value={track.format}
								onchange={(e) => quickFix(track.id, { format: e.currentTarget.value as AudioFormat })}
								class="rounded-lg border px-2 py-1 text-xs font-semibold uppercase {getFormatBadgeClass(track.format)} focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
								title="Change Format"
							>
								{#each FORMAT_OPTIONS as opt}
									<option value={opt.value} class="bg-neutral-900 text-neutral-200">{opt.label}</option>
								{/each}
							</select>

							<!-- Quality Dropdown -->
							<select
								value={track.quality_rating}
								onchange={(e) => quickFix(track.id, { quality_rating: e.currentTarget.value as QualityRating })}
								class="rounded-lg border px-2 py-1 text-xs font-medium {QUALITY_OPTIONS.find(q => q.value === track.quality_rating)?.color} focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
								title="Change Quality"
							>
								{#each QUALITY_OPTIONS as q}
									<option value={q.value} class="bg-neutral-900 text-neutral-200">{q.label}</option>
								{/each}
							</select>

							<!-- Censorship Dropdown -->
							<select
								value={track.censorship}
								onchange={(e) => quickFix(track.id, { censorship: e.currentTarget.value as CensorshipStatus })}
								class="rounded-lg border px-2 py-1 text-xs font-medium {CENSORSHIP_OPTIONS.find(c => c.value === track.censorship)?.color} focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
								title="Change Censorship"
							>
								{#each CENSORSHIP_OPTIONS as c}
									<option value={c.value} class="bg-neutral-900 text-neutral-200">{c.label}</option>
								{/each}
							</select>

							<!-- Lyrics Dropdown -->
							<select
								value={track.lyrics}
								onchange={(e) => quickFix(track.id, { lyrics: e.currentTarget.value as LyricsStatus })}
								class="rounded-lg border px-2 py-1 text-xs font-medium {LYRICS_OPTIONS.find(l => l.value === track.lyrics)?.color} focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
								title="Change Lyrics"
							>
								{#each LYRICS_OPTIONS as l}
									<option value={l.value} class="bg-neutral-900 text-neutral-200">{l.label}</option>
								{/each}
							</select>

							<!-- Make LRC Button -->
							<a
								href="/lrc-maker?trackId={track.id}"
								class="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs font-medium text-neutral-300 hover:text-emerald-400 hover:border-emerald-500/40 hover:bg-emerald-950/20 transition flex items-center gap-1"
								title="Open in LRC Maker"
							>
								<Mic2 class="h-3 w-3" />
								<span>LRC</span>
							</a>

							<!-- Verify button -->
							{#if track.manually_checked !== 1}
								<button
									type="button"
									onclick={() => quickFix(track.id, { manually_checked: 1 })}
									class="rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/80 px-2.5 py-1 text-xs font-semibold text-emerald-300 transition active:scale-95"
									title="Mark as manually checked & verified"
								>
									✓ Verify
								</button>
							{/if}

							{#if track.notes}
								<span class="text-[11px] italic text-neutral-500 truncate max-w-xs">
									"{track.notes}"
								</span>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{:else}
		<div class="flex flex-col items-center justify-center rounded-3xl border border-dashed border-neutral-800 py-16 text-center">
			<CheckCircle2 class="h-12 w-12 text-emerald-400 mb-3" />
			<h3 class="text-lg font-bold text-white">No Tracks Match These Criteria!</h3>
			<p class="mt-1 text-xs text-neutral-400 max-w-sm">
				Try adjusting your filters or search terms.
			</p>
			{#if localSearch || localCensorship !== 'all' || localLyrics !== 'all' || localQuality !== 'all' || localFormat !== 'all'}
				<button
					type="button"
					onclick={resetFilters}
					class="mt-4 rounded-xl bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-200 hover:bg-neutral-700"
				>
					Clear Local Filters
				</button>
			{:else}
				<a
					href="/"
					class="mt-4 rounded-xl bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-200 hover:bg-neutral-700"
				>
					Return to Vault
				</a>
			{/if}
		</div>
	{/if}
</div>
