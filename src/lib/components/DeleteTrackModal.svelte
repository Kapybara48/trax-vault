<script lang="ts">
	import type { Track } from '$lib/types/index.js';
	import { formatDuration } from '$lib/utils.js';
	import { Trash2, AlertTriangle, HardDrive, Database, X, Check } from '@lucide/svelte';

	interface Props {
		track: Track | null;
		isOpen: boolean;
		isAdmin: boolean;
		onClose: () => void;
		onConfirm: (deleteFile: boolean) => Promise<void>;
	}

	let { track, isOpen, isAdmin, onClose, onConfirm }: Props = $props();

	let deleteFile = $state(false);
	let isDeleting = $state(false);

	$effect(() => {
		if (isOpen) {
			deleteFile = false;
			isDeleting = false;
		}
	});

	async function handleConfirm() {
		if (!track) return;
		isDeleting = true;
		try {
			await onConfirm(deleteFile);
		} finally {
			isDeleting = false;
		}
	}
</script>

{#if isOpen && track}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
		role="dialog"
		aria-modal="true"
	>
		<div
			class="relative w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900/95 p-6 shadow-2xl backdrop-blur-xl flex flex-col gap-5 text-neutral-200 animate-in zoom-in-95 duration-200"
		>
			<!-- Header -->
			<div class="flex items-start justify-between gap-4">
				<div class="flex items-center gap-3">
					<div class="rounded-xl border border-rose-500/20 bg-rose-500/10 p-2.5 text-rose-400">
						<Trash2 class="h-6 w-6" />
					</div>
					<div>
						<h3 class="text-lg font-bold text-neutral-100">Delete Song</h3>
						<p class="text-xs text-neutral-400">Choose how to remove this song from your library.</p>
					</div>
				</div>
				<button
					type="button"
					onclick={onClose}
					disabled={isDeleting}
					class="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<!-- Track Info Card -->
			<div class="rounded-xl border border-neutral-800 bg-neutral-950/60 p-3.5 flex items-center justify-between gap-3 text-xs">
				<div class="min-w-0 flex-1">
					<p class="truncate font-semibold text-neutral-100 text-sm">{track.title}</p>
					<p class="truncate text-neutral-400 text-xs mt-0.5">
						{#if track.artist}{track.artist} • {/if}Track {track.track_number} • {formatDuration(track.duration_ms)}
					</p>
				</div>
				<span class="rounded px-2 py-0.5 font-mono text-[11px] font-bold uppercase border border-neutral-700 bg-neutral-800/80 text-neutral-300">
					{track.format}
				</span>
			</div>

			<!-- Deletion Mode Choices -->
			<div class="space-y-3">
				<!-- Option 1: Remove from Vault only -->
				<button
					type="button"
					onclick={() => (deleteFile = false)}
					disabled={isDeleting}
					class="w-full text-left rounded-xl border p-3.5 transition flex items-start gap-3.5 cursor-pointer {!deleteFile ? 'border-emerald-500/60 bg-emerald-950/20 ring-1 ring-emerald-500/40' : 'border-neutral-800 bg-neutral-950/40 hover:bg-neutral-800/40'}"
				>
					<div class="mt-0.5 rounded-lg border p-1.5 {!deleteFile ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-400' : 'border-neutral-800 bg-neutral-900 text-neutral-400'}">
						<Database class="h-4 w-4" />
					</div>
					<div class="flex-1 min-w-0">
						<div class="flex items-center justify-between">
							<span class="font-bold text-sm text-neutral-100">Remove from Vault Only</span>
							{#if !deleteFile}
								<Check class="h-4 w-4 text-emerald-400 shrink-0" />
							{/if}
						</div>
						<p class="text-xs text-neutral-400 mt-1 leading-relaxed">
							Safely removes the track entry from Trax Vault. The audio file on your hard drive remains untouched and can be re-scanned anytime.
						</p>
					</div>
				</button>

				<!-- Option 2: Delete File from Disk & Vault (Admin Only) -->
				{#if isAdmin && track.file_path}
					<button
						type="button"
						onclick={() => (deleteFile = true)}
						disabled={isDeleting}
						class="w-full text-left rounded-xl border p-3.5 transition flex items-start gap-3.5 cursor-pointer {deleteFile ? 'border-rose-500/70 bg-rose-950/30 ring-1 ring-rose-500/50' : 'border-neutral-800 bg-neutral-950/40 hover:bg-neutral-800/40'}"
					>
						<div class="mt-0.5 rounded-lg border p-1.5 {deleteFile ? 'border-rose-500/50 bg-rose-500/20 text-rose-400' : 'border-neutral-800 bg-neutral-900 text-neutral-400'}">
							<HardDrive class="h-4 w-4" />
						</div>
						<div class="flex-1 min-w-0">
							<div class="flex items-center justify-between">
								<span class="font-bold text-sm text-rose-300">Delete Audio File from Disk & Vault</span>
								{#if deleteFile}
									<Check class="h-4 w-4 text-rose-400 shrink-0" />
								{/if}
							</div>
							<p class="text-xs text-neutral-400 mt-1 leading-relaxed">
								Permanently unlinks the audio file and companion lyrics from storage. This cannot be undone.
							</p>
						</div>
					</button>
				{/if}
			</div>

			<!-- Danger Notice when Disk Deletion is selected -->
			{#if deleteFile}
				<div class="rounded-xl border border-rose-800/60 bg-rose-950/40 p-3 flex items-start gap-2.5 text-xs text-rose-300">
					<AlertTriangle class="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
					<p>Warning: The physical audio file will be permanently deleted from the server storage.</p>
				</div>
			{/if}

			<!-- Actions -->
			<div class="flex items-center justify-end gap-3 pt-2">
				<button
					type="button"
					onclick={onClose}
					disabled={isDeleting}
					class="rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-700 transition"
				>
					Cancel
				</button>
				<button
					type="button"
					onclick={handleConfirm}
					disabled={isDeleting}
					class="rounded-xl px-4 py-2 text-xs font-bold transition flex items-center gap-1.5 shadow-lg {deleteFile ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/30' : 'bg-neutral-100 hover:bg-white text-neutral-950 shadow-white/10'}"
				>
					{#if isDeleting}
						<span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"></span>
						Deleting...
					{:else}
						<Trash2 class="h-3.5 w-3.5" />
						{deleteFile ? 'Delete File & Record' : 'Remove Song'}
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}
