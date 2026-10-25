<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Navbar from '$lib/components/Navbar.svelte';
	import GlobalMiniPlayer from '$lib/components/GlobalMiniPlayer.svelte';
	import { player } from '$lib/services/player.svelte.js';
	import type { LayoutData } from './$types.js';

	let { data, children }: { data: LayoutData; children: any } = $props();

	const currentPath = $derived(page.url.pathname);
	const isAuthPage = $derived(currentPath === '/login' || currentPath === '/setup');
	const isPlayerPage = $derived(currentPath.startsWith('/player'));

	let audioElement = $state<HTMLAudioElement | null>(null);

	onMount(() => {
		if (audioElement) {
			player.init(audioElement);
		}
	});
</script>

<svelte:head>
	<title>Trax Vault - Music Quality & Lyrics Tracker</title>
	<meta name="description" content="Self-hosted music quality, censorship, and lyrics tracker" />
</svelte:head>

<!-- Persistent Global HTML5 Audio Element -->
<audio bind:this={audioElement} preload="metadata" class="hidden"></audio>

<div class="bg-neutral-950 text-neutral-100 flex flex-col font-sans selection:bg-emerald-600 selection:text-white {isPlayerPage ? 'h-screen h-[100dvh] overflow-hidden' : 'min-h-screen'}">
	{#if !isAuthPage}
		<Navbar
			issuesCount={data.stats?.total_needs_attention || 0}
			user={data.user}
			authDisabled={data.authDisabled}
		/>
	{/if}

	<main class="flex-1 min-h-0 {isPlayerPage ? 'overflow-hidden flex flex-col' : player.currentTrack ? 'pb-28' : 'pb-16'}">
		{@render children()}
	</main>

	<!-- Global Floating Mini Player on non-player tabs -->
	{#if !isAuthPage && !isPlayerPage && player.currentTrack}
		<GlobalMiniPlayer />
	{/if}

	{#if !isAuthPage && !isPlayerPage}
		<footer class="border-t border-neutral-900 bg-neutral-950 py-6 text-center text-xs text-neutral-500 {player.currentTrack ? 'mb-16' : ''}">
			<div class="mx-auto max-w-7xl px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
				<p>
					<span class="font-bold text-neutral-400">Trax Vault v1.7</span> • Self-hosted with SQLite & MusicBrainz
				</p>
				<p class="text-[11px] text-neutral-600">
					Track FLAC/MP3 formats, bad quality encodes, lyrics (.lrc/plain), and censored tracks.
				</p>
			</div>
		</footer>
	{/if}
</div>
