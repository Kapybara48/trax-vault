<script lang="ts">
	import type { PageData } from './$types.js';
	import {
		Play,
		Pause,
		Shuffle,
		ArrowLeft,
		Pencil,
		Trash2,
		ListMusic,
		Globe,
		Lock,
		Clock,
		ArrowUp,
		ArrowDown,
		Music,
		Disc,
		ExternalLink,
		X,
		Check,
		Search
	} from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { player } from '$lib/services/player.svelte.js';
	import { formatDuration, getBitrateLabel } from '$lib/utils.js';
	import type { Playlist, Track } from '$lib/types/index.js';

	interface ExtendedPlaylist extends Playlist {
		song_count: number;
		duration_ms: number;
		cover_url: string | null;
	}

	let { data }: { data: PageData } = $props();

	let playlist = $state<ExtendedPlaylist>(data.playlist as ExtendedPlaylist);
	let tracks = $state<Track[]>(data.tracks);
	let searchQuery = $state('');

	// Edit Modal State
	let showEditModal = $state(false);
	let editName = $state(data.playlist.name);
	let editComment = $state(data.playlist.comment || '');
	let editIsPublic = $state(Boolean(data.playlist.is_public));
	let isSaving = $state(false);
	let editError = $state<string | null>(null);

	// Delete Confirmation State
	let showDeleteConfirm = $state(false);
	let isDeleting = $state(false);

	// Action in flight
	let isReordering = $state(false);

	const totalDurationMs = $derived(
		tracks.reduce((acc, t) => acc + (t.duration_ms || 0), 0)
	);

	function formatTotalDuration(ms: number): string {
		if (!ms || ms <= 0) return '0 min';
		const totalMinutes = Math.round(ms / 60000);
		if (totalMinutes < 60) {
			return `${totalMinutes} min`;
		}
		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		return minutes > 0 ? `${hours} hr ${minutes} min` : `${hours} hr`;
	}

	const filteredTracks = $derived(
		tracks.filter(
			(t) =>
				!searchQuery.trim() ||
				t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
				(t.artist && t.artist.toLowerCase().includes(searchQuery.toLowerCase())) ||
				(t.album_title && t.album_title.toLowerCase().includes(searchQuery.toLowerCase()))
		)
	);

	const isCurrentlyPlayingPlaylist = $derived(
		player.currentAlbum?.id === -playlist.id && player.isPlaying
	);

	function handlePlayAll() {
		if (tracks.length === 0) return;
		if (player.currentAlbum?.id === -playlist.id) {
			player.togglePlay();
		} else {
			player.playPlaylist(playlist, tracks, 0);
		}
	}

	function handleShufflePlay() {
		if (tracks.length === 0) return;
		const shuffled = [...tracks].sort(() => Math.random() - 0.5);
		player.playPlaylist(playlist, shuffled, 0);
	}

	async function moveTrack(index: number, direction: 'up' | 'down') {
		if (isReordering) return;
		const targetIndex = direction === 'up' ? index - 1 : index + 1;
		if (targetIndex < 0 || targetIndex >= tracks.length) return;

		// Optimistic swap
		const newTracks = [...tracks];
		const temp = newTracks[index];
		newTracks[index] = newTracks[targetIndex];
		newTracks[targetIndex] = temp;
		tracks = newTracks;

		isReordering = true;
		try {
			const res = await fetch(`/api/playlists/${playlist.id}/tracks`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ trackIds: newTracks.map((t) => t.id) })
			});
			const result = await res.json();
			if (result.tracks) {
				tracks = result.tracks;
			}
		} catch (err) {
			console.error('Failed to reorder playlist tracks:', err);
		} finally {
			isReordering = false;
		}
	}

	async function removeTrack(index: number, track: Track) {
		if (!confirm(`Remove "${track.title}" from this playlist?`)) return;

		// Optimistic removal
		const originalTracks = [...tracks];
		tracks = tracks.filter((_, idx) => idx !== index);

		try {
			const res = await fetch(
				`/api/playlists/${playlist.id}/tracks?trackIndex=${index}&trackId=${track.id}`,
				{ method: 'DELETE' }
			);
			const result = await res.json();
			if (result.tracks) {
				tracks = result.tracks;
			}
			if (result.playlist) {
				playlist = result.playlist;
			}
		} catch (err) {
			console.error('Failed to remove track:', err);
			tracks = originalTracks;
		}
	}

	async function handleSaveDetails(e: SubmitEvent) {
		e.preventDefault();
		if (!editName.trim()) return;

		isSaving = true;
		editError = null;

		try {
			const res = await fetch(`/api/playlists/${playlist.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: editName.trim(),
					comment: editComment.trim() || null,
					is_public: editIsPublic
				})
			});

			const result = await res.json();
			if (!res.ok || result.error) {
				editError = result.error || 'Failed to update playlist';
				return;
			}

			if (result.playlist) {
				playlist = result.playlist;
			}
			showEditModal = false;
		} catch (err: any) {
			editError = err.message || 'Network error';
		} finally {
			isSaving = false;
		}
	}

	async function handleDeletePlaylist() {
		isDeleting = true;
		try {
			const res = await fetch(`/api/playlists/${playlist.id}`, {
				method: 'DELETE'
			});
			if (res.ok) {
				goto('/playlists');
			} else {
				alert('Failed to delete playlist');
			}
		} catch (err) {
			console.error('Failed to delete playlist:', err);
			alert('Network error while deleting playlist');
		} finally {
			isDeleting = false;
			showDeleteConfirm = false;
		}
	}
</script>

<svelte:head>
	<title>{playlist.name} | Track Vault</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
	<!-- Back Button -->
	<div class="mb-6">
		<a
			href="/playlists"
			class="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-neutral-400 hover:text-emerald-400 transition"
		>
			<ArrowLeft class="h-4 w-4" />
			<span>Back to Playlists</span>
		</a>
	</div>

	<!-- Playlist Hero Card -->
	<header class="mb-8 rounded-3xl border border-neutral-800/80 bg-neutral-900/50 p-6 sm:p-8 backdrop-blur-xl shadow-2xl">
		<div class="flex flex-col gap-6 sm:flex-row sm:items-end">
			<!-- Artwork Container -->
			<div class="relative h-44 w-44 sm:h-52 sm:w-52 flex-shrink-0 overflow-hidden rounded-2xl bg-neutral-950 shadow-2xl border border-neutral-800">
				{#if playlist.cover_url}
					<img
						src={playlist.cover_url}
						alt={playlist.name}
						class="h-full w-full object-cover"
						onerror={(e) => {
							(e.currentTarget as HTMLElement).style.display = 'none';
						}}
					/>
				{:else}
					<div class="flex h-full w-full items-center justify-center bg-gradient-to-br from-neutral-900 via-neutral-950 to-emerald-950/20 text-emerald-400">
						<ListMusic class="h-20 w-20 opacity-40" />
					</div>
				{/if}
			</div>

			<!-- Metadata & Actions -->
			<div class="flex flex-1 flex-col justify-end">
				<!-- Tag Badges -->
				<div class="mb-2 flex items-center gap-2">
					<span class="text-xs font-bold uppercase tracking-wider text-emerald-400">
						Playlist
					</span>
					<span class="text-neutral-600">&bull;</span>
					{#if playlist.is_public}
						<span class="inline-flex items-center gap-1 rounded-full bg-neutral-950/80 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400 border border-emerald-500/30">
							<Globe class="h-3 w-3" />
							Public
						</span>
					{:else}
						<span class="inline-flex items-center gap-1 rounded-full bg-neutral-950/80 px-2.5 py-0.5 text-[11px] font-medium text-neutral-400 border border-neutral-800">
							<Lock class="h-3 w-3" />
							Private
						</span>
					{/if}
				</div>

				<!-- Title -->
				<h1 class="text-2xl sm:text-4xl lg:text-5xl font-black text-neutral-100 tracking-tight leading-tight">
					{playlist.name}
				</h1>

				<!-- Description / Comment -->
				{#if playlist.comment}
					<p class="mt-2 text-xs sm:text-sm text-neutral-300 max-w-2xl leading-relaxed">
						{playlist.comment}
					</p>
				{/if}

				<!-- Stats Subtext -->
				<div class="mt-3 flex items-center gap-2 text-xs text-neutral-400">
					<span class="font-semibold text-neutral-200">
						{tracks.length} {tracks.length === 1 ? 'song' : 'songs'}
					</span>
					<span>&bull;</span>
					<span>{formatTotalDuration(totalDurationMs)}</span>
				</div>

				<!-- Action Buttons Bar -->
				<div class="mt-6 flex flex-wrap items-center gap-3">
					<!-- Play All Button -->
					<button
						type="button"
						onclick={handlePlayAll}
						disabled={tracks.length === 0}
						class="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-5 py-2.5 text-xs sm:text-sm font-bold text-neutral-950 shadow-lg shadow-emerald-500/20 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 transition cursor-pointer"
					>
						{#if isCurrentlyPlayingPlaylist}
							<Pause class="h-4 w-4 fill-current" />
							<span>Pause</span>
						{:else}
							<Play class="h-4 w-4 fill-current ml-0.5" />
							<span>Play All</span>
						{/if}
					</button>

					<!-- Shuffle Button -->
					<button
						type="button"
						onclick={handleShufflePlay}
						disabled={tracks.length === 0}
						class="inline-flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-800/80 px-4 py-2.5 text-xs sm:text-sm font-semibold text-neutral-200 hover:bg-neutral-700 hover:text-white disabled:opacity-40 transition"
					>
						<Shuffle class="h-4 w-4" />
						<span>Shuffle</span>
					</button>

					<!-- Edit Details Button -->
					<button
						type="button"
						onclick={() => {
							editName = playlist.name;
							editComment = playlist.comment || '';
							editIsPublic = Boolean(playlist.is_public);
							editError = null;
							showEditModal = true;
						}}
						class="inline-flex items-center gap-1.5 rounded-xl border border-neutral-700/80 bg-neutral-800/60 px-3.5 py-2.5 text-xs font-semibold text-neutral-300 hover:bg-neutral-700 hover:text-white transition"
					>
						<Pencil class="h-3.5 w-3.5" />
						<span>Edit</span>
					</button>

					<!-- Delete Playlist Button -->
					<button
						type="button"
						onclick={() => (showDeleteConfirm = true)}
						class="inline-flex items-center gap-1.5 rounded-xl border border-rose-900/40 bg-rose-950/20 px-3.5 py-2.5 text-xs font-semibold text-rose-300 hover:bg-rose-950/50 hover:text-rose-200 transition ml-auto"
					>
						<Trash2 class="h-3.5 w-3.5" />
						<span>Delete</span>
					</button>
				</div>
			</div>
		</div>
	</header>

	<!-- Tracklist Section -->
	<section class="rounded-2xl border border-neutral-800/80 bg-neutral-900/40 p-4 sm:p-6 backdrop-blur-md shadow-lg">
		<!-- Filter Tracklist Input -->
		<div class="mb-4 flex flex-col sm:flex-row items-center justify-between gap-3">
			<div class="relative w-full sm:w-72">
				<Search class="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-500" />
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Filter tracks in playlist..."
					class="w-full rounded-xl border border-neutral-700/80 bg-neutral-950/80 pl-9 pr-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition"
				/>
				{#if searchQuery}
					<button
						type="button"
						onclick={() => (searchQuery = '')}
						class="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
					>
						<X class="h-3.5 w-3.5" />
					</button>
				{/if}
			</div>

			<div class="text-xs text-neutral-400 self-end sm:self-center font-medium">
				{filteredTracks.length} of {tracks.length} tracks
			</div>
		</div>

		<!-- Table -->
		{#if tracks.length > 0}
			<div class="overflow-x-auto">
				<table class="w-full text-left text-xs border-collapse">
					<thead class="text-neutral-400 border-b border-neutral-800/80">
						<tr class="h-9">
							<th class="w-10 text-center font-semibold">#</th>
							<th class="font-semibold">Title & Artist</th>
							<th class="font-semibold hidden md:table-cell">Album</th>
							<th class="font-semibold hidden sm:table-cell">Fidelity</th>
							<th class="w-16 text-right pr-4 font-semibold"><Clock class="w-3.5 h-3.5 inline text-neutral-500" /></th>
							<th class="w-28 text-right pr-2 font-semibold">Order / Manage</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-neutral-800/40">
						{#each filteredTracks as track, idx (track.id + '-' + idx)}
							{@const originalIdx = tracks.findIndex((t) => t.id === track.id)}
							{@const isCurrent = player.currentTrack?.id === track.id}
							{@const isCurrentPlaying = isCurrent && player.isPlaying}
							<tr
								class="group hover:bg-neutral-800/50 transition h-14 {isCurrent ? 'bg-emerald-950/20' : ''}"
							>
								<!-- Index / Play Button -->
								<td class="text-center font-mono w-10">
									{#if isCurrentPlaying}
										<div class="flex items-end justify-center gap-0.5 h-3">
											<span class="w-0.5 bg-emerald-400 animate-pulse h-full"></span>
											<span class="w-0.5 bg-emerald-400 animate-pulse h-1.5"></span>
											<span class="w-0.5 bg-emerald-400 animate-pulse h-full"></span>
										</div>
									{:else}
										<span class="group-hover:hidden text-neutral-500">{originalIdx + 1}</span>
										<button
											type="button"
											onclick={() => player.playPlaylist(playlist, tracks, originalIdx)}
											class="hidden group-hover:inline-flex items-center justify-center text-emerald-400 hover:text-emerald-300"
											title="Play {track.title}"
										>
											<Play class="w-3.5 h-3.5 fill-current" />
										</button>
									{/if}
								</td>

								<!-- Title & Artist -->
								<td class="py-2 pr-3 min-w-0">
									<div class="font-semibold truncate {isCurrent ? 'text-emerald-300 font-bold' : 'text-neutral-100'}">
										{track.title}
									</div>
									<div class="text-[11px] text-neutral-400 truncate">
										{track.artist}
									</div>
								</td>

								<!-- Album -->
								<td class="py-2 pr-3 hidden md:table-cell min-w-0">
									{#if track.album_id}
										<a
											href="/album/{track.album_id}"
											class="text-neutral-300 hover:text-emerald-400 hover:underline truncate block"
											title={track.album_title || 'Album'}
										>
											{track.album_title || 'Album'}
										</a>
									{:else}
										<span class="text-neutral-500">&mdash;</span>
									{/if}
								</td>

								<!-- Fidelity / Format -->
								<td class="py-2 pr-3 hidden sm:table-cell">
									<div class="flex items-center gap-1.5">
										<span class="rounded bg-neutral-800/80 px-2 py-0.5 text-[10px] font-mono text-neutral-300 border border-neutral-700/60">
											{track.format}
										</span>
										{#if track.bitrate_kbps}
											<span class="text-[10px] text-neutral-500 font-mono">
												{getBitrateLabel(track.format, track.bitrate_kbps)}
											</span>
										{/if}
									</div>
								</td>

								<!-- Duration -->
								<td class="py-2 pr-4 text-right font-mono text-neutral-400">
									{formatDuration(track.duration_ms)}
								</td>

								<!-- Order / Remove Actions -->
								<td class="py-2 pr-2 text-right">
									<div class="inline-flex items-center gap-1">
										<!-- Move Up -->
										<button
											type="button"
											onclick={() => moveTrack(originalIdx, 'up')}
											disabled={originalIdx === 0 || isReordering}
											class="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-neutral-400 transition"
											title="Move Up"
										>
											<ArrowUp class="h-3.5 w-3.5" />
										</button>

										<!-- Move Down -->
										<button
											type="button"
											onclick={() => moveTrack(originalIdx, 'down')}
											disabled={originalIdx === tracks.length - 1 || isReordering}
											class="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-neutral-400 transition"
											title="Move Down"
										>
											<ArrowDown class="h-3.5 w-3.5" />
										</button>

										<!-- Remove -->
										<button
											type="button"
											onclick={() => removeTrack(originalIdx, track)}
											class="rounded p-1 text-rose-400/80 hover:bg-rose-950/40 hover:text-rose-300 transition"
											title="Remove from Playlist"
										>
											<Trash2 class="h-3.5 w-3.5" />
										</button>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<!-- Empty Playlist State -->
			<div class="flex flex-col items-center justify-center py-16 text-center">
				<div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-800/80 text-emerald-400 mb-3 shadow-inner">
					<ListMusic class="h-7 w-7" />
				</div>
				<h3 class="text-base font-bold text-neutral-100">This playlist is currently empty</h3>
				<p class="mt-1 max-w-sm text-xs text-neutral-400">
					Add songs from any album in your vault or from the player by clicking "Add to Playlist".
				</p>
				<a
					href="/"
					class="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-neutral-950 hover:bg-emerald-400 transition"
				>
					<ExternalLink class="h-3.5 w-3.5" />
					<span>Explore Vault Albums</span>
				</a>
			</div>
		{/if}
	</section>
</div>

<!-- Edit Details Modal -->
{#if showEditModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
		<div class="relative w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
			<!-- Header -->
			<div class="flex items-center justify-between pb-4 border-b border-neutral-800">
				<div class="flex items-center gap-2.5">
					<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
						<Pencil class="h-4 w-4" />
					</div>
					<h2 class="text-base font-bold text-neutral-100">Edit Playlist Details</h2>
				</div>
				<button
					type="button"
					onclick={() => (showEditModal = false)}
					class="rounded-lg p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<!-- Form -->
			<form onsubmit={handleSaveDetails} class="mt-4 space-y-4">
				{#if editError}
					<div class="rounded-xl border border-rose-800 bg-rose-950/60 p-3 text-xs text-rose-300">
						{editError}
					</div>
				{/if}

				<div>
					<label for="edit-name" class="block text-xs font-semibold text-neutral-300 mb-1.5">
						Playlist Name <span class="text-emerald-400">*</span>
					</label>
					<input
						id="edit-name"
						type="text"
						bind:value={editName}
						required
						class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 py-2.5 text-sm text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition"
					/>
				</div>

				<div>
					<label for="edit-comment" class="block text-xs font-semibold text-neutral-300 mb-1.5">
						Description / Notes
					</label>
					<textarea
						id="edit-comment"
						bind:value={editComment}
						rows="2"
						placeholder="Optional notes or description..."
						class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition resize-none"
					></textarea>
				</div>

				<div class="flex items-center gap-2.5 pt-1">
					<input
						id="edit-public"
						type="checkbox"
						bind:checked={editIsPublic}
						class="h-4 w-4 rounded border-neutral-700 bg-neutral-950 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-neutral-900"
					/>
					<label for="edit-public" class="text-xs text-neutral-300 select-none cursor-pointer">
						Make Public (Visible across all clients and Subsonic devices)
					</label>
				</div>

				<!-- Actions -->
				<div class="flex items-center justify-end gap-3 pt-3 border-t border-neutral-800">
					<button
						type="button"
						onclick={() => (showEditModal = false)}
						class="rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-700 transition"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={!editName.trim() || isSaving}
						class="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-neutral-950 hover:bg-emerald-400 disabled:opacity-50 transition"
					>
						{#if isSaving}
							<div class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-950 border-t-transparent"></div>
							<span>Saving...</span>
						{:else}
							<span>Save Changes</span>
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- Delete Confirmation Modal -->
{#if showDeleteConfirm}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
		<div class="relative w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
			<div class="flex items-center gap-3 text-rose-400 mb-3">
				<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/20 border border-rose-500/30">
					<Trash2 class="h-5 w-5" />
				</div>
				<div>
					<h3 class="text-base font-bold text-neutral-100">Delete Playlist</h3>
					<p class="text-xs text-neutral-400">This action cannot be undone.</p>
				</div>
			</div>

			<p class="text-xs text-neutral-300 leading-relaxed mb-6">
				Are you sure you want to permanently delete <strong class="text-white">"{playlist.name}"</strong>? The audio files themselves will not be touched.
			</p>

			<div class="flex items-center justify-end gap-3">
				<button
					type="button"
					onclick={() => (showDeleteConfirm = false)}
					disabled={isDeleting}
					class="rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-700 transition"
				>
					Cancel
				</button>
				<button
					type="button"
					onclick={handleDeletePlaylist}
					disabled={isDeleting}
					class="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50 transition"
				>
					{#if isDeleting}
						<div class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
						<span>Deleting...</span>
					{:else}
						<span>Delete Playlist</span>
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}
