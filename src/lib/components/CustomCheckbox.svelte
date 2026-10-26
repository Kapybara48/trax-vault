<script lang="ts">
	import { Check } from '@lucide/svelte';

	interface Props {
		checked?: boolean;
		disabled?: boolean;
		title?: string;
		class?: string;
		onchange?: (checked: boolean) => void;
	}

	let { checked = false, disabled = false, title = '', class: className = '', onchange }: Props = $props();

	function toggle(e?: MouseEvent | KeyboardEvent) {
		if (e) {
			e.stopPropagation();
		}
		if (disabled) return;
		const next = !checked;
		if (onchange) onchange(next);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === ' ' || e.key === 'Enter') {
			e.preventDefault();
			toggle(e);
		}
	}
</script>

<button
	type="button"
	role="checkbox"
	aria-checked={checked}
	{disabled}
	{title}
	onclick={toggle}
	onkeydown={handleKeydown}
	class="relative flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-md border transition duration-150 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 {disabled ? 'opacity-40 cursor-not-allowed bg-neutral-900 border-neutral-800' : 'cursor-pointer'} {checked ? 'bg-emerald-600 border-emerald-500 text-white shadow-sm shadow-emerald-600/40' : 'bg-neutral-950/90 border-neutral-700 hover:border-emerald-500/60'} {className}"
>
	{#if checked}
		<Check class="h-3.5 w-3.5 stroke-[3]" />
	{/if}
</button>
