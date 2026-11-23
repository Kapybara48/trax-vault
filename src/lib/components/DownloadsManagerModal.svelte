<script lang="ts">
	import {
		X,
		Download,
		ArrowDownCircle,
		Pause,
		Play,
		Trash2,
		RefreshCw,
		AlertCircle,
		CheckCircle,
		Clock,
		HardDrive,
		Disc3,
		Music,
		ListMusic
	} from '@lucide/svelte';
	import { offlineStorage } from '$lib/services/offline.svelte.js';
	import { formatBytes } from '$lib/utils.js';
	import { confirmAction } from '$lib/services/dialog.svelte.js';

	interface Props {
		isOpen: boolean;
		onClose: () => void;
	}

	let { isOpen, onClose }: Props = $props();

	let activeTab = $state<'queue' | 'failed' | 'storage'>('queue');

	$effect(() => {
		if (isOpen) {
			offlineStorage.refreshStats().catch(() => {});
		}
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && isOpen) {
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/80 backdrop-blur-md animate-fade-in">
		<!-- Backdrop click to dismiss -->
		<div class="absolute inset-0" onclick={onClose} role="presentation"></div>

		<!-- Modal Container -->
		<div class="relative w-full max-w-2xl bg-neutral-900/95 border border-neutral-700/80 rounded-2xl sm:rounded-3xl shadow-2xl shadow-black/80 overflow-hidden flex flex-col max-h-[90vh] z-10">
			<!-- Header -->
			<div class="p-4 sm:p-5 border-b border-neutral-800 flex items-center justify-between shrink-0 bg-neutral-950/40">
				<div class="flex items-center gap-3">
					<div class="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
						{#if offlineStorage.isDownloading}
							<RefreshCw class="w-5 h-5 animate-spin text-emerald-400" />
						{:else}
							<ArrowDownCircle class="w-5 h-5 text-emerald-400" />
						{/if}
					</div>
					<div>
						<h2 class="text-base sm:text-lg font-bold text-white flex items-center gap-2">
							<span>Downloads Manager</span>
							{#if offlineStorage.queueSummary.isDownloading}
								<span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 animate-pulse">
									Active
								</span>
							{:else if offlineStorage.isPaused}
								<span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
									Paused
								</span>
							{/if}
						</h2>
						<p class="text-xs text-neutral-400">
							{#if offlineStorage.queueSummary.totalItems > 0}
								{offlineStorage.queueSummary.completedItems} of {offlineStorage.queueSummary.totalItems} songs downloaded ({offlineStorage.queueSummary.overallProgressPercent}%)
							{:else}
								{offlineStorage.downloadedTrackIds.size} songs saved offline ({formatBytes(offlineStorage.offlineStorageBytes)})
							{/if}
						</p>
					</div>
				</div>

				<button
					type="button"
					onclick={onClose}
					class="p-2 text-neutral-400 hover:text-white rounded-xl hover:bg-neutral-800 transition cursor-pointer"
					title="Close"
				>
					<X class="w-5 h-5" />
				</button>
			</div>

			<!-- Active Download Batch Progress Bar -->
			{#if offlineStorage.queueSummary.totalItems > 0}
				<div class="px-4 sm:px-5 py-3 bg-neutral-950/70 border-b border-neutral-800/80 shrink-0 space-y-2">
					<div class="flex items-center justify-between text-xs">
						<span class="text-neutral-300 font-medium truncate max-w-[70%]">
							{#if offlineStorage.activeItem}
								<span class="text-emerald-400 font-bold">Downloading:</span> "{offlineStorage.activeItem.track.title}"
								{#if offlineStorage.activeItem.album}
									<span class="text-neutral-400 font-normal">({offlineStorage.activeItem.album.title})</span>
								{/if}
							{:else if offlineStorage.isPaused}
								<span class="text-amber-400">Downloads paused</span>
							{:else}
								<span>Preparing next item...</span>
							{/if}
						</span>
						<span class="font-mono text-emerald-400 font-bold">
							{offlineStorage.queueSummary.overallProgressPercent}%
						</span>
					</div>

					<!-- Master Progress Bar -->
					<div class="w-full h-2 rounded-full bg-neutral-800 overflow-hidden">
						<div
							class="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300"
							style="width: {offlineStorage.queueSummary.overallProgressPercent}%"
						></div>
					</div>

					<!-- Queue Action Buttons -->
					<div class="flex items-center justify-between pt-1 text-xs">
						<div class="flex items-center gap-2">
							{#if offlineStorage.isPaused}
								<button
									type="button"
									onclick={() => offlineStorage.resumeQueue()}
									class="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 text-xs font-semibold flex items-center gap-1 cursor-pointer"
								>
									<Play class="w-3 h-3 fill-current" />
									<span>Resume</span>
								</button>
							{:else if offlineStorage.isDownloading}
								<button
									type="button"
									onclick={() => offlineStorage.pauseQueue()}
									class="px-2.5 py-1 rounded-lg bg-neutral-800 text-neutral-300 hover:text-white hover:bg-neutral-700 text-xs font-semibold flex items-center gap-1 cursor-pointer"
								>
									<Pause class="w-3 h-3" />
									<span>Pause</span>
								</button>
							{/if}

							{#if offlineStorage.downloadQueue.length > 0 || offlineStorage.activeItem}
								<button
									type="button"
									onclick={() => offlineStorage.cancelQueue()}
									class="px-2.5 py-1 rounded-lg bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 text-xs font-semibold flex items-center gap-1 cursor-pointer"
								>
									<X class="w-3 h-3" />
									<span>Cancel Remaining</span>
								</button>
							{/if}
						</div>

						<span class="text-[11px] text-neutral-400 font-mono">
							{offlineStorage.downloadQueue.length} in queue
						</span>
					</div>
				</div>
			{/if}

			<!-- Tab Navigation -->
			<div class="flex items-center border-b border-neutral-800 px-4 sm:px-5 shrink-0 bg-neutral-950/20 gap-4 text-xs font-semibold">
				<button
					type="button"
					onclick={() => (activeTab = 'queue')}
					class="py-3 border-b-2 transition flex items-center gap-1.5 cursor-pointer {activeTab === 'queue'
						? 'border-emerald-500 text-emerald-400'
						: 'border-transparent text-neutral-400 hover:text-neutral-200'}"
				>
					<Clock class="w-3.5 h-3.5" />
					<span>Queue ({offlineStorage.downloadQueue.length + (offlineStorage.activeItem ? 1 : 0)})</span>
				</button>

				{#if offlineStorage.failedItems.length > 0}
					<button
						type="button"
						onclick={() => (activeTab = 'failed')}
						class="py-3 border-b-2 transition flex items-center gap-1.5 cursor-pointer {activeTab === 'failed'
							? 'border-red-500 text-red-400'
							: 'border-transparent text-red-400/70 hover:text-red-300'}"
					>
						<AlertCircle class="w-3.5 h-3.5 text-red-400" />
						<span>Failed ({offlineStorage.failedItems.length})</span>
					</button>
				{/if}

				<button
					type="button"
					onclick={() => (activeTab = 'storage')}
					class="py-3 border-b-2 transition flex items-center gap-1.5 cursor-pointer {activeTab === 'storage'
						? 'border-emerald-500 text-emerald-400'
						: 'border-transparent text-neutral-400 hover:text-neutral-200'}"
				>
					<HardDrive class="w-3.5 h-3.5" />
					<span>Storage & Settings</span>
				</button>
			</div>

			<!-- Tab Content Body -->
			<div class="flex-1 overflow-y-auto p-4 sm:p-5 min-h-[220px] max-h-[50vh] space-y-3">
				{#if activeTab === 'queue'}
					<!-- Active Item Card -->
					{#if offlineStorage.activeItem}
						<div class="p-3 rounded-xl bg-neutral-950/80 border border-emerald-500/40 space-y-2">
							<div class="flex items-center justify-between text-xs">
								<span class="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
									<RefreshCw class="w-3 h-3 animate-spin" />
									<span>Now Downloading</span>
								</span>
								<span class="font-mono text-emerald-400 font-bold">
									{offlineStorage.queueSummary.activeTrackPercent}%
								</span>
							</div>

							<div class="flex items-center gap-3">
								<div class="w-10 h-10 rounded-lg bg-neutral-900 border border-neutral-800 overflow-hidden shrink-0 flex items-center justify-center">
									{#if offlineStorage.activeItem.album?.cover_url}
										<img src={offlineStorage.activeItem.album.cover_url} alt="Cover" class="w-full h-full object-cover" />
									{:else}
										<Music class="w-5 h-5 text-neutral-600" />
									{/if}
								</div>
								<div class="flex-1 min-w-0">
									<div class="text-xs font-bold text-white truncate">{offlineStorage.activeItem.track.title}</div>
									<div class="text-[11px] text-neutral-400 truncate mt-0.5">
										{offlineStorage.activeItem.track.artist || offlineStorage.activeItem.album?.artist || 'Unknown Artist'}
										{#if offlineStorage.activeItem.album}
											&bull; {offlineStorage.activeItem.album.title}
										{/if}
									</div>
								</div>
							</div>

							<!-- Track Progress Bar -->
							<div class="w-full h-1.5 rounded-full bg-neutral-800 overflow-hidden">
								<div
									class="h-full bg-emerald-400 transition-all duration-150"
									style="width: {offlineStorage.queueSummary.activeTrackPercent}%"
								></div>
							</div>
						</div>
					{/if}

					<!-- Queued Items List -->
					{#if offlineStorage.downloadQueue.length > 0}
						<div class="space-y-1.5">
							<div class="text-[11px] font-bold uppercase tracking-wider text-neutral-400 px-1">
								Upcoming in Queue ({offlineStorage.downloadQueue.length})
							</div>

							{#each offlineStorage.downloadQueue.slice(0, 50) as item, idx}
								<div class="flex items-center gap-2.5 p-2 rounded-xl bg-neutral-950/40 border border-neutral-800/60 text-xs">
									<span class="w-5 text-center text-neutral-500 font-mono text-[10px] shrink-0">
										#{idx + 1}
									</span>
									<div class="w-8 h-8 rounded-lg bg-neutral-900 border border-neutral-800 overflow-hidden shrink-0 flex items-center justify-center">
										{#if item.album?.cover_url}
											<img src={item.album.cover_url} alt="Cover" class="w-full h-full object-cover" />
										{:else}
											<Music class="w-4 h-4 text-neutral-600" />
										{/if}
									</div>
									<div class="flex-1 min-w-0">
										<div class="text-xs font-medium text-white truncate">{item.track.title}</div>
										<div class="text-[10px] text-neutral-400 truncate">
											{item.track.artist || item.album?.artist || 'Unknown'} &bull; {item.album?.title || 'Single'}
										</div>
									</div>
									<span class="text-[10px] text-neutral-500 font-mono shrink-0 uppercase px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-800">
										{item.quality}
									</span>
								</div>
							{/each}

							{#if offlineStorage.downloadQueue.length > 50}
								<div class="p-2 text-center text-xs text-neutral-500 font-mono">
									+ {offlineStorage.downloadQueue.length - 50} more tracks in queue
								</div>
							{/if}
						</div>
					{:else if !offlineStorage.activeItem}
						<div class="p-8 text-center text-xs text-neutral-500 space-y-2">
							<CheckCircle class="w-8 h-8 text-emerald-400/60 mx-auto" />
							<div class="font-semibold text-neutral-300">All downloads completed</div>
							<p class="text-[11px] text-neutral-500 max-w-sm mx-auto">
								Your queue is empty. Tap "Download" on any album, artist, or playlist to save music directly to this device.
							</p>
						</div>
					{/if}
				{:else if activeTab === 'failed'}
					<div class="space-y-3">
						<div class="flex items-center justify-between">
							<span class="text-xs text-red-400 font-semibold">
								{offlineStorage.failedItems.length} tracks could not be downloaded
							</span>
							<div class="flex items-center gap-2">
								<button
									type="button"
									onclick={() => offlineStorage.retryFailed()}
									class="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 text-xs font-semibold flex items-center gap-1 cursor-pointer"
								>
									<RefreshCw class="w-3 h-3" />
									<span>Retry All</span>
								</button>
								<button
									type="button"
									onclick={() => offlineStorage.clearFailed()}
									class="px-2.5 py-1 rounded-lg bg-neutral-800 text-neutral-400 hover:text-white text-xs font-semibold cursor-pointer"
								>
									Clear
								</button>
							</div>
						</div>

						<div class="space-y-1.5">
							{#each offlineStorage.failedItems as item}
								<div class="flex items-center justify-between p-2.5 rounded-xl bg-red-950/20 border border-red-500/30 text-xs">
									<div class="min-w-0 flex-1">
										<div class="text-xs font-bold text-white truncate">{item.track.title}</div>
										<div class="text-[10px] text-red-300 truncate mt-0.5">
											{item.error || 'Network error'}
										</div>
									</div>
									<span class="text-[10px] text-neutral-400 truncate max-w-[120px] text-right">
										{item.album?.title || 'Track'}
									</span>
								</div>
							{/each}
						</div>
					</div>
				{:else if activeTab === 'storage'}
					<div class="space-y-4 text-xs">
						<!-- Offline Stats Summary -->
						<div class="grid grid-cols-2 gap-3">
							<div class="p-3 rounded-xl bg-neutral-950/60 border border-neutral-800 space-y-1">
								<div class="text-[10px] uppercase font-bold text-neutral-500 tracking-wider">Offline Storage</div>
								<div class="text-base font-bold text-emerald-400 font-mono">
									{formatBytes(offlineStorage.offlineStorageBytes)}
								</div>
							</div>
							<div class="p-3 rounded-xl bg-neutral-950/60 border border-neutral-800 space-y-1">
								<div class="text-[10px] uppercase font-bold text-neutral-500 tracking-wider">Downloaded Songs</div>
								<div class="text-base font-bold text-white font-mono">
									{offlineStorage.downloadedTrackIds.size} tracks
								</div>
							</div>
						</div>

						<!-- Download Quality Selector -->
						<div class="p-3 rounded-xl bg-neutral-950/60 border border-neutral-800 space-y-2">
							<label class="block font-bold text-white text-xs">
								Default Download Audio Quality
							</label>
							<select
								value={offlineStorage.downloadQuality}
								onchange={(e) => offlineStorage.setDownloadQuality((e.target as HTMLSelectElement).value as any)}
								class="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
							>
								<option value="original">Original Master (FLAC / Lossless Bit-Perfect)</option>
								<option value="320">320 kbps MP3 (Ultra High Quality - Recommended for saving space)</option>
								<option value="192">192 kbps MP3 (Standard Fidelity - Compact)</option>
								<option value="128">128 kbps MP3 (Maximum Storage Conservation)</option>
							</select>
							<p class="text-[11px] text-neutral-500 leading-relaxed">
								Original stores raw lossless files. MP3 options transcode on-the-fly to conserve phone storage.
							</p>
						</div>

						<!-- Clear All Downloads Danger Zone -->
						{#if offlineStorage.downloadedTrackIds.size > 0}
							<div class="pt-2">
								<button
									type="button"
									onclick={async () => {
										const confirmed = await confirmAction({
											title: 'Delete All Offline Music',
											message: `Delete all ${offlineStorage.downloadedTrackIds.size} downloaded tracks (${formatBytes(offlineStorage.offlineStorageBytes)}) from this device?`,
											confirmText: 'Delete All'
										});
										if (confirmed) {
											await offlineStorage.clearAllOfflineMusic();
										}
									}}
									class="w-full py-2.5 px-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 font-semibold transition cursor-pointer flex items-center justify-center gap-1.5"
								>
									<Trash2 class="w-4 h-4" />
									<span>Clear All Offline Music ({formatBytes(offlineStorage.offlineStorageBytes)})</span>
								</button>
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="p-3 sm:p-4 border-t border-neutral-800/80 bg-neutral-950/40 flex items-center justify-between text-xs text-neutral-500 shrink-0">
				<span>Trax Vault Offline Storage v1</span>
				<button
					type="button"
					onclick={onClose}
					class="px-4 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-semibold transition cursor-pointer"
				>
					Close
				</button>
			</div>
		</div>
	</div>
{/if}
