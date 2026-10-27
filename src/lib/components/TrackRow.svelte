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
		CheckCircle2,
		FileText,
		Disc,
		Clock,
		Mic2,
		Sparkles,
		Check,
		AlignLeft,
		ListPlus
	} from '@lucide/svelte';
	import CustomCheckbox from '$lib/components/CustomCheckbox.svelte';

	interface Props {
		track: Track;
		onTrackUpdated?: (updated: Track) => void;
		onTrackDeleted?: (id: number) => void;
		onOpenLyrics?: (track: Track) => void;
		onAddToPlaylist?: (track: Track) => void;
	}

	let { track, onTrackUpdated, onTrackDeleted, onOpenLyrics, onAddToPlaylist }: Props = $props();

	let isUpdating = $state(false);
	let showNotes = $state(false);
	let notesValue = $state(track.notes || '');

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

	async function handleDelete() {
		if (
			!confirm(
				`Remove song "${track.title}" from Vault?\n\nAudio file on disk will NOT be deleted, and can be re-scanned at any time.`
			)
		) {
			return;
		}
		try {
			const res = await fetch(`/api/tracks/${track.id}`, { method: 'DELETE' });
			if (res.ok && onTrackDeleted) {
				onTrackDeleted(track.id);
			}
		} catch (err) {
			console.error('Failed to delete track:', err);
		}
	}
</script>

<div
	class="group relative flex flex-col gap-2 border-b border-neutral-800/60 p-3 transition hover:bg-neutral-900/40 {track.is_missing === 1 ? 'border-l-4 border-l-rose-500 bg-rose-500/[0.03]' : track.needs_attention ? 'border-l-4 border-l-amber-500/80 bg-amber-500/[0.02]' : track.manually_checked === 1 ? 'border-l-4 border-l-emerald-500/60 bg-emerald-500/[0.02]' : ''}"
>
	<!-- LINE 1: Song Info, Title, Artist, Duration & Quality / Bitrate -->
	<div class="flex items-center justify-between gap-3 min-w-0">
		<div class="flex items-center gap-2.5 min-w-0 flex-1">
			<!-- Verification Checkbox -->
			<div
				class="flex items-center shrink-0"
				title={track.is_missing === 1 ? 'Missing song from release' : track.manually_checked === 1 ? 'Marked as verified (Click to uncheck)' : 'Click to mark as verified'}
			>
				<CustomCheckbox
					checked={track.manually_checked === 1}
					disabled={isUpdating || track.is_missing === 1}
					onchange={(checked) => updateField('manually_checked', checked ? 1 : 0)}
				/>
			</div>

			<span class="w-6 text-right text-xs font-mono font-medium text-neutral-500 shrink-0">
				{track.track_number}
			</span>

			<div class="flex items-center gap-2 min-w-0 flex-1">
				<span class="truncate text-sm font-semibold {track.is_missing === 1 ? 'text-rose-200' : track.manually_checked === 1 ? 'text-emerald-100' : 'text-neutral-100'}" title={track.title}>
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
				{:else if track.manually_checked === 1}
					<span
						class="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/30 shrink-0"
					>
						<CheckCircle2 class="h-3 w-3" />
						Checked
					</span>
				{:else if track.needs_attention}
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
				onclick={handleDelete}
				class="rounded p-1 text-neutral-500 hover:bg-rose-950/50 hover:text-rose-400 transition"
				title="Delete"
			>
				<Trash2 class="h-3.5 w-3.5" />
			</button>
		</div>
	</div>
</div>

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
