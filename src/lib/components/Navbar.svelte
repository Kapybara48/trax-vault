<script lang="ts">
	import { onMount } from 'svelte';
	import { preloadData } from '$app/navigation';
	import { page } from '$app/state';
	import {
		Disc3,
		TriangleAlert,
		Plus,
		Library,
		FolderSync,
		LogOut,
		User as UserIcon,
		Settings as SettingsIcon,
		Tag,
		ExternalLink,
		Mic,
		ListMusic
	} from '@lucide/svelte';

	interface Props {
		issuesCount?: number;
		user?: { id: number; username: string; role: string } | null;
		authDisabled?: boolean;
	}

	let {
		issuesCount = 0,
		user = null,
		authDisabled = false
	}: Props = $props();

	const currentPath = $derived(page.url.pathname);

	onMount(() => {
		// Slowly / asynchronously warm up the scan route in the background on idle
		const timer = setTimeout(() => {
			preloadData('/scan').catch(() => {});
		}, 1200);
		return () => clearTimeout(timer);
	});

	async function handleLogout() {
		try {
			await fetch('/api/auth/logout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' }
			});
		} catch (e) {
			console.error('Logout error:', e);
		}
		window.location.href = '/login';
	}
</script>

<header class="sticky top-0 z-50 border-b border-neutral-800 bg-neutral-950/85 backdrop-blur-md">
	<div class="mx-auto flex max-w-7xl items-center justify-between px-4 py-2.5 sm:px-6">
		<!-- Brand Logo -->
		<div class="flex items-center gap-6">
			<a href="/" class="flex items-center gap-2.5 transition hover:opacity-90">
				<div class="flex h-9 w-9 items-center justify-center rounded-xl overflow-hidden shadow-lg shadow-emerald-500/20 border border-emerald-500/30 bg-neutral-900 shrink-0">
					<img src="/favicon.svg" alt="Trax Vault Icon" class="h-full w-full object-cover" />
				</div>
				<div>
					<span class="text-base sm:text-lg font-black tracking-wider text-white">TRAX<span class="text-emerald-400">VAULT</span></span>
					<span class="hidden sm:block text-[9px] font-medium uppercase tracking-widest text-emerald-400/80">Music Quality & Lyrics Tracker</span>
				</div>
			</a>

			<!-- Desktop Primary Nav Links -->
			<nav class="hidden md:flex items-center gap-1 ml-2">
				<a
					href="/"
					class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs sm:text-sm font-medium transition {currentPath === '/' ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-700/60 shadow-sm' : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'}"
				>
					<Library class="h-4 w-4" />
					<span>Vault</span>
				</a>

				<a
					href="/player"
					class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs sm:text-sm font-medium transition {currentPath.startsWith('/player') ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-700/60 shadow-sm' : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'}"
				>
					<Disc3 class="h-4 w-4 text-emerald-400" />
					<span>Player</span>
				</a>

				<a
					href="/issues"
					class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs sm:text-sm font-medium transition {currentPath.startsWith('/issues') ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-700/60 shadow-sm' : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'}"
				>
					<TriangleAlert class="h-4 w-4 {issuesCount > 0 ? 'text-amber-400' : 'text-neutral-400'}" />
					<span>Fixer</span>
					{#if issuesCount > 0}
						<span class="ml-0.5 inline-flex items-center justify-center rounded-full bg-amber-500/20 px-1.5 py-0.2 text-[11px] font-semibold text-amber-300 border border-amber-500/40">
							{issuesCount}
						</span>
					{/if}
				</a>

				<a
					href="/lrc-maker"
					class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs sm:text-sm font-medium transition {currentPath.startsWith('/lrc-maker') ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-700/60 shadow-sm' : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'}"
				>
					<Mic class="h-4 w-4" />
					<span>LRC Maker</span>
				</a>

				<a
					href="/scan"
					data-sveltekit-preload-data="hover"
					class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs sm:text-sm font-medium transition {currentPath.startsWith('/scan') ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-700/60 shadow-sm' : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'}"
				>
					<FolderSync class="h-4 w-4 text-emerald-400" />
					<span>Scan</span>
				</a>

				<a
					href="/tagger"
					class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs sm:text-sm font-medium transition {currentPath.startsWith('/tagger') ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-700/60 shadow-sm' : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'}"
				>
					<Tag class="h-4 w-4 text-emerald-400" />
					<span>Tagger</span>
				</a>
			</nav>
		</div>

		<!-- Action Buttons & User Menu -->
		<div class="flex items-center gap-2 sm:gap-3">
			<a
				href="/add"
				class="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm font-semibold text-white shadow-md shadow-emerald-600/30 transition hover:bg-emerald-500 active:scale-95 shrink-0"
			>
				<Plus class="h-4 w-4" />
				<span class="hidden sm:inline">Add Album</span>
				<span class="sm:hidden">Add</span>
			</a>

			{#if user && !authDisabled}
				<div class="flex items-center gap-1.5 pl-2 border-l border-neutral-800">
					<a
						href="/settings"
						class="flex items-center gap-1.5 text-xs font-medium text-neutral-300 bg-neutral-900 border border-neutral-800 rounded-xl px-2 sm:px-2.5 py-1.5 hover:border-emerald-600/50 hover:text-white transition"
						title="Account Settings ({user.username})"
					>
						<UserIcon class="h-3.5 w-3.5 text-emerald-400 shrink-0" />
						<span class="truncate max-w-[60px] xs:max-w-[80px] sm:max-w-[120px]">{user.username}</span>
					</a>

					<button
						type="button"
						onclick={handleLogout}
						class="rounded-xl p-1.5 sm:p-2 text-neutral-400 hover:text-rose-400 hover:bg-neutral-900 border border-transparent hover:border-neutral-800 transition cursor-pointer"
						title="Sign Out"
					>
						<LogOut class="h-4 w-4" />
					</button>
				</div>
			{/if}
		</div>
	</div>

	<!-- Mobile Navigation Bottom Bar (7-tab bar) -->
	<div class="grid grid-cols-7 md:hidden border-t border-neutral-800/80 px-0.5 py-1 bg-neutral-950 text-center select-none">
		<a
			href="/"
			class="flex flex-col items-center gap-0.5 py-1 text-[9px] xs:text-[10px] font-medium transition {currentPath === '/' ? 'text-emerald-400 font-semibold' : 'text-neutral-400 hover:text-neutral-200'}"
		>
			<Library class="h-4 w-4" />
			<span class="truncate w-full block">Vault</span>
		</a>

		<a
			href="/player"
			class="flex flex-col items-center gap-0.5 py-1 text-[9px] xs:text-[10px] font-medium transition {currentPath.startsWith('/player') ? 'text-emerald-400 font-semibold' : 'text-neutral-400 hover:text-neutral-200'}"
		>
			<Disc3 class="h-4 w-4 {currentPath.startsWith('/player') ? 'text-emerald-400 animate-spin-slow' : ''}" />
			<span class="truncate w-full block">Player</span>
		</a>

		<a
			href="/issues"
			class="flex flex-col items-center gap-0.5 py-1 text-[9px] xs:text-[10px] font-medium relative transition {currentPath.startsWith('/issues') ? 'text-emerald-400 font-semibold' : 'text-neutral-400 hover:text-neutral-200'}"
		>
			<div class="relative">
				<TriangleAlert class="h-4 w-4 {issuesCount > 0 ? 'text-amber-400' : ''}" />
				{#if issuesCount > 0}
					<span class="absolute -top-1 -right-2 rounded-full bg-amber-500 text-black px-1 text-[8px] font-bold leading-none">
						{issuesCount}
					</span>
				{/if}
			</div>
			<span class="truncate w-full block">Fixer</span>
		</a>

		<a
			href="/tagger"
			class="flex flex-col items-center gap-0.5 py-1 text-[9px] xs:text-[10px] font-medium transition {currentPath.startsWith('/tagger') ? 'text-emerald-400 font-semibold' : 'text-neutral-400 hover:text-neutral-200'}"
		>
			<Tag class="h-4 w-4 {currentPath.startsWith('/tagger') ? 'text-emerald-400' : ''}" />
			<span class="truncate w-full block">Tagger</span>
		</a>

		<a
			href="/lrc-maker"
			class="flex flex-col items-center gap-0.5 py-1 text-[9px] xs:text-[10px] font-medium transition {currentPath.startsWith('/lrc-maker') ? 'text-emerald-400 font-semibold' : 'text-neutral-400 hover:text-neutral-200'}"
		>
			<Mic class="h-4 w-4" />
			<span class="truncate w-full block">LRC</span>
		</a>

		<a
			href="/scan"
			data-sveltekit-preload-data="hover"
			class="flex flex-col items-center gap-0.5 py-1 text-[9px] xs:text-[10px] font-medium transition {currentPath.startsWith('/scan') ? 'text-emerald-400 font-semibold' : 'text-neutral-400 hover:text-neutral-200'}"
		>
			<FolderSync class="h-4 w-4" />
			<span class="truncate w-full block">Scan</span>
		</a>

		<a
			href="/settings"
			class="flex flex-col items-center gap-0.5 py-1 text-[9px] xs:text-[10px] font-medium transition {currentPath.startsWith('/settings') ? 'text-emerald-400 font-semibold' : 'text-neutral-400 hover:text-neutral-200'}"
		>
			<SettingsIcon class="h-4 w-4" />
			<span class="truncate w-full block">Settings</span>
		</a>
	</div>
</header>
