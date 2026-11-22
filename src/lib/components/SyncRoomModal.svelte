<script lang="ts">
	import { player } from '$lib/services/player.svelte.js';
	import {
		X,
		Radio,
		Smartphone,
		Monitor,
		Volume2,
		VolumeX,
		Users,
		Copy,
		Check,
		Link2,
		LogOut,
		Plus,
		Play,
		Globe,
		Lock,
		Pencil,
		RefreshCw,
		Sparkles,
		Disc3,
		Mic,
		Speaker,
		Unlink,
		Headphones
	} from '@lucide/svelte';

	let isEditingDeviceName = $state(false);
	let deviceNameInput = $state('');

	let joinCodeInput = $state('');
	let joinError = $state<string | null>(null);
	let isJoiningRoom = $state(false);

	let newRoomName = $state('');
	let newRoomIsPublic = $state(true);
	let newRoomAllowGuestControl = $state(true);
	let isCreatingRoom = $state(false);
	let createRoomError = $state<string | null>(null);

	let copiedCode = $state(false);
	let copiedLink = $state(false);

	const syncedAudioCount = $derived(
		player.connectedDevices.filter((d) => !d.isStandalone && d.isAudioOutput).length
	);

	function startEditingDeviceName() {
		deviceNameInput = player.deviceName;
		isEditingDeviceName = true;
	}

	async function saveDeviceName(e: SubmitEvent) {
		e.preventDefault();
		if (deviceNameInput.trim()) {
			await player.updateDeviceName(deviceNameInput.trim());
		}
		isEditingDeviceName = false;
	}

	function extractRoomCode(raw: string): string {
		const trimmed = raw.trim();
		try {
			if (trimmed.includes('room=')) {
				const url = new URL(trimmed, window.location.origin);
				const param = url.searchParams.get('room');
				if (param) return param.trim().toUpperCase();
			}
		} catch {}
		return trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
	}

	async function handleJoinByCode(e?: SubmitEvent) {
		if (e) e.preventDefault();
		joinError = null;
		const code = extractRoomCode(joinCodeInput);
		if (!code) {
			joinError = 'Please enter a valid 6-character room code or invite link.';
			return;
		}
		isJoiningRoom = true;
		try {
			const res = await player.joinListeningRoom(code);
			if (!res.ok) {
				joinError = res.error || 'Could not join room.';
			} else {
				joinCodeInput = '';
			}
		} finally {
			isJoiningRoom = false;
		}
	}

	async function handleJoinPublicRoom(code: string | null) {
		if (!code) return;
		joinError = null;
		isJoiningRoom = true;
		try {
			const res = await player.joinListeningRoom(code);
			if (!res.ok) {
				joinError = res.error || 'Could not join room.';
			}
		} finally {
			isJoiningRoom = false;
		}
	}

	async function handleCreateRoom(e: SubmitEvent) {
		e.preventDefault();
		createRoomError = null;
		isCreatingRoom = true;
		try {
			const res = await player.createListeningRoom({
				roomName: newRoomName.trim(),
				isPublic: newRoomIsPublic,
				allowGuestControl: newRoomAllowGuestControl
			});
			if (!res.ok) {
				createRoomError = res.error || 'Failed to create listening room.';
			} else {
				newRoomName = '';
			}
		} finally {
			isCreatingRoom = false;
		}
	}

	async function copyRoomCode() {
		const code = player.activeRoom?.code;
		if (!code) return;
		try {
			await navigator.clipboard.writeText(code);
			copiedCode = true;
			setTimeout(() => (copiedCode = false), 2000);
		} catch {}
	}

	async function copyInviteLink() {
		const code = player.activeRoom?.code;
		if (!code || typeof window === 'undefined') return;
		const link = `${window.location.origin}/player?room=${encodeURIComponent(code)}`;
		try {
			await navigator.clipboard.writeText(link);
			copiedLink = true;
			setTimeout(() => (copiedLink = false), 2000);
		} catch {}
	}
</script>

{#if player.showSyncModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in duration-150"
		role="dialog"
		aria-modal="true"
		aria-label="Multi-Device Sync and Listen Together"
	>
		<div
			class="relative w-full max-w-2xl max-h-[90dvh] flex flex-col rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl overflow-hidden"
		>
			<!-- Modal Header -->
			<div
				class="flex items-center justify-between px-5 py-4 border-b border-neutral-800 bg-neutral-950/70 shrink-0"
			>
				<div class="flex items-center gap-3 min-w-0">
					<div
						class="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0 shadow-inner"
					>
						<Radio class="w-5 h-5 {player.syncConnected ? 'animate-pulse' : ''}" />
					</div>
					<div class="min-w-0">
						<div class="flex items-center gap-2">
							<h2 class="text-sm sm:text-base font-bold text-white truncate">
								Sync Devices &amp; Listen Together
							</h2>
							<span
								class="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border {player.syncConnected
									? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60'
									: 'bg-amber-950/80 text-amber-300 border-amber-700/60'}"
							>
								<span
									class="w-1.5 h-1.5 rounded-full {player.syncConnected
										? 'bg-emerald-400 animate-ping'
										: 'bg-amber-400'}"
								></span>
								{player.syncConnected ? 'Live Sync' : 'Reconnecting'}
							</span>
						</div>
						<p class="text-[11px] text-neutral-400 truncate mt-0.5">
							{#if player.activeRoom?.type === 'shared'}
								In Shared Room <strong class="text-emerald-300">{player.activeRoom.name}</strong> ({player.activeRoom.code}) &bull; {player.connectedDevices.length}
								{player.connectedDevices.length === 1 ? 'listener' : 'listeners'}
							{:else}
								Synced across your personal devices ({player.connectedDevices.length} connected)
							{/if}
						</p>
					</div>
				</div>

				<button
					type="button"
					onclick={() => player.closeSyncModal()}
					class="rounded-xl p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white transition cursor-pointer"
					title="Close"
				>
					<X class="w-5 h-5" />
				</button>
			</div>

			<!-- Autoplay Audio Unlock Prompt Banner (if browser blocked unprompted background audio) -->
			{#if player.audioUnlockRequired && player.localAudioEnabled}
				<div
					class="px-5 py-3 bg-emerald-950/80 border-b border-emerald-700/60 flex items-center justify-between gap-3 shrink-0"
				>
					<div class="flex items-center gap-2.5 text-xs text-emerald-200">
						<Volume2 class="w-4 h-4 text-emerald-400 shrink-0 animate-bounce" />
						<span>
							Your browser paused automatic audio playback. Click to start synchronized audio on
							this device!
						</span>
					</div>
					<button
						type="button"
						onclick={() => player.unlockAudioPlayback()}
						class="px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold text-xs transition cursor-pointer shrink-0 shadow-md"
					>
						Enable Audio Now
					</button>
				</div>
			{/if}

			<!-- Tab Navigation -->
			<div
				class="flex items-center gap-2 px-5 pt-3 pb-2.5 border-b border-neutral-800/80 bg-neutral-900/90 shrink-0"
			>
				<button
					type="button"
					onclick={() => (player.syncModalTab = 'devices')}
					class="px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-2 {player.syncModalTab ===
					'devices'
						? 'bg-emerald-500 text-neutral-950 shadow-sm'
						: 'bg-neutral-800/80 text-neutral-300 hover:text-white hover:bg-neutral-800'}"
				>
					<Monitor class="w-3.5 h-3.5" />
					<span>My Devices &amp; Audio Mode</span>
					<span
						class="px-1.5 py-0.2 rounded-full text-[10px] {player.syncModalTab === 'devices'
							? 'bg-neutral-950/20 text-neutral-950'
							: 'bg-neutral-700 text-neutral-300'}"
					>
						{player.connectedDevices.length}
					</span>
				</button>

				<button
					type="button"
					onclick={() => {
						player.syncModalTab = 'rooms';
						player.refreshPublicRooms();
					}}
					class="px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-2 {player.syncModalTab ===
					'rooms'
						? 'bg-emerald-500 text-neutral-950 shadow-sm'
						: 'bg-neutral-800/80 text-neutral-300 hover:text-white hover:bg-neutral-800'}"
				>
					<Users class="w-3.5 h-3.5" />
					<span>Listen Together (Cross-Account Rooms)</span>
					{#if player.activeRoom?.type === 'shared'}
						<span
							class="px-1.5 py-0.2 rounded-full text-[10px] font-mono {player.syncModalTab ===
							'rooms'
								? 'bg-neutral-950/20 text-neutral-950'
								: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'}"
						>
							{player.activeRoom.code}
						</span>
					{:else if player.publicRooms.length > 0}
						<span
							class="px-1.5 py-0.2 rounded-full text-[10px] {player.syncModalTab === 'rooms'
								? 'bg-neutral-950/20 text-neutral-950'
								: 'bg-emerald-500/20 text-emerald-300'}"
						>
							{player.publicRooms.length} live
						</span>
					{/if}
				</button>
			</div>

			<!-- Modal Body -->
			<div class="flex-1 overflow-y-auto p-5 space-y-5 min-h-0">
				{#if player.syncModalTab === 'devices'}
					<!-- SECTION 1: THIS DEVICE CONFIGURATION & AUDIO MODE -->
					<div class="p-4 rounded-2xl bg-neutral-950/80 border border-neutral-800 space-y-4">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<div class="flex items-center gap-2.5">
								<div
									class="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400"
								>
									{#if /Android|iPhone|iPad/i.test(player.deviceName)}
										<Smartphone class="w-4 h-4" />
									{:else}
										<Monitor class="w-4 h-4" />
									{/if}
								</div>
								<div>
									<div class="flex items-center gap-2">
										<span class="text-xs font-bold text-white">{player.deviceName}</span>
										<span
											class="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
										>
											This Device
										</span>
									</div>
									<p class="text-[11px] text-neutral-400 mt-0.5">
										Choose whether this device plays sound or acts as a live lyrics &amp; remote
										companion display
									</p>
								</div>
							</div>

							{#if !isEditingDeviceName}
								<button
									type="button"
									onclick={startEditingDeviceName}
									class="px-2.5 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-[11px] font-semibold text-neutral-300 hover:text-white flex items-center gap-1.5 transition cursor-pointer"
								>
									<Pencil class="w-3 h-3" />
									<span>Rename Device</span>
								</button>
							{/if}
						</div>

						{#if isEditingDeviceName}
							<form onsubmit={saveDeviceName} class="flex items-center gap-2 pt-1">
								<input
									type="text"
									bind:value={deviceNameInput}
									placeholder="e.g. Arch Linux Desktop, Living Room Tablet..."
									maxlength="50"
									class="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
								/>
								<button
									type="submit"
									class="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold text-xs transition cursor-pointer"
								>
									Save
								</button>
								<button
									type="button"
									onclick={() => (isEditingDeviceName = false)}
									class="px-2.5 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs transition cursor-pointer"
								>
									Cancel
								</button>
							</form>
						{/if}

						<!-- 4 Playback & Sync Mode Cards for This Device -->
						<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-1">
							<!-- Mode 1: Standalone (On Its Own) -->
							<button
								type="button"
								onclick={() => player.setStandaloneMode(true)}
								class="text-left p-3 rounded-xl border transition cursor-pointer flex flex-col justify-between gap-2 {player.standaloneMode
									? 'bg-amber-950/50 border-amber-500/60 ring-1 ring-amber-500/40 shadow-lg'
									: 'bg-neutral-900/80 border-neutral-800 hover:border-neutral-700'}"
							>
								<div class="flex items-center justify-between">
									<div
										class="w-7 h-7 rounded-lg flex items-center justify-center {player.standaloneMode
											? 'bg-amber-500 text-neutral-950'
											: 'bg-neutral-800 text-neutral-400'}"
									>
										<Headphones class="w-4 h-4" />
									</div>
									{#if player.standaloneMode}
										<span
											class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40"
										>
											Active
										</span>
									{/if}
								</div>
								<div>
									<div class="text-xs font-bold text-white">On Its Own (Solo)</div>
									<p class="text-[10px] text-neutral-400 leading-relaxed mt-0.5">
										Plays different songs independently on this device without affecting or syncing
										with other devices.
									</p>
								</div>
							</button>

							<!-- Mode 2: Companion / Lyrics Remote (Muted Here) -->
							<button
								type="button"
								onclick={() => player.setLocalAudioMode(false, false)}
								class="text-left p-3 rounded-xl border transition cursor-pointer flex flex-col justify-between gap-2 {!player.standaloneMode &&
								!player.localAudioEnabled
									? 'bg-cyan-950/50 border-cyan-500/60 ring-1 ring-cyan-500/40 shadow-lg'
									: 'bg-neutral-900/80 border-neutral-800 hover:border-neutral-700'}"
							>
								<div class="flex items-center justify-between">
									<div
										class="w-7 h-7 rounded-lg flex items-center justify-center {!player.standaloneMode &&
										!player.localAudioEnabled
											? 'bg-cyan-500 text-neutral-950'
											: 'bg-neutral-800 text-neutral-400'}"
									>
										<Mic class="w-4 h-4" />
									</div>
									{#if !player.standaloneMode && !player.localAudioEnabled}
										<span
											class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
										>
											Active
										</span>
									{/if}
								</div>
								<div>
									<div class="text-xs font-bold text-white">Companion &amp; Lyrics</div>
									<p class="text-[10px] text-neutral-400 leading-relaxed mt-0.5">
										Mutes audio here. Follows your synced device, scrolls live lyrics &amp; acts as
										remote.
									</p>
								</div>
							</button>

							<!-- Mode 3: Transfer Audio Here Only -->
							<button
								type="button"
								onclick={() => player.setLocalAudioMode(true, true)}
								class="text-left p-3 rounded-xl border transition cursor-pointer flex flex-col justify-between gap-2 {!player.standaloneMode &&
								player.localAudioEnabled &&
								syncedAudioCount === 1
									? 'bg-emerald-950/50 border-emerald-500/60 ring-1 ring-emerald-500/40 shadow-lg'
									: 'bg-neutral-900/80 border-neutral-800 hover:border-neutral-700'}"
							>
								<div class="flex items-center justify-between">
									<div
										class="w-7 h-7 rounded-lg flex items-center justify-center {!player.standaloneMode &&
										player.localAudioEnabled &&
										syncedAudioCount === 1
											? 'bg-emerald-500 text-neutral-950'
											: 'bg-neutral-800 text-neutral-400'}"
									>
										<Speaker class="w-4 h-4" />
									</div>
									{#if !player.standaloneMode && player.localAudioEnabled && syncedAudioCount === 1}
										<span
											class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
										>
											Active
										</span>
									{/if}
								</div>
								<div>
									<div class="text-xs font-bold text-white">Play Here Only</div>
									<p class="text-[10px] text-neutral-400 leading-relaxed mt-0.5">
										Synced group speaker. Switches your other synced devices into Companion mode.
									</p>
								</div>
							</button>

							<!-- Mode 4: Play Audio Here Too (Simultaneous Multi-Device) -->
							<button
								type="button"
								onclick={() => player.setLocalAudioMode(true, false)}
								class="text-left p-3 rounded-xl border transition cursor-pointer flex flex-col justify-between gap-2 {!player.standaloneMode &&
								player.localAudioEnabled &&
								syncedAudioCount > 1
									? 'bg-emerald-950/50 border-emerald-500/60 ring-1 ring-emerald-500/40 shadow-lg'
									: 'bg-neutral-900/80 border-neutral-800 hover:border-neutral-700'}"
							>
								<div class="flex items-center justify-between">
									<div
										class="w-7 h-7 rounded-lg flex items-center justify-center {!player.standaloneMode &&
										player.localAudioEnabled &&
										syncedAudioCount > 1
											? 'bg-emerald-500 text-neutral-950'
											: 'bg-neutral-800 text-neutral-400'}"
									>
										<Volume2 class="w-4 h-4" />
									</div>
									{#if !player.standaloneMode && player.localAudioEnabled && syncedAudioCount > 1}
										<span
											class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
										>
											Multi-Speaker
										</span>
									{/if}
								</div>
								<div>
									<div class="text-xs font-bold text-white">Play on Multiple</div>
									<p class="text-[10px] text-neutral-400 leading-relaxed mt-0.5">
										Plays synchronized audio on this device simultaneously alongside other synced
										speakers.
									</p>
								</div>
							</button>
						</div>
					</div>

					<!-- SECTION 2: ALL CONNECTED DEVICES IN SESSION -->
					<div class="space-y-2.5">
						<div class="flex items-center justify-between">
							<h3 class="text-xs font-bold uppercase tracking-wider text-neutral-400">
								Connected Devices ({player.connectedDevices.length})
							</h3>
						</div>

						<div class="space-y-2">
							{#each player.connectedDevices as dev (dev.deviceId)}
								{@const isSelf = dev.deviceId === player.deviceId}
								<div
									class="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl border transition {isSelf
										? 'bg-neutral-900/90 border-emerald-500/40'
										: 'bg-neutral-950/70 border-neutral-800'}"
								>
									<div class="flex items-center gap-3 min-w-0">
										<div
											class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border {dev.isStandalone
												? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
												: dev.isAudioOutput
													? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
													: 'bg-cyan-500/15 border-cyan-500/30 text-cyan-400'}"
										>
											{#if /Android|iPhone|iPad/i.test(dev.deviceName)}
												<Smartphone class="w-4 h-4" />
											{:else}
												<Monitor class="w-4 h-4" />
											{/if}
										</div>

										<div class="min-w-0">
											<div class="flex items-center gap-2 flex-wrap">
												<span class="text-xs font-bold text-white truncate">{dev.deviceName}</span>
												{#if isSelf}
													<span
														class="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
													>
														You
													</span>
												{/if}
												<span
													class="text-[10px] px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-300 border border-neutral-700"
												>
													@{dev.username}
												</span>
											</div>
											<div class="flex items-center gap-2 mt-0.5 text-[11px] flex-wrap">
												{#if dev.isStandalone}
													<span class="text-amber-400 flex items-center gap-1 font-medium">
														<Headphones class="w-3 h-3" />
														<span>On Its Own (Independent Playback)</span>
													</span>
													{#if dev.standaloneTrackTitle}
														<span class="text-neutral-400 truncate max-w-[220px]">
															&bull; Playing: <strong class="text-neutral-200">{dev.standaloneTrackTitle}</strong>
														</span>
													{/if}
												{:else if dev.isAudioOutput}
													<span class="text-emerald-400 flex items-center gap-1 font-medium">
														<Volume2 class="w-3 h-3" />
														<span>Synced &bull; Playing Audio</span>
													</span>
												{:else}
													<span class="text-cyan-400 flex items-center gap-1 font-medium">
														<Mic class="w-3 h-3" />
														<span>Synced &bull; Companion &amp; Lyrics Remote</span>
													</span>
												{/if}
											</div>
										</div>
									</div>

									<!-- Device Action Buttons -->
									<div class="flex items-center gap-1.5 flex-wrap shrink-0">
										{#if dev.isStandalone}
											{#if !isSelf}
												<button
													type="button"
													onclick={() => player.syncWithDevice(dev.deviceId, false)}
													class="px-2.5 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500 text-cyan-300 hover:text-neutral-950 border border-cyan-500/40 text-[11px] font-bold transition cursor-pointer"
													title="Sync your device with this device's current song in Companion & Lyrics mode"
												>
													Sync Lyrics With This
												</button>
												<button
													type="button"
													onclick={() => player.syncWithDevice(dev.deviceId, true)}
													class="px-2.5 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500 text-emerald-300 hover:text-neutral-950 border border-emerald-500/40 text-[11px] font-bold transition cursor-pointer"
													title="Sync and play this device's song together on both devices"
												>
													Listen Together
												</button>
											{/if}
											<button
												type="button"
												onclick={() => player.setStandaloneMode(false, dev.deviceId)}
												class="px-2.5 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 text-[11px] font-semibold transition cursor-pointer"
												title="Bring this device back into the synced group"
											>
												Join Sync Group
											</button>
										{:else}
											{#if !isSelf && player.standaloneMode}
												<button
													type="button"
													onclick={() => player.syncWithDevice(dev.deviceId, false)}
													class="px-2.5 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500 text-cyan-300 hover:text-neutral-950 border border-cyan-500/40 text-[11px] font-bold transition cursor-pointer"
													title="Sync your device with this device in Companion & Lyrics mode"
												>
													Sync Lyrics With This
												</button>
												<button
													type="button"
													onclick={() => player.syncWithDevice(dev.deviceId, true)}
													class="px-2.5 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500 text-emerald-300 hover:text-neutral-950 border border-emerald-500/40 text-[11px] font-bold transition cursor-pointer"
													title="Sync and play audio together with this device"
												>
													Sync Audio With This
												</button>
											{:else if !dev.isAudioOutput}
												<button
													type="button"
													onclick={() => player.setLocalAudioMode(true, true, dev.deviceId)}
													class="px-2.5 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500 text-emerald-300 hover:text-neutral-950 border border-emerald-500/40 text-[11px] font-bold transition cursor-pointer"
													title="Transfer exclusive speaker output to this device"
												>
													Transfer Here
												</button>
												<button
													type="button"
													onclick={() => player.setLocalAudioMode(true, false, dev.deviceId)}
													class="px-2.5 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white border border-neutral-700 text-[11px] font-semibold transition cursor-pointer"
													title="Also enable audio output on this device"
												>
													+ Audio
												</button>
											{:else}
												<button
													type="button"
													onclick={() => player.setLocalAudioMode(false, false, dev.deviceId)}
													class="px-2.5 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-cyan-300 border border-neutral-700 text-[11px] font-semibold transition cursor-pointer flex items-center gap-1"
													title="Mute audio on this device and use as Companion Display / Lyrics Remote"
												>
													<VolumeX class="w-3 h-3" />
													<span>Companion</span>
												</button>
											{/if}

											<button
												type="button"
												onclick={() => player.setStandaloneMode(true, dev.deviceId)}
												class="px-2.5 py-1.5 rounded-xl bg-neutral-800 hover:bg-amber-950/80 text-neutral-400 hover:text-amber-300 border border-neutral-700 hover:border-amber-700/60 text-[11px] font-semibold transition cursor-pointer flex items-center gap-1"
												title="Set this device to On Its Own (Solo) mode so it plays independently without syncing"
											>
												<Unlink class="w-3 h-3" />
												<span>On Its Own</span>
											</button>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					</div>
				{:else}
					<!-- TAB 2: LISTEN TOGETHER (CROSS-ACCOUNT SHARED ROOMS) -->
					{#if player.activeRoom?.type === 'shared'}
						<!-- CURRENTLY IN A SHARED ROOM -->
						<div
							class="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-emerald-950/50 via-neutral-950 to-neutral-950 border border-emerald-500/40 space-y-4 shadow-xl"
						>
							<div class="flex flex-wrap items-start justify-between gap-3">
								<div>
									<div class="flex items-center gap-2">
										<span
											class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
										>
											Active Jam Session
										</span>
										{#if player.activeRoom.isPublic}
											<span
												class="text-[10px] font-semibold text-neutral-300 flex items-center gap-1"
											>
												<Globe class="w-3 h-3 text-emerald-400" /> Public Lobby
											</span>
										{:else}
											<span
												class="text-[10px] font-semibold text-neutral-400 flex items-center gap-1"
											>
												<Lock class="w-3 h-3 text-amber-400" /> Private Code
											</span>
										{/if}
									</div>
									<h3 class="text-base sm:text-lg font-bold text-white mt-1">
										{player.activeRoom.name}
									</h3>
									<p class="text-xs text-neutral-400">
										Hosted by <strong class="text-neutral-200"
											>@{player.activeRoom.hostUsername}</strong
										>
										&bull; Everyone in this room hears the same music &amp; synced lyrics in real time.
									</p>
								</div>

								<button
									type="button"
									onclick={() => player.leaveListeningRoom()}
									class="px-3 py-1.5 rounded-xl bg-rose-950/80 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-700/60 text-xs font-bold transition cursor-pointer flex items-center gap-1.5"
								>
									<LogOut class="w-3.5 h-3.5" />
									<span>Leave Room</span>
								</button>
							</div>

							<!-- Shareable Room Code & Invite Link Bar -->
							<div
								class="p-3.5 rounded-xl bg-neutral-900/90 border border-neutral-800 flex flex-wrap items-center justify-between gap-3"
							>
								<div>
									<div class="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
										Room Invite Code
									</div>
									<div
										class="text-xl font-mono font-black tracking-widest text-emerald-400 select-all mt-0.5"
									>
										{player.activeRoom.code}
									</div>
								</div>

								<div class="flex items-center gap-2 flex-wrap">
									<button
										type="button"
										onclick={copyRoomCode}
										class="px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-xs font-bold text-white flex items-center gap-1.5 transition cursor-pointer"
									>
										{#if copiedCode}
											<Check class="w-3.5 h-3.5 text-emerald-400" />
											<span class="text-emerald-300">Copied Code!</span>
										{:else}
											<Copy class="w-3.5 h-3.5 text-neutral-400" />
											<span>Copy Code</span>
										{/if}
									</button>

									<button
										type="button"
										onclick={copyInviteLink}
										class="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-md"
									>
										{#if copiedLink}
											<Check class="w-3.5 h-3.5" />
											<span>Invite Link Copied!</span>
										{:else}
											<Link2 class="w-3.5 h-3.5" />
											<span>Copy Invite Link</span>
										{/if}
									</button>
								</div>
							</div>

							<!-- Room Permissions Controls -->
							<div
								class="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-neutral-800/80 text-xs"
							>
								<label class="flex items-center gap-2 cursor-pointer select-none text-neutral-300">
									<input
										type="checkbox"
										checked={player.activeRoom.isPublic}
										onchange={(e) =>
											player.updateRoomSettings({ isPublic: e.currentTarget.checked })}
										class="h-4 w-4 rounded border-neutral-700 bg-neutral-900 text-emerald-500 focus:ring-emerald-500"
									/>
									<span>Show room in Public Server Lobby</span>
								</label>

								<label class="flex items-center gap-2 cursor-pointer select-none text-neutral-300">
									<input
										type="checkbox"
										checked={player.activeRoom.allowGuestControl}
										onchange={(e) =>
											player.updateRoomSettings({ allowGuestControl: e.currentTarget.checked })}
										class="h-4 w-4 rounded border-neutral-700 bg-neutral-900 text-emerald-500 focus:ring-emerald-500"
									/>
									<span>Allow all participants to control playback &amp; queue</span>
								</label>
							</div>
						</div>

						<!-- Participants in Shared Room -->
						<div class="space-y-2">
							<h4 class="text-xs font-bold uppercase tracking-wider text-neutral-400">
								Listeners in This Room ({player.connectedDevices.length})
							</h4>
							<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
								{#each player.connectedDevices as member (member.deviceId)}
									<div
										class="p-3 rounded-xl bg-neutral-950/80 border border-neutral-800 flex items-center justify-between gap-2"
									>
										<div class="flex items-center gap-2.5 min-w-0">
											<div
												class="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-xs font-bold text-emerald-300 uppercase shrink-0"
											>
												{member.username.slice(0, 2)}
											</div>
											<div class="min-w-0">
												<div class="text-xs font-bold text-white truncate">
													@{member.username}
													{#if member.userId === player.activeRoom.hostUserId}
														<span
															class="ml-1 text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30"
														>
															Host
														</span>
													{/if}
												</div>
												<div class="text-[10px] text-neutral-400 truncate">
													{member.deviceName}
												</div>
											</div>
										</div>
										<span
											class="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 {member.isAudioOutput
												? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60'
												: 'bg-cyan-950 text-cyan-300 border border-cyan-700/60'}"
										>
											{member.isAudioOutput ? 'Listening' : 'Lyrics Only'}
										</span>
									</div>
								{/each}
							</div>
						</div>
					{:else}
						<!-- NOT IN A SHARED ROOM YET: JOIN OR CREATE -->

						<!-- 1. Join by Code or Invite Link -->
						<div class="p-4 rounded-2xl bg-neutral-950/80 border border-neutral-800 space-y-3">
							<label
								for="join-room-code-input"
								class="block text-xs font-bold uppercase tracking-wider text-emerald-400"
							>
								1. Join a Friend's Session by Code or Invite Link
							</label>
							{#if joinError}
								<div
									class="p-2.5 rounded-xl bg-rose-950/70 border border-rose-800 text-xs text-rose-300"
								>
									{joinError}
								</div>
							{/if}
							<form onsubmit={handleJoinByCode} class="flex items-center gap-2">
								<input
									id="join-room-code-input"
									type="text"
									bind:value={joinCodeInput}
									placeholder="Enter 6-digit code (e.g. VAULT7) or paste invite URL..."
									class="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 px-3.5 py-2 text-xs font-mono text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none uppercase"
								/>
								<button
									type="submit"
									disabled={!joinCodeInput.trim() || isJoiningRoom}
									class="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-neutral-950 font-bold text-xs transition cursor-pointer shrink-0"
								>
									{isJoiningRoom ? 'Joining...' : 'Join Session'}
								</button>
							</form>
						</div>

						<!-- 2. Active Public Rooms Lobby -->
						<div class="space-y-2.5">
							<div class="flex items-center justify-between">
								<span class="text-xs font-bold uppercase tracking-wider text-neutral-300">
									2. Active Public Sessions on Server ({player.publicRooms.length})
								</span>
								<button
									type="button"
									onclick={() => player.refreshPublicRooms()}
									class="text-[11px] text-neutral-400 hover:text-emerald-400 flex items-center gap-1 cursor-pointer"
								>
									<RefreshCw class="w-3 h-3" />
									<span>Refresh</span>
								</button>
							</div>

							{#if player.publicRooms.length > 0}
								<div class="grid grid-cols-1 gap-2">
									{#each player.publicRooms as pubRoom (pubRoom.id)}
										<div
											class="p-3 rounded-xl bg-neutral-950/90 border border-neutral-800 hover:border-emerald-500/40 flex items-center justify-between gap-3 transition"
										>
											<div class="flex items-center gap-3 min-w-0">
												<div
													class="w-11 h-11 rounded-xl bg-neutral-900 border border-neutral-800 overflow-hidden shrink-0 flex items-center justify-center"
												>
													{#if pubRoom.currentCoverUrl}
														<img
															src={pubRoom.currentCoverUrl}
															alt={pubRoom.name}
															class="w-full h-full object-cover"
														/>
													{:else}
														<Disc3 class="w-5 h-5 text-emerald-400" />
													{/if}
												</div>
												<div class="min-w-0">
													<div class="flex items-center gap-2">
														<span class="text-xs font-bold text-white truncate">{pubRoom.name}</span
														>
														<span
															class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-neutral-900 text-emerald-400 border border-neutral-800"
														>
															{pubRoom.code}
														</span>
													</div>
													<div class="text-[11px] text-neutral-400 truncate mt-0.5">
														{#if pubRoom.currentTrackTitle}
															<span class="text-emerald-300 font-medium"
																>{pubRoom.currentTrackTitle}</span
															>
															{#if pubRoom.currentTrackArtist}
																<span> &bull; {pubRoom.currentTrackArtist}</span>
															{/if}
														{:else}
															<span>Hosted by @{pubRoom.hostUsername}</span>
														{/if}
													</div>
													<div class="text-[10px] text-neutral-500 mt-0.5">
														Host: @{pubRoom.hostUsername} &bull; {pubRoom.listenerCount}
														{pubRoom.listenerCount === 1 ? 'listener' : 'listeners'}
													</div>
												</div>
											</div>

											<button
												type="button"
												onclick={() => handleJoinPublicRoom(pubRoom.code)}
												disabled={isJoiningRoom}
												class="px-3.5 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500 text-emerald-300 hover:text-neutral-950 border border-emerald-500/40 font-bold text-xs transition cursor-pointer shrink-0 flex items-center gap-1.5"
											>
												<Play class="w-3.5 h-3.5 fill-current" />
												<span>Join &amp; Listen</span>
											</button>
										</div>
									{/each}
								</div>
							{:else}
								<div
									class="p-5 rounded-2xl bg-neutral-950/50 border border-neutral-800/80 text-center text-xs text-neutral-500"
								>
									No public listening sessions are currently active. Start one below so other
									accounts can join you!
								</div>
							{/if}
						</div>

						<!-- 3. Create a New Shared Listening Room -->
						<form
							onsubmit={handleCreateRoom}
							class="p-4 rounded-2xl bg-neutral-950/80 border border-neutral-800 space-y-3.5"
						>
							<div class="flex items-center gap-2">
								<Sparkles class="w-4 h-4 text-emerald-400" />
								<span class="text-xs font-bold uppercase tracking-wider text-neutral-200">
									3. Start a New "Listen Together" Jam Session
								</span>
							</div>

							{#if createRoomError}
								<div
									class="p-2.5 rounded-xl bg-rose-950/70 border border-rose-800 text-xs text-rose-300"
								>
									{createRoomError}
								</div>
							{/if}

							<div>
								<label
									for="create-room-name"
									class="block text-xs font-semibold text-neutral-300 mb-1"
								>
									Session Name (Optional)
								</label>
								<input
									id="create-room-name"
									type="text"
									bind:value={newRoomName}
									placeholder="e.g. Late Night Hi-Res Listening, Hip-Hop Classics..."
									maxlength="60"
									class="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3.5 py-2 text-xs text-white placeholder-neutral-500 focus:border-emerald-500 focus:outline-none"
								/>
							</div>

							<div class="space-y-2 pt-1 text-xs">
								<label class="flex items-center gap-2.5 cursor-pointer select-none text-neutral-300">
									<input
										type="checkbox"
										bind:checked={newRoomIsPublic}
										class="h-4 w-4 rounded border-neutral-700 bg-neutral-900 text-emerald-500 focus:ring-emerald-500"
									/>
									<span>
										<strong>Public on Server Lobby</strong> — Let other accounts on Trax Vault see and
										join in 1 click
									</span>
								</label>

								<label class="flex items-center gap-2.5 cursor-pointer select-none text-neutral-300">
									<input
										type="checkbox"
										bind:checked={newRoomAllowGuestControl}
										class="h-4 w-4 rounded border-neutral-700 bg-neutral-900 text-emerald-500 focus:ring-emerald-500"
									/>
									<span>
										<strong>Collaborative Controls</strong> — Allow anyone in the session to play, pause,
										seek, or change tracks
									</span>
								</label>
							</div>

							<div class="pt-1 flex justify-end">
								<button
									type="submit"
									disabled={isCreatingRoom}
									class="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-neutral-950 font-bold text-xs transition cursor-pointer flex items-center gap-1.5 shadow-lg shadow-emerald-500/20"
								>
									<Plus class="w-4 h-4" />
									<span>{isCreatingRoom ? 'Starting Session...' : 'Start Shared Session'}</span>
								</button>
							</div>
						</form>
					{/if}
				{/if}
			</div>
		</div>
	</div>
{/if}
