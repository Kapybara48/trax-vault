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
		Radio,
		Smartphone,
		Copy,
		Check,
		Users,
		UserPlus,
		Trash2,
		Heart,
		Music,
		X,
		ShieldAlert,
		ChevronDown
	} from '@lucide/svelte';
	import { confirmAction, alertAction } from '$lib/services/dialog.svelte.js';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Active Tab State (Default: 'users' for admins, 'account' for regular users)
	let activeTab = $state<'users' | 'account' | 'subsonic' | 'system'>(
		data.account?.role === 'admin' ? 'users' : 'account'
	);

	// Account Password Change State
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');

	let showCurrent = $state(false);
	let showNew = $state(false);
	let showConfirm = $state(false);

	let isSubmitting = $state(false);
	let clientError = $state<string | null>(null);
	let clientSuccess = $state<string | null>(null);

	// Subsonic State
	let copiedServerUrl = $state(false);
	let showSubsonicCacheTips = $state(false);

	function copyServerUrl() {
		navigator.clipboard.writeText(data.serverBaseUrl);
		copiedServerUrl = true;
		setTimeout(() => {
			copiedServerUrl = false;
		}, 2000);
	}

	// Multi-User Management State
	let usersList = $state<any[]>(data.users || []);
	$effect(() => {
		if (data.users) {
			usersList = [...data.users];
		}
	});

	let showAddUserModal = $state(false);
	let newUsername = $state('');
	let newUserPassword = $state('');
	let newUserRole = $state<'user' | 'admin'>('user');
	let isAddingUser = $state(false);
	let addUserError = $state<string | null>(null);

	let showResetPwModal = $state(false);
	let resetTargetUser = $state<{ id: number; username: string } | null>(null);
	let adminResetNewPw = $state('');
	let adminResetConfirmPw = $state('');
	let isResettingPw = $state(false);
	let resetPwError = $state<string | null>(null);
	let resetPwSuccess = $state<string | null>(null);

	async function fetchUsers() {
		try {
			const res = await fetch('/api/admin/users');
			if (res.ok) {
				const json = await res.json();
				usersList = json.users || [];
			}
		} catch (err) {
			console.error('Failed to refresh users:', err);
		}
	}

	async function handleAddUser(e: SubmitEvent) {
		e.preventDefault();
		addUserError = null;
		if (!newUsername || newUsername.trim().length < 3) {
			addUserError = 'Username must be at least 3 characters';
			return;
		}
		if (!newUserPassword || newUserPassword.length < 6) {
			addUserError = 'Password must be at least 6 characters';
			return;
		}
		isAddingUser = true;
		try {
			const res = await fetch('/api/admin/users', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					username: newUsername.trim(),
					password: newUserPassword,
					role: newUserRole
				})
			});
			const json = await res.json();
			if (!res.ok) {
				addUserError = json.error || 'Failed to create user account';
				return;
			}
			newUsername = '';
			newUserPassword = '';
			newUserRole = 'user';
			showAddUserModal = false;
			await fetchUsers();
		} catch (err: any) {
			addUserError = err.message || 'Network error occurred';
		} finally {
			isAddingUser = false;
		}
	}

	async function handleToggleRole(targetUser: any) {
		const newRole = targetUser.role === 'admin' ? 'user' : 'admin';
		const confirmed = await confirmAction({
			title: 'Change User Role',
			message: `Change role of "${targetUser.username}" to ${newRole.toUpperCase()}?`,
			confirmText: 'Change Role'
		});
		if (!confirmed) return;

		try {
			const res = await fetch(`/api/admin/users/${targetUser.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ role: newRole })
			});
			const json = await res.json();
			if (!res.ok) {
				await alertAction(json.error || 'Failed to update role', 'Error');
				return;
			}
			await fetchUsers();
		} catch (err: any) {
			await alertAction(err.message || 'Network error', 'Error');
		}
	}

	function openResetPasswordModal(targetUser: any) {
		resetTargetUser = { id: targetUser.id, username: targetUser.username };
		adminResetNewPw = '';
		adminResetConfirmPw = '';
		resetPwError = null;
		resetPwSuccess = null;
		showResetPwModal = true;
	}

	async function handleAdminResetPassword(e: SubmitEvent) {
		e.preventDefault();
		if (!resetTargetUser) return;
		resetPwError = null;
		resetPwSuccess = null;

		if (!adminResetNewPw || adminResetNewPw.length < 6) {
			resetPwError = 'Password must be at least 6 characters';
			return;
		}
		if (adminResetNewPw !== adminResetConfirmPw) {
			resetPwError = 'Passwords do not match';
			return;
		}

		isResettingPw = true;
		try {
			const res = await fetch(`/api/admin/users/${resetTargetUser.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ newPassword: adminResetNewPw })
			});
			const json = await res.json();
			if (!res.ok) {
				resetPwError = json.error || 'Failed to reset password';
				return;
			}
			resetPwSuccess = `Password for ${resetTargetUser.username} successfully updated!`;
			setTimeout(() => {
				showResetPwModal = false;
			}, 1200);
		} catch (err: any) {
			resetPwError = err.message || 'Network error occurred';
		} finally {
			isResettingPw = false;
		}
	}

	async function handleDeleteUser(targetUser: any) {
		const confirmed = await confirmAction({
			title: 'Delete User Account',
			message: `Are you sure you want to delete user "${targetUser.username}"? This action cannot be undone and will delete all their playlists and saved data.`,
			confirmText: 'Delete User',
			danger: true
		});
		if (!confirmed) return;

		try {
			const res = await fetch(`/api/admin/users/${targetUser.id}`, {
				method: 'DELETE'
			});
			const json = await res.json();
			if (!res.ok) {
				await alertAction(json.error || 'Failed to delete user', 'Error');
				return;
			}
			await fetchUsers();
		} catch (err: any) {
			await alertAction(err.message || 'Network error', 'Error');
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
	<title>Trax Vault - Settings</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-4 py-8 sm:px-6">
	<!-- Page Header -->
	<div class="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
		<div class="flex items-center gap-3">
			<div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-950/80 border border-emerald-600/40 text-emerald-400 shadow-lg shadow-emerald-950/50">
				<Settings class="h-6 w-6" />
			</div>
			<div>
				<h1 class="text-2xl font-black text-white sm:text-3xl">Settings</h1>
				<p class="text-xs text-neutral-400">
					Manage user accounts, credentials, Subsonic streaming, and server configuration
				</p>
			</div>
		</div>
	</div>

	<!-- Auth Disabled Warning Banner -->
	{#if data.authDisabled}
		<div class="mb-6 rounded-2xl border border-amber-600/40 bg-amber-950/40 p-4 sm:p-5 text-amber-200 shadow-xl backdrop-blur-md">
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

	<!-- Master-Detail Navigation: Sidebar List on Left, Active Settings on Right -->
	<div class="flex flex-col md:flex-row gap-6 items-start">
		<!-- Left Navigation Menu (Desktop Vertical List & Mobile Horizontal Pills) -->
		<div class="w-full md:w-64 lg:w-72 shrink-0">
			<!-- Mobile Horizontal Switcher -->
			<div class="flex items-center gap-1.5 overflow-x-auto pb-2 md:hidden">
				{#if data.account?.role === 'admin'}
					<button
						type="button"
						onclick={() => (activeTab = 'users')}
						class="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold shrink-0 transition cursor-pointer {activeTab === 'users'
							? 'bg-emerald-500 text-neutral-950 shadow-md'
							: 'bg-neutral-900 border border-neutral-800 text-neutral-300'}"
					>
						<Users class="w-4 h-4" />
						<span>Users ({usersList.length})</span>
					</button>
				{/if}
				<button
					type="button"
					onclick={() => (activeTab = 'account')}
					class="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold shrink-0 transition cursor-pointer {activeTab === 'account'
						? 'bg-emerald-500 text-neutral-950 shadow-md'
						: 'bg-neutral-900 border border-neutral-800 text-neutral-300'}"
				>
					<User class="w-4 h-4" />
					<span>Account</span>
				</button>
				<button
					type="button"
					onclick={() => (activeTab = 'subsonic')}
					class="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold shrink-0 transition cursor-pointer {activeTab === 'subsonic'
						? 'bg-emerald-500 text-neutral-950 shadow-md'
						: 'bg-neutral-900 border border-neutral-800 text-neutral-300'}"
				>
					<Radio class="w-4 h-4" />
					<span>Subsonic</span>
				</button>
				<button
					type="button"
					onclick={() => (activeTab = 'system')}
					class="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold shrink-0 transition cursor-pointer {activeTab === 'system'
						? 'bg-emerald-500 text-neutral-950 shadow-md'
						: 'bg-neutral-900 border border-neutral-800 text-neutral-300'}"
				>
					<HardDrive class="w-4 h-4" />
					<span>System</span>
				</button>
			</div>

			<!-- Desktop Vertical List -->
			<div class="hidden md:flex flex-col gap-1.5 p-2 rounded-2xl border border-neutral-800 bg-neutral-900/60 backdrop-blur-xl">
				{#if data.account?.role === 'admin'}
					<button
						type="button"
						onclick={() => (activeTab = 'users')}
						class="w-full flex items-center justify-between p-3 rounded-xl text-left text-xs transition cursor-pointer {activeTab === 'users'
							? 'bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-bold shadow-md'
							: 'text-neutral-400 hover:text-white hover:bg-neutral-800/60 border border-transparent font-medium'}"
					>
						<div class="flex items-center gap-3">
							<div class="w-7 h-7 rounded-lg flex items-center justify-center {activeTab === 'users' ? 'bg-emerald-500 text-neutral-950' : 'bg-neutral-800 text-neutral-400'}">
								<Users class="w-4 h-4" />
							</div>
							<div>
								<div class="text-xs font-semibold {activeTab === 'users' ? 'text-white' : 'text-neutral-200'}">Users</div>
								<div class="text-[10px] text-neutral-500">Accounts & roles</div>
							</div>
						</div>
						<span class="text-[10px] font-bold px-2 py-0.5 rounded-full {activeTab === 'users' ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/50' : 'bg-neutral-800 text-neutral-400'}">
							{usersList.length}
						</span>
					</button>
				{/if}

				<button
					type="button"
					onclick={() => (activeTab = 'account')}
					class="w-full flex items-center justify-between p-3 rounded-xl text-left text-xs transition cursor-pointer {activeTab === 'account'
						? 'bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-bold shadow-md'
						: 'text-neutral-400 hover:text-white hover:bg-neutral-800/60 border border-transparent font-medium'}"
				>
					<div class="flex items-center gap-3">
						<div class="w-7 h-7 rounded-lg flex items-center justify-center {activeTab === 'account' ? 'bg-emerald-500 text-neutral-950' : 'bg-neutral-800 text-neutral-400'}">
							<User class="w-4 h-4" />
						</div>
						<div>
							<div class="text-xs font-semibold {activeTab === 'account' ? 'text-white' : 'text-neutral-200'}">Account</div>
							<div class="text-[10px] text-neutral-500">Profile & password</div>
						</div>
					</div>
				</button>

				<button
					type="button"
					onclick={() => (activeTab = 'subsonic')}
					class="w-full flex items-center justify-between p-3 rounded-xl text-left text-xs transition cursor-pointer {activeTab === 'subsonic'
						? 'bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-bold shadow-md'
						: 'text-neutral-400 hover:text-white hover:bg-neutral-800/60 border border-transparent font-medium'}"
				>
					<div class="flex items-center gap-3">
						<div class="w-7 h-7 rounded-lg flex items-center justify-center {activeTab === 'subsonic' ? 'bg-emerald-500 text-neutral-950' : 'bg-neutral-800 text-neutral-400'}">
							<Radio class="w-4 h-4" />
						</div>
						<div>
							<div class="text-xs font-semibold {activeTab === 'subsonic' ? 'text-white' : 'text-neutral-200'}">Subsonic API</div>
							<div class="text-[10px] text-neutral-500">Mobile & desktop apps</div>
						</div>
					</div>
				</button>

				<button
					type="button"
					onclick={() => (activeTab = 'system')}
					class="w-full flex items-center justify-between p-3 rounded-xl text-left text-xs transition cursor-pointer {activeTab === 'system'
						? 'bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-bold shadow-md'
						: 'text-neutral-400 hover:text-white hover:bg-neutral-800/60 border border-transparent font-medium'}"
				>
					<div class="flex items-center gap-3">
						<div class="w-7 h-7 rounded-lg flex items-center justify-center {activeTab === 'system' ? 'bg-emerald-500 text-neutral-950' : 'bg-neutral-800 text-neutral-400'}">
							<HardDrive class="w-4 h-4" />
						</div>
						<div>
							<div class="text-xs font-semibold {activeTab === 'system' ? 'text-white' : 'text-neutral-200'}">System</div>
							<div class="text-[10px] text-neutral-500">Version & storage paths</div>
						</div>
					</div>
				</button>
			</div>
		</div>

		<!-- Right Detail View: Full Settings of Selected Tab -->
		<div class="flex-1 min-w-0 w-full space-y-6">
			<!-- TAB 1: USERS (DEFAULT FOR ADMINS) -->
			{#if activeTab === 'users' && data.account?.role === 'admin'}
				<div class="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6 sm:p-8 backdrop-blur-xl shadow-xl">
					<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-neutral-800/80 pb-5 mb-6">
						<div class="flex items-center gap-3">
							<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-950/80 border border-purple-600/40 text-purple-400">
								<Users class="h-5 w-5" />
							</div>
							<div>
								<div class="flex items-center gap-2">
									<h2 class="text-base font-bold text-white">User Accounts</h2>
									<span class="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-semibold text-neutral-400">
										{usersList.length} total
									</span>
								</div>
								<p class="text-xs text-neutral-400">Manage user logins, roles, and Subsonic streaming privileges</p>
							</div>
						</div>

						<div class="flex flex-wrap items-center gap-2">
							{#if data.registrationDisabled}
								<span
									class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-amber-950/60 border border-amber-600/40 text-amber-300"
									title="DISABLE_REGISTRATION=true: Users cannot register on their own"
								>
									<ShieldAlert class="h-3 w-3" /> Registration Disabled
								</span>
							{:else}
								<span
									class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-950/60 border border-emerald-600/40 text-emerald-300"
									title="Public registration is enabled via /register"
								>
									<CheckCircle2 class="h-3 w-3" /> Public Registration Active
								</span>
							{/if}

							<button
								type="button"
								onclick={() => { showAddUserModal = true; addUserError = null; }}
								class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-950 transition cursor-pointer"
							>
								<UserPlus class="h-3.5 w-3.5" />
								<span>Add User</span>
							</button>
						</div>
					</div>

					<!-- Users List -->
					<div class="space-y-3">
						{#each usersList as u (u.id)}
							<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3.5 sm:p-4 rounded-2xl border border-neutral-800/80 bg-neutral-950/50 hover:bg-neutral-950/80 transition gap-3">
								<div class="flex items-center gap-3">
									<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-bold text-xs uppercase {u.role === 'admin' ? 'bg-emerald-950 text-emerald-300 border border-emerald-600/40' : 'bg-neutral-800 text-neutral-300 border border-neutral-700'}">
										{u.username.slice(0, 2)}
									</div>
									<div>
										<div class="flex items-center gap-2">
											<span class="text-sm font-semibold text-neutral-100">{u.username}</span>
											<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider {u.role === 'admin' ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-600/40' : 'bg-neutral-800 text-neutral-400 border border-neutral-700'}">
												{u.role}
											</span>
											{#if u.id === data.account?.id}
												<span class="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-neutral-800 text-neutral-400">
													You
												</span>
											{/if}
										</div>
										<div class="flex items-center gap-3 mt-0.5 text-[11px] text-neutral-500">
											<span class="flex items-center gap-1">
												<Music class="h-3 w-3" />
												{u.playlist_count || 0} playlists
											</span>
											<span>•</span>
											<span class="flex items-center gap-1">
												<Heart class="h-3 w-3" />
												{u.starred_count || 0} starred
											</span>
											{#if u.created_at}
												<span class="hidden sm:inline">•</span>
												<span class="hidden sm:inline">Joined {new Date(u.created_at).toLocaleDateString()}</span>
											{/if}
										</div>
									</div>
								</div>

								<!-- User Actions -->
								<div class="flex items-center gap-2 self-end sm:self-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-neutral-800/60 w-full sm:w-auto justify-end">
									{#if u.id !== data.account?.id}
										<button
											type="button"
											onclick={() => handleToggleRole(u)}
											class="px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-[11px] font-medium text-neutral-300 transition cursor-pointer"
											title="Toggle administrator privileges"
										>
											Make {u.role === 'admin' ? 'User' : 'Admin'}
										</button>
										<button
											type="button"
											onclick={() => openResetPasswordModal(u)}
											class="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition cursor-pointer"
											title="Reset Password"
										>
											<KeyRound class="h-3.5 w-3.5" />
										</button>
										<button
											type="button"
											onclick={() => handleDeleteUser(u)}
											class="p-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900 border border-rose-800/50 text-rose-300 hover:text-white transition cursor-pointer"
											title="Delete User"
										>
											<Trash2 class="h-3.5 w-3.5" />
										</button>
									{:else}
										<span class="text-[11px] text-neutral-500 italic pr-2">Current Session</span>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</div>

			<!-- TAB 2: ACCOUNT & SECURITY -->
			{:else if activeTab === 'account'}
				<div class="space-y-6">
					<!-- Account Profile Card -->
					<div class="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6 sm:p-8 backdrop-blur-xl shadow-xl">
						<div class="flex items-center gap-3 border-b border-neutral-800/80 pb-5 mb-6">
							<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-800 border border-neutral-700 text-emerald-400">
								<User class="h-5 w-5" />
							</div>
							<div>
								<h2 class="text-base font-bold text-white">Account Profile</h2>
								<p class="text-xs text-neutral-400">Current login details & active sessions</p>
							</div>
						</div>

						<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
							<div class="p-3.5 rounded-2xl bg-neutral-950/60 border border-neutral-800/70">
								<span class="text-[11px] font-medium text-neutral-500 uppercase tracking-wider block mb-1">Username</span>
								<div class="flex items-center gap-2">
									<span class="font-bold text-neutral-100 text-sm">{data.account?.username || 'admin'}</span>
									<span class="rounded-md bg-emerald-950/80 border border-emerald-600/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
										{data.account?.role || 'admin'}
									</span>
								</div>
							</div>

							<div class="p-3.5 rounded-2xl bg-neutral-950/60 border border-neutral-800/70">
								<span class="text-[11px] font-medium text-neutral-500 uppercase tracking-wider block mb-1">Status</span>
								<div class="flex items-center gap-1.5 text-emerald-400">
									<ShieldCheck class="h-4 w-4" />
									<span class="font-medium text-neutral-200">
										{data.authDisabled ? 'Auth Bypassed' : 'Session Active'}
									</span>
								</div>
							</div>

							<div class="p-3.5 rounded-2xl bg-neutral-950/60 border border-neutral-800/70">
								<span class="text-[11px] font-medium text-neutral-500 uppercase tracking-wider block mb-1">Active Sessions</span>
								<span class="font-medium text-neutral-200">
									{data.activeSessionsCount} active login session{data.activeSessionsCount === 1 ? '' : 's'}
								</span>
							</div>

							{#if data.account?.created_at}
								<div class="p-3.5 rounded-2xl bg-neutral-950/60 border border-neutral-800/70">
									<span class="text-[11px] font-medium text-neutral-500 uppercase tracking-wider block mb-1">Member Since</span>
									<span class="font-medium text-neutral-300">
										{new Date(data.account.created_at).toLocaleDateString()}
									</span>
								</div>
							{/if}
						</div>
					</div>

					<!-- Change Password Card -->
					<div class="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6 sm:p-8 backdrop-blur-xl shadow-xl">
						<div class="flex items-center gap-3 border-b border-neutral-800/80 pb-5 mb-6">
							<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-950/80 border border-emerald-600/40 text-emerald-400">
								<KeyRound class="h-5 w-5" />
							</div>
							<div>
								<h2 class="text-base font-bold text-white">Change Account Password</h2>
								<p class="text-xs text-neutral-400">Update your credentials with a new secure password</p>
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

			<!-- TAB 3: SUBSONIC & STREAMING -->
			{:else if activeTab === 'subsonic'}
				<div class="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6 sm:p-8 backdrop-blur-xl shadow-xl space-y-6">
					<div class="flex items-center gap-3 border-b border-neutral-800/80 pb-5">
						<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-950/80 border border-purple-500/40 text-purple-400">
							<Radio class="h-5 w-5" />
						</div>
						<div>
							<h2 class="text-base font-bold text-white">Subsonic &amp; OpenSubsonic Streaming</h2>
							<p class="text-xs text-neutral-400">Connect Symfonium, Feishin, DSub, and third-party mobile &amp; desktop clients</p>
						</div>
					</div>

					<!-- Server Connection URL -->
					<div class="space-y-2">
						<div class="flex items-center justify-between">
							<span class="text-xs font-semibold text-neutral-300">Server Connection URL</span>
							<span class="text-[11px] text-emerald-400 font-medium">Standard Base URL</span>
						</div>
						<div class="flex items-center justify-between gap-2 font-mono text-xs sm:text-sm text-neutral-200 bg-neutral-950 p-3 rounded-2xl border border-neutral-800">
							<span class="truncate select-all">{data.serverBaseUrl}</span>
							<button
								type="button"
								onclick={copyServerUrl}
								class="px-3 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xs font-semibold text-neutral-200 hover:text-white transition cursor-pointer flex items-center gap-1.5 shrink-0"
								title="Copy Server URL"
							>
								{#if copiedServerUrl}
									<Check class="h-3.5 w-3.5 text-emerald-400" />
									<span class="text-emerald-400">Copied</span>
								{:else}
									<Copy class="h-3.5 w-3.5" />
									<span>Copy</span>
								{/if}
							</button>
						</div>
						<p class="text-[11px] text-neutral-400 leading-relaxed">
							Enter this exact URL in Symfonium, Feishin, DSub, or other Subsonic clients. Clients automatically communicate with the streaming API without having to append <code class="text-neutral-300">/rest</code>.
						</p>
					</div>

					<!-- Credentials Notice -->
					<div class="p-4 rounded-2xl bg-neutral-950/80 border border-neutral-800 space-y-2">
						<div class="flex items-center gap-2 text-xs font-semibold text-white">
							<ShieldCheck class="w-4 h-4 text-emerald-400" />
							<span>Standard Account Credentials</span>
						</div>
						<p class="text-[11px] text-neutral-400 leading-relaxed">
							Log into your Subsonic client using your standard Trax Vault username (<strong class="text-neutral-200">{data.account?.username}</strong>) and your account password. There is no separate password or setup needed.
						</p>
					</div>

					<!-- Streaming Capabilities Grid -->
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
						<div class="p-3 rounded-xl bg-neutral-950/50 border border-neutral-800/70 text-xs">
							<div class="font-semibold text-neutral-200 flex items-center gap-2">
								<Music class="w-3.5 h-3.5 text-emerald-400" />
								<span>Lossless Audio Streaming</span>
							</div>
							<p class="text-[11px] text-neutral-400 mt-1">FLAC, ALAC, WAV, and MP3 streaming with HTTP 206 byte-seeking</p>
						</div>

						<div class="p-3 rounded-xl bg-neutral-950/50 border border-neutral-800/70 text-xs">
							<div class="font-semibold text-neutral-200 flex items-center gap-2">
								<Radio class="w-3.5 h-3.5 text-purple-400" />
								<span>Karaoke Synced Lyrics</span>
							</div>
							<p class="text-[11px] text-neutral-400 mt-1">Millisecond-timed structured lyrics via OpenSubsonic <code class="text-neutral-300">getLyricsBySongId</code></p>
						</div>

						<div class="p-3 rounded-xl bg-neutral-950/50 border border-neutral-800/70 text-xs">
							<div class="font-semibold text-neutral-200 flex items-center gap-2">
								<Heart class="w-3.5 h-3.5 text-rose-400" />
								<span>Playlists &amp; Favorites</span>
							</div>
							<p class="text-[11px] text-neutral-400 mt-1">Full 2-way playlist sync and track/album starring</p>
						</div>

						<div class="p-3 rounded-xl bg-neutral-950/50 border border-neutral-800/70 text-xs">
							<div class="font-semibold text-neutral-200 flex items-center gap-2">
								<User class="w-3.5 h-3.5 text-cyan-400" />
								<span>Artist Metadata &amp; Artwork</span>
							</div>
							<p class="text-[11px] text-neutral-400 mt-1">Cached Cover Art Archive covers and artist photography</p>
						</div>
					</div>

					<!-- Symfonium & Client Sync Guidance Collapsible -->
					<div class="pt-2 border-t border-neutral-800/60">
						<button
							type="button"
							onclick={() => (showSubsonicCacheTips = !showSubsonicCacheTips)}
							class="w-full flex items-center justify-between text-left text-neutral-300 hover:text-white transition py-2 cursor-pointer group"
						>
							<span class="flex items-center gap-2 font-semibold text-xs text-purple-400 group-hover:text-purple-300">
								<Smartphone class="h-4 w-4" />
								Symfonium Sync &amp; Offline Cache Tips
							</span>
							<ChevronDown class="h-4 w-4 text-neutral-500 transition-transform duration-200 {showSubsonicCacheTips ? 'rotate-180' : ''}" />
						</button>

						{#if showSubsonicCacheTips}
							<div class="mt-2 rounded-2xl bg-neutral-950/90 border border-neutral-800 p-4 space-y-3 text-xs text-neutral-400 animate-in fade-in duration-150">
								<div>
									<p class="font-semibold text-neutral-200 mb-1">🎵 Updating Synced Lyrics (.lrc) &amp; Tags</p>
									<p class="leading-relaxed text-[11px]">
										Symfonium caches lyrics in its <span class="text-neutral-200">Media Info Cache</span>. For streaming tracks, go to 
										<span class="text-purple-300 font-semibold">Settings → Advanced → Clear media info cache</span>, then tap <span class="text-purple-300 font-semibold">Sync</span> to immediately fetch fresh lyrics from Trax Vault.
									</p>
								</div>

								<div class="pt-2.5 border-t border-neutral-800/60">
									<p class="font-semibold text-neutral-200 mb-1">💾 Refreshing Offline Downloaded Songs</p>
									<p class="leading-relaxed text-[11px]">
										Subsonic mobile players do not overwrite downloaded audio files automatically to prevent unexpected mobile data use. To refresh an offline song:
									</p>
									<ul class="list-disc list-inside mt-1.5 space-y-1 text-neutral-400 text-[11px]">
										<li>Tap the 3-dot menu on the song or album → <span class="text-neutral-200">Remove from cache</span></li>
										<li>Tap 3-dot menu → <span class="text-neutral-200">Download</span> to re-download the updated audio &amp; lyrics</li>
										<li>Or configure <span class="text-purple-300 font-semibold">Settings → Offline and cache → Automatic offline cache</span> for auto-maintenance on sync.</li>
									</ul>
								</div>

								<div class="pt-2 border-t border-neutral-800/60 text-[10px] text-neutral-500">
									💡 Trax Vault automatically supplies <code class="text-neutral-400">ETag</code>, <code class="text-neutral-400">Last-Modified</code>, and updates <code class="text-neutral-400">lastScan</code> whenever you edit tags or lyrics so Symfonium and Feishin always know when library items change.
								</div>
							</div>
						{/if}
					</div>
				</div>

			<!-- TAB 4: SYSTEM INFORMATION -->
			{:else if activeTab === 'system'}
				<div class="rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6 sm:p-8 backdrop-blur-xl shadow-xl space-y-5">
					<div class="flex items-center gap-3 border-b border-neutral-800/80 pb-5">
						<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-800 border border-neutral-700 text-emerald-400">
							<HardDrive class="h-5 w-5" />
						</div>
						<div>
							<h2 class="text-base font-bold text-white">System Information</h2>
							<p class="text-xs text-neutral-400">Vault environment, versions, and filesystem storage paths</p>
						</div>
					</div>

					<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
						<div class="p-3.5 rounded-2xl bg-neutral-950/60 border border-neutral-800/70 space-y-1">
							<span class="text-[11px] font-medium text-neutral-500 uppercase tracking-wider block">Application Version</span>
							<div class="flex items-center gap-2 font-mono">
								<span class="rounded-md bg-emerald-950/80 border border-emerald-600/40 px-2 py-0.5 text-xs font-bold text-emerald-300">
									v{data.versionInfo.appVersion}
								</span>
								<span class="text-[11px] text-neutral-400">schema {data.versionInfo.schemaVersion}</span>
							</div>
						</div>

						<div class="p-3.5 rounded-2xl bg-neutral-950/60 border border-neutral-800/70 space-y-1">
							<span class="text-[11px] font-medium text-neutral-500 uppercase tracking-wider block">Environment</span>
							<span class="font-mono text-neutral-200 uppercase text-xs">{data.env.nodeEnv}</span>
						</div>

						<div class="sm:col-span-2 p-3.5 rounded-2xl bg-neutral-950/60 border border-neutral-800/70 space-y-1">
							<span class="text-[11px] font-medium text-neutral-500 uppercase tracking-wider block">Database Storage</span>
							<div class="flex items-center gap-2 font-mono text-xs text-neutral-300 break-all">
								<Layers class="h-4 w-4 shrink-0 text-emerald-400" />
								<span>{data.env.dataDir}/traxvault.db</span>
							</div>
						</div>

						<div class="sm:col-span-2 p-3.5 rounded-2xl bg-neutral-950/60 border border-neutral-800/70 space-y-1">
							<span class="text-[11px] font-medium text-neutral-500 uppercase tracking-wider block">Music Library Folder</span>
							<div class="flex items-center gap-2 font-mono text-xs text-neutral-300 break-all">
								<Folder class="h-4 w-4 shrink-0 text-emerald-400" />
								<span>{data.env.musicDir}</span>
							</div>
						</div>

						{#if data.versionInfo.metadata.migrated_from}
							<div class="sm:col-span-2 p-3.5 rounded-2xl bg-neutral-950/60 border border-neutral-800/70 space-y-1">
								<span class="text-[11px] font-medium text-neutral-500 uppercase tracking-wider block">Migration Bridge</span>
								<span class="font-mono text-emerald-400 text-xs">Upgraded from v{data.versionInfo.metadata.migrated_from}</span>
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- Add User Modal -->
	{#if showAddUserModal}
		<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
			<div class="w-full max-w-md rounded-3xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
				<div class="flex items-center justify-between border-b border-neutral-800 pb-4">
					<div class="flex items-center gap-2.5">
						<div class="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-950 border border-emerald-600/40 text-emerald-400">
							<UserPlus class="h-5 w-5" />
						</div>
						<h3 class="text-base font-bold text-white">Create User Account</h3>
					</div>
					<button
						type="button"
						onclick={() => (showAddUserModal = false)}
						class="rounded-lg p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 transition cursor-pointer"
					>
						<X class="h-5 w-5" />
					</button>
				</div>

				{#if addUserError}
					<div class="rounded-xl border border-rose-800/80 bg-rose-950/60 p-3 text-xs text-rose-300 flex items-center gap-2">
						<AlertCircle class="h-4 w-4 shrink-0 text-rose-400" />
						<span>{addUserError}</span>
					</div>
				{/if}

				<form onsubmit={handleAddUser} class="space-y-4">
					<div>
						<label for="modalUsername" class="block text-xs font-semibold text-neutral-300 mb-1">
							Username *
						</label>
						<input
							id="modalUsername"
							type="text"
							required
							minlength="3"
							maxlength="32"
							bind:value={newUsername}
							placeholder="e.g. listener42"
							class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 py-2 text-xs sm:text-sm text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
						/>
						<p class="mt-1 text-[11px] text-neutral-500">3-32 characters (letters, numbers, underscores, hyphens)</p>
					</div>

					<div>
						<label for="modalPassword" class="block text-xs font-semibold text-neutral-300 mb-1">
							Password *
						</label>
						<input
							id="modalPassword"
							type="password"
							required
							minlength="6"
							bind:value={newUserPassword}
							placeholder="Minimum 6 characters"
							class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 py-2 text-xs sm:text-sm text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
						/>
					</div>

					<div>
						<label for="modalRole" class="block text-xs font-semibold text-neutral-300 mb-1">
							Role &amp; Permissions
						</label>
						<select
							id="modalRole"
							bind:value={newUserRole}
							class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs sm:text-sm text-neutral-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
						>
							<option value="user">User (Standard streaming &amp; personal playlists)</option>
							<option value="admin">Administrator (Full settings &amp; tagging management)</option>
						</select>
					</div>

					<div class="flex items-center justify-end gap-2.5 pt-3 border-t border-neutral-800">
						<button
							type="button"
							onclick={() => (showAddUserModal = false)}
							class="rounded-xl px-4 py-2 text-xs font-medium text-neutral-400 hover:text-white hover:bg-neutral-800 transition cursor-pointer"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={isAddingUser || newUsername.trim().length < 3 || newUserPassword.length < 6}
							class="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-emerald-950 hover:bg-emerald-500 disabled:opacity-50 transition cursor-pointer"
						>
							{#if isAddingUser}
								<div class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
								<span>Creating...</span>
							{:else}
								<UserPlus class="h-3.5 w-3.5" />
								<span>Create User</span>
							{/if}
						</button>
					</div>
				</form>
			</div>
		</div>
	{/if}

	<!-- Admin Reset Password Modal -->
	{#if showResetPwModal && resetTargetUser}
		<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
			<div class="w-full max-w-md rounded-3xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
				<div class="flex items-center justify-between border-b border-neutral-800 pb-4">
					<div class="flex items-center gap-2.5">
						<div class="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-950 border border-purple-600/40 text-purple-400">
							<KeyRound class="h-5 w-5" />
						</div>
						<div>
							<h3 class="text-base font-bold text-white">Reset User Password</h3>
							<p class="text-xs text-neutral-400">For account: <strong class="text-neutral-200">{resetTargetUser.username}</strong></p>
						</div>
					</div>
					<button
						type="button"
						onclick={() => (showResetPwModal = false)}
						class="rounded-lg p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 transition cursor-pointer"
					>
						<X class="h-5 w-5" />
					</button>
				</div>

				{#if resetPwError}
					<div class="rounded-xl border border-rose-800/80 bg-rose-950/60 p-3 text-xs text-rose-300 flex items-center gap-2">
						<AlertCircle class="h-4 w-4 shrink-0 text-rose-400" />
						<span>{resetPwError}</span>
					</div>
				{/if}

				{#if resetPwSuccess}
					<div class="rounded-xl border border-emerald-600/40 bg-emerald-950/60 p-3 text-xs text-emerald-300 flex items-center gap-2">
						<CheckCircle2 class="h-4 w-4 shrink-0 text-emerald-400" />
						<span>{resetPwSuccess}</span>
					</div>
				{/if}

				<form onsubmit={handleAdminResetPassword} class="space-y-4">
					<div>
						<label for="adminNewPw" class="block text-xs font-semibold text-neutral-300 mb-1">
							New Password * <span class="text-[11px] font-normal text-neutral-500">(minimum 6 characters)</span>
						</label>
						<input
							id="adminNewPw"
							type="password"
							required
							minlength="6"
							bind:value={adminResetNewPw}
							placeholder="Enter new password"
							class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 py-2 text-xs sm:text-sm text-neutral-100 placeholder-neutral-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
						/>
					</div>

					<div>
						<label for="adminConfirmPw" class="block text-xs font-semibold text-neutral-300 mb-1">
							Confirm New Password *
						</label>
						<input
							id="adminConfirmPw"
							type="password"
							required
							minlength="6"
							bind:value={adminResetConfirmPw}
							placeholder="Confirm new password"
							class="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3.5 py-2 text-xs sm:text-sm text-neutral-100 placeholder-neutral-500 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 {adminResetConfirmPw.length > 0 && adminResetNewPw !== adminResetConfirmPw ? 'border-rose-600' : ''}"
						/>
						{#if adminResetConfirmPw.length > 0 && adminResetNewPw !== adminResetConfirmPw}
							<p class="mt-1 text-[11px] text-rose-400">Passwords do not match</p>
						{/if}
					</div>

					<div class="flex items-center justify-end gap-2.5 pt-3 border-t border-neutral-800">
						<button
							type="button"
							onclick={() => (showResetPwModal = false)}
							class="rounded-xl px-4 py-2 text-xs font-medium text-neutral-400 hover:text-white hover:bg-neutral-800 transition cursor-pointer"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={isResettingPw || adminResetNewPw.length < 6 || adminResetNewPw !== adminResetConfirmPw}
							class="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-purple-950 hover:bg-purple-500 disabled:opacity-50 transition cursor-pointer"
						>
							{#if isResettingPw}
								<div class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
								<span>Saving...</span>
							{:else}
								<KeyRound class="h-3.5 w-3.5" />
								<span>Reset Password</span>
							{/if}
						</button>
					</div>
				</form>
			</div>
		</div>
	{/if}
</div>
