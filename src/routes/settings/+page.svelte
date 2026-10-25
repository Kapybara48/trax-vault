<script lang="ts">
	import type { PageData, ActionData } from './$types.js';
	import {
		Settings,
		User,
		KeyRound,
		Lock,
		Eye,
		EyeOff,
		Shield,
		ShieldCheck,
		AlertTriangle,
		CheckCircle2,
		AlertCircle,
		HardDrive,
		Folder,
		Layers,
		Tag,
		ExternalLink,
		Radio,
		Smartphone,
		Copy,
		Check
	} from '@lucide/svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');

	let showCurrent = $state(false);
	let showNew = $state(false);
	let showConfirm = $state(false);

	let isSubmitting = $state(false);
	let clientError = $state<string | null>(null);
	let clientSuccess = $state<string | null>(null);

	let copiedBase = $state(false);
	let copiedRest = $state(false);
	let syncPassword = $state('');
	let isSyncingSubsonic = $state(false);
	let subsonicMsg = $state<string | null>(null);
	let subsonicErr = $state<string | null>(null);

	function copyBaseUrl() {
		navigator.clipboard.writeText(data.serverBaseUrl);
		copiedBase = true;
		setTimeout(() => {
			copiedBase = false;
		}, 2000);
	}

	function copyRestUrl() {
		navigator.clipboard.writeText(data.subsonicUrl);
		copiedRest = true;
		setTimeout(() => {
			copiedRest = false;
		}, 2000);
	}

	async function handleSyncSubsonic(e: SubmitEvent) {
		e.preventDefault();
		subsonicMsg = null;
		subsonicErr = null;
		if (!syncPassword) {
			subsonicErr = 'Please enter your current password';
			return;
		}
		isSyncingSubsonic = true;
		try {
			const formData = new FormData();
			formData.append('password', syncPassword);
			const res = await fetch('?/syncSubsonicPassword', {
				method: 'POST',
				body: formData
			});
			if (res.ok) {
				subsonicMsg = 'Subsonic client authentication activated successfully!';
				syncPassword = '';
				data.hasSubsonicSecret = true;
			} else {
				subsonicErr = 'Incorrect password entered';
			}
		} catch {
			subsonicErr = 'Network error occurred while syncing';
		} finally {
			isSyncingSubsonic = false;
		}
	}

	const passwordsMatch = $derived(
		newPassword.length > 0 && confirmPassword.length > 0 && newPassword === confirmPassword
	);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		clientError = null;
		clientSuccess = null;

		if (!currentPassword) {
			clientError = 'Please enter your current password';
			return;
		}

		if (!newPassword || newPassword.length < 6) {
			clientError = 'New password must be at least 6 characters long';
			return;
		}

		if (newPassword !== confirmPassword) {
			clientError = 'New passwords do not match';
			return;
		}

		isSubmitting = true;

		try {
			const res = await fetch('/api/auth/change-password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					currentPassword,
					newPassword,
					confirmPassword
				})
			});

			const result = await res.json();

			if (!res.ok) {
				clientError = result.error || 'Failed to update password';
				isSubmitting = false;
				return;
			}

			clientSuccess = 'Password updated successfully!';
			currentPassword = '';
			newPassword = '';
			confirmPassword = '';
		} catch (err: any) {
			console.error('Password change error:', err);
			clientError = 'A network error occurred. Please try again.';
		} finally {
			isSubmitting = false;
		}
	}
</script>

<svelte:head>
	<title>Track Vault - Settings</title>
</svelte:head>

<div class="mx-auto max-w-5xl px-4 py-8 sm:px-6">
	<!-- Page Header -->
	<div class="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
		<div>
			<div class="flex items-center gap-3">
				<div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-950/80 border border-emerald-600/40 text-emerald-400 shadow-lg shadow-emerald-950/50">
					<Settings class="h-6 w-6" />
				</div>
				<div>
					<h1 class="text-2xl font-black text-white sm:text-3xl">Settings</h1>
					<p class="text-xs text-neutral-400">
						Manage your account credentials, security preferences, and vault information
					</p>
				</div>
			</div>
		</div>
	</div>

	<!-- Auth Disabled Warning Banner -->
	{#if data.authDisabled}
		<div class="mb-8 rounded-2xl border border-amber-600/40 bg-amber-950/40 p-4 sm:p-5 text-amber-200 shadow-xl backdrop-blur-md">
			<div class="flex items-start gap-3.5">
				<AlertTriangle class="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
				<div class="text-xs leading-relaxed space-y-1">
					<p class="font-bold text-amber-300">
						Authentication Bypassed (AUTH_DISABLED=true)
					</p>
					<p class="text-amber-200/80">
						Standard session authentication is currently turned off via environment configuration. Every request operates under the synthetic administrator profile. Password modifications are disabled in this mode.
					</p>
				</div>
			</div>
		</div>
	{/if}

	<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
		<!-- Left Column: Account Profile & Security Card -->
		<div class="space-y-6 lg:col-span-1">
			<!-- Account Info -->
			<div class="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6 backdrop-blur-xl shadow-xl">
				<div class="flex items-center gap-3 border-b border-neutral-800/80 pb-4 mb-5">
					<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-800 border border-neutral-700 text-emerald-400">
						<User class="h-5 w-5" />
					</div>
					<div>
						<h2 class="text-sm font-bold text-white">Account Profile</h2>
						<p class="text-[11px] text-neutral-400">Current login details</p>
					</div>
				</div>

				<div class="space-y-4 text-xs">
					<div>
						<span class="text-[11px] font-medium text-neutral-500 uppercase tracking-wider block mb-1">Username</span>
						<div class="flex items-center gap-2">
							<span class="font-semibold text-neutral-200 text-sm">{data.account?.username || 'admin'}</span>
							<span class="rounded-md bg-emerald-950/80 border border-emerald-600/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
								{data.account?.role || 'admin'}
							</span>
						</div>
					</div>

					<div>
						<span class="text-[11px] font-medium text-neutral-500 uppercase tracking-wider block mb-1">Status</span>
						<div class="flex items-center gap-2 text-emerald-400">
							<ShieldCheck class="h-4 w-4" />
							<span class="font-medium text-neutral-300">
								{data.authDisabled ? 'Auth Bypassed' : 'Session Active'}
							</span>
						</div>
					</div>

					<div>
						<span class="text-[11px] font-medium text-neutral-500 uppercase tracking-wider block mb-1">Active Sessions</span>
						<span class="font-medium text-neutral-300">
							{data.activeSessionsCount} active login session{data.activeSessionsCount === 1 ? '' : 's'}
						</span>
					</div>

					{#if data.account?.created_at}
						<div>
							<span class="text-[11px] font-medium text-neutral-500 uppercase tracking-wider block mb-1">Created</span>
							<span class="font-medium text-neutral-400">
								{new Date(data.account.created_at).toLocaleDateString()}
							</span>
						</div>
					{/if}
				</div>
			</div>

			<!-- System & Storage Info -->
			<div class="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6 backdrop-blur-xl shadow-xl text-xs space-y-4">
				<div class="flex items-center gap-3 border-b border-neutral-800/80 pb-4 mb-2">
					<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-800 border border-neutral-700 text-emerald-400">
						<HardDrive class="h-5 w-5" />
					</div>
					<div>
						<h2 class="text-sm font-bold text-white">System Information</h2>
						<p class="text-[11px] text-neutral-400">Vault environment & data</p>
					</div>
				</div>

				<div class="space-y-3">
					<div>
						<span class="text-[11px] font-medium text-neutral-500 uppercase tracking-wider block mb-0.5">Database Storage</span>
						<div class="flex items-center gap-1.5 font-mono text-[11px] text-neutral-300 bg-neutral-950 p-2 rounded-lg border border-neutral-800 break-all">
							<Layers class="h-3.5 w-3.5 shrink-0 text-emerald-400" />
							<span>{data.env.dataDir}/trackvault.db</span>
						</div>
					</div>

					<div>
						<span class="text-[11px] font-medium text-neutral-500 uppercase tracking-wider block mb-0.5">Music Library Folder</span>
						<div class="flex items-center gap-1.5 font-mono text-[11px] text-neutral-300 bg-neutral-950 p-2 rounded-lg border border-neutral-800 break-all">
							<Folder class="h-3.5 w-3.5 shrink-0 text-emerald-400" />
							<span>{data.env.musicDir}</span>
						</div>
					</div>

					<div class="flex items-center justify-between pt-2 border-t border-neutral-800/60 text-neutral-400">
						<span>Environment:</span>
						<span class="font-mono text-neutral-200 uppercase">{data.env.nodeEnv}</span>
					</div>
				</div>
			</div>

			<!-- MusicBrainz Tagger Studio Card -->
			<div class="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6 backdrop-blur-xl shadow-xl text-xs space-y-4">
				<div class="flex items-center gap-3 border-b border-neutral-800/80 pb-4 mb-2">
					<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-950/80 border border-emerald-500/40 text-emerald-400">
						<Tag class="h-5 w-5" />
					</div>
					<div>
						<h2 class="text-sm font-bold text-white">MusicBrainz Tagger Studio</h2>
						<p class="text-[11px] text-neutral-400">Native Embedded Tagging</p>
					</div>
				</div>

				<div class="space-y-3">
					<p class="text-neutral-400 leading-relaxed text-[11px]">
						Track Vault's built-in tagger studio queries MusicBrainz directly, aligns songs with releases, downloads official cover art, and writes verified ID3/Vorbis tags directly to audio files on disk.
					</p>

					<div class="pt-2 border-t border-neutral-800/60">
						<a
							href="/tagger"
							class="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-emerald-600/30 hover:bg-emerald-500 transition active:scale-95"
						>
							<Tag class="h-3.5 w-3.5" />
							<span>Open Tagger Studio</span>
						</a>
					</div>
				</div>
			</div>

			<!-- Subsonic & OpenSubsonic API Card -->
			<div class="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6 backdrop-blur-xl shadow-xl text-xs space-y-4">
				<div class="flex items-center gap-3 border-b border-neutral-800/80 pb-4 mb-2">
					<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-950/80 border border-purple-500/40 text-purple-400">
						<Radio class="h-5 w-5" />
					</div>
					<div>
						<h2 class="text-sm font-bold text-white">Subsonic & OpenSubsonic</h2>
						<p class="text-[11px] text-neutral-400">Navidrome & Symfonium Server</p>
					</div>
				</div>

				<div class="space-y-3">
					<p class="text-neutral-400 leading-relaxed text-[11px]">
						Connect third-party music streaming clients like <strong class="text-neutral-200">Symfonium</strong> (Android), <strong class="text-neutral-200">Feishin</strong> (Desktop), or <strong class="text-neutral-200">Amperfy</strong> (iOS) directly to Track Vault.
					</p>

					<div>
						<div class="flex items-center justify-between mb-0.5">
							<span class="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">Feishin / Desktop URL</span>
							<span class="text-[10px] text-neutral-500">Auto-appends /rest</span>
						</div>
						<div class="flex items-center justify-between gap-1.5 font-mono text-[11px] text-neutral-300 bg-neutral-950 p-2 rounded-lg border border-neutral-800">
							<span class="truncate">{data.serverBaseUrl}</span>
							<button
								type="button"
								onclick={copyBaseUrl}
								class="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition cursor-pointer"
								title="Copy Feishin Server URL"
							>
								{#if copiedBase}
									<Check class="h-3.5 w-3.5 text-emerald-400" />
								{:else}
									<Copy class="h-3.5 w-3.5" />
								{/if}
							</button>
						</div>
					</div>

					<div>
						<div class="flex items-center justify-between mb-0.5">
							<span class="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">Mobile API URL</span>
							<span class="text-[10px] text-neutral-500">Symfonium / DSub</span>
						</div>
						<div class="flex items-center justify-between gap-1.5 font-mono text-[11px] text-neutral-300 bg-neutral-950 p-2 rounded-lg border border-neutral-800">
							<span class="truncate">{data.subsonicUrl}</span>
							<button
								type="button"
								onclick={copyRestUrl}
								class="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition cursor-pointer"
								title="Copy Subsonic REST URL"
							>
								{#if copiedRest}
									<Check class="h-3.5 w-3.5 text-emerald-400" />
								{:else}
									<Copy class="h-3.5 w-3.5" />
								{/if}
							</button>
						</div>
					</div>

					<div class="pt-2 border-t border-neutral-800/60 space-y-2">
						<div class="flex items-center justify-between">
							<span class="text-neutral-400">Token Authentication:</span>
							{#if data.authDisabled}
								<span class="text-emerald-400 font-semibold flex items-center gap-1">
									<CheckCircle2 class="h-3 w-3" /> Bypassed
								</span>
							{:else if data.hasSubsonicSecret}
								<span class="text-emerald-400 font-semibold flex items-center gap-1">
									<CheckCircle2 class="h-3 w-3" /> Active & Ready
								</span>
							{:else}
								<span class="text-amber-400 font-semibold flex items-center gap-1">
									<AlertCircle class="h-3 w-3" /> Needs Activation
								</span>
							{/if}
						</div>

						<div class="flex items-center justify-between">
							<span class="text-neutral-400">Synced Lyrics (LRC):</span>
							<span class="text-purple-300 font-semibold">Enabled</span>
						</div>

						{#if !data.authDisabled}
							<form onsubmit={handleSyncSubsonic} class="mt-3 pt-3 border-t border-neutral-800/60 space-y-2">
								<div class="flex items-center justify-between">
									<span class="text-[11px] font-semibold text-neutral-300">Sync Subsonic Password</span>
									<span class="text-[10px] text-neutral-500">Updates token secret</span>
								</div>
								<p class="text-[11px] text-neutral-400">
									Enter your current Track Vault password to synchronize token authentication for Feishin & mobile apps:
								</p>
								<div class="flex gap-2">
									<input
										type="password"
										bind:value={syncPassword}
										placeholder="Current password"
										class="flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-500 focus:border-purple-500 focus:outline-none"
									/>
									<button
										type="submit"
										disabled={isSyncingSubsonic || !syncPassword}
										class="px-3 py-1.5 rounded-lg bg-purple-600 text-white font-medium text-xs hover:bg-purple-500 disabled:opacity-50 transition cursor-pointer"
									>
										{#if isSyncingSubsonic}Syncing...{:else}Sync{/if}
									</button>
								</div>
								{#if subsonicErr}
									<p class="text-[11px] text-rose-400">{subsonicErr}</p>
								{/if}
								{#if subsonicMsg}
									<p class="text-[11px] text-emerald-400">{subsonicMsg}</p>
								{/if}
							</form>
						{/if}
					</div>
				</div>
			</div>
		</div>

		<!-- Right Column: Change Password -->
		<div class="lg:col-span-2">
			<div class="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6 sm:p-8 backdrop-blur-xl shadow-xl">
				<div class="flex items-center gap-3 border-b border-neutral-800/80 pb-5 mb-6">
					<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-950/80 border border-emerald-600/40 text-emerald-400">
						<KeyRound class="h-5 w-5" />
					</div>
					<div>
						<h2 class="text-base font-bold text-white">Change Account Password</h2>
						<p class="text-xs text-neutral-400">Update your administrator credentials with a new secure password</p>
					</div>
				</div>

				<!-- Success Message -->
				{#if clientSuccess || form?.success}
					<div class="mb-6 rounded-2xl border border-emerald-600/40 bg-emerald-950/40 p-4 text-xs text-emerald-200 flex items-center gap-3">
						<CheckCircle2 class="h-5 w-5 shrink-0 text-emerald-400" />
						<span>{clientSuccess || form?.message || 'Password changed successfully!'}</span>
					</div>
				{/if}

				<!-- Error Message -->
				{#if clientError || form?.error}
					<div class="mb-6 rounded-2xl border border-rose-800/80 bg-rose-950/60 p-4 text-xs text-rose-300 flex items-center gap-3">
						<AlertCircle class="h-5 w-5 shrink-0 text-rose-400" />
						<span>{clientError || form?.error}</span>
					</div>
				{/if}

				<form onsubmit={handleSubmit} class="space-y-5">
					<!-- Current Password -->
					<div>
						<label for="currentPassword" class="block text-xs font-semibold text-neutral-300 mb-1.5">
							Current Password *
						</label>
						<div class="relative">
							<Lock class="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
							<input
								id="currentPassword"
								name="currentPassword"
								type={showCurrent ? 'text' : 'password'}
								required
								disabled={data.authDisabled}
								bind:value={currentPassword}
								placeholder="Enter current password"
								autocomplete="current-password"
								class="w-full rounded-xl border border-neutral-700 bg-neutral-950 pl-10 pr-11 py-2.5 text-xs sm:text-sm text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
							/>
							<button
								type="button"
								onclick={() => (showCurrent = !showCurrent)}
								disabled={data.authDisabled}
								class="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-200 focus:outline-none"
								title={showCurrent ? 'Hide password' : 'Show password'}
							>
								{#if showCurrent}
									<EyeOff class="h-4 w-4" />
								{:else}
									<Eye class="h-4 w-4" />
								{/if}
							</button>
						</div>
					</div>

					<!-- New Password -->
					<div>
						<label for="newPassword" class="block text-xs font-semibold text-neutral-300 mb-1.5">
							New Password * <span class="text-[11px] font-normal text-neutral-500">(minimum 6 characters)</span>
						</label>
						<div class="relative">
							<KeyRound class="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
							<input
								id="newPassword"
								name="newPassword"
								type={showNew ? 'text' : 'password'}
								required
								minlength="6"
								disabled={data.authDisabled}
								bind:value={newPassword}
								placeholder="Enter new secure password"
								autocomplete="new-password"
								class="w-full rounded-xl border border-neutral-700 bg-neutral-950 pl-10 pr-11 py-2.5 text-xs sm:text-sm text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
							/>
							<button
								type="button"
								onclick={() => (showNew = !showNew)}
								disabled={data.authDisabled}
								class="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-200 focus:outline-none"
								title={showNew ? 'Hide password' : 'Show password'}
							>
								{#if showNew}
									<EyeOff class="h-4 w-4" />
								{:else}
									<Eye class="h-4 w-4" />
								{/if}
							</button>
						</div>
					</div>

					<!-- Confirm New Password -->
					<div>
						<label for="confirmPassword" class="block text-xs font-semibold text-neutral-300 mb-1.5">
							Confirm New Password *
						</label>
						<div class="relative">
							<KeyRound class="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
							<input
								id="confirmPassword"
								name="confirmPassword"
								type={showConfirm ? 'text' : 'password'}
								required
								minlength="6"
								disabled={data.authDisabled}
								bind:value={confirmPassword}
								placeholder="Repeat new password"
								autocomplete="new-password"
								class="w-full rounded-xl border border-neutral-700 bg-neutral-950 pl-10 pr-11 py-2.5 text-xs sm:text-sm text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed {confirmPassword.length > 0 && !passwordsMatch ? 'border-rose-600 focus:border-rose-500 focus:ring-rose-500' : ''}"
							/>
							<button
								type="button"
								onclick={() => (showConfirm = !showConfirm)}
								disabled={data.authDisabled}
								class="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-200 focus:outline-none"
								title={showConfirm ? 'Hide password' : 'Show password'}
							>
								{#if showConfirm}
									<EyeOff class="h-4 w-4" />
								{:else}
									<Eye class="h-4 w-4" />
								{/if}
							</button>
						</div>
						{#if confirmPassword.length > 0 && !passwordsMatch}
							<p class="mt-1 text-[11px] text-rose-400">Passwords do not match</p>
						{/if}
					</div>

					<!-- Submit Button -->
					<div class="pt-2">
						<button
							type="submit"
							disabled={isSubmitting || data.authDisabled || !passwordsMatch || newPassword.length < 6}
							class="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-lg shadow-emerald-600/30 transition hover:bg-emerald-500 active:scale-95 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
						>
							{#if isSubmitting}
								<div class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
								<span>Updating Password...</span>
							{:else}
								<Shield class="h-4 w-4" />
								<span>Update Password</span>
							{/if}
						</button>
					</div>
				</form>
			</div>
		</div>
	</div>
</div>
