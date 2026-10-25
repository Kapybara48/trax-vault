<script lang="ts">
	import type { Playlist } from '$lib/types/index.js';
	import {
		ListPlus,
		ListMusic,
		Search,
		Plus,
		Check,
		X,
		RefreshCw,
		Globe,
		Lock,
		Disc
	} from '@lucide/svelte';

	interface Props {
		isOpen: boolean;
		trackIds: number[];
		trackTitle?: string;
		onClose: () => void;
		onAdded?: (playlistId: number, playlistName: string) => void;
	}

	let { isOpen, trackIds, trackTitle, onClose, onAdded }: Props = $props();

	let playlists = $state<Playlist[]>([]);
	let isLoading = $state(false);
	let searchQuery = $state('');
	let addingToId = $state<number | null>(null);
	let successId = $state<number | null>(null);
	let errorMsg = $state<string | null>(null);

	// Inline Create Playlist State
	let showCreateForm = $state(false);
	let newName = $state('');
	let newComment = $state('');
	let newIsPublic = $state(false);
	let isCreating = $state(false);

	$effect(() => {
		if (isOpen) {
			loadPlaylists();
			showCreateForm = false;
			newName = '';
			newComment = '';
			searchQuery = '';
			errorMsg = null;
			successId = null;
		}
	});

	async function loadPlaylists() {
		isLoading = true;
		errorMsg = null;
		try {
			const res = await fetch('/api/playlists');
			const data = await res.json();
			if (data.playlists) {
				playlists = data.playlists;
			}
		} catch (err: any) {
			console.error('Failed to load playlists:', err);
			errorMsg = 'Failed to load playlists.';
		} finally {
			isLoading = false;
		}
	}

	const filteredPlaylists = $derived(
		playlists.filter(
			(p) =>
				!searchQuery.trim() ||
				p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
				(p.comment && p.comment.toLowerCase().includes(searchQuery.toLowerCase()))
		)
	);

	async function addToPlaylist(playlist: Playlist) {
		if (trackIds.length === 0) return;
		addingToId = playlist.id;
		errorMsg = null;

		try {
			const res = await fetch(`/api/playlists/${playlist.id}/tracks`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ trackIds })
			});

			const data = await res.json();
			if (!res.ok || data.error) {
				errorMsg = data.error || 'Failed to add tracks.';
				return;
			}

			successId = playlist.id;
			if (onAdded) {
				onAdded(playlist.id, playlist.name);
			}

			setTimeout(() => {
				onClose();
			}, 700);
		} catch (err: any) {
			console.error('Failed to add track to playlist:', err);
			errorMsg = err.message || 'Network error.';
		} finally {
			addingToId = null;
		}
	}

	async function createAndAddPlaylist() {
		const trimmedName = newName.trim();
		if (!trimmedName) return;

		isCreating = true;
		errorMsg = null;

		try {
			const res = await fetch('/api/playlists', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: trimmedName,
					comment: newComment.trim() || null,
					is_public: newIsPublic,
					trackIds
				})
			});

			const data = await res.json();
			if (!res.ok || data.error) {
				errorMsg = data.error || 'Failed to create playlist.';
				return;
			}

			successId = data.playlistId;
			if (onAdded) {
				onAdded(data.playlistId, trimmedName);
			}

			setTimeout(() => {
				onClose();
			}, 700);
		} catch (err: any) {
			console.error('Failed to create playlist:', err);
			errorMsg = err.message || 'Network error.';
		} finally {
			isCreating = false;
		}
	}
</script>

{#if isOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
		role="dialog"
		aria-modal="true"
	>
		<div
			class="relative w-full max-w-md rounded-3xl border border-neutral-800 bg-neutral-900/95 p-5 shadow-2xl backdrop-blur-xl flex flex-col max-h-[85vh]"
		>
			<!-- Header -->
			<div class="flex items-start justify-between pb-4 border-b border-neutral-800/80">
				<div class="flex items-center gap-3">
					<div class="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-950/70 text-emerald-400 border border-emerald-500/30 shrink-0">
						<ListPlus class="h-5 w-5" />
					</div>
					<div class="min-w-0">
						<h3 class="text-base font-bold text-white truncate">Add to Playlist</h3>
						<p class="text-xs text-neutral-400 truncate">
							{#if trackTitle}
								"{trackTitle}"
							{:else}
								{trackIds.length} {trackIds.length === 1 ? 'track' : 'tracks'} selected
							{/if}
						</p>
					</div>
				</div>

				<button
					type="button"
					onclick={onClose}
					class="rounded-xl p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white transition cursor-pointer"
					title="Close"
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<!-- Error Alert -->
			{#if errorMsg}
				<div class="mt-3 rounded-xl bg-rose-950/60 border border-rose-600/50 p-2.5 text-xs text-rose-300">
					{errorMsg}
				</div>
			{/if}

			<!-- Content Area -->
			<div class="flex-1 overflow-y-auto py-3 space-y-3 min-h-0">
				{#if showCreateForm}
					<!-- Create New Playlist Form -->
					<div class="rounded-2xl border border-neutral-800 bg-neutral-950/60 p-4 space-y-3">
						<div class="flex items-center justify-between">
							<span class="text-xs font-bold uppercase tracking-wider text-emerald-400">New Playlist</span>
							<button
								type="button"
								onclick={() => (showCreateForm = false)}
								class="text-xs text-neutral-400 hover:text-white"
							>
								Cancel
							</button>
						</div>

						<div>
							<label class="block text-[11px] font-semibold text-neutral-300 mb-1">Playlist Name *</label>
							<input
								type="text"
								bind:value={newName}
								placeholder="e.g. Chill Lossless Mix"
								class="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-emerald-500"
							/>
						</div>

						<div>
							<label class="block text-[11px] font-semibold text-neutral-300 mb-1">Description (optional)</label>
							<input
								type="text"
								bind:value={newComment}
								placeholder="e.g. My favorite Hi-Res evening jams"
								class="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-emerald-500"
							/>
						</div>

						<label class="flex items-center gap-2 cursor-pointer pt-1">
							<input
								type="checkbox"
								bind:checked={newIsPublic}
								class="rounded border-neutral-700 bg-neutral-900 text-emerald-500 focus:ring-emerald-500"
							/>
							<span class="text-xs text-neutral-300 flex items-center gap-1.5">
								<Globe class="h-3.5 w-3.5 text-neutral-400" />
								Make visible to all users (Public)
							</span>
						</label>

						<button
							type="button"
							onclick={createAndAddPlaylist}
							disabled={isCreating || !newName.trim()}
							class="w-full mt-2 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 py-2.5 text-xs font-bold text-white shadow-md shadow-emerald-600/30 hover:brightness-110 active:scale-98 transition disabled:opacity-50 cursor-pointer"
						>
							{#if isCreating}
								<RefreshCw class="h-3.5 w-3.5 animate-spin" />
								<span>Creating Playlist...</span>
							{:else}
								<Plus class="h-4 w-4" />
								<span>Create & Add {trackIds.length} {trackIds.length === 1 ? 'Track' : 'Tracks'}</span>
							{/if}
						</button>
					</div>
				{:else}
					<!-- Create New Button -->
					<button
						type="button"
						onclick={() => (showCreateForm = true)}
						class="w-full flex items-center gap-3 p-3 rounded-2xl border border-dashed border-neutral-700 bg-neutral-950/40 hover:bg-neutral-800/40 hover:border-emerald-500/50 text-neutral-300 hover:text-white transition cursor-pointer group"
					>
						<div class="h-10 w-10 rounded-xl bg-neutral-800 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition">
							<Plus class="h-5 w-5" />
						</div>
						<div class="text-left">
							<div class="text-xs font-bold">Create New Playlist</div>
							<div class="text-[10px] text-neutral-400">Start a fresh playlist with this selection</div>
						</div>
					</button>

					<!-- Search Bar -->
					{#if playlists.length > 3}
						<div class="relative">
							<Search class="absolute left-3 top-2.5 h-3.5 w-3.5 text-neutral-500" />
							<input
								type="text"
								bind:value={searchQuery}
								placeholder="Search your playlists..."
								class="w-full rounded-xl border border-neutral-700 bg-neutral-950 pl-9 pr-3 py-2 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-emerald-500"
							/>
						</div>
					{/if}

					<!-- Playlists List -->
					<div class="space-y-1.5 max-h-64 overflow-y-auto pr-1">
						{#if isLoading}
							<div class="py-8 text-center text-xs text-neutral-400">
								<RefreshCw class="h-5 w-5 animate-spin mx-auto text-emerald-400 mb-2" />
								<span>Loading playlists...</span>
							</div>
						{:else if filteredPlaylists.length === 0}
							<div class="py-6 text-center text-xs text-neutral-500">
								{searchQuery ? 'No playlists match your search.' : 'No playlists yet. Create one above!'}
							</div>
						{:else}
							{#each filteredPlaylists as p (p.id)}
								{@const isAddingThis = addingToId === p.id}
								{@const isDoneThis = successId === p.id}

								<button
									type="button"
									onclick={() => addToPlaylist(p)}
									disabled={isAddingThis || isDoneThis}
									class="w-full flex items-center gap-3 p-2.5 rounded-2xl border text-left transition cursor-pointer {isDoneThis ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300' : 'bg-neutral-950/50 border-neutral-800 hover:bg-neutral-800/50 hover:border-neutral-700'}"
								>
									<!-- Playlist Thumbnail -->
									<div class="h-10 w-10 shrink-0 rounded-xl overflow-hidden bg-neutral-900 border border-neutral-800 flex items-center justify-center">
										{#if p.cover_url}
											<img src={p.cover_url} alt={p.name} class="h-full w-full object-cover" />
										{:else}
											<ListMusic class="h-5 w-5 text-neutral-500" />
										{/if}
									</div>

									<div class="min-w-0 flex-1">
										<div class="flex items-center gap-1.5">
											<span class="text-xs font-bold text-white truncate {isDoneThis ? 'text-emerald-300' : ''}">
												{p.name}
											</span>
											{#if p.is_public}
												<Globe class="h-3 w-3 text-neutral-500 shrink-0" title="Public Playlist" />
											{:else}
												<Lock class="h-3 w-3 text-neutral-500 shrink-0" title="Private Playlist" />
											{/if}
										</div>
										<p class="text-[10px] text-neutral-400 truncate">
											{p.song_count || 0} tracks {#if p.comment}• {p.comment}{/if}
										</p>
									</div>

									<!-- Action Indicator -->
									<div class="shrink-0">
										{#if isDoneThis}
											<span class="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-black">
												<Check class="h-4 w-4" />
											</span>
										{:else if isAddingThis}
											<RefreshCw class="h-4 w-4 animate-spin text-emerald-400" />
										{:else}
											<span class="rounded-lg bg-neutral-800 px-2 py-1 text-[11px] font-semibold text-neutral-300 group-hover:bg-emerald-600 group-hover:text-white transition">
												Add
											</span>
										{/if}
									</div>
								</button>
							{/each}
						{/if}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
