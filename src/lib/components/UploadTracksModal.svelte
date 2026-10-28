<script lang="ts">
	import type { Track } from '$lib/types/index.js';
	import {
		Upload,
		X,
		FileAudio,
		CheckCircle2,
		AlertTriangle,
		Trash2,
		Loader2,
		Clock
	} from '@lucide/svelte';

	interface Props {
		albumId: number;
		albumTitle: string;
		isOpen: boolean;
		onClose: () => void;
		onUploadSuccess: (tracks: Track[]) => void;
	}

	interface StagedFileItem {
		file: File;
		status: 'idle' | 'uploading' | 'success' | 'error';
		errorMsg?: string;
	}

	let { albumId, albumTitle, isOpen, onClose, onUploadSuccess }: Props = $props();

	let stagedFiles = $state<StagedFileItem[]>([]);
	let isDragging = $state(false);
	let isUploading = $state(false);
	let uploadError = $state<string | null>(null);
	let uploadResult = $state<{ uploaded: number; linked: number; total: number; failed: number } | null>(null);

	let currentUploadIndex = $state<number | null>(null);
	let fileInputRef = $state<HTMLInputElement | null>(null);

	const totalBytes = $derived(stagedFiles.reduce((acc, item) => acc + item.file.size, 0));
	const completedCount = $derived(stagedFiles.filter((f) => f.status === 'success').length);
	const progressPercent = $derived(
		stagedFiles.length > 0 ? Math.round((completedCount / stagedFiles.length) * 100) : 0
	);

	$effect(() => {
		if (isOpen) {
			stagedFiles = [];
			isDragging = false;
			isUploading = false;
			uploadError = null;
			uploadResult = null;
			currentUploadIndex = null;
		}
	});

	function handleFilesSelected(files: FileList | null) {
		if (!files) return;
		const allowedExts = ['.flac', '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.aif', '.aiff', '.alac'];
		const newItems: StagedFileItem[] = [];

		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
			if (allowedExts.includes(ext)) {
				if (!stagedFiles.some((item) => item.file.name === file.name && item.file.size === file.size)) {
					newItems.push({ file, status: 'idle' });
				}
			}
		}

		stagedFiles = [...stagedFiles, ...newItems];
	}

	function removeFile(index: number) {
		if (isUploading) return;
		stagedFiles = stagedFiles.filter((_, i) => i !== index);
	}

	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
	}

	async function startUpload() {
		if (stagedFiles.length === 0 || isUploading) return;
		isUploading = true;
		uploadError = null;

		let totalUploaded = 0;
		let totalLinked = 0;
		let failedCount = 0;
		let latestTracks: Track[] = [];

		for (let i = 0; i < stagedFiles.length; i++) {
			const item = stagedFiles[i];
			if (item.status === 'success') continue;

			currentUploadIndex = i;
			item.status = 'uploading';

			const formData = new FormData();
			formData.append('files', item.file);

			try {
				const res = await fetch(`/api/albums/${albumId}/tracks/upload`, {
					method: 'POST',
					body: formData
				});

				const data = await res.json().catch(() => ({}));
				if (!res.ok) {
					item.status = 'error';
					item.errorMsg = data.error || `Upload failed with HTTP ${res.status}`;
					failedCount++;
					continue;
				}

				item.status = 'success';
				const results: any[] = data.results || [];
				totalLinked += results.filter((r) => r.status === 'linked_missing').length;
				totalUploaded += results.filter((r) => r.status === 'uploaded').length;

				if (data.tracks && data.tracks.length > 0) {
					latestTracks = data.tracks;
				}
			} catch (err: any) {
				item.status = 'error';
				item.errorMsg = err.message || 'Connection error';
				failedCount++;
			}
		}

		currentUploadIndex = null;
		isUploading = false;

		const succeeded = stagedFiles.filter((f) => f.status === 'success').length;
		uploadResult = {
			uploaded: totalUploaded,
			linked: totalLinked,
			total: succeeded,
			failed: failedCount
		};

		if (latestTracks.length > 0) {
			onUploadSuccess(latestTracks);
		}
	}
</script>

{#if isOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
		role="dialog"
		aria-modal="true"
	>
		<div
			class="relative w-full max-w-xl rounded-2xl border border-neutral-800 bg-neutral-900/95 p-6 shadow-2xl backdrop-blur-xl flex flex-col gap-5 text-neutral-200 animate-in zoom-in-95 duration-200"
		>
			<!-- Header -->
			<div class="flex items-start justify-between gap-4">
				<div class="flex items-center gap-3">
					<div class="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2.5 text-emerald-400">
						<Upload class="h-6 w-6" />
					</div>
					<div>
						<h3 class="text-lg font-bold text-neutral-100">Upload Tracks to Album</h3>
						<p class="text-xs text-neutral-400 truncate max-w-sm">"{albumTitle}"</p>
					</div>
				</div>
				<button
					type="button"
					onclick={onClose}
					disabled={isUploading}
					class="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition disabled:opacity-30"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<!-- Success Summary Banner -->
			{#if uploadResult}
				<div class="rounded-xl border border-emerald-500/30 bg-emerald-950/40 p-4 flex flex-col gap-2 text-emerald-300">
					<div class="flex items-center gap-2 font-bold text-sm">
						<CheckCircle2 class="h-5 w-5 text-emerald-400" />
						Upload Process Complete!
					</div>
					<p class="text-xs text-neutral-300 leading-relaxed">
						Successfully processed <strong class="text-white">{uploadResult.total}</strong> audio files:
						{#if uploadResult.linked > 0}
							<span class="text-emerald-400 font-semibold">{uploadResult.linked} missing tracks automatically linked & resolved</span>,
						{/if}
						<span class="text-neutral-200">{uploadResult.uploaded} new songs added</span>.
						{#if uploadResult.failed > 0}
							<span class="text-rose-400 font-medium">({uploadResult.failed} failed)</span>
						{/if}
					</p>
					<div class="pt-2 flex justify-end">
						<button
							type="button"
							onclick={onClose}
							class="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 transition shadow-sm"
						>
							Done
						</button>
					</div>
				</div>
			{:else}
				<!-- Drag & Drop Zone -->
				<div
					role="button"
					tabindex="0"
					onclick={() => !isUploading && fileInputRef?.click()}
					onkeydown={(e) => {
						if (!isUploading && (e.key === 'Enter' || e.key === ' ')) {
							e.preventDefault();
							fileInputRef?.click();
						}
					}}
					ondragover={(e) => {
						e.preventDefault();
						if (!isUploading) isDragging = true;
					}}
					ondragleave={() => (isDragging = false)}
					ondrop={(e) => {
						e.preventDefault();
						isDragging = false;
						if (!isUploading) handleFilesSelected(e.dataTransfer?.files || null);
					}}
					class="relative rounded-2xl border-2 border-dashed p-7 text-center transition flex flex-col items-center justify-center gap-2.5 {isUploading ? 'opacity-50 cursor-not-allowed border-neutral-800 bg-neutral-950/30' : isDragging ? 'border-emerald-400 bg-emerald-950/20 cursor-pointer' : 'border-neutral-700/80 bg-neutral-950/50 hover:border-neutral-600 hover:bg-neutral-950/80 cursor-pointer'}"
				>
					<input
						type="file"
						multiple
						accept="audio/*,.flac,.mp3,.m4a,.aac,.ogg,.opus,.wav,.aiff,.alac"
						class="hidden"
						bind:this={fileInputRef}
						disabled={isUploading}
						onchange={(e) => handleFilesSelected(e.currentTarget.files)}
					/>

					<div class="rounded-2xl border border-neutral-800 bg-neutral-900 p-3 text-neutral-400 shadow-inner">
						<FileAudio class="h-6 w-6 text-emerald-400" />
					</div>

					<div>
						<p class="text-sm font-semibold text-neutral-200">
							Drop audio files here, or <span class="text-emerald-400 hover:underline">browse</span>
						</p>
						<p class="text-xs text-neutral-400 mt-1">
							Supports FLAC, MP3, M4A, AAC, OGG, OPUS, WAV, AIFF, ALAC • Multi-GB albums supported
						</p>
					</div>
				</div>

				<!-- Live Upload Progress Bar -->
				{#if isUploading}
					<div class="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-3.5 space-y-2">
						<div class="flex items-center justify-between text-xs">
							<div class="flex items-center gap-2 text-emerald-300 font-semibold truncate">
								<Loader2 class="h-4 w-4 animate-spin shrink-0 text-emerald-400" />
								<span class="truncate">
									{#if currentUploadIndex !== null && stagedFiles[currentUploadIndex]}
										Uploading {currentUploadIndex + 1} of {stagedFiles.length}: {stagedFiles[currentUploadIndex].file.name}
									{:else}
										Uploading songs...
									{/if}
								</span>
							</div>
							<span class="font-mono text-emerald-400 shrink-0 font-bold">{progressPercent}%</span>
						</div>
						<div class="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
							<div
								class="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300"
								style="width: {progressPercent}%"
							></div>
						</div>
					</div>
				{/if}

				<!-- Staged Files List -->
				{#if stagedFiles.length > 0}
					<div class="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
						<div class="flex items-center justify-between text-xs text-neutral-400 px-1 font-medium">
							<span>Selected Songs ({stagedFiles.length} • {formatBytes(totalBytes)})</span>
							{#if !isUploading}
								<button
									type="button"
									onclick={() => (stagedFiles = [])}
									class="text-rose-400 hover:underline cursor-pointer"
								>
									Clear All
								</button>
							{/if}
						</div>

						<div class="divide-y divide-neutral-800/60 rounded-xl border border-neutral-800 bg-neutral-950/40">
							{#each stagedFiles as item, idx}
								<div class="flex items-center justify-between gap-3 p-2.5 text-xs transition {item.status === 'uploading' ? 'bg-emerald-950/20' : item.status === 'success' ? 'bg-emerald-950/10' : item.status === 'error' ? 'bg-rose-950/20' : 'hover:bg-neutral-900/30'}">
									<div class="flex items-center gap-2.5 min-w-0 flex-1">
										{#if item.status === 'uploading'}
											<Loader2 class="h-4 w-4 animate-spin text-emerald-400 shrink-0" />
										{:else if item.status === 'success'}
											<CheckCircle2 class="h-4 w-4 text-emerald-400 shrink-0" />
										{:else if item.status === 'error'}
											<AlertTriangle class="h-4 w-4 text-rose-400 shrink-0" />
										{:else}
											<FileAudio class="h-4 w-4 text-neutral-500 shrink-0" />
										{/if}

										<div class="min-w-0 flex-1">
											<p class="truncate font-medium {item.status === 'success' ? 'text-emerald-200' : item.status === 'error' ? 'text-rose-200' : 'text-neutral-200'}">
												{item.file.name}
											</p>
											{#if item.errorMsg}
												<p class="text-[10px] text-rose-400 truncate">{item.errorMsg}</p>
											{/if}
										</div>
									</div>

									<div class="flex items-center gap-3 shrink-0 text-neutral-400">
										<span class="font-mono text-[11px]">{formatBytes(item.file.size)}</span>
										{#if !isUploading && item.status !== 'success'}
											<button
												type="button"
												onclick={(e) => {
													e.stopPropagation();
													removeFile(idx);
												}}
												class="text-neutral-500 hover:text-rose-400 transition"
												title="Remove"
											>
												<Trash2 class="h-3.5 w-3.5" />
											</button>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Footer Actions -->
				<div class="flex items-center justify-between gap-3 pt-2">
					<p class="text-[11px] text-neutral-400">
						Songs are uploaded individually so even multi-GB albums upload reliably.
					</p>

					<div class="flex items-center gap-2 shrink-0">
						<button
							type="button"
							onclick={onClose}
							disabled={isUploading}
							class="rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-700 transition disabled:opacity-40"
						>
							Cancel
						</button>
						<button
							type="button"
							onclick={startUpload}
							disabled={stagedFiles.length === 0 || isUploading}
							class="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-xs font-bold text-neutral-950 transition hover:from-emerald-400 hover:to-teal-400 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-lg shadow-emerald-950/50"
						>
							{#if isUploading}
								<Loader2 class="h-3.5 w-3.5 animate-spin" />
								Uploading...
							{:else}
								<Upload class="h-3.5 w-3.5" />
								Upload {stagedFiles.length > 0 ? `(${stagedFiles.length})` : ''}
							{/if}
						</button>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}
