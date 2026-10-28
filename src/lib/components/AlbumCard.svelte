<script lang="ts">
	import type { Album } from '$lib/types/index.js';
	import { Disc, AlertTriangle, CheckCircle2, Music, Trash2 } from '@lucide/svelte';
	import CustomCheckbox from '$lib/components/CustomCheckbox.svelte';
	import { invalidateAll } from '$app/navigation';
	import { confirmAction, alertAction } from '$lib/services/dialog.svelte.js';

	interface Props {
		album: Album;
		selected?: boolean;
		selectionMode?: boolean;
		onToggleSelect?: (id: number) => void;
		onAlbumDeleted?: (id: number) => void;
	}

	let {
		album,
		selected = false,
		selectionMode = false,
		onToggleSelect,
		onAlbumDeleted
	}: Props = $props();

	const hasIssues = $derived(
		(album.bad_quality_count || 0) > 0 ||
		(album.censored_count || 0) > 0 ||
		(album.missing_lyrics_count || 0) > 0 ||
		(album.missing_tracks_count || 0) > 0
	);

	async function handleDelete(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		const confirmed = await confirmAction({
			title: 'Unvault Album',
			message: `Remove album "${album.title}" from Vault?\n\nAudio files on disk in your music directory will NOT be deleted, and the album will return to the Library Scanner.`,
			confirmText: 'Unvault Album',
			danger: true
		});
		if (!confirmed) return;

		try {
			const res = await fetch(`/api/albums/${album.id}`, { method: 'DELETE' });
			if (res.ok) {
				if (onAlbumDeleted) {
					onAlbumDeleted(album.id);
				} else {
					await invalidateAll();
				}
			} else {
				const errData = await res.json().catch(() => ({}));
				await alertAction(`Failed to remove album: ${errData.error || res.statusText}`, 'Error');
			}
		} catch (err: any) {
			console.error('Failed to remove album from vault:', err);
			await alertAction(`Failed to remove album: ${err.message}`, 'Error');
		}
	}

	function handleLinkClick(e: MouseEvent) {
		if (selectionMode) {
			e.preventDefault();
			e.stopPropagation();
			if (onToggleSelect) {
				onToggleSelect(album.id);
			}
		}
	}
</script>

<div
	class="group relative flex flex-col overflow-hidden rounded-2xl border transition duration-200 p-4 {selected ? 'border-emerald-500 bg-neutral-900/90 ring-2 ring-emerald-500/70 shadow-xl shadow-emerald-950/40 -translate-y-1' : 'border-neutral-800/80 bg-neutral-900/40 hover:-translate-y-1 hover:border-emerald-700/50 hover:bg-neutral-900/80 hover:shadow-xl hover:shadow-emerald-950/20'}"
>
	<!-- Link backdrop to open album when not in selection mode -->
	<a
		href="/album/{album.id}"
		onclick={handleLinkClick}
		class="absolute inset-0 z-10 cursor-pointer"
		aria-label="View album {album.title}"
	></a>

	<!-- Top-Left Actions: Multi-Select Checkbox & Quick Unvault Button (z-20, isolated from link) -->
	<div class="absolute top-6 left-6 z-20 flex items-center gap-1.5 pointer-events-auto">
		<button
			type="button"
			onclick={(e) => {
				e.preventDefault();
				e.stopPropagation();
				if (onToggleSelect) onToggleSelect(album.id);
			}}
			class="flex items-center justify-center rounded-lg p-1 -m-1 transition duration-150 {selectionMode || selected ? 'opacity-100 scale-100' : 'opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100'} cursor-pointer"
			title={selected ? 'Deselect album' : 'Select album'}
		>
			<CustomCheckbox
				checked={selected}
				disabled
				class="pointer-events-none"
			/>
		</button>

		{#if !selectionMode}
			<button
				type="button"
				onclick={handleDelete}
				class="flex h-5 w-5 items-center justify-center rounded-md bg-black/70 text-neutral-400 opacity-0 backdrop-blur-md transition duration-200 hover:bg-rose-950 hover:text-rose-300 group-hover:opacity-100 border border-neutral-700/60 shadow-md cursor-pointer"
				title="Remove from Vault (keeps audio files on disk)"
			>
				<Trash2 class="h-3 w-3" />
			</button>
		{/if}
	</div>

	<!-- Cover Art / Thumbnail -->
	<div class="relative aspect-square w-full overflow-hidden rounded-xl bg-neutral-950 shadow-inner">
		{#if album.cover_url}
			<img
				src={album.cover_url}
				alt={album.title}
				loading="lazy"
				class="h-full w-full object-cover transition duration-300 group-hover:scale-105"
				onerror={(e) => {
					// Fallback if image fails to load
					(e.currentTarget as HTMLElement).style.display = 'none';
				}}
			/>
		{:else}
			<div class="flex h-full w-full items-center justify-center bg-gradient-to-br from-neutral-900 to-neutral-950 text-neutral-600">
				<Disc class="h-16 w-16 opacity-40 group-hover:rotate-12 transition duration-300" />
			</div>
		{/if}

		<!-- Health Badge on Top Right (pointer-events-none so click passes to link) -->
		<div class="absolute top-2 right-2 flex flex-col gap-1 items-end pointer-events-none">
			{#if album.checked_count !== undefined && (album.track_count || 0) > 0 && album.checked_count === album.track_count}
				<span class="inline-flex items-center gap-1 rounded-full bg-emerald-900/90 px-2 py-0.5 text-[10px] font-semibold text-emerald-200 border border-emerald-500/80 backdrop-blur-md shadow-sm whitespace-nowrap">
					<CheckCircle2 class="h-3 w-3 text-emerald-300" />
					Verified
				</span>
			{:else if !hasIssues && (album.track_count || 0) > 0}
				<span class="inline-flex items-center gap-1 rounded-full bg-emerald-950/90 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 border border-emerald-700/60 backdrop-blur-md shadow-sm whitespace-nowrap">
					<CheckCircle2 class="h-3 w-3" />
					Ready
				</span>
			{:else if hasIssues}
				<span class="inline-flex items-center gap-1 rounded-full bg-amber-950/90 px-2 py-0.5 text-[10px] font-semibold text-amber-300 border border-amber-600/60 backdrop-blur-md shadow-sm whitespace-nowrap">
					<AlertTriangle class="h-3 w-3" />
					Needs Fix
				</span>
			{/if}
		</div>

		{#if album.media_type}
			<div class="absolute bottom-2 left-2 pointer-events-none">
				<span class="rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-neutral-300 backdrop-blur-sm whitespace-nowrap">
					{album.media_type}
				</span>
			</div>
		{/if}
	</div>

	<!-- Info Section (pointer-events-none so clicks hit link) -->
	<div class="mt-3.5 flex flex-1 flex-col justify-between pointer-events-none">
		<div>
			<h3 class="truncate font-bold text-neutral-100 group-hover:text-emerald-300 transition" title={album.title}>
				{album.title}
			</h3>
			<p class="truncate text-sm font-medium text-neutral-400" title={album.artist}>
				{album.artist}
			</p>
		</div>

		<div class="mt-3 flex items-center justify-between border-t border-neutral-800/60 pt-2 text-xs text-neutral-500">
			<span class="whitespace-nowrap">{album.release_year || '—'}</span>
			<div class="flex items-center gap-2 whitespace-nowrap">
				{#if album.checked_count !== undefined && (album.track_count || 0) > 0}
					<span class="whitespace-nowrap font-medium {album.checked_count === album.track_count ? 'text-emerald-400' : 'text-neutral-400'}">
						{album.checked_count}/{album.track_count}&nbsp;checked
					</span>
				{:else}
					<span class="whitespace-nowrap">{album.track_count || 0}&nbsp;tracks</span>
				{/if}
			</div>
		</div>

		<!-- Matching Tracks Badge when specific track search is active -->
		{#if album.matched_tracks_count !== undefined}
			<div class="mt-2 flex items-center gap-1.5 rounded-lg bg-emerald-950/80 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 border border-emerald-700/60 shadow-sm whitespace-nowrap">
				<Music class="h-3 w-3 text-emerald-400" />
				<span>{album.matched_tracks_count}&nbsp;matched</span>
			</div>
		{/if}

		<!-- Status Pills Breakdown -->
		{#if hasIssues}
			<div class="mt-2 flex flex-wrap gap-1.5 pt-1">
				{#if (album.bad_quality_count || 0) > 0}
					<span class="rounded bg-rose-950/70 px-1.5 py-0.5 text-[10px] font-medium text-rose-300 border border-rose-800/50 whitespace-nowrap">
						{album.bad_quality_count}&nbsp;bad
					</span>
				{/if}
				{#if (album.censored_count || 0) > 0}
					<span class="rounded bg-rose-950/70 px-1.5 py-0.5 text-[10px] font-medium text-rose-300 border border-rose-800/50 whitespace-nowrap">
						{album.censored_count}&nbsp;censored
					</span>
				{/if}
				{#if (album.missing_lyrics_count || 0) > 0}
					<span class="rounded bg-amber-950/70 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 border border-amber-800/50 whitespace-nowrap">
						{album.missing_lyrics_count}&nbsp;no lyrics
					</span>
				{/if}
				{#if (album.missing_tracks_count || 0) > 0}
					<span class="rounded bg-rose-950/80 px-1.5 py-0.5 text-[10px] font-bold text-rose-300 border border-rose-700/60 whitespace-nowrap">
						{album.missing_tracks_count}&nbsp;missing song{(album.missing_tracks_count ?? 0) > 1 ? 's' : ''}
					</span>
				{/if}
			</div>
		{/if}
	</div>
</div>
