<script lang="ts">
	import { Disc, Lock, User, ArrowRight, ShieldCheck, UserPlus, AlertCircle } from '@lucide/svelte';

	let { data }: { data: { registrationDisabled: boolean } } = $props();

	let username = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let isSubmitting = $state(false);
	let errorMessage = $state<string | null>(null);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		errorMessage = null;

		if (!username.trim() || !password) {
			errorMessage = 'All fields are required';
			return;
		}

		if (username.trim().length < 3) {
			errorMessage = 'Username must be at least 3 characters long';
			return;
		}

		if (password.length < 6) {
			errorMessage = 'Password must be at least 6 characters long';
			return;
		}

		if (password !== confirmPassword) {
			errorMessage = 'Passwords do not match';
			return;
		}

		isSubmitting = true;

		try {
			const res = await fetch('/api/auth/register', {
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

			const resData = await res.json();

			if (!res.ok) {
				errorMessage = resData.error || 'Failed to create account';
				isSubmitting = false;
				return;
			}

			// Success! Redirect to library
			window.location.href = resData.redirect || '/';
		} catch (err: any) {
			console.error('Registration error:', err);
			errorMessage = 'Network or server error occurred during registration. Please try again.';
			isSubmitting = false;
		}
	}
</script>

<svelte:head>
	<title>Trax Vault - Create Account</title>
</svelte:head>

<div class="flex min-h-[85vh] items-center justify-center px-4 py-12 sm:px-6">
	<div class="w-full max-w-md">
		<!-- Brand Header -->
		<div class="text-center">
			<div class="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-900/30 border border-emerald-500/40 text-emerald-400 shadow-xl shadow-emerald-950/50 mb-4">
				<UserPlus class="h-8 w-8 stroke-[2.2]" />
			</div>
			<h1 class="text-2xl sm:text-3xl font-black text-white">
				Create an Account
			</h1>
			<p class="mt-1 text-xs text-neutral-400">
				Join Trax Vault to build personal playlists and stream lossless music
			</p>
		</div>

		<!-- Registration Card -->
		<div class="mt-8 rounded-3xl border border-neutral-800 bg-neutral-900/50 p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
			{#if data.registrationDisabled}
				<!-- Registration Disabled Notice -->
				<div class="text-center py-4 space-y-4">
					<div class="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 mx-auto">
						<AlertCircle class="h-6 w-6" />
					</div>
					<div>
						<h2 class="text-base font-bold text-white">Public Registration Disabled</h2>
						<p class="mt-1.5 text-xs text-neutral-400 leading-relaxed">
							The administrator has restricted account creation for this Trax Vault instance. Please contact the administrator to create an account for you.
						</p>
					</div>
					<div class="pt-2">
						<a
							href="/login"
							class="inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 px-5 py-2.5 text-xs font-bold text-neutral-200 transition"
						>
							&larr; Return to Sign In
						</a>
					</div>
				</div>
			{:else}
				{#if errorMessage}
					<div class="mb-5 rounded-xl border border-rose-800/80 bg-rose-950/60 p-3 text-xs text-rose-300">
						{errorMessage}
					</div>
				{/if}

				<form onsubmit={handleSubmit} class="space-y-4">
					<div>
						<label for="reg-username" class="block text-xs font-semibold text-neutral-300 mb-1.5">
							Username
						</label>
						<div class="relative">
							<User class="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
							<input
								id="reg-username"
								name="username"
								type="text"
								required
								bind:value={username}
								placeholder="e.g. music_fan"
								autocomplete="username"
								class="w-full rounded-xl border border-neutral-700 bg-neutral-950 pl-10 pr-4 py-2.5 text-xs sm:text-sm text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
							/>
						</div>
						<p class="mt-1 text-[10px] text-neutral-500">
							3–32 characters, letters, numbers, and underscores.
						</p>
					</div>

					<div>
						<label for="reg-password" class="block text-xs font-semibold text-neutral-300 mb-1.5">
							Password
						</label>
						<div class="relative">
							<Lock class="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
							<input
								id="reg-password"
								name="password"
								type="password"
								required
								bind:value={password}
								placeholder="••••••••"
								autocomplete="new-password"
								class="w-full rounded-xl border border-neutral-700 bg-neutral-950 pl-10 pr-4 py-2.5 text-xs sm:text-sm text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
							/>
						</div>
						<p class="mt-1 text-[10px] text-neutral-500">Minimum 6 characters.</p>
					</div>

					<div>
						<label for="reg-confirm-password" class="block text-xs font-semibold text-neutral-300 mb-1.5">
							Confirm Password
						</label>
						<div class="relative">
							<Lock class="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
							<input
								id="reg-confirm-password"
								name="confirmPassword"
								type="password"
								required
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
								<span>Creating Account...</span>
							{:else}
								<UserPlus class="h-4 w-4" />
								<span>Create Account</span>
								<ArrowRight class="h-4 w-4" />
							{/if}
						</button>
					</div>
				</form>

				<div class="mt-6 pt-5 border-t border-neutral-800 text-center text-xs text-neutral-400">
					Already have an account?
					<a href="/login" class="font-bold text-emerald-400 hover:text-emerald-300 ml-1 transition">
						Sign in &rarr;
					</a>
				</div>
			{/if}
		</div>
	</div>
</div>
