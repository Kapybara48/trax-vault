<script lang="ts">
	import type { Album } from '$lib/types/index.js';
	import { Disc, AlertTriangle, CheckCircle2, Music, Trash2 } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';

	interface Props {
		album: Album;
		onAlbumDeleted?: (id: number) => void;
	}

	let { album, onAlbumDeleted }: Props = $props();

	const hasIssues = $derived(
		(album.bad_quality_count || 0) > 0 ||
		(album.censored_count || 0) > 0 ||
		(album.missing_lyrics_count || 0) > 0
	);

	async function handleDelete(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
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
				if (onAlbumDeleted) {
					onAlbumDeleted(album.id);
				} else {
					await invalidateAll();
				}
			} else {
				const errData = await res.json().catch(() => ({}));
				alert(`Failed to remove album: ${errData.error || res.statusText}`);
			}
		} catch (err: any) {
			console.error('Failed to remove album from vault:', err);
			alert(`Failed to remove album: ${err.message}`);
		}
	}
</script>

<a
	href="/album/{album.id}"
	class="group relative flex flex-col overflow-hidden rounded-2xl border border-neutral-800/80 bg-neutral-900/40 p-4 transition duration-200 hover:-translate-y-1 hover:border-emerald-700/50 hover:bg-neutral-900/80 hover:shadow-xl hover:shadow-emerald-950/20"
>
	<!-- Cover Art / Thumbnail -->
	<div class="relative aspect-square w-full overflow-hidden rounded-xl bg-neutral-950 shadow-inner">
		<!-- Quick Unvault / Remove button on hover -->
		<button
			type="button"
			onclick={handleDelete}
			class="absolute top-2 left-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-neutral-400 opacity-0 backdrop-blur-md transition duration-200 hover:bg-rose-950 hover:text-rose-300 group-hover:opacity-100 border border-neutral-700/60 shadow-md"
			title="Remove from Vault (keeps audio files on disk)"
		>
			<Trash2 class="h-3.5 w-3.5" />
		</button>

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

		<!-- Health Badge on Top Right -->
		<div class="absolute top-2 right-2 flex flex-col gap-1 items-end">
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
			<div class="absolute bottom-2 left-2">
				<span class="rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-neutral-300 backdrop-blur-sm whitespace-nowrap">
					{album.media_type}
				</span>
			</div>
		{/if}
	</div>

	<!-- Info Section -->
	<div class="mt-3.5 flex flex-1 flex-col justify-between">
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
			</div>
		{/if}
	</div>
</a>
