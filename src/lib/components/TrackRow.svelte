<script lang="ts">
	import type { Track, AudioFormat, QualityRating, CensorshipStatus, LyricsStatus } from '$lib/types/index.js';
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
		Trash2,
		AlertTriangle,
		FileText,
		Disc,
		Clock,
		Mic2,
		Sparkles,
		Check,
		AlignLeft,
		ListPlus,
		Download,
		RefreshCw,
		ScanLine,
		Upload,
		X
	} from '@lucide/svelte';
	import DeleteTrackModal from '$lib/components/DeleteTrackModal.svelte';
	import { alertAction } from '$lib/services/dialog.svelte.js';

	interface Props {
		track: Track;
		isAdmin?: boolean;
		onTrackUpdated?: (updated: Track) => void;
		onTrackDeleted?: (id: number) => void;
		onOpenLyrics?: (track: Track) => void;
		onAddToPlaylist?: (track: Track) => void;
	}

	let {
		track,
		isAdmin = false,
		onTrackUpdated,
		onTrackDeleted,
		onOpenLyrics,
		onAddToPlaylist
	}: Props = $props();

	let isUpdating = $state(false);
	let isReplacing = $state(false);
	let isRescanning = $state(false);
	let showDeleteModal = $state(false);
	let showNotes = $state(false);
	let showDownloadMenu = $state(false);
	let showIssueMenu = $state(false);
	let notesValue = $state(track.notes || '');
	let issueNoteText = $state(track.notes || '');
	let replaceInputRef = $state<HTMLInputElement | null>(null);

	const hasTrackIssue = $derived(
		track.is_missing === 1 ||
		track.censorship === 'censored' ||
		track.lyrics === 'censored_lrc' ||
		track.quality_rating === 'bad' ||
		Boolean(track.needs_attention)
	);

	async function updateField(field: keyof Track, value: any) {
		isUpdating = true;
		try {
			const res = await fetch(`/api/tracks/${track.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ [field]: value })
			});

			if (res.ok) {
				const data = await res.json();
				if (data.track && onTrackUpdated) {
					onTrackUpdated(data.track);
				}
			} else {
				const data = await res.json().catch(() => ({}));
				await alertAction(data.error || 'Failed to update track', 'Update Failed');
			}
		} catch (err) {
			console.error('Failed to update track:', err);
		} finally {
			isUpdating = false;
		}
	}

	async function saveNotes() {
		await updateField('notes', notesValue);
		showNotes = false;
	}

	async function handleReplaceFile(file: File) {
		isReplacing = true;
		const formData = new FormData();
		formData.append('file', file);
		try {
			const res = await fetch(`/api/tracks/${track.id}/replace`, {
				method: 'POST',
				body: formData
			});
			const data = await res.json();
			if (res.ok && data.track && onTrackUpdated) {
				onTrackUpdated(data.track);
			} else {
				await alertAction(data.error || 'Failed to replace track audio', 'Replacement Error');
			}
		} catch (err: any) {
			console.error('Failed to replace track audio:', err);
			await alertAction(err.message || 'Failed to upload replacement audio', 'Error');
		} finally {
			isReplacing = false;
		}
	}

	async function handleRescan() {
		isRescanning = true;
		try {
			const res = await fetch(`/api/tracks/${track.id}/rescan`, {
				method: 'POST'
			});
			const data = await res.json();
			if (res.ok && data.track && onTrackUpdated) {
				onTrackUpdated(data.track);
			} else {
				await alertAction(data.error || 'Failed to re-scan track metadata', 'Re-scan Error');
			}
		} catch (err: any) {
			console.error('Failed to re-scan track audio:', err);
			await alertAction(err.message || 'Failed to re-scan metadata', 'Error');
		} finally {
			isRescanning = false;
		}
	}

	async function handleDeleteConfirm(deleteFile: boolean) {
		try {
			const res = await fetch(`/api/tracks/${track.id}?deleteFile=${deleteFile}`, { method: 'DELETE' });
			if (res.ok && onTrackDeleted) {
				onTrackDeleted(track.id);
			} else {
				const data = await res.json().catch(() => ({}));
				await alertAction(data.error || 'Failed to delete track', 'Delete Error');
			}
		} catch (err: any) {
			console.error('Failed to delete track:', err);
			await alertAction(err.message || 'Failed to delete track', 'Error');
		} finally {
			showDeleteModal = false;
		}
	}
</script>

<div
	class="group relative flex flex-col gap-2 border-b border-neutral-800/60 p-3 transition hover:bg-neutral-900/40 {track.is_missing === 1 ? 'border-l-4 border-l-rose-500 bg-rose-500/[0.03]' : hasTrackIssue ? 'border-l-4 border-l-amber-500/80 bg-amber-500/[0.02]' : ''}"
>
	<!-- LINE 1: Song Info, Title, Artist, Duration & Quality / Bitrate -->
	<div class="flex items-center justify-between gap-3 min-w-0">
		<div class="flex items-center gap-2.5 min-w-0 flex-1 relative">
			<!-- Track Number -->
			<span class="w-6 text-right text-xs font-mono font-medium text-neutral-500 shrink-0">
				{track.track_number}
			</span>

			<!-- Flag / Report Error Button (Discrete / Hidden unless hovered or has issue) -->
			<div class="relative shrink-0">
				<button
					type="button"
					onclick={() => (showIssueMenu = !showIssueMenu)}
					class="p-1 rounded-lg transition cursor-pointer flex items-center gap-1 {hasTrackIssue
						? 'bg-amber-950/70 border border-amber-600/70 text-amber-300 hover:bg-amber-900 shadow-sm'
						: 'text-neutral-500 hover:text-amber-400 hover:bg-neutral-800 opacity-0 group-hover:opacity-100'}"
					title={hasTrackIssue ? 'Track has flagged issues (Click to view/change)' : 'Flag problem with track (censored, bad audio, etc.)'}
				>
					<AlertTriangle class="h-3.5 w-3.5 {hasTrackIssue ? 'text-amber-400' : ''}" />
					{#if hasTrackIssue && track.is_missing !== 1}
						<span class="text-[10px] font-bold uppercase hidden xl:inline">
							{track.censorship === 'censored' ? 'Censored' : track.lyrics === 'censored_lrc' ? 'Censored Lyrics' : track.quality_rating === 'bad' ? 'Bad Quality' : 'Issue'}
						</span>
					{/if}
				</button>

				{#if showIssueMenu}
					<!-- Backdrop -->
					<div
						class="fixed inset-0 z-40"
						onclick={() => (showIssueMenu = false)}
					></div>
					<!-- Issue Menu Popover -->
					<div
						class="absolute left-0 top-full mt-1.5 z-50 w-72 rounded-2xl bg-neutral-900/95 border border-neutral-700/80 shadow-2xl p-3 text-xs flex flex-col gap-2.5 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150"
					>
						<div class="flex items-center justify-between border-b border-neutral-800 pb-2">
							<div class="flex items-center gap-1.5 font-bold text-white text-xs">
								<AlertTriangle class="h-4 w-4 text-amber-400" />
								<span>Report / Flag Track Issue</span>
							</div>
							<button
								type="button"
								onclick={() => (showIssueMenu = false)}
								class="text-neutral-400 hover:text-white p-0.5 cursor-pointer"
							>
								<X class="h-3.5 w-3.5" />
							</button>
						</div>

						<p class="text-[11px] text-neutral-400 leading-tight">
							Specify what is wrong with this song so you can track it in The Fixer:
						</p>

						<div class="space-y-1.5">
							<!-- Censored Lyrics Option -->
							<button
								type="button"
								onclick={() => {
									const next = track.lyrics === 'censored_lrc' ? 'synced_lrc' : 'censored_lrc';
									updateField('lyrics', next);
								}}
								class="w-full flex items-center justify-between p-2 rounded-xl text-left transition cursor-pointer border {track.lyrics === 'censored_lrc' ? 'bg-orange-950/60 border-orange-700/80 text-orange-200' : 'bg-neutral-950/60 border-neutral-800 text-neutral-300 hover:bg-neutral-800'}"
							>
								<div>
									<div class="font-semibold text-xs flex items-center gap-1.5">
										<span class="text-orange-400">📝</span>
										<span>Censored Lyrics (.lrc)</span>
									</div>
									<div class="text-[10px] text-neutral-400 mt-0.5">Asterisks (f***) or omitted verses</div>
								</div>
								<span class="text-[10px] font-bold px-1.5 py-0.5 rounded {track.lyrics === 'censored_lrc' ? 'bg-orange-900 text-orange-200' : 'bg-neutral-800 text-neutral-400'}">
									{track.lyrics === 'censored_lrc' ? 'FLAGGED' : 'FLAG'}
								</span>
							</button>

							<!-- Censored Audio Option -->
							<button
								type="button"
								onclick={() => {
									const next = track.censorship === 'censored' ? 'explicit' : 'censored';
									updateField('censorship', next);
								}}
								class="w-full flex items-center justify-between p-2 rounded-xl text-left transition cursor-pointer border {track.censorship === 'censored' ? 'bg-rose-950/60 border-rose-700/80 text-rose-200' : 'bg-neutral-950/60 border-neutral-800 text-neutral-300 hover:bg-neutral-800'}"
							>
								<div>
									<div class="font-semibold text-xs flex items-center gap-1.5">
										<span class="text-rose-400">🚫</span>
										<span>Censored Audio Track</span>
									</div>
									<div class="text-[10px] text-neutral-400 mt-0.5">Radio edit, muted/bleeped curses</div>
								</div>
								<span class="text-[10px] font-bold px-1.5 py-0.5 rounded {track.censorship === 'censored' ? 'bg-rose-900 text-rose-200' : 'bg-neutral-800 text-neutral-400'}">
									{track.censorship === 'censored' ? 'FLAGGED' : 'FLAG'}
								</span>
							</button>

							<!-- Bad Quality Option -->
							<button
								type="button"
								onclick={() => {
									const next = track.quality_rating === 'bad' ? 'good' : 'bad';
									updateField('quality_rating', next);
								}}
								class="w-full flex items-center justify-between p-2 rounded-xl text-left transition cursor-pointer border {track.quality_rating === 'bad' ? 'bg-amber-950/60 border-amber-700/80 text-amber-200' : 'bg-neutral-950/60 border-neutral-800 text-neutral-300 hover:bg-neutral-800'}"
							>
								<div>
									<div class="font-semibold text-xs flex items-center gap-1.5">
										<span class="text-amber-400">📉</span>
										<span>Bad Audio Quality</span>
									</div>
									<div class="text-[10px] text-neutral-400 mt-0.5">Muffled, low bitrate, bad transcode</div>
								</div>
								<span class="text-[10px] font-bold px-1.5 py-0.5 rounded {track.quality_rating === 'bad' ? 'bg-amber-900 text-amber-200' : 'bg-neutral-800 text-neutral-400'}">
									{track.quality_rating === 'bad' ? 'FLAGGED' : 'FLAG'}
								</span>
							</button>
						</div>

						<!-- Custom Issue Notes Input -->
						<div class="pt-1 border-t border-neutral-800">
							<label class="block text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">
								Issue Description / Note
							</label>
							<div class="flex items-center gap-1.5">
								<input
									type="text"
									bind:value={issueNoteText}
									placeholder="e.g. Muted word at 1:45..."
									class="flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
								/>
								<button
									type="button"
									onclick={() => {
										updateField('notes', issueNoteText.trim());
										showIssueMenu = false;
									}}
									class="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs cursor-pointer shadow-sm"
								>
									Save
								</button>
							</div>
						</div>

						<!-- Clear Issues Button if any are set -->
						{#if track.censorship === 'censored' || track.lyrics === 'censored_lrc' || track.quality_rating === 'bad' || track.notes}
							<div class="pt-1 border-t border-neutral-800 flex justify-end">
								<button
									type="button"
									onclick={() => {
										if (track.censorship === 'censored') updateField('censorship', 'explicit');
										if (track.lyrics === 'censored_lrc') updateField('lyrics', 'synced_lrc');
										if (track.quality_rating === 'bad') updateField('quality_rating', 'good');
										if (track.notes) {
											issueNoteText = '';
											updateField('notes', '');
										}
										showIssueMenu = false;
									}}
									class="text-[10px] text-neutral-400 hover:text-emerald-400 transition cursor-pointer flex items-center gap-1"
								>
									<span>✓ Clear all errors for this track</span>
								</button>
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<div class="flex items-center gap-2 min-w-0 flex-1">
				<span class="truncate text-sm font-semibold {track.is_missing === 1 ? 'text-rose-200' : 'text-neutral-100'}" title={track.title}>
					{track.title}
				</span>

				{#if track.is_missing === 1}
					<span
						class="inline-flex items-center gap-1 rounded bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-300 border border-rose-500/40 shrink-0"
						title="Audio file is missing from library folder"
					>
						<AlertTriangle class="h-3 w-3 text-rose-400" />
						Missing Song
					</span>
					{#if isAdmin}
						<button
							type="button"
							onclick={() => replaceInputRef?.click()}
							disabled={isReplacing}
							class="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-950/40 px-2 py-0.5 text-[10px] font-bold text-emerald-300 hover:bg-emerald-900/60 transition cursor-pointer shrink-0 shadow-sm"
							title="Upload audio file for this missing song"
						>
							{#if isReplacing}
								<span class="h-3 w-3 animate-spin rounded-full border border-emerald-400 border-t-transparent"></span>
								Uploading...
							{:else}
								<Upload class="h-3 w-3" />
								+ Upload Audio
							{/if}
						</button>
					{/if}
				{:else if hasTrackIssue}
					<span
						class="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 border border-amber-500/30 shrink-0"
					>
						<AlertTriangle class="h-3 w-3" />
						Needs Fix
					</span>
				{/if}
			</div>
		</div>

		<!-- Right side of Line 1: Artist, Duration, Format & Bitrate kb/s -->
		<div class="flex items-center gap-2.5 text-xs text-neutral-400 shrink-0">
			{#if track.artist}
				<span class="truncate max-w-[150px] text-neutral-400">{track.artist}</span>
				<span>•</span>
			{/if}
			<span class="font-mono text-neutral-500">{formatDuration(track.duration_ms)}</span>

			{#if track.is_missing === 1}
				<span class="inline-flex items-center gap-1 rounded-lg border border-rose-800/60 bg-rose-950/60 px-2 py-0.5 text-[11px] font-semibold text-rose-300">
					<span class="font-bold uppercase font-mono text-[10px]">Missing File</span>
				</span>
			{:else}
				<!-- Format & Bitrate kb/s Badge -->
				<span class="inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[11px] font-medium {getFormatBadgeClass(track.format)}">
					<span class="font-bold uppercase font-mono">{track.format}</span>
					<span class="opacity-40">|</span>
					<span class="text-neutral-200 font-mono text-[10px]">{getBitrateLabel(track.format, track.bitrate_kbps)}</span>
				</span>
			{/if}
		</div>
	</div>

	<!-- Hidden input for file replacement / upload -->
	<input
		type="file"
		class="hidden"
		bind:this={replaceInputRef}
		accept="audio/*,.flac,.mp3,.m4a,.aac,.ogg,.opus,.wav,.aif,.aiff,.alac"
		onchange={(e) => {
			const file = e.currentTarget.files?.[0];
			if (file) handleReplaceFile(file);
			e.currentTarget.value = '';
		}}
	/>

	<!-- LINE 2: Direct Choice Buttons (Format, Quality, Censorship, Lyrics) + Notes & Delete -->
	<div class="flex flex-wrap items-center justify-between gap-2 pt-1 pl-8.5">
		<div class="flex flex-wrap items-center gap-1.5">
			<!-- Format -->
			<select
				value={track.format}
				onchange={(e) => updateField('format', e.currentTarget.value)}
				disabled={isUpdating}
				class="rounded-lg border px-2 py-1 text-xs font-semibold uppercase tracking-wide cursor-pointer transition focus:outline-none focus:ring-1 focus:ring-emerald-500 {getFormatBadgeClass(track.format)}"
			>
				{#each FORMAT_OPTIONS as opt}
					<option value={opt.value} class="bg-neutral-900 text-neutral-200">
						{opt.label}
					</option>
				{/each}
			</select>

			<!-- Quality -->
			<select
				value={track.quality_rating}
				onchange={(e) => updateField('quality_rating', e.currentTarget.value)}
				disabled={isUpdating}
				class="rounded-lg border px-2 py-1 text-xs font-medium cursor-pointer transition focus:outline-none focus:ring-1 focus:ring-emerald-500 {QUALITY_OPTIONS.find(q => q.value === track.quality_rating)?.color || 'text-neutral-300 bg-neutral-900 border-neutral-800'}"
			>
				{#each QUALITY_OPTIONS as q}
					<option value={q.value} class="bg-neutral-900 text-neutral-200">
						{q.label}
					</option>
				{/each}
			</select>

			<!-- Censorship -->
			<select
				value={track.censorship}
				onchange={(e) => updateField('censorship', e.currentTarget.value)}
				disabled={isUpdating}
				class="rounded-lg border px-2 py-1 text-xs font-medium cursor-pointer transition focus:outline-none focus:ring-1 focus:ring-emerald-500 {CENSORSHIP_OPTIONS.find(c => c.value === track.censorship)?.color || 'text-neutral-300 bg-neutral-900 border-neutral-800'}"
			>
				{#each CENSORSHIP_OPTIONS as opt}
					<option value={opt.value} class="bg-neutral-900 text-neutral-200">
						{opt.label}
					</option>
				{/each}
			</select>

			<!-- Lyrics -->
			<div class="flex items-center gap-1">
				<select
					value={track.lyrics}
					onchange={(e) => updateField('lyrics', e.currentTarget.value)}
					disabled={isUpdating}
					class="rounded-lg border px-2 py-1 text-xs font-medium cursor-pointer transition focus:outline-none focus:ring-1 focus:ring-emerald-500 {LYRICS_OPTIONS.find(l => l.value === track.lyrics)?.color || 'text-neutral-300 bg-neutral-900 border-neutral-800'}"
				>
					{#each LYRICS_OPTIONS as opt}
						<option value={opt.value} class="bg-neutral-900 text-neutral-200">
							{opt.label}
						</option>
					{/each}
				</select>

				{#if onOpenLyrics}
					<button
						type="button"
						onclick={() => onOpenLyrics?.(track)}
						class="rounded-lg border border-neutral-800 bg-neutral-900/80 p-1.5 text-neutral-400 hover:text-indigo-400 hover:border-indigo-500/40 hover:bg-indigo-950/20 transition flex items-center justify-center shrink-0 cursor-pointer"
						title="Quick View & Edit Folder Lyrics (.lrc / .txt)"
					>
						<AlignLeft class="h-3 w-3" />
					</button>
				{/if}

				<a
					href="/lrc-maker?trackId={track.id}"
					class="rounded-lg border border-neutral-800 bg-neutral-900/80 p-1.5 text-neutral-400 hover:text-emerald-400 hover:border-emerald-500/40 hover:bg-emerald-950/20 transition flex items-center justify-center shrink-0"
					title="Open in LRC Maker"
				>
					<Mic2 class="h-3 w-3" />
				</a>
			</div>
		</div>

		<!-- Actions: Notes snippet / toggle & Delete -->
		<div class="flex items-center gap-2 ml-auto">
			{#if track.notes}
				<span class="truncate italic text-neutral-400 text-[11px] max-w-[200px]" title={track.notes}>
					"{track.notes}"
				</span>
			{/if}

			{#if onAddToPlaylist}
				<button
					type="button"
					onclick={() => onAddToPlaylist?.(track)}
					class="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-emerald-400 transition"
					title="Add to Playlist"
				>
					<ListPlus class="h-3.5 w-3.5" />
				</button>
			{/if}

			{#if isAdmin}
				<button
					type="button"
					onclick={() => replaceInputRef?.click()}
					disabled={isReplacing}
					class="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-emerald-400 transition"
					title="Replace Audio File"
				>
					{#if isReplacing}
						<span class="h-3.5 w-3.5 animate-spin rounded-full border border-emerald-400 border-t-transparent inline-block"></span>
					{:else}
						<RefreshCw class="h-3.5 w-3.5" />
					{/if}
				</button>

				{#if track.file_path && track.is_missing !== 1}
					<button
						type="button"
						onclick={handleRescan}
						disabled={isRescanning}
						class="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-cyan-400 transition"
						title="Re-scan File Metadata & Fidelity from Disk"
					>
						{#if isRescanning}
							<span class="h-3.5 w-3.5 animate-spin rounded-full border border-cyan-400 border-t-transparent inline-block"></span>
						{:else}
							<ScanLine class="h-3.5 w-3.5" />
						{/if}
					</button>
				{/if}
			{/if}

			{#if track.file_path && track.is_missing !== 1}
				<div class="relative inline-block">
					<button
						type="button"
						onclick={() => (showDownloadMenu = !showDownloadMenu)}
						class="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-emerald-400 transition inline-flex items-center"
						title="Download Audio File"
					>
						<Download class="h-3.5 w-3.5" />
					</button>
					{#if showDownloadMenu}
						<div
							class="fixed inset-0 z-40"
							onclick={() => (showDownloadMenu = false)}
						></div>
						<div
							class="absolute right-0 bottom-full mb-1 z-50 w-48 rounded-xl bg-neutral-900 border border-neutral-700/80 shadow-2xl p-1.5 text-xs flex flex-col gap-1 backdrop-blur-xl"
						>
							<div class="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-neutral-400 border-b border-neutral-800">
								Download Audio
							</div>
							<a
								href="/api/tracks/{track.id}/audio?download=true"
								download
								onclick={() => (showDownloadMenu = false)}
								class="px-2 py-1.5 rounded-lg hover:bg-neutral-800 text-neutral-200 hover:text-emerald-300 flex items-center justify-between"
							>
								<span>Original ({track.format || 'Audio'})</span>
								<span class="text-[10px] font-mono text-neutral-500">Full</span>
							</a>
							<a
								href="/api/tracks/{track.id}/audio?download=true&bitrate=320&format=mp3"
								download
								onclick={() => (showDownloadMenu = false)}
								class="px-2 py-1.5 rounded-lg hover:bg-neutral-800 text-neutral-200 hover:text-emerald-300 flex items-center justify-between"
							>
								<span>320 kbps MP3</span>
								<span class="text-[10px] font-mono text-emerald-400 font-semibold">HQ</span>
							</a>
							<a
								href="/api/tracks/{track.id}/audio?download=true&bitrate=192&format=mp3"
								download
								onclick={() => (showDownloadMenu = false)}
								class="px-2 py-1.5 rounded-lg hover:bg-neutral-800 text-neutral-200 hover:text-emerald-300 flex items-center justify-between"
							>
								<span>192 kbps MP3</span>
								<span class="text-[10px] font-mono text-neutral-400">Normal</span>
							</a>
							<a
								href="/api/tracks/{track.id}/audio?download=true&bitrate=128&format=mp3"
								download
								onclick={() => (showDownloadMenu = false)}
								class="px-2 py-1.5 rounded-lg hover:bg-neutral-800 text-neutral-200 hover:text-emerald-300 flex items-center justify-between"
							>
								<span>128 kbps MP3</span>
								<span class="text-[10px] font-mono text-amber-400 font-semibold">Saver</span>
							</a>
						</div>
					{/if}
				</div>
			{/if}

			<button
				type="button"
				onclick={() => (showNotes = !showNotes)}
				class="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition"
				title="Notes"
			>
				<FileText class="h-3.5 w-3.5" />
			</button>

			<button
				type="button"
				onclick={() => (showDeleteModal = true)}
				class="rounded p-1 text-neutral-500 hover:bg-rose-950/50 hover:text-rose-400 transition"
				title="Delete"
			>
				<Trash2 class="h-3.5 w-3.5" />
			</button>
		</div>
	</div>
</div>

<DeleteTrackModal
	{track}
	isOpen={showDeleteModal}
	{isAdmin}
	onClose={() => (showDeleteModal = false)}
	onConfirm={handleDeleteConfirm}
/>

<!-- Inline Notes Editor Drawer -->
{#if showNotes}
	<div class="flex items-center gap-2 border-b border-neutral-800 bg-neutral-900/90 px-8 py-2.5">
		<input
			type="text"
			bind:value={notesValue}
			placeholder="Notes for this track (e.g. 'needs vinyl rip replacement', 'radio muted curse at 1:45', etc.)"
			class="flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
		/>
		<button
			type="button"
			onclick={saveNotes}
			class="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500 transition shadow-sm shadow-emerald-600/30"
		>
			Save
		</button>
		<button
			type="button"
			onclick={() => (showNotes = false)}
			class="rounded-lg bg-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700 transition"
		>
			Cancel
		</button>
	</div>
{/if}
