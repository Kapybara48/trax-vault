<script lang="ts">
	import { dialog } from '$lib/services/dialog.svelte.js';
	import { Trash2, AlertTriangle, Info, HelpCircle, X } from '@lucide/svelte';

	function handleKeydown(event: KeyboardEvent) {
		if (!dialog.state.isOpen) return;

		if (event.key === 'Escape') {
			event.preventDefault();
			dialog.handleCancel();
		} else if (event.key === 'Enter' && !event.shiftKey) {
			// If not focused on a button already, confirm
			event.preventDefault();
			dialog.handleConfirm();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if dialog.state.isOpen}
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md transition-opacity duration-200"
		role="dialog"
		aria-modal="true"
		aria-labelledby="dialog-title"
	>
		<!-- Backdrop dismiss -->
		<button
			type="button"
			class="fixed inset-0 h-full w-full cursor-default bg-transparent focus:outline-none"
			tabindex="-1"
			onclick={() => dialog.handleCancel()}
			aria-label="Close dialog overlay"
		></button>

		<!-- Modal Box -->
		<div
			class="relative w-full max-w-md rounded-3xl border border-neutral-800 bg-neutral-900/95 p-6 shadow-2xl backdrop-blur-2xl ring-1 ring-white/10 z-10 transition-all duration-200"
		>
			<!-- Top Close Button -->
			<button
				type="button"
				class="absolute right-4 top-4 rounded-xl p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white transition cursor-pointer"
				onclick={() => dialog.handleCancel()}
				title="Close (Esc)"
			>
				<X class="h-4 w-4" />
			</button>

			<div class="flex items-start gap-4">
				<!-- Icon Container -->
				{#if dialog.state.icon === 'trash' || dialog.state.danger}
					<div
						class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-rose-950/80 border border-rose-500/40 text-rose-400 shadow-lg shadow-rose-950/30"
					>
						<Trash2 class="h-6 w-6" />
					</div>
				{:else if dialog.state.icon === 'warning'}
					<div
						class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-950/80 border border-amber-500/40 text-amber-400 shadow-lg shadow-amber-950/30"
					>
						<AlertTriangle class="h-6 w-6" />
					</div>
				{:else if dialog.state.icon === 'help'}
					<div
						class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-950/80 border border-indigo-500/40 text-indigo-400 shadow-lg shadow-indigo-950/30"
					>
						<HelpCircle class="h-6 w-6" />
					</div>
				{:else}
					<div
						class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 shadow-lg shadow-emerald-950/30"
					>
						<Info class="h-6 w-6" />
					</div>
				{/if}

				<!-- Content -->
				<div class="min-w-0 flex-1 pt-0.5">
					<h3 id="dialog-title" class="text-base font-bold text-white tracking-tight leading-snug">
						{dialog.state.title}
					</h3>
					<div class="mt-2 text-xs text-neutral-300 leading-relaxed whitespace-pre-line max-h-60 overflow-y-auto">
						{dialog.state.message}
					</div>
				</div>
			</div>

			<!-- Footer Action Buttons -->
			<div class="mt-6 flex items-center justify-end gap-3 pt-4 border-t border-neutral-800/80">
				{#if !dialog.state.isAlert}
					<button
						type="button"
						class="rounded-xl px-4 py-2.5 text-xs font-semibold text-neutral-300 hover:text-white bg-neutral-800/80 hover:bg-neutral-700/80 border border-neutral-700/70 transition cursor-pointer"
						onclick={() => dialog.handleCancel()}
					>
						{dialog.state.cancelText}
					</button>
				{/if}

				{#if dialog.state.danger}
					<button
						type="button"
						class="rounded-xl px-5 py-2.5 text-xs font-bold text-white bg-gradient-to-r from-rose-600 to-red-500 hover:from-rose-500 hover:to-red-400 shadow-lg shadow-rose-900/40 transition cursor-pointer active:scale-95"
						onclick={() => dialog.handleConfirm()}
					>
						{dialog.state.confirmText}
					</button>
				{:else}
					<button
						type="button"
						class="rounded-xl px-5 py-2.5 text-xs font-bold text-white bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 shadow-lg shadow-emerald-900/40 transition cursor-pointer active:scale-95"
						onclick={() => dialog.handleConfirm()}
					>
						{dialog.state.confirmText}
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}
