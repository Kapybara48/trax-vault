<script lang="ts">
	import { tick } from 'svelte';
	import {
		X,
		Sparkles,
		Download,
		Square,
		CheckCircle2,
		AlertTriangle,
		Disc,
		Music,
		FileText,
		Check,
		RotateCw,
		Loader2,
		AlertCircle
	} from '@lucide/svelte';
	import { confirmAction } from '$lib/services/dialog.svelte.js';

	interface Props {
		isOpen: boolean;
		currentAlbumId?: number | null;
		currentAlbumTitle?: string | null;
		onClose: () => void;
		onComplete?: () => void;
	}

	let {
		isOpen = false,
		currentAlbumId = null,
		currentAlbumTitle = null,
		onClose,
		onComplete
	}: Props = $props();

	// Scope and Options
	let scope = $state<'album' | 'all'>('album');
	let onlySynced = $state(true);
	let saveToDisk = $state(true);

	// Status and Counts
	let isLoadingStatus = $state(false);
	let totalNeedingLyrics = $state(0);
	let albumNeedingLyrics = $state(0);
	let resolvedAlbumTitle = $state<string | null>(null);

	// Execution state
	let isRunning = $state(false);
	let isCompleted = $state(false);
	let abortController: AbortController | null = null;

	let currentTrackInfo = $state<{ title: string; artist: string } | null>(null);
	let progress = $state({ current: 0, total: 0, percent: 0 });

	let counters = $state({
		synced: 0,
		instrumental: 0,
		plain: 0,
		notFound: 0,
		error: 0
	});

	interface LogEntry {
		id: string;
		title: string;
		artist: string;
		status: 'synced' | 'instrumental' | 'plain' | 'not_found' | 'skipped' | 'error';
		message: string;
		time: string;
	}

	let logs = $state<LogEntry[]>([]);
	let logsContainerEl: HTMLDivElement | null = $state(null);

	// Fetch status whenever modal opens
	$effect(() => {
		if (isOpen) {
			if (currentAlbumId) {
				scope = 'album';
			} else {
				scope = 'all';
			}
			loadStatus();
		} else {
			if (isRunning) {
				stopDownload();
			}
			resetState();
		}
	});

	function resetState() {
		isRunning = false;
		isCompleted = false;
		currentTrackInfo = null;
		progress = { current: 0, total: 0, percent: 0 };
		counters = { synced: 0, instrumental: 0, plain: 0, notFound: 0, error: 0 };
		logs = [];
	}

	async function loadStatus() {
		isLoadingStatus = true;
		try {
			const res = await fetch(`/api/lyrics/batch-status?albumId=${currentAlbumId || ''}`);
			const data = await res.json();
			if (data.success) {
				totalNeedingLyrics = data.totalNeedingLyrics || 0;
				albumNeedingLyrics = data.albumNeedingLyrics || 0;
				resolvedAlbumTitle = data.albumTitle || currentAlbumTitle || null;

				// If current album has 0 needing lyrics but library has some, default to 'all'
				if (currentAlbumId && albumNeedingLyrics === 0 && totalNeedingLyrics > 0) {
					scope = 'all';
				}
			}
		} catch (err) {
			console.error('Failed to load batch lyrics status:', err);
		} finally {
			isLoadingStatus = false;
		}
	}

	async function scrollLogsToBottom() {
		await tick();
		if (logsContainerEl) {
			logsContainerEl.scrollTop = logsContainerEl.scrollHeight;
		}
	}

	async function startDownload() {
		resetState();
		isRunning = true;
		abortController = new AbortController();

		const targetAlbumId = scope === 'album' ? currentAlbumId : null;

		try {
			const res = await fetch('/api/lyrics/batch-download', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					albumId: targetAlbumId,
					onlySynced,
					saveToDisk
				}),
				signal: abortController.signal
			});

			if (!res.ok || !res.body) {
				throw new Error(`Failed to start batch download: HTTP ${res.status}`);
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder('utf-8');
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n\n');
				buffer = lines.pop() || '';

				for (const chunk of lines) {
					const trimmed = chunk.trim();
					if (!trimmed.startsWith('data:')) continue;
					const jsonStr = trimmed.replace(/^data:\s*/, '');
					try {
						const event = JSON.parse(jsonStr);

						if (event.type === 'start') {
							progress.total = event.total;
						} else if (event.type === 'progress') {
							progress.current = event.current;
							progress.total = event.total;
							progress.percent = event.total > 0 ? Math.round((event.current / event.total) * 100) : 0;
							currentTrackInfo = { title: event.title, artist: event.artist };

							if (event.status === 'synced') counters.synced++;
							else if (event.status === 'instrumental') counters.instrumental++;
							else if (event.status === 'plain') counters.plain++;
							else if (event.status === 'error') counters.error++;
							else counters.notFound++;

							const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
							logs = [
								...logs.slice(-100),
								{
									id: Math.random().toString(36).slice(2, 9),
									title: event.title,
									artist: event.artist,
									status: event.status,
									message: event.message,
									time
								}
							];
							scrollLogsToBottom();
						} else if (event.type === 'complete') {
							isCompleted = true;
							isRunning = false;
						}
					} catch {
						// Ignore JSON parse errors
					}
				}
			}
		} catch (err: any) {
			if (err.name !== 'AbortError') {
				logs = [
					...logs,
					{
						id: Math.random().toString(36).slice(2, 9),
						title: 'Batch Process',
						artist: '',
						status: 'error',
						message: `Batch download failed: ${err.message}`,
						time: new Date().toLocaleTimeString()
					}
				];
				scrollLogsToBottom();
			}
		} finally {
			isRunning = false;
			onComplete?.();
		}
	}

	function stopDownload() {
		if (abortController) {
			abortController.abort();
			abortController = null;
		}
		isRunning = false;
		logs = [
			...logs,
			{
				id: Math.random().toString(36).slice(2, 9),
				title: 'Download Stopped',
				artist: '',
				status: 'skipped',
				message: 'Batch lyrics download stopped by user',
				time: new Date().toLocaleTimeString()
			}
		];
		scrollLogsToBottom();
	}

	async function handleClose() {
		if (isRunning) {
			const confirmed = await confirmAction({
				title: 'Stop Batch Download',
				message: 'Batch lyrics download is in progress. Are you sure you want to stop and close?',
				confirmText: 'Stop & Close',
				danger: true
			});
			if (!confirmed) {
				return;
			}
			stopDownload();
		}
		onClose();
	}
</script>

{#if isOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
		<div class="relative w-full max-w-2xl overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-900/95 p-6 sm:p-7 shadow-2xl backdrop-blur-xl flex flex-col max-h-[90vh]">
			<!-- Modal Header -->
			<div class="flex items-start justify-between gap-4 border-b border-neutral-800/80 pb-4 shrink-0">
				<div class="flex items-center gap-3">
					<div class="p-2.5 rounded-2xl bg-teal-500/15 border border-teal-500/30 text-teal-400">
						<Sparkles class="h-6 w-6" />
					</div>
					<div>
						<h2 class="text-lg font-bold text-white flex items-center gap-2">
							Batch Synced Lyrics Downloader
							<span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-teal-950/80 text-teal-300 border border-teal-800/50">
								LRCLIB Auto-Sync
							</span>
						</h2>
						<p class="text-xs text-neutral-400 mt-0.5">
							Automatically download synchronized karaoke lyrics and companion <code class="text-teal-300 font-mono">.lrc</code> files
						</p>
					</div>
				</div>

				<button
					type="button"
					onclick={handleClose}
					class="p-2 rounded-xl text-neutral-400 hover:text-white hover:bg-neutral-800 transition cursor-pointer"
					title="Close"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<!-- Main Modal Body -->
			<div class="flex-1 overflow-y-auto py-5 space-y-5 min-h-0 pr-1">
				{#if !isRunning && !isCompleted}
					<!-- SCOPE SELECTION -->
					<div class="space-y-3">
						<label class="block text-xs font-bold uppercase tracking-wider text-neutral-400">
							Select Download Scope
						</label>

						<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
							<!-- Option 1: Current Album -->
							{#if currentAlbumId}
								<button
									type="button"
									onclick={() => (scope = 'album')}
									class="text-left p-4 rounded-2xl border transition cursor-pointer flex flex-col justify-between {scope === 'album' ? 'bg-teal-950/30 border-teal-500/60 ring-1 ring-teal-500/30 text-white' : 'bg-neutral-950/60 border-neutral-800 hover:border-neutral-700 text-neutral-300'}"
								>
									<div>
										<div class="flex items-center justify-between mb-1">
											<span class="text-xs font-bold flex items-center gap-1.5 text-teal-300">
												<Disc class="h-3.5 w-3.5" />
												Current Album
											</span>
											{#if scope === 'album'}
												<CheckCircle2 class="h-4 w-4 text-teal-400" />
											{/if}
										</div>
										<p class="text-sm font-semibold truncate text-white" title={resolvedAlbumTitle || 'Album'}>
											{resolvedAlbumTitle || 'Current Album'}
										</p>
									</div>
									<div class="mt-3 text-xs font-mono text-neutral-400 flex items-center gap-1">
										<span class="font-bold {albumNeedingLyrics > 0 ? 'text-amber-400' : 'text-neutral-500'}">
											{albumNeedingLyrics}
										</span>
										<span>songs without synced LRC</span>
									</div>
								</button>
							{/if}

							<!-- Option 2: Entire Library -->
							<button
								type="button"
								onclick={() => (scope = 'all')}
								class="text-left p-4 rounded-2xl border transition cursor-pointer flex flex-col justify-between {!currentAlbumId ? 'sm:col-span-2' : ''} {scope === 'all' ? 'bg-teal-950/30 border-teal-500/60 ring-1 ring-teal-500/30 text-white' : 'bg-neutral-950/60 border-neutral-800 hover:border-neutral-700 text-neutral-300'}"
							>
								<div>
									<div class="flex items-center justify-between mb-1">
										<span class="text-xs font-bold flex items-center gap-1.5 text-teal-300">
											<Music class="h-3.5 w-3.5" />
											Entire Vault Library
										</span>
										{#if scope === 'all'}
											<CheckCircle2 class="h-4 w-4 text-teal-400" />
										{/if}
									</div>
									<p class="text-sm font-semibold text-white">
										All Vault Albums & Songs
									</p>
								</div>
								<div class="mt-3 text-xs font-mono text-neutral-400 flex items-center gap-1">
									<span class="font-bold {totalNeedingLyrics > 0 ? 'text-amber-400' : 'text-neutral-500'}">
										{totalNeedingLyrics}
									</span>
									<span>songs without synced LRC</span>
								</div>
							</button>
						</div>
					</div>

					<!-- DOWNLOAD PREFERENCES -->
					<div class="p-4 rounded-2xl border border-neutral-800/80 bg-neutral-950/50 space-y-3">
						<span class="block text-xs font-bold uppercase tracking-wider text-neutral-400">
							Preferences & Options
						</span>

						<!-- Option: Only Synced -->
						<label class="flex items-start gap-3 cursor-pointer group">
							<input
								type="checkbox"
								bind:checked={onlySynced}
								class="mt-0.5 rounded border-neutral-700 bg-neutral-900 text-teal-500 focus:ring-teal-500/30 cursor-pointer"
							/>
							<div class="text-xs">
								<span class="font-semibold text-neutral-200 group-hover:text-white transition">
									Only save Synced Lyrics
								</span>
								<p class="text-neutral-400 text-[11px] mt-0.5">
									Skip songs where LRCLIB only has plain unsynchronized text. Instrumental markers (<code class="text-purple-300">♪</code>) will still be saved.
								</p>
							</div>
						</label>

						<!-- Option: Save to Disk -->
						<label class="flex items-start gap-3 cursor-pointer group">
							<input
								type="checkbox"
								bind:checked={saveToDisk}
								class="mt-0.5 rounded border-neutral-700 bg-neutral-900 text-teal-500 focus:ring-teal-500/30 cursor-pointer"
							/>
							<div class="text-xs">
								<span class="font-semibold text-neutral-200 group-hover:text-white transition">
									Save companion <code class="text-teal-300">.lrc</code> files to song folders on disk
								</span>
								<p class="text-neutral-400 text-[11px] mt-0.5">
									Writes clean timed lyrics files right beside your audio files for Symfonium, Feishin, and offline players.
								</p>
							</div>
						</label>
					</div>
				{:else}
					<!-- RUNNING OR COMPLETED VIEW -->
					<div class="space-y-4">
						<!-- Progress Header & Bar -->
						<div class="p-4 rounded-2xl border border-neutral-800/80 bg-neutral-950/70 space-y-2.5">
							<div class="flex items-center justify-between text-xs">
								<div class="flex items-center gap-2">
									{#if isRunning}
										<Loader2 class="h-4 w-4 text-teal-400 animate-spin" />
										<span class="font-bold text-white">Downloading lyrics...</span>
									{:else}
										<CheckCircle2 class="h-4 w-4 text-emerald-400" />
										<span class="font-bold text-emerald-300">Batch download completed!</span>
									{/if}
								</div>
								<div class="font-mono text-neutral-300 font-semibold">
									{progress.current} / {progress.total} tracks ({progress.percent}%)
								</div>
							</div>

							<!-- Animated Progress Track -->
							<div class="w-full h-2.5 rounded-full bg-neutral-800/80 overflow-hidden relative border border-neutral-700/40">
								<div
									class="h-full bg-gradient-to-r from-teal-500 via-emerald-400 to-teal-400 transition-all duration-200"
									style="width: {progress.percent}%"
								></div>
							</div>

							{#if currentTrackInfo && isRunning}
								<div class="text-xs text-neutral-400 truncate pt-1 flex items-center gap-1.5">
									<span class="text-neutral-500">Processing:</span>
									<span class="font-semibold text-neutral-200 truncate">{currentTrackInfo.title}</span>
									{#if currentTrackInfo.artist}
										<span class="text-neutral-500">•</span>
										<span class="text-neutral-400 truncate">{currentTrackInfo.artist}</span>
									{/if}
								</div>
							{/if}
						</div>

						<!-- Results Metric Counters -->
						<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
							<div class="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/50">
								<div class="text-lg font-bold text-emerald-300 font-mono">{counters.synced}</div>
								<div class="text-[11px] font-semibold text-emerald-400">Synced LRC</div>
							</div>

							<div class="p-3 rounded-xl bg-purple-950/40 border border-purple-800/50">
								<div class="text-lg font-bold text-purple-300 font-mono">{counters.instrumental}</div>
								<div class="text-[11px] font-semibold text-purple-400">Instrumental</div>
							</div>

							<div class="p-3 rounded-xl bg-neutral-900 border border-neutral-800">
								<div class="text-lg font-bold text-neutral-300 font-mono">{counters.notFound}</div>
								<div class="text-[11px] font-semibold text-neutral-400">Not Found</div>
							</div>

							<div class="p-3 rounded-xl bg-rose-950/30 border border-rose-900/40">
								<div class="text-lg font-bold text-rose-300 font-mono">{counters.error}</div>
								<div class="text-[11px] font-semibold text-rose-400">Errors</div>
							</div>
						</div>

						<!-- Real-Time Activity Log -->
						<div>
							<span class="block text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">
								Live Activity Log
							</span>
							<div
								bind:this={logsContainerEl}
								class="h-48 overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-950 p-3 font-mono text-[11px] space-y-1.5 shadow-inner"
							>
								{#if logs.length === 0}
									<div class="text-neutral-500 italic p-2 text-center">
										Connecting to LRCLIB and starting downloads...
									</div>
								{:else}
									{#each logs as log (log.id)}
										<div class="flex items-start gap-2 leading-relaxed">
											<span class="text-neutral-600 shrink-0">[{log.time}]</span>
											{#if log.status === 'synced'}
												<span class="px-1.5 py-0.2 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 font-bold shrink-0">
													SYNCED
												</span>
											{:else if log.status === 'instrumental'}
												<span class="px-1.5 py-0.2 rounded bg-purple-950/80 text-purple-300 border border-purple-700/60 font-bold shrink-0">
													INSTRUMENTAL
												</span>
											{:else if log.status === 'plain'}
												<span class="px-1.5 py-0.2 rounded bg-amber-950/80 text-amber-300 border border-amber-700/60 font-bold shrink-0">
													PLAIN
												</span>
											{:else if log.status === 'error'}
												<span class="px-1.5 py-0.2 rounded bg-rose-950/80 text-rose-300 border border-rose-700/60 font-bold shrink-0">
													ERROR
												</span>
											{:else}
												<span class="px-1.5 py-0.2 rounded bg-neutral-900 text-neutral-400 border border-neutral-700/60 font-bold shrink-0">
													NO SYNC
												</span>
											{/if}
											<div class="min-w-0 flex-1 truncate">
												<span class="text-neutral-200 font-semibold">{log.title}</span>
												{#if log.artist}
													<span class="text-neutral-500"> - {log.artist}</span>
												{/if}
												<span class="text-neutral-400 italic ml-1.5">({log.message})</span>
											</div>
										</div>
									{/each}
								{/if}
							</div>
						</div>
					</div>
				{/if}
			</div>

			<!-- Modal Footer -->
			<div class="border-t border-neutral-800/80 pt-4 flex items-center justify-between gap-3 shrink-0">
				{#if !isRunning && !isCompleted}
					<button
						type="button"
						onclick={handleClose}
						class="px-4 py-2 rounded-xl text-xs font-semibold text-neutral-300 hover:bg-neutral-800 transition cursor-pointer"
					>
						Cancel
					</button>

					<button
						type="button"
						onclick={startDownload}
						disabled={(scope === 'album' ? albumNeedingLyrics : totalNeedingLyrics) === 0}
						class="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 text-neutral-950 text-xs font-bold shadow-lg shadow-teal-500/20 hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100 transition cursor-pointer"
					>
						<Download class="h-4 w-4" />
						<span>
							Start Download ({scope === 'album' ? albumNeedingLyrics : totalNeedingLyrics} songs)
						</span>
					</button>
				{:else if isRunning}
					<div class="text-xs text-neutral-400 flex items-center gap-2">
						<Loader2 class="h-3.5 w-3.5 text-teal-400 animate-spin" />
						<span>Downloading from LRCLIB (~8 songs/sec)...</span>
					</div>

					<button
						type="button"
						onclick={stopDownload}
						class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-950/80 hover:bg-rose-900 border border-rose-800/80 text-rose-200 text-xs font-bold transition cursor-pointer"
					>
						<Square class="h-3.5 w-3.5 fill-current" />
						<span>Stop Download</span>
					</button>
				{:else}
					<!-- Completed Footer -->
					<div class="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
						<CheckCircle2 class="h-4 w-4" />
						<span>Done! {counters.synced} synced lyrics and {counters.instrumental} instrumental markers saved.</span>
					</div>

					<button
						type="button"
						onclick={handleClose}
						class="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-950/40 transition cursor-pointer"
					>
						Done
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}
