<script lang="ts">
	import type { PageData } from './$types.js';
	import {
		ListMusic,
		Plus,
		Search,
		Play,
		Globe,
		Lock,
		Clock,
		Music,
		Sparkles,
		X,
		Disc
	} from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { player } from '$lib/services/player.svelte.js';
	import type { Playlist } from '$lib/types/index.js';

	interface ExtendedPlaylist extends Playlist {
		song_count: number;
		duration_ms: number;
		cover_url: string | null;
	}

	let { data }: { data: PageData } = $props();

	let playlists = $state<ExtendedPlaylist[]>(data.playlists as ExtendedPlaylist[]);
	let searchQuery = $state('');
	let showCreateModal = $state(false);

	// Create Playlist Form State
	let newName = $state('');
	let newComment = $state('');
	let newIsPublic = $state(false);
	let isCreating = $state(false);
	let createError = $state<string | null>(null);

	// Play loading state
	let loadingPlaylistId = $state<number | null>(null);

	const filteredPlaylists = $derived(
		playlists.filter(
			(p) =>
				!searchQuery.trim() ||
				p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
				(p.comment && p.comment.toLowerCase().includes(searchQuery.toLowerCase()))
		)
	);

	function formatPlaylistDuration(ms: number): string {
		if (!ms || ms <= 0) return '0 min';
		const totalMinutes = Math.round(ms / 60000);
		if (totalMinutes < 60) {
			return `${totalMinutes} min`;
		}
		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		return minutes > 0 ? `${hours} hr ${minutes} min` : `${hours} hr`;
	}

	async function handlePlay(playlist: ExtendedPlaylist, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();

		loadingPlaylistId = playlist.id;
		try {
			const res = await fetch(`/api/playlists/${playlist.id}`);
			const data = await res.json();
			if (data.tracks && data.tracks.length > 0) {
				player.playPlaylist(playlist, data.tracks, 0);
			}
		} catch (err) {
			console.error('Failed to play playlist:', err);
		} finally {
			loadingPlaylistId = null;
		}
	}

	async function handleCreatePlaylist(e: SubmitEvent) {
		e.preventDefault();
		if (!newName.trim()) return;

		isCreating = true;
		createError = null;

		try {
			const res = await fetch('/api/playlists', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: newName.trim(),
					comment: newComment.trim() || null,
					is_public: newIsPublic
				})
			});

			const result = await res.json();
			if (!res.ok || result.error) {
				createError = result.error || 'Failed to create playlist';
				return;
			}

			showCreateModal = false;
			newName = '';
			newComment = '';
			newIsPublic = false;

			if (result.playlistId) {
				goto(`/playlist/${result.playlistId}`);
			}
		} catch (err: any) {
			createError = err.message || 'Network error';
		} finally {
			isCreating = false;
		}
	}
</script>

<svelte:head>
	<title>Playlists | Track Vault</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
	<!-- Header Banner -->
	<header class="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
		<div>
			<div class="flex items-center gap-3">
				<div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 text-emerald-400 border border-emerald-500/30 shadow-inner">
					<ListMusic class="h-6 w-6" />
				</div>
				<div>
					<h1 class="text-2xl font-black tracking-tight text-neutral-100 sm:text-3xl">Playlists</h1>
					<p class="text-xs sm:text-sm text-neutral-400">
						Custom collections, mixes, and synced Subsonic / Symfonium playlists.
					</p>
				</div>
			</div>
		</div>

		<!-- Actions -->
		<div class="flex items-center gap-3">
			<button
				type="button"
				onclick={() => {
					showCreateModal = true;
					createError = null;
				}}
				class="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2.5 text-xs sm:text-sm font-semibold text-neutral-950 shadow-lg shadow-emerald-500/20 transition-all hover:scale-[1.02] hover:brightness-110 active:scale-[0.98]"
			>
				<Plus class="h-4 w-4" />
				<span>Create Playlist</span>
			</button>
		</div>
	</header>

	<!-- Search & Filter Bar -->
	<div class="mb-6 flex flex-col sm:flex-row items-center gap-4">
		<div class="relative flex-1 w-full">
			<Search class="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Search playlists by title or description..."
				class="w-full rounded-xl border border-neutral-800 bg-neutral-900/60 pl-10 pr-4 py-2.5 text-xs sm:text-sm text-neutral-100 placeholder-neutral-500 backdrop-blur-md focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition"
			/>
			{#if searchQuery}
				<button
					type="button"
					onclick={() => (searchQuery = '')}
					class="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
				>
					<X class="h-4 w-4" />
				</button>
			{/if}
		</div>

		<div class="text-xs text-neutral-400 whitespace-nowrap self-end sm:self-center font-medium">
			{filteredPlaylists.length} {filteredPlaylists.length === 1 ? 'playlist' : 'playlists'}
		</div>
	</div>

	<!-- Playlists Grid -->
	{#if filteredPlaylists.length > 0}
		<section class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
			{#each filteredPlaylists as playlist (playlist.id)}
				<a
					href="/playlist/{playlist.id}"
					class="group relative flex flex-col overflow-hidden rounded-2xl border border-neutral-800/80 bg-neutral-900/40 p-3.5 transition duration-200 hover:-translate-y-1 hover:border-emerald-700/50 hover:bg-neutral-900/80 hover:shadow-xl hover:shadow-emerald-950/20 backdrop-blur-md"
				>
					<!-- Artwork / Thumbnail Container -->
					<div class="relative aspect-square w-full overflow-hidden rounded-xl bg-neutral-950 shadow-inner">
						{#if playlist.cover_url}
							<img
								src={playlist.cover_url}
								alt={playlist.name}
								loading="lazy"
								class="h-full w-full object-cover transition duration-300 group-hover:scale-105"
								onerror={(e) => {
									(e.currentTarget as HTMLElement).style.display = 'none';
								}}
							/>
						{:else}
							<div class="flex h-full w-full items-center justify-center bg-gradient-to-br from-neutral-900 via-neutral-950 to-emerald-950/20 text-neutral-600">
								<ListMusic class="h-14 w-14 opacity-30 text-emerald-400 group-hover:scale-110 transition duration-300" />
							</div>
						{/if}

						<!-- Public / Private Status Pill -->
						<div class="absolute top-2 right-2">
							{#if playlist.is_public}
								<span class="inline-flex items-center gap-1 rounded-full bg-neutral-950/80 px-2 py-0.5 text-[10px] font-medium text-emerald-400 border border-emerald-500/30 backdrop-blur-md shadow-sm">
									<Globe class="h-2.5 w-2.5" />
									Public
								</span>
							{:else}
								<span class="inline-flex items-center gap-1 rounded-full bg-neutral-950/80 px-2 py-0.5 text-[10px] font-medium text-neutral-400 border border-neutral-800 backdrop-blur-md shadow-sm">
									<Lock class="h-2.5 w-2.5" />
									Private
								</span>
							{/if}
						</div>

						<!-- Hover Quick Play Button -->
						{#if playlist.song_count > 0}
							<button
								type="button"
								onclick={(e) => handlePlay(playlist, e)}
								disabled={loadingPlaylistId === playlist.id}
								aria-label="Play {playlist.name}"
								class="absolute bottom-2.5 right-2.5 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-neutral-950 shadow-xl opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 hover:scale-110 hover:bg-emerald-400 active:scale-95 transition-all duration-200 z-10"
							>
								{#if loadingPlaylistId === playlist.id}
									<div class="h-4 w-4 animate-spin rounded-full border-2 border-neutral-950 border-t-transparent"></div>
								{:else}
									<Play class="h-4 w-4 fill-current ml-0.5" />
								{/if}
							</button>
						{/if}
					</div>

					<!-- Details -->
					<div class="mt-3 flex flex-1 flex-col justify-between">
						<div>
							<h3 class="truncate text-xs sm:text-sm font-bold text-neutral-100 group-hover:text-emerald-400 transition" title={playlist.name}>
								{playlist.name}
							</h3>
							{#if playlist.comment}
								<p class="mt-0.5 line-clamp-1 text-[11px] text-neutral-400" title={playlist.comment}>
									{playlist.comment}
								</p>
							{/if}
						</div>

						<div class="mt-2 flex items-center justify-between text-[11px] text-neutral-500 font-medium">
							<span>{playlist.song_count} {playlist.song_count === 1 ? 'song' : 'songs'}</span>
							<span>{formatPlaylistDuration(playlist.duration_ms)}</span>
						</div>
					</div>
				</a>
			{/each}
		</section>
	{:else}
		<!-- Empty State -->
		<section class="flex flex-col items-center justify-center rounded-3xl border border-dashed border-neutral-800 bg-neutral-900/30 py-20 px-4 text-center">
			<div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-neutral-800/80 text-emerald-400 mb-4 shadow-inner">
				<ListMusic class="h-8 w-8" />
			</div>
			<h3 class="text-lg font-bold text-neutral-100">
				{#if searchQuery}
					No playlists matching "{searchQuery}"
				{:else}
					No playlists yet
				{/if}
			</h3>
			<p class="mt-1 max-w-sm text-xs sm:text-sm text-neutral-400">
				{#if searchQuery}
					Try clearing your search query to see all your saved playlists.
				{:else}
					Create your first custom playlist to group your favorite songs, or sync them with mobile apps like Symfonium.
				{/if}
			</p>

			{#if searchQuery}
				<button
					type="button"
					onclick={() => (searchQuery = '')}
					class="mt-4 rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-200 hover:bg-neutral-700 transition"
				>
					Clear Search
				</button>
			{:else}
				<button
					type="button"
					onclick={() => (showCreateModal = true)}
					class="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-5 py-2.5 text-xs sm:text-sm font-semibold text-neutral-950 shadow-lg shadow-emerald-500/20 hover:scale-105 transition"
				>
					<Plus class="h-4 w-4" />
					<span>Create Your First Playlist</span>
				</button>
			{/if}
		</section>
	{/if}
</div>

<!-- Create Playlist Modal -->
{#if showCreateModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
		<div class="relative w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
			<!-- Header -->
			<div class="flex items-center justify-between pb-4 border-b border-neutral-800">
				<div class="flex items-center gap-2.5">
					<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
						<Plus class="h-4 w-4" />
					</div>
					<h2 class="text-base font-bold text-neutral-100">New Playlist</h2>
				</div>
				<button
					type="button"
					onclick={() => (showCreateModal = false)}
					class="rounded-lg p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<!-- Form -->
			<form onsubmit={handleCreatePlaylist} class="mt-4 space-y-4">
				{#if createError}
					<div class="rounded-xl border border-rose-800 bg-rose-950/60 p-3 text-xs text-rose-300">
						{createError}
					</div>
				{/if}

				<div>
					<label for="pl-name" class="block text-xs font-semibold text-neutral-300 mb-1.5">
						Playlist Name <span class="text-emerald-400">*</span>
					</label>
					<input
						id="pl-name"
						type="text"
						bind:value={newName}
						placeholder="e.g., Road Trip Mix, Late Night Beats"
						required
						class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 py-2.5 text-sm text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition"
					/>
				</div>

				<div>
					<label for="pl-comment" class="block text-xs font-semibold text-neutral-300 mb-1.5">
						Description / Notes (Optional)
					</label>
					<textarea
						id="pl-comment"
						bind:value={newComment}
						rows="2"
						placeholder="Add an optional note about this playlist..."
						class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition resize-none"
					></textarea>
				</div>

				<div class="flex items-center gap-2.5 pt-1">
					<input
						id="pl-public"
						type="checkbox"
						bind:checked={newIsPublic}
						class="h-4 w-4 rounded border-neutral-700 bg-neutral-950 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-neutral-900"
					/>
					<label for="pl-public" class="text-xs text-neutral-300 select-none cursor-pointer">
						Make Public (Visible to all users and Subsonic clients)
					</label>
				</div>

				<!-- Actions -->
				<div class="flex items-center justify-end gap-3 pt-3 border-t border-neutral-800">
					<button
						type="button"
						onclick={() => (showCreateModal = false)}
						class="rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-700 transition"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={!newName.trim() || isCreating}
						class="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-neutral-950 hover:bg-emerald-400 disabled:opacity-50 transition"
					>
						{#if isCreating}
							<div class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-950 border-t-transparent"></div>
							<span>Creating...</span>
						{:else}
							<span>Create</span>
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
