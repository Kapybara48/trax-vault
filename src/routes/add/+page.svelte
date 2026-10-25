<script lang="ts">
	import type {
		AudioFormat,
		QualityRating,
		CensorshipStatus,
		LyricsStatus,
		MusicBrainzReleaseItem,
		MusicBrainzReleaseDetail
	} from '$lib/types/index.js';
	import {
		FORMAT_OPTIONS,
		QUALITY_OPTIONS,
		CENSORSHIP_OPTIONS,
		LYRICS_OPTIONS,
		formatDuration,
		getFormatBadgeClass
	} from '$lib/utils.js';
	import {
		Search,
		Disc,
		Disc3,
		Plus,
		CheckCircle2,
		AlertTriangle,
		ArrowRight,
		ArrowLeft,
		Sparkles,
		FileText,
		Layers,
		Trash2,
		FolderSync
	} from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import CustomToggle from '$lib/components/CustomToggle.svelte';

	type ActiveTab = 'musicbrainz' | 'manual';
	let activeTab = $state<ActiveTab>('musicbrainz');

	// --- MusicBrainz Search State ---
	let mbQuery = $state('');
	let mbArtist = $state('');
	let isSearching = $state(false);
	let searchResults = $state<MusicBrainzReleaseItem[]>([]);
	let searchError = $state<string | null>(null);

	let selectedRelease = $state<MusicBrainzReleaseDetail | null>(null);
	let isLoadingRelease = $state(false);

	// Default settings for MusicBrainz imported tracks
	let mbDefaultFormat = $state<AudioFormat>('FLAC');
	let mbDefaultQuality = $state<QualityRating>('good');
	let mbDefaultCensorship = $state<CensorshipStatus>('clean_original');
	let mbDefaultLyrics = $state<LyricsStatus>('missing');
	let isImporting = $state(false);

	// --- Manual Album Form State ---
	let manualTitle = $state('');
	let manualArtist = $state('');
	let manualYear = $state('');
	let manualGenre = $state('');
	let manualMediaType = $state('Digital');
	let manualCoverUrl = $state('');
	let manualNotes = $state('');
	let manualDefaultFormat = $state<AudioFormat>('FLAC');
	let manualDefaultLyrics = $state<LyricsStatus>('missing');
	let manualDefaultCensorship = $state<CensorshipStatus>('clean_original');

	interface ManualTrackRow {
		disc_number: number;
		track_number: number;
		title: string;
		artist: string;
		duration_str: string;
		format: AudioFormat;
		quality_rating: QualityRating;
		censorship: CensorshipStatus;
		lyrics: LyricsStatus;
	}

	let manualTracks = $state<ManualTrackRow[]>([]);
	let pasteText = $state('');
	let showPasteArea = $state(false);

	// Search MusicBrainz
	async function searchMB() {
		if (!mbQuery.trim() && !mbArtist.trim()) return;
		isSearching = true;
		searchError = null;
		searchResults = [];
		selectedRelease = null;

		try {
			const qParam = encodeURIComponent(mbQuery.trim());
			const artistParam = encodeURIComponent(mbArtist.trim());
			const res = await fetch(`/api/musicbrainz/search?q=${qParam}&artist=${artistParam}`);
			if (!res.ok) throw new Error('Search failed');
			searchResults = await res.json();
			if (searchResults.length === 0) {
				searchError = 'No releases found on MusicBrainz. Try refining album title or artist name.';
			}
		} catch (err: any) {
			searchError = 'Failed to connect to MusicBrainz. Please try again.';
		} finally {
			isSearching = false;
		}
	}

	// Select release to load tracklist
	async function selectMBRelease(id: string) {
		isLoadingRelease = true;
		selectedRelease = null;
		try {
			const res = await fetch(`/api/musicbrainz/release/${id}`);
			if (!res.ok) throw new Error('Failed to fetch release');
			selectedRelease = await res.json();
		} catch (err) {
			console.error('Error fetching release:', err);
		} finally {
			isLoadingRelease = false;
		}
	}

	// Import chosen release into Trax Vault
	async function importMBRelease() {
		if (!selectedRelease) return;
		isImporting = true;

		try {
			const tracksPayload = selectedRelease.tracks.map((t) => ({
				disc_number: t.disc_number,
				track_number: t.track_number,
				title: t.title,
				artist: t.artist !== selectedRelease!.artist ? t.artist : null,
				duration_ms: t.duration_ms,
				format: mbDefaultFormat,
				quality_rating: mbDefaultQuality,
				censorship: mbDefaultCensorship,
				lyrics: mbDefaultLyrics
			}));

			const res = await fetch('/api/albums', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					album: {
						musicbrainz_id: selectedRelease.id,
						title: selectedRelease.title,
						artist: selectedRelease.artist,
						release_year: selectedRelease.release_year,
						cover_url: selectedRelease.cover_url,
						media_type: selectedRelease.media_type
					},
					tracks: tracksPayload
				})
			});

			if (res.ok) {
				const data = await res.json();
				goto(`/album/${data.id}`);
			} else {
				alert('Failed to import album. Please check inputs.');
			}
		} catch (err) {
			console.error('Import failed:', err);
			alert('Import failed');
		} finally {
			isImporting = false;
		}
	}

	// Parse pasted tracklist
	function parsePastedTracks() {
		if (!pasteText.trim()) return;

		const lines = pasteText.split('\n').map((l) => l.trim()).filter(Boolean);
		const newTracks: ManualTrackRow[] = [];

		for (let i = 0; i < lines.length; i++) {
			let line = lines[i];

			// Strip common leading numbers: "1. Title", "01 - Title", "1 - Title"
			const numMatch = line.match(/^(\d+)[\.\-\s]+(.*)$/);
			let trackNum = i + 1;
			let title = line;

			if (numMatch) {
				trackNum = parseInt(numMatch[1], 10);
				title = numMatch[2].trim();
			}

			// Check for duration at end: "Title 3:45" or "Title (3:45)" or "Title - 3:45"
			let durationStr = '';
			const durMatch = title.match(/[\(\-]?\s*(\d{1,2}:\d{2})\s*[\)]?$/);
			if (durMatch) {
				durationStr = durMatch[1];
				title = title.replace(durMatch[0], '').trim();
			}

			newTracks.push({
				disc_number: 1,
				track_number: trackNum,
				title: title || `Track ${trackNum}`,
				artist: '',
				duration_str: durationStr,
				format: manualDefaultFormat,
				quality_rating: 'good',
				censorship: manualDefaultCensorship,
				lyrics: manualDefaultLyrics
			});
		}

		manualTracks = newTracks;
		showPasteArea = false;
		pasteText = '';
	}

	function addEmptyManualTrack() {
		manualTracks.push({
			disc_number: 1,
			track_number: manualTracks.length + 1,
			title: '',
			artist: '',
			duration_str: '',
			format: manualDefaultFormat,
			quality_rating: 'good',
			censorship: manualDefaultCensorship,
			lyrics: manualDefaultLyrics
		});
	}

	function removeManualTrack(index: number) {
		manualTracks.splice(index, 1);
		// re-index track numbers
		manualTracks.forEach((t, i) => {
			t.track_number = i + 1;
		});
	}

	// Submit manual album
	async function submitManualAlbum() {
		if (!manualTitle.trim() || !manualArtist.trim()) {
			alert('Album Title and Artist are required');
			return;
		}

		const yearNum = manualYear.trim() ? parseInt(manualYear.trim(), 10) : null;

		const tracksPayload = manualTracks.map((t) => {
			let durMs: number | null = null;
			if (t.duration_str.trim()) {
				const parts = t.duration_str.trim().split(':');
				if (parts.length === 2) {
					const min = parseInt(parts[0], 10);
					const sec = parseInt(parts[1], 10);
					if (!isNaN(min) && !isNaN(sec)) durMs = (min * 60 + sec) * 1000;
				}
			}

			return {
				disc_number: t.disc_number,
				track_number: t.track_number,
				title: t.title.trim() || `Track ${t.track_number}`,
				artist: t.artist.trim() || null,
				duration_ms: durMs,
				format: t.format,
				quality_rating: t.quality_rating,
				censorship: t.censorship,
				lyrics: t.lyrics
			};
		});

		try {
			const res = await fetch('/api/albums', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					album: {
						title: manualTitle.trim(),
						artist: manualArtist.trim(),
						release_year: isNaN(yearNum!) ? null : yearNum,
						genre: manualGenre.trim() || null,
						cover_url: manualCoverUrl.trim() || null,
						media_type: manualMediaType.trim() || 'Digital',
						notes: manualNotes.trim() || null
					},
					tracks: tracksPayload
				})
			});

			if (res.ok) {
				const data = await res.json();
				goto(`/album/${data.id}`);
			} else {
				alert('Failed to create album. Please verify form fields.');
			}
		} catch (err) {
			console.error('Failed to submit manual album:', err);
		}
	}
</script>

<div class="mx-auto max-w-5xl px-4 py-6 sm:px-6">
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

	<!-- Page Heading -->
	<div class="mb-6">
		<h1 class="text-2xl sm:text-3xl font-black text-white">Add Album to Trax Vault</h1>
		<p class="mt-1 text-sm text-neutral-400">
			Import directly from MusicBrainz with full tracklists & cover art, or enter an album manually.
		</p>
	</div>

	<!-- Main Tab Switcher -->
	<div class="mb-8 flex flex-col sm:flex-row gap-1.5 rounded-2xl bg-neutral-900/80 p-1.5 border border-neutral-800">
		<a
			href="/scan"
			class="flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold text-neutral-400 hover:text-white hover:bg-neutral-800 transition"
		>
			<FolderSync class="h-4 w-4 text-emerald-400" />
			Scan Server Files (FLAC/MP3)
		</a>

		<button
			type="button"
			onclick={() => (activeTab = 'musicbrainz')}
			class="flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold transition {activeTab === 'musicbrainz' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30' : 'text-neutral-400 hover:text-white'}"
		>
			<Sparkles class="h-4 w-4" />
			Import from MusicBrainz
		</button>

		<button
			type="button"
			onclick={() => (activeTab = 'manual')}
			class="flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold transition {activeTab === 'manual' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30' : 'text-neutral-400 hover:text-white'}"
		>
			<Disc class="h-4 w-4" />
			Add Manually / Paste Tracklist
		</button>
	</div>

	<!-- TAB 1: MUSICBRAINZ IMPORT -->
	{#if activeTab === 'musicbrainz'}
		<div class="space-y-6">
			<!-- Search Bar -->
			<div class="rounded-3xl border border-neutral-800 bg-neutral-900/50 p-6 shadow-xl">
				<h2 class="text-base font-bold text-white mb-1">Search MusicBrainz Database</h2>
				<p class="text-xs text-neutral-400 mb-4">
					Enter album title and artist for high accuracy (e.g. Title: <span class="text-emerald-400">Kamikaze</span>, Artist: <span class="text-emerald-400">Eminem</span>)
				</p>

				<form
					onsubmit={(e) => {
						e.preventDefault();
						searchMB();
					}}
					class="flex flex-col gap-3"
				>
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<!-- Album Title Input -->
						<div class="relative">
							<Search class="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
							<input
								type="text"
								bind:value={mbQuery}
								placeholder="Album title (e.g. Kamikaze)"
								class="w-full rounded-xl border border-neutral-700 bg-neutral-950 pl-10 pr-4 py-2.5 text-sm text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
							/>
						</div>

						<!-- Artist Name Input -->
						<div class="relative">
							<input
								type="text"
								bind:value={mbArtist}
								placeholder="Artist name (optional, e.g. Eminem)"
								class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-sm text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
							/>
						</div>
					</div>

					<div class="flex justify-end">
						<button
							type="submit"
							disabled={isSearching || (!mbQuery.trim() && !mbArtist.trim())}
							class="rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-600/30 transition hover:bg-emerald-500 disabled:opacity-50"
						>
							{isSearching ? 'Searching...' : 'Search Releases'}
						</button>
					</div>
				</form>

				{#if searchError}
					<p class="mt-4 text-xs text-amber-400 flex items-center gap-1.5">
						<AlertTriangle class="h-4 w-4 shrink-0" />
						{searchError}
					</p>
				{/if}
			</div>

			<!-- Search Results List -->
			{#if searchResults.length > 0 && !selectedRelease}
				<div class="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-6 shadow-xl">
					<h3 class="text-sm font-bold text-neutral-200 mb-4">
						Matching Releases ({searchResults.length})
					</h3>

					<div class="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[600px] overflow-y-auto pr-1">
						{#each searchResults as rel}
							<div
								class="flex items-center justify-between gap-4 rounded-2xl border border-neutral-800 bg-neutral-950/60 p-3.5 transition hover:border-emerald-500/50 hover:bg-neutral-900"
							>
								<div class="flex items-center gap-3 min-w-0">
									<!-- Cover Thumbnail -->
									<div class="relative aspect-square w-14 shrink-0 overflow-hidden rounded-xl bg-neutral-900 border border-neutral-800">
										{#if rel.cover_url}
											<img
												src={rel.cover_url}
												alt={rel.title}
												class="h-full w-full object-cover"
												onerror={(e) => {
													(e.currentTarget as HTMLElement).style.display = 'none';
												}}
											/>
										{:else}
											<div class="flex h-full w-full items-center justify-center text-neutral-600">
												<Disc class="h-6 w-6 opacity-40" />
											</div>
										{/if}
									</div>

									<div class="min-w-0 flex-1">
										<h4 class="truncate font-bold text-neutral-100 text-sm" title={rel.title}>
											{rel.title}
										</h4>
										<p class="truncate text-xs text-neutral-400" title={rel.artist}>
											{rel.artist}
										</p>
										<div class="mt-1 flex items-center gap-2 text-[11px] text-neutral-500">
											<span>{rel.year || 'Unknown year'}</span>
											<span>•</span>
											<span>{rel.track_count} tracks</span>
											{#if rel.media_format}
												<span>•</span>
												<span class="uppercase">{rel.media_format}</span>
											{/if}
										</div>
									</div>
								</div>

								<button
									type="button"
									onclick={() => selectMBRelease(rel.id)}
									disabled={isLoadingRelease}
									class="shrink-0 rounded-xl bg-emerald-600/90 hover:bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white transition active:scale-95 shadow-sm shadow-emerald-600/20"
								>
									Select
								</button>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Loading State for Release Details -->
			{#if isLoadingRelease}
				<div class="rounded-3xl border border-neutral-800 bg-neutral-900/40 p-12 text-center">
					<Disc3 class="mx-auto h-8 w-8 text-emerald-400 animate-spin mb-3" />
					<p class="text-sm font-semibold text-neutral-200">Fetching tracklist from MusicBrainz...</p>
				</div>
			{/if}

			<!-- Selected Release Preview & Defaults Configuration -->
			{#if selectedRelease}
				<div class="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6 sm:p-8 shadow-2xl">
					<div class="flex items-center justify-between border-b border-neutral-800 pb-4 mb-6">
						<span class="text-xs font-bold uppercase tracking-wider text-emerald-400">Review & Configure Vault Import</span>
						<button
							type="button"
							onclick={() => (selectedRelease = null)}
							class="text-xs text-neutral-400 hover:text-white"
						>
							← Choose different release
						</button>
					</div>

					<!-- Hero Summary -->
					<div class="flex flex-col sm:flex-row gap-6 items-start">
						<div class="relative aspect-square w-32 shrink-0 overflow-hidden rounded-2xl bg-neutral-950 border border-neutral-800">
							{#if selectedRelease.cover_url}
								<img
									src={selectedRelease.cover_url}
									alt={selectedRelease.title}
									class="h-full w-full object-cover"
									onerror={(e) => {
										(e.currentTarget as HTMLElement).style.display = 'none';
									}}
								/>
							{:else}
								<div class="flex h-full w-full items-center justify-center text-neutral-600">
									<Disc class="h-10 w-10 opacity-40" />
								</div>
							{/if}
						</div>

						<div class="flex-1">
							<h3 class="text-xl sm:text-2xl font-black text-white">{selectedRelease.title}</h3>
							<p class="text-sm font-semibold text-neutral-300">{selectedRelease.artist}</p>
							<p class="text-xs text-neutral-400 mt-1">
								{selectedRelease.release_year || 'Unknown year'} • {selectedRelease.tracks.length} tracks • {selectedRelease.media_type || 'Digital'}
							</p>
						</div>
					</div>

					<!-- Defaults Section -->
					<div class="mt-8 rounded-2xl border border-neutral-800 bg-neutral-950/80 p-5">
						<h4 class="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-3 flex items-center gap-1.5">
							<Layers class="h-4 w-4" />
							Set What You Currently Have In Your Vault:
						</h4>
						<p class="text-xs text-neutral-400 mb-4">
							Choose your audio format and lyrics status. You can update or tweak any individual song anytime later!
						</p>

						<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
							<!-- Audio Format Choice -->
							<div>
								<label class="block text-xs font-semibold text-neutral-300 mb-1.5">Audio Format</label>
								<select
									bind:value={mbDefaultFormat}
									class="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-semibold uppercase text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
								>
									{#each FORMAT_OPTIONS as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							</div>

							<!-- Audio Quality Choice -->
							<div>
								<label class="block text-xs font-semibold text-neutral-300 mb-1.5">Audio Quality Assessment</label>
								<select
									bind:value={mbDefaultQuality}
									class="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-medium text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
								>
									{#each QUALITY_OPTIONS as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							</div>

							<!-- Lyrics Choice -->
							<div>
								<label class="block text-xs font-semibold text-neutral-300 mb-1.5">Lyrics Available</label>
								<select
									bind:value={mbDefaultLyrics}
									class="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-medium text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
								>
									{#each LYRICS_OPTIONS as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							</div>

							<!-- Censorship Choice -->
							<div>
								<label class="block text-xs font-semibold text-neutral-300 mb-1.5">Censorship Status</label>
								<select
									bind:value={mbDefaultCensorship}
									class="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-medium text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
								>
									{#each CENSORSHIP_OPTIONS as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							</div>
						</div>
					</div>

					<!-- Tracklist Preview -->
					<div class="mt-6">
						<h4 class="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-3">
							Tracks to be imported ({selectedRelease.tracks.length}):
						</h4>

						<div class="max-h-64 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950 divide-y divide-neutral-900">
							{#each selectedRelease.tracks as tr}
								<div class="flex items-center justify-between px-4 py-2 text-xs">
									<div class="flex items-center gap-3">
										<span class="w-6 text-right font-mono text-neutral-500">{tr.track_number}</span>
										<span class="font-medium text-neutral-200">{tr.title}</span>
										{#if tr.artist !== selectedRelease.artist}
											<span class="text-neutral-500">• {tr.artist}</span>
										{/if}
									</div>
									<span class="font-mono text-neutral-500">{formatDuration(tr.duration_ms)}</span>
								</div>
							{/each}
						</div>
					</div>

					<!-- Import Action -->
					<div class="mt-8 flex justify-end">
						<button
							type="button"
							onclick={importMBRelease}
							disabled={isImporting}
							class="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-bold text-white shadow-xl shadow-emerald-600/30 transition hover:bg-emerald-500 disabled:opacity-50"
						>
							<Sparkles class="h-4 w-4" />
							{isImporting ? 'Importing into Vault...' : 'Import Album into Trax Vault'}
						</button>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- TAB 2: MANUAL ENTRY -->
	{#if activeTab === 'manual'}
		<div class="rounded-3xl border border-neutral-800 bg-neutral-900/50 p-6 sm:p-8 shadow-2xl space-y-6">
			<div>
				<h2 class="text-base font-bold text-white">Manual Album Details</h2>
				<p class="text-xs text-neutral-400">Fill in the album information and add your tracks below.</p>
			</div>

			<!-- Album Metadata Form -->
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div>
					<label class="block text-xs font-semibold text-neutral-300 mb-1">Album Title *</label>
					<input
						type="text"
						bind:value={manualTitle}
						placeholder="e.g. Discovery"
						class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
					/>
				</div>

				<div>
					<label class="block text-xs font-semibold text-neutral-300 mb-1">Artist *</label>
					<input
						type="text"
						bind:value={manualArtist}
						placeholder="e.g. Daft Punk"
						class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
					/>
				</div>

				<div>
					<label class="block text-xs font-semibold text-neutral-300 mb-1">Release Year</label>
					<input
						type="number"
						bind:value={manualYear}
						placeholder="e.g. 2001"
						class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
					/>
				</div>

				<div>
					<label class="block text-xs font-semibold text-neutral-300 mb-1">Genre</label>
					<input
						type="text"
						bind:value={manualGenre}
						placeholder="e.g. Electronic, House"
						class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
					/>
				</div>

				<div>
					<label class="block text-xs font-semibold text-neutral-300 mb-1">Media Format</label>
					<select
						bind:value={manualMediaType}
						class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
					>
						<option value="Digital">Digital / Web</option>
						<option value="CD">CD</option>
						<option value="Vinyl">Vinyl</option>
						<option value="Cassette">Cassette</option>
					</select>
				</div>

				<div>
					<label class="block text-xs font-semibold text-neutral-300 mb-1">Cover Art URL (optional)</label>
					<input
						type="url"
						bind:value={manualCoverUrl}
						placeholder="https://..."
						class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
					/>
				</div>
			</div>

			<!-- Paste Tracklist Section -->
			<div class="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-5">
				<div class="flex items-center justify-between mb-3">
					<div>
						<h3 class="text-xs font-bold uppercase tracking-wider text-emerald-400">Fast Tracklist Entry</h3>
						<p class="text-xs text-neutral-400">Paste your tracklist lines (auto-detects track numbers & durations)</p>
					</div>

					<CustomToggle
						checked={showPasteArea}
						label="Paste Tool"
						onchange={(val) => (showPasteArea = val)}
					/>
				</div>

				{#if showPasteArea}
					<div class="space-y-3">
						<textarea
							bind:value={pasteText}
							rows="6"
							placeholder={`Paste tracklist, e.g.:\n1. One More Time (5:20)\n2. Aerodynamic (3:27)\n3. Digital Love (4:58)`}
							class="w-full rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-xs font-mono text-neutral-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
						></textarea>

						<div class="flex items-center justify-end gap-2">
							<button
								type="button"
								onclick={parsePastedTracks}
								class="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 shadow-md shadow-emerald-600/30 transition"
							>
								Process & Fill Tracklist
							</button>
						</div>
					</div>
				{/if}
			</div>

			<!-- Manual Tracks Table -->
			<div>
				<div class="flex items-center justify-between mb-3">
					<h3 class="text-xs font-bold uppercase tracking-wider text-neutral-300">
						Album Tracks ({manualTracks.length})
					</h3>

					<button
						type="button"
						onclick={addEmptyManualTrack}
						class="flex items-center gap-1.5 rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-neutral-200 hover:bg-neutral-700"
					>
						<Plus class="h-3.5 w-3.5" />
						Add Track
					</button>
				</div>

				{#if manualTracks.length > 0}
					<div class="rounded-xl border border-neutral-800 overflow-hidden divide-y divide-neutral-800">
						{#each manualTracks as t, i}
							<div class="flex flex-wrap items-center gap-2 bg-neutral-950 p-2.5 text-xs">
								<span class="w-6 text-center font-mono text-neutral-500 font-bold">{t.track_number}</span>

								<input
									type="text"
									bind:value={t.title}
									placeholder="Track title"
									class="flex-1 min-w-[150px] rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200"
								/>

								<input
									type="text"
									bind:value={t.duration_str}
									placeholder="3:45"
									class="w-16 rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 font-mono"
									title="Duration (mm:ss)"
								/>

								<!-- Format -->
								<select
									bind:value={t.format}
									class="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs font-semibold uppercase text-neutral-200"
								>
									{#each FORMAT_OPTIONS as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>

								<!-- Lyrics -->
								<select
									bind:value={t.lyrics}
									class="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200"
								>
									{#each LYRICS_OPTIONS as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>

								<!-- Censorship -->
								<select
									bind:value={t.censorship}
									class="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-200"
								>
									{#each CENSORSHIP_OPTIONS as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>

								<button
									type="button"
									onclick={() => removeManualTrack(i)}
									class="rounded p-1 text-neutral-500 hover:text-rose-400"
									title="Remove track"
								>
									<Trash2 class="h-3.5 w-3.5" />
								</button>
							</div>
						{/each}
					</div>
				{:else}
					<div class="rounded-xl border border-dashed border-neutral-800 p-6 text-center text-xs text-neutral-500">
						No tracks added yet. Click "+ Add Track" or use "Paste Tracklist Text" above.
					</div>
				{/if}
			</div>

			<!-- Submit Button -->
			<div class="flex justify-end pt-4 border-t border-neutral-800">
				<button
					type="button"
					onclick={submitManualAlbum}
					disabled={!manualTitle.trim() || !manualArtist.trim()}
					class="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-bold text-white shadow-xl shadow-emerald-600/30 transition hover:bg-emerald-500 disabled:opacity-50"
				>
					<Disc class="h-4 w-4" />
					Save Album to Vault
				</button>
			</div>
		</div>
	{/if}
</div>
