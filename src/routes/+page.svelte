<script lang="ts">
	import type { PageData } from './$types.js';
	import type { Track } from '$lib/types/index.js';
	import AlbumCard from '$lib/components/AlbumCard.svelte';
	import {
		formatDuration,
		FORMAT_OPTIONS,
		QUALITY_OPTIONS,
		CENSORSHIP_OPTIONS,
		LYRICS_OPTIONS,
		getFormatBadgeClass
	} from '$lib/utils.js';
	import {
		Disc,
		Disc3,
		Plus,
		Search,
		TriangleAlert,
		CheckCircle2,
		ShieldAlert,
		FileText,
		Sparkles,
		Flame,
		Layers,
		ArrowRight,
		SlidersHorizontal,
		RotateCcw,
		Music,
		Grid,
		ListMusic,
		Filter,
		Trash2
	} from '@lucide/svelte';
	import CustomCheckbox from '$lib/components/CustomCheckbox.svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { player } from '$lib/services/player.svelte.js';

	let { data }: { data: PageData } = $props();

	let searchQuery = $state(data.searchQuery);
	let selectedFormat = $state(data.activeFormat || 'all');
	let selectedCensorship = $state(data.activeCensorship || 'all');
	let selectedLyrics = $state(data.activeLyrics || 'all');
	let currentView = $state<'albums' | 'tracks'>(data.activeView || 'albums');
	let showFilters = $state(false);

	let selectedAlbumIds = $state<number[]>([]);
	let isBatchDeleting = $state(false);

	const activeFilterCount = $derived(
		(selectedFormat !== 'all' && selectedFormat !== '' ? 1 : 0) +
		(selectedCensorship !== 'all' && selectedCensorship !== '' ? 1 : 0) +
		(selectedLyrics !== 'all' && selectedLyrics !== '' ? 1 : 0)
	);

	let tracksList = $state<Track[]>([...data.matchingTracks]);

	$effect(() => {
		searchQuery = data.searchQuery;
		selectedFormat = data.activeFormat || 'all';
		selectedCensorship = data.activeCensorship || 'all';
		selectedLyrics = data.activeLyrics || 'all';
		currentView = data.activeView || 'albums';
		tracksList = [...data.matchingTracks];
		selectedAlbumIds = selectedAlbumIds.filter((id) => data.albums.some((a) => a.id === id));
	});

	function toggleAlbumSelect(id: number) {
		if (selectedAlbumIds.includes(id)) {
			selectedAlbumIds = selectedAlbumIds.filter((x) => x !== id);
		} else {
			selectedAlbumIds = [...selectedAlbumIds, id];
		}
	}

	function toggleSelectAll() {
		if (selectedAlbumIds.length === data.albums.length) {
			selectedAlbumIds = [];
		} else {
			selectedAlbumIds = data.albums.map((a) => a.id);
		}
	}

	async function handleBatchDelete() {
		if (selectedAlbumIds.length === 0) return;
		const count = selectedAlbumIds.length;
		if (
			!confirm(
				`Remove ${count} selected ${count === 1 ? 'album' : 'albums'} from Vault?\n\nAudio files on disk in your music directory will NOT be deleted, and the albums will return to the Library Scanner.`
			)
		) {
			return;
		}

		isBatchDeleting = true;
		try {
			const res = await fetch('/api/albums', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ids: selectedAlbumIds })
			});

			if (res.ok) {
				selectedAlbumIds = [];
				await invalidateAll();
			} else {
				const errData = await res.json().catch(() => ({}));
				alert(`Failed to remove albums: ${errData.error || res.statusText}`);
			}
		} catch (err: any) {
			console.error('Failed to batch remove albums:', err);
			alert(`Failed to remove albums: ${err.message}`);
		} finally {
			isBatchDeleting = false;
		}
	}

	function applyFilters(overrides: {
		q?: string;
		filter?: string;
		format?: string;
		censor?: string;
		lyrics?: string;
		view?: 'albums' | 'tracks';
	} = {}) {
		selectedAlbumIds = [];
		const params = new URLSearchParams(window.location.search);

		const q = overrides.q !== undefined ? overrides.q : searchQuery;
		if (q.trim()) params.set('q', q.trim());
		else params.delete('q');

		const f = overrides.filter !== undefined ? overrides.filter : data.activeFilter;
		if (f && f !== 'all') params.set('filter', f);
		else params.delete('filter');

		const fmt = overrides.format !== undefined ? overrides.format : selectedFormat;
		if (fmt && fmt !== 'all') params.set('format', fmt);
		else params.delete('format');

		const cens = overrides.censor !== undefined ? overrides.censor : selectedCensorship;
		if (cens && cens !== 'all') params.set('censor', cens);
		else params.delete('censor');

		const lyr = overrides.lyrics !== undefined ? overrides.lyrics : selectedLyrics;
		if (lyr && lyr !== 'all') params.set('lyrics', lyr);
		else params.delete('lyrics');

		const v = overrides.view !== undefined ? overrides.view : currentView;
		if (v && v !== 'albums') params.set('view', v);
		else params.delete('view');

		goto(`/?${params.toString()}`);
	}

	function handleSearchSubmit(e: Event) {
		e.preventDefault();
		applyFilters({ q: searchQuery });
	}

	function setFilterPill(filterVal: string) {
		applyFilters({ filter: filterVal });
	}

	function quickSearch(tag: string) {
		searchQuery = tag;
		applyFilters({ q: tag });
	}

	function resetAll() {
		searchQuery = '';
		selectedFormat = 'all';
		selectedCensorship = 'all';
		selectedLyrics = 'all';
		goto('/');
	}

	async function quickFixTrack(trackId: number, patch: Partial<Track>) {
		try {
			const res = await fetch(`/api/tracks/${trackId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(patch)
			});
			if (res.ok) {
				const json = await res.json();
				if (json.track) {
					const idx = tracksList.findIndex((t) => t.id === trackId);
					if (idx !== -1) tracksList[idx] = json.track;
				}
				await invalidateAll();
			}
		} catch (err) {
			console.error('Failed to quick fix track:', err);
		}
	}

	async function removeTrackFromVault(trackId: number, title: string) {
		if (
			!confirm(
				`Remove song "${title}" from Vault?\n\nAudio file on disk will NOT be deleted, and can be re-scanned at any time.`
			)
		) {
			return;
		}

		try {
			const res = await fetch(`/api/tracks/${trackId}`, { method: 'DELETE' });
			if (res.ok) {
				tracksList = tracksList.filter((t) => t.id !== trackId);
				await invalidateAll();
			} else {
				const errData = await res.json().catch(() => ({}));
				alert(`Failed to remove track: ${errData.error || res.statusText}`);
			}
		} catch (err: any) {
			console.error('Failed to delete track:', err);
			alert(`Failed to remove track: ${err.message}`);
		}
	}
</script>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<!-- Top Stats Banner -->
	<section class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
		<!-- Health Score Card -->
		<div class="relative overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 shadow-sm backdrop-blur">
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold text-neutral-400">Vault Health</span>
				<Sparkles class="h-4 w-4 text-emerald-400" />
			</div>
			<div class="mt-2 text-2xl font-black {data.stats.health_score >= 80 ? 'text-emerald-400' : data.stats.health_score >= 50 ? 'text-amber-400' : 'text-rose-400'}">
				{data.stats.health_score}%
			</div>
			<div class="mt-2 h-1 w-full overflow-hidden rounded-full bg-neutral-800">
				<div
					class="h-full rounded-full transition-all duration-500 {data.stats.health_score >= 80 ? 'bg-emerald-500' : data.stats.health_score >= 50 ? 'bg-amber-500' : 'bg-rose-500'}"
					style="width: {data.stats.health_score}%"
				></div>
			</div>
			<p class="mt-2 text-[11px] text-neutral-400">
				<strong class="text-emerald-400 font-semibold">{data.stats.checked_tracks_count || 0}/{data.stats.total_tracks}</strong> verified
			</p>
		</div>

		<!-- Audio Formats Card -->
		<div
			class="relative overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 shadow-sm backdrop-blur cursor-pointer hover:border-neutral-700 transition"
			onclick={() => quickSearch('!flac')}
			role="button"
			tabindex="0"
			onkeydown={(e) => { if (e.key === 'Enter') quickSearch('!flac'); }}
		>
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold text-neutral-400">Formats</span>
				<Disc3 class="h-4 w-4 text-teal-400" />
			</div>
			<div class="mt-2 text-2xl font-black text-white">
				{data.stats.flac_count} <span class="text-xs font-normal text-emerald-400">FLAC</span>
			</div>
			<p class="mt-2 text-[11px] text-neutral-400">
				<span class="text-amber-400 font-semibold">{data.stats.mp3_count + data.stats.other_format_count}</span> lossy (!flac)
			</p>
		</div>

		<!-- Censored Tracker Card -->
		<a
			href="/issues?type=censored"
			class="group relative overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 shadow-sm backdrop-blur transition hover:border-neutral-700"
		>
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold text-neutral-400">Censored</span>
				<ShieldAlert class="h-4 w-4 text-rose-400 group-hover:scale-110 transition" />
			</div>
			<div class="mt-2 text-2xl font-black {data.stats.censored_count > 0 ? 'text-rose-400' : 'text-neutral-300'}">
				{data.stats.censored_count}
			</div>
			<p class="mt-2 text-[11px] text-neutral-500 flex items-center justify-between">
				<span>Radio edits</span>
				<ArrowRight class="h-3 w-3 text-neutral-500 group-hover:text-emerald-400 transition" />
			</p>
		</a>

		<!-- Lyrics Coverage Card -->
		<a
			href="/issues?type=missing_lyrics"
			class="group relative overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 shadow-sm backdrop-blur transition hover:border-neutral-700"
		>
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold text-neutral-400">Missing Lyrics</span>
				<FileText class="h-4 w-4 text-emerald-400 group-hover:scale-110 transition" />
			</div>
			<div class="mt-2 text-2xl font-black {data.stats.missing_lyrics_count > 0 ? 'text-amber-400' : 'text-emerald-400'}">
				{data.stats.missing_lyrics_count}
			</div>
			<p class="mt-2 text-[11px] text-neutral-500">
				{data.stats.synced_lyrics_count} synced .lrc
			</p>
		</a>

		<!-- Bad Quality Card -->
		<a
			href="/issues?type=bad_quality"
			class="group relative overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 shadow-sm backdrop-blur transition hover:border-neutral-700"
		>
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold text-neutral-400">Low Quality</span>
				<TriangleAlert class="h-4 w-4 text-rose-400 group-hover:scale-110 transition" />
			</div>
			<div class="mt-2 text-2xl font-black {data.stats.bad_quality_count > 0 ? 'text-rose-400' : 'text-emerald-400'}">
				{data.stats.bad_quality_count}
			</div>
			<p class="mt-2 text-[11px] text-neutral-500 flex items-center justify-between">
				<span>Needs upgrade</span>
				<ArrowRight class="h-3 w-3 text-neutral-500 group-hover:text-emerald-400 transition" />
			</p>
		</a>
	</section>

	<!-- Search & Filters Section -->
	<section class="mb-6 space-y-3 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-3.5 sm:p-4 shadow-md">
		<!-- Search Form, Filter Toggle & View Switcher -->
		<div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
			<!-- Query Input -->
			<form onsubmit={handleSearchSubmit} class="relative flex-1">
				<Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Search artists, albums, or tags (!flac, censored...)"
					class="w-full rounded-xl border border-neutral-700 bg-neutral-950 pl-9 pr-20 py-2 text-xs sm:text-sm text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
				/>
				<div class="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
					{#if searchQuery}
						<button
							type="button"
							onclick={() => { searchQuery = ''; applyFilters({ q: '' }); }}
							class="rounded-lg p-1 text-neutral-500 hover:text-white"
						>
							<RotateCcw class="h-3 w-3" />
						</button>
					{/if}
					<button
						type="submit"
						class="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500 transition"
					>
						Search
					</button>
				</div>
			</form>

			<div class="flex items-center gap-2">
				<!-- Filters Expand Button -->
				<button
					type="button"
					onclick={() => (showFilters = !showFilters)}
					class="flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition {showFilters || activeFilterCount > 0 ? 'bg-emerald-950/70 border-emerald-500/80 text-emerald-300' : 'bg-neutral-950 border-neutral-700 text-neutral-300 hover:border-neutral-600'}"
				>
					<SlidersHorizontal class="h-3.5 w-3.5" />
					<span>Filters</span>
					{#if activeFilterCount > 0}
						<span class="rounded-full bg-emerald-500 px-1.5 py-0.2 text-[10px] font-bold text-black">
							{activeFilterCount}
						</span>
					{/if}
				</button>

				<!-- View Mode Toggle: Albums vs Song Files -->
				<div class="flex items-center rounded-xl border border-neutral-800 bg-neutral-950 p-0.5">
					<button
						type="button"
						onclick={() => applyFilters({ view: 'albums' })}
						class="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition {currentView === 'albums' ? 'bg-emerald-600 text-white' : 'text-neutral-400 hover:text-white'}"
					>
						<Grid class="h-3.5 w-3.5" />
						<span>Albums ({data.albums.length})</span>
					</button>
					<button
						type="button"
						onclick={() => applyFilters({ view: 'tracks' })}
						class="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition {currentView === 'tracks' ? 'bg-emerald-600 text-white' : 'text-neutral-400 hover:text-white'}"
					>
						<ListMusic class="h-3.5 w-3.5" />
						<span>Songs ({data.totalMatchingTracks})</span>
					</button>
				</div>
			</div>
		</div>

		<!-- Expandable Dropdowns -->
		{#if showFilters || activeFilterCount > 0}
			<div class="flex flex-wrap items-center gap-2 pt-2 border-t border-neutral-800/60 text-xs">
				<select
					value={selectedFormat}
					onchange={(e) => applyFilters({ format: e.currentTarget.value })}
					class="rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1 text-xs text-neutral-200 focus:outline-none focus:border-emerald-500 {selectedFormat !== 'all' && selectedFormat !== '' ? 'border-emerald-500 text-emerald-300' : ''}"
				>
					<option value="all">All Formats</option>
					<option value="!FLAC">!FLAC (Non-FLAC)</option>
					<option value="FLAC">FLAC</option>
					<option value="MP3">MP3</option>
					<option value="MP3_320">MP3 320k</option>
					<option value="MP3_V0">MP3 V0</option>
					<option value="MP3_128">MP3 128k</option>
					<option value="AAC_256">AAC</option>
					<option value="WAV">WAV</option>
				</select>

				<select
					value={selectedCensorship}
					onchange={(e) => applyFilters({ censor: e.currentTarget.value })}
					class="rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1 text-xs text-neutral-200 focus:outline-none focus:border-emerald-500 {selectedCensorship !== 'all' && selectedCensorship !== '' ? 'border-emerald-500 text-emerald-300' : ''}"
				>
					<option value="all">All Censorship</option>
					<option value="censored">Censored</option>
					<option value="explicit">Explicit</option>
					<option value="clean_original">Clean</option>
					<option value="!censored">!Censored</option>
				</select>

				<select
					value={selectedLyrics}
					onchange={(e) => applyFilters({ lyrics: e.currentTarget.value })}
					class="rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1 text-xs text-neutral-200 focus:outline-none focus:border-emerald-500 {selectedLyrics !== 'all' && selectedLyrics !== '' ? 'border-emerald-500 text-emerald-300' : ''}"
				>
					<option value="all">All Lyrics</option>
					<option value="missing">No Lyrics</option>
					<option value="unsynced_lrc">Unsynced LRC</option>
					<option value="synced_lrc">Synced LRC</option>
					<option value="plain_txt">Plain TXT</option>
					<option value="!missing">Has Lyrics</option>
				</select>

				{#if activeFilterCount > 0 || searchQuery || data.activeFilter !== 'all'}
					<button
						type="button"
						onclick={resetAll}
						class="text-neutral-400 hover:text-rose-400 text-xs underline ml-auto"
					>
						Reset all
					</button>
				{/if}
			</div>
		{/if}

		<!-- Simplified Essential Category Pills -->
		<div class="flex flex-wrap items-center gap-1.5 pt-1">
			<button
				type="button"
				onclick={() => setFilterPill('all')}
				class="rounded-lg px-2.5 py-1 text-xs font-semibold transition {data.activeFilter === 'all' ? 'bg-emerald-600 text-white' : 'bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'}"
			>
				All Albums
			</button>

			<button
				type="button"
				onclick={() => setFilterPill('needs_attention')}
				class="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition {data.activeFilter === 'needs_attention' ? 'bg-amber-600 text-white' : 'bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'}"
			>
				<TriangleAlert class="h-3 w-3" />
				Needs Fix ({data.stats.total_needs_attention})
			</button>

			<button
				type="button"
				onclick={() => setFilterPill('unverified')}
				class="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition {data.activeFilter === 'unverified' ? 'bg-amber-700 text-white' : 'bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'}"
			>
				<span>Unverified</span>
			</button>

			<button
				type="button"
				onclick={() => setFilterPill('verified')}
				class="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition {data.activeFilter === 'verified' ? 'bg-emerald-700 text-white' : 'bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'}"
			>
				<CheckCircle2 class="h-3 w-3 text-emerald-300" />
				<span>100% Verified</span>
			</button>
		</div>
	</section>

	<!-- VIEW 1: ALBUMS GRID -->
	{#if currentView === 'albums'}
		{#if data.albums.length > 0}
			<!-- Multi-select Toolbar Header -->
			<div class="mb-3.5 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-neutral-800/80 bg-neutral-900/40 px-3.5 py-2.5 backdrop-blur-sm">
				<div class="flex items-center gap-2.5">
					<button
						type="button"
						onclick={toggleSelectAll}
						class="flex items-center gap-2 rounded-lg border border-neutral-700/80 bg-neutral-950/80 px-2.5 py-1 text-xs font-semibold text-neutral-300 hover:border-neutral-600 hover:text-white transition cursor-pointer"
					>
						<CustomCheckbox
							checked={selectedAlbumIds.length > 0 && selectedAlbumIds.length === data.albums.length}
							onchange={toggleSelectAll}
						/>
						<span>{selectedAlbumIds.length === data.albums.length ? 'Deselect All' : 'Select All'} ({data.albums.length})</span>
					</button>

					{#if selectedAlbumIds.length > 0}
						<span class="text-xs text-neutral-400">
							<strong class="text-emerald-400 font-bold">{selectedAlbumIds.length}</strong> of {data.albums.length} selected
						</span>
					{/if}
				</div>

				{#if selectedAlbumIds.length > 0}
					<div class="flex items-center gap-2">
						<button
							type="button"
							onclick={() => (selectedAlbumIds = [])}
							class="text-xs text-neutral-400 hover:text-neutral-200 transition px-2 py-1 cursor-pointer"
						>
							Clear selection
						</button>
						<button
							type="button"
							onclick={handleBatchDelete}
							disabled={isBatchDeleting}
							class="flex items-center gap-1.5 rounded-lg bg-rose-600/90 hover:bg-rose-600 text-white px-3 py-1 text-xs font-semibold shadow-md shadow-rose-950/30 transition disabled:opacity-50 cursor-pointer"
							title="Remove selected albums from Vault"
						>
							{#if isBatchDeleting}
								<div class="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
								<span>Removing...</span>
							{:else}
								<Trash2 class="h-3.5 w-3.5" />
								<span>Remove Selected ({selectedAlbumIds.length})</span>
							{/if}
						</button>
					</div>
				{/if}
			</div>

			<section class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
				{#each data.albums as album (album.id)}
					<AlbumCard
						{album}
						selected={selectedAlbumIds.includes(album.id)}
						selectionMode={selectedAlbumIds.length > 0}
						onToggleSelect={toggleAlbumSelect}
						onAlbumDeleted={(id) => {
							selectedAlbumIds = selectedAlbumIds.filter((x) => x !== id);
							invalidateAll();
						}}
					/>
				{/each}
			</section>
		{:else}
			<!-- Empty State -->
			<section class="flex flex-col items-center justify-center rounded-3xl border border-dashed border-neutral-800 bg-neutral-900/20 py-20 text-center">
				<div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-neutral-800/80 text-emerald-400 mb-4">
					<Disc3 class="h-8 w-8" />
				</div>
				<h3 class="text-lg font-bold text-neutral-100">
					{#if data.searchQuery || data.activeFilter !== 'all' || selectedFormat !== 'all' || selectedCensorship !== 'all' || selectedLyrics !== 'all'}
						No albums matching your criteria
					{:else}
						Your Trax Vault is empty
					{/if}
				</h3>
				<p class="mt-1 max-w-sm text-sm text-neutral-400">
					{#if data.searchQuery || data.activeFilter !== 'all' || selectedFormat !== 'all' || selectedCensorship !== 'all' || selectedLyrics !== 'all'}
						Try adjusting search terms (e.g. !flac, censored) or clear the filter.
					{:else}
						Start tracking your collection by scanning your music library or adding albums.
					{/if}
				</p>
				<div class="mt-6 flex items-center gap-3">
					{#if data.searchQuery || data.activeFilter !== 'all' || selectedFormat !== 'all' || selectedCensorship !== 'all' || selectedLyrics !== 'all'}
						<button
							type="button"
							onclick={resetAll}
							class="rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm font-semibold text-neutral-200 hover:bg-neutral-700"
						>
							Reset Filters
						</button>
					{:else}
						<a
							href="/scan"
							class="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-600/30 transition hover:bg-emerald-500"
						>
							<Plus class="h-4 w-4" />
							Scan Music Files
						</a>
					{/if}
				</div>
			</section>
		{/if}

	<!-- VIEW 2: SONG FILES VIEW (Show all files matching !flac, etc.) -->
	{:else}
		{#if tracksList.length > 0}
			<section class="space-y-3">
				<div class="flex items-center justify-between text-xs text-neutral-400 px-1">
					<span>
						Showing <strong class="text-white font-bold">{tracksList.length}</strong> matching song {tracksList.length === 1 ? 'file' : 'files'}
					</span>
					<span class="text-neutral-500">
						1-click quick update or jump into the album
					</span>
				</div>

				<div class="rounded-2xl border border-neutral-800 bg-neutral-900/40 divide-y divide-neutral-800/80 overflow-hidden">
					{#each tracksList as track (track.id)}
						<div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-3.5 transition hover:bg-neutral-900/80 {track.needs_attention ? 'border-l-4 border-l-amber-500/80 bg-amber-500/[0.02]' : track.manually_checked === 1 ? 'border-l-4 border-l-emerald-500/60 bg-emerald-500/[0.02]' : ''}">
							<!-- Track info with thumbnail -->
							<div class="flex items-center gap-3 min-w-0 flex-1">
								<!-- Manual Checkbox -->
								<div
									class="flex items-center shrink-0"
									title={track.manually_checked === 1 ? 'Marked as manually checked & verified (Click to uncheck)' : 'Click to mark as manually checked (100% verified)'}
								>
									<CustomCheckbox
										checked={track.manually_checked === 1}
										onchange={(checked) => quickFixTrack(track.id, { manually_checked: checked ? 1 : 0 })}
									/>
								</div>

								<a
									href="/album/{track.album_id}"
									class="relative aspect-square h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-neutral-950 border border-neutral-800 hover:border-emerald-500 transition"
									title="View album: {track.album_title}"
								>
									{#if track.album_cover_url}
										<img
											src={track.album_cover_url}
											alt={track.album_title}
											class="h-full w-full object-cover"
											onerror={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
										/>
									{:else}
										<div class="flex h-full w-full items-center justify-center text-neutral-600">
											<Disc class="h-6 w-6 opacity-40" />
										</div>
									{/if}
								</a>

								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2">
										<span class="truncate font-bold text-sm {track.manually_checked === 1 ? 'text-emerald-100' : 'text-neutral-100'}" title={track.title}>
											{track.title}
										</span>
										{#if track.manually_checked === 1}
											<span
												class="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/30"
												title="Manually checked and verified"
											>
												<CheckCircle2 class="h-3 w-3" />
												Checked
											</span>
										{/if}
										<span class="text-xs text-neutral-500 font-mono">
											#{track.track_number}
										</span>
									</div>

									<div class="flex items-center gap-2 text-xs text-neutral-400 mt-0.5">
										<span class="truncate text-neutral-300">
											{track.artist || track.album_artist || 'Unknown Artist'}
										</span>
										<span>•</span>
										<a
											href="/album/{track.album_id}"
											class="truncate hover:text-emerald-300 transition text-neutral-400"
											title="Open album"
										>
											{track.album_title}
										</a>
										{#if track.duration_ms}
											<span>•</span>
											<span class="font-mono text-neutral-500">{formatDuration(track.duration_ms)}</span>
										{/if}
									</div>
								</div>
							</div>

							<!-- Badges & Controls -->
							<div class="flex flex-wrap items-center gap-2 lg:justify-end">
								<!-- Format Badge -->
								<span class="rounded-lg border px-2.5 py-0.5 text-xs font-semibold uppercase {getFormatBadgeClass(track.format)}">
									{track.format}
								</span>

								<!-- Quality Badge -->
								<span class="rounded-lg border px-2 py-0.5 text-xs font-medium {QUALITY_OPTIONS.find(q => q.value === track.quality_rating)?.color}">
									{track.quality_rating}
								</span>

								<!-- Censorship Badge -->
								<span class="inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-medium {CENSORSHIP_OPTIONS.find(c => c.value === track.censorship)?.color || 'text-neutral-400 border-neutral-800'}">
									{#if track.censorship === 'censored'}
										<ShieldAlert class="h-3 w-3 text-rose-400" />
										<span>Censored</span>
									{:else if track.censorship === 'explicit'}
										<span class="font-bold text-amber-300">E</span>
										<span>Explicit</span>
									{:else if track.censorship === 'clean_original'}
										<span>Clean</span>
									{:else if track.censorship === 'instrumental'}
										<span>Inst.</span>
									{:else}
										<span class="text-neutral-400">Unverified</span>
									{/if}
								</span>

								<!-- Lyrics Badge -->
								<span class="inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-medium {LYRICS_OPTIONS.find(l => l.value === track.lyrics)?.color}">
									{#if track.lyrics === 'synced_lrc'}
										<CheckCircle2 class="h-3 w-3 text-emerald-400" />
										<span>Synced LRC</span>
									{:else if track.lyrics === 'unsynced_lrc'}
										<FileText class="h-3 w-3 text-amber-300" />
										<span>Unsynced LRC</span>
									{:else if track.lyrics === 'plain_txt'}
										<FileText class="h-3 w-3 text-sky-400" />
										<span>Plain TXT</span>
									{:else}
										<TriangleAlert class="h-3 w-3 text-rose-400" />
										<span>No Lyrics</span>
									{/if}
								</span>

								<!-- 1-Click Upgrade / Actions -->
								<div class="flex items-center gap-1.5 border-l border-neutral-800 pl-2 ml-1">
									{#if track.format !== 'FLAC'}
										<button
											type="button"
											onclick={() => quickFixTrack(track.id, { format: 'FLAC', quality_rating: 'good' })}
											class="rounded-lg bg-teal-950/80 hover:bg-teal-900 border border-teal-700/80 px-2 py-0.5 text-xs font-semibold text-teal-300 transition"
											title="Upgrade to FLAC lossless"
										>
											+ FLAC
										</button>
									{/if}

									<a
										href="/album/{track.album_id}"
										class="rounded-lg bg-neutral-800 p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-700"
										title="Open Album"
									>
										<ArrowRight class="h-3.5 w-3.5" />
									</a>

									<button
										type="button"
										onclick={() => removeTrackFromVault(track.id, track.title)}
										class="rounded-lg bg-neutral-800 p-1.5 text-neutral-400 hover:text-rose-400 hover:bg-neutral-700 transition"
										title="Remove song from Vault (keeps audio file on disk)"
									>
										<Trash2 class="h-3.5 w-3.5" />
									</button>
								</div>
							</div>
						</div>
					{/each}
				</div>
			</section>
		{:else}
			<section class="flex flex-col items-center justify-center rounded-3xl border border-dashed border-neutral-800 bg-neutral-900/20 py-20 text-center">
				<div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-neutral-800/80 text-emerald-400 mb-4">
					<ListMusic class="h-8 w-8" />
				</div>
				<h3 class="text-lg font-bold text-neutral-100">
					No song files matching your criteria
				</h3>
				<p class="mt-1 max-w-sm text-sm text-neutral-400">
					Try clearing the search or filters to see all songs.
				</p>
				<button
					type="button"
					onclick={resetAll}
					class="mt-6 rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm font-semibold text-neutral-200 hover:bg-neutral-700"
				>
					Reset Filters
				</button>
			</section>
		{/if}
	{/if}

	<!-- Floating Batch Actions Dock (shows when items are selected) -->
	{#if selectedAlbumIds.length > 0 && currentView === 'albums'}
		<div class="fixed {player.currentTrack ? 'bottom-20 sm:bottom-22' : 'bottom-6'} inset-x-0 z-40 flex justify-center px-4 pointer-events-none">
			<div class="pointer-events-auto flex items-center gap-3 rounded-2xl border border-neutral-700/80 bg-neutral-900/95 px-4 py-3 shadow-2xl backdrop-blur-xl">
				<div class="flex items-center gap-2 border-r border-neutral-800 pr-3">
					<span class="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-400 border border-emerald-500/40">
						{selectedAlbumIds.length}
					</span>
					<span class="text-xs font-medium text-neutral-200">
						{selectedAlbumIds.length === 1 ? 'album selected' : 'albums selected'}
					</span>
				</div>

				<button
					type="button"
					onclick={toggleSelectAll}
					class="text-xs text-neutral-400 hover:text-white transition cursor-pointer"
				>
					{selectedAlbumIds.length === data.albums.length ? 'Deselect All' : 'Select All'}
				</button>

				<button
					type="button"
					onclick={() => (selectedAlbumIds = [])}
					class="text-xs text-neutral-400 hover:text-white transition cursor-pointer"
				>
					Clear
				</button>

				<button
					type="button"
					onclick={handleBatchDelete}
					disabled={isBatchDeleting}
					class="flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 px-3.5 py-1.5 text-xs font-bold text-white shadow-lg shadow-rose-950/50 transition disabled:opacity-50 cursor-pointer"
				>
					{#if isBatchDeleting}
						<div class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
						<span>Removing...</span>
					{:else}
						<Trash2 class="h-4 w-4" />
						<span>Remove from Vault</span>
					{/if}
				</button>
			</div>
		</div>
	{/if}
</div>
