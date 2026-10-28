<script lang="ts">
	import { page } from '$app/state';
	import { Disc, Lock, User, ArrowRight, ShieldCheck } from '@lucide/svelte';

	let { data }: { data: any } = $props();

	let username = $state('');
	let password = $state('');
	let isSubmitting = $state(false);
	let errorMessage = $state<string | null>(null);

	const redirectUrl = $derived(page.url.searchParams.get('redirect') || '/');

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		errorMessage = null;

		if (!username.trim() || !password) {
			errorMessage = 'Username and password are required';
			return;
		}

		isSubmitting = true;

		try {
			const res = await fetch('/api/auth/login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					username: username.trim(),
					password,
					redirectTo: redirectUrl
				})
			});

			const data = await res.json();

			if (!res.ok) {
				errorMessage = data.error || 'Failed to sign in';
				isSubmitting = false;
				return;
			}

			// Success! Redirect to intended page or home
			window.location.href = data.redirect || redirectUrl;
		} catch (err: any) {
			console.error('Login error:', err);
			errorMessage = 'Network or server error occurred during sign in. Please try again.';
			isSubmitting = false;
		}
	}
</script>

<svelte:head>
	<title>Trax Vault - Login</title>
</svelte:head>

<div class="flex min-h-[85vh] items-center justify-center px-4 py-12 sm:px-6">
	<div class="w-full max-w-md">
		<!-- Brand Header -->
		<div class="text-center">
			<div class="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-900/30 border border-emerald-500/40 text-emerald-400 shadow-xl shadow-emerald-950/50 mb-4">
				<Disc class="h-9 w-9 stroke-[2.2]" />
			</div>
			<h1 class="text-2xl sm:text-3xl font-black text-white">
				Trax Vault
			</h1>
			<p class="mt-1 text-xs text-neutral-400">
				Sign in to access your music collection and vault tools
			</p>
		</div>

		<!-- Login Card -->
		<div class="mt-8 rounded-3xl border border-neutral-800 bg-neutral-900/50 p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
			{#if errorMessage}
				<div class="mb-5 rounded-xl border border-rose-800/80 bg-rose-950/60 p-3 text-xs text-rose-300">
					{errorMessage}
				</div>
			{/if}

			<form
				onsubmit={handleSubmit}
				class="space-y-4"
			>
				<div>
					<label for="username" class="block text-xs font-semibold text-neutral-300 mb-1.5">
						Username
					</label>
					<div class="relative">
						<User class="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
						<input
							id="username"
							name="username"
							type="text"
							required
							bind:value={username}
							placeholder="admin"
							autocomplete="username"
							class="w-full rounded-xl border border-neutral-700 bg-neutral-950 pl-10 pr-4 py-2.5 text-xs sm:text-sm text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
						/>
					</div>
				</div>

				<div>
					<label for="password" class="block text-xs font-semibold text-neutral-300 mb-1.5">
						Password
					</label>
					<div class="relative">
						<Lock class="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
						<input
							id="password"
							name="password"
							type="password"
							required
							bind:value={password}
							placeholder="••••••••"
							autocomplete="current-password"
							class="w-full rounded-xl border border-neutral-700 bg-neutral-950 pl-10 pr-4 py-2.5 text-xs sm:text-sm text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
						/>
					</div>
				</div>

				<div class="pt-2">
					<button
						type="submit"
						disabled={isSubmitting}
						class="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-3 text-xs sm:text-sm font-bold text-white shadow-lg shadow-emerald-600/30 transition active:scale-[0.99] disabled:opacity-50 cursor-pointer"
					>
						{#if isSubmitting}
							<Disc class="h-4 w-4 animate-spin" />
							<span>Signing in...</span>
						{:else}
							<ShieldCheck class="h-4 w-4" />
							<span>Sign In to Vault</span>
							<ArrowRight class="h-4 w-4" />
						{/if}
					</button>
				</div>
			</form>

			{#if data?.registrationAllowed}
				<div class="mt-6 pt-5 border-t border-neutral-800 text-center text-xs text-neutral-400">
					Don't have an account?
					<a href="/register" class="font-bold text-emerald-400 hover:text-emerald-300 ml-1 transition">
						Create an account &rarr;
					</a>
				</div>
			{/if}
		</div>
	</div>
</div>
