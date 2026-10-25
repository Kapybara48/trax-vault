<script lang="ts">
	import { Disc, ShieldCheck, ArrowRight, Lock, User, Sparkles, Database } from '@lucide/svelte';

	let username = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let isSubmitting = $state(false);
	let errorMessage = $state<string | null>(null);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		errorMessage = null;

		if (!username || username.trim().length < 3) {
			errorMessage = 'Username must be at least 3 characters long';
			return;
		}

		if (!password || password.length < 6) {
			errorMessage = 'Password must be at least 6 characters long';
			return;
		}

		if (password !== confirmPassword) {
			errorMessage = 'Passwords do not match';
			return;
		}

		isSubmitting = true;

		try {
			const res = await fetch('/api/auth/setup', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					username: username.trim(),
					password,
					confirmPassword
				})
			});

			const data = await res.json();

			if (!res.ok) {
				errorMessage = data.error || 'Failed to complete setup';
				isSubmitting = false;
				return;
			}

			// Success! Redirect to main vault
			window.location.href = data.redirect || '/';
		} catch (err: any) {
			console.error('Setup error:', err);
			errorMessage = 'Network or server error occurred during setup. Please try again.';
			isSubmitting = false;
		}
	}
</script>

<svelte:head>
	<title>Trax Vault - Initial Setup</title>
</svelte:head>

<div class="flex min-h-[85vh] items-center justify-center px-4 py-12 sm:px-6">
	<div class="w-full max-w-md">
		<!-- Brand Header -->
		<div class="text-center">
			<div class="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-900/30 border border-emerald-500/40 text-emerald-400 shadow-xl shadow-emerald-950/50 mb-4">
				<Disc class="h-9 w-9 stroke-[2.2] animate-spin" style="animation-duration: 16s;" />
			</div>
			<div class="flex items-center justify-center gap-1.5 text-xs font-bold uppercase tracking-widest text-emerald-400">
				<Sparkles class="h-3.5 w-3.5" />
				Welcome to Trax Vault
			</div>
			<h1 class="mt-2 text-2xl sm:text-3xl font-black text-white">
				First-Run Setup
			</h1>
			<p class="mt-1 text-xs text-neutral-400 max-w-sm mx-auto">
				Create your primary administrator account to secure your vault and collection.
			</p>
		</div>

		<!-- Setup Card -->
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
						Admin Username
					</label>
					<div class="relative">
						<User class="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
						<input
							id="username"
							name="username"
							type="text"
							required
							minlength="3"
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
							minlength="6"
							bind:value={password}
							placeholder="••••••••"
							autocomplete="new-password"
							class="w-full rounded-xl border border-neutral-700 bg-neutral-950 pl-10 pr-4 py-2.5 text-xs sm:text-sm text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
						/>
					</div>
					<p class="mt-1 text-[11px] text-neutral-500">Must be at least 6 characters</p>
				</div>

				<div>
					<label for="confirmPassword" class="block text-xs font-semibold text-neutral-300 mb-1.5">
						Confirm Password
					</label>
					<div class="relative">
						<Lock class="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
						<input
							id="confirmPassword"
							name="confirmPassword"
							type="password"
							required
							minlength="6"
							bind:value={confirmPassword}
							placeholder="••••••••"
							autocomplete="new-password"
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
							<span>Setting up Vault...</span>
						{:else}
							<ShieldCheck class="h-4 w-4" />
							<span>Create Admin & Launch Vault</span>
							<ArrowRight class="h-4 w-4" />
						{/if}
					</button>
				</div>
			</form>

			<div class="mt-6 border-t border-neutral-800/80 pt-4 flex items-center gap-2 text-[11px] text-neutral-400">
				<Database class="h-3.5 w-3.5 text-emerald-400 shrink-0" />
				<span>Powered by SQLite. Fast, self-contained local database in Docker.</span>
			</div>
		</div>
	</div>
</div>
