<script lang="ts">
	import type { Track } from '$lib/types/index.js';
	import { Upload, X, FileAudio, CheckCircle2, AlertTriangle, Trash2, ArrowUpRight } from '@lucide/svelte';

	interface Props {
		albumId: number;
		albumTitle: string;
		isOpen: boolean;
		onClose: () => void;
		onUploadSuccess: (tracks: Track[]) => void;
	}

	let { albumId, albumTitle, isOpen, onClose, onUploadSuccess }: Props = $props();

	let selectedFiles = $state<File[]>([]);
	let isDragging = $state(false);
	let isUploading = $state(false);
	let uploadError = $state<string | null>(null);
	let uploadResult = $state<{ uploaded: number; linked: number; total: number } | null>(null);

	let fileInputRef = $state<HTMLInputElement | null>(null);

	$effect(() => {
		if (isOpen) {
			selectedFiles = [];
			isDragging = false;
			isUploading = false;
			uploadError = null;
			uploadResult = null;
		}
	});

	function handleFilesSelected(files: FileList | null) {
		if (!files) return;
		const validFiles: File[] = [];
		const allowedExts = ['.flac', '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.aif', '.aiff', '.alac'];

		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
			if (allowedExts.includes(ext)) {
				// Prevent duplicates in the staged list
				if (!selectedFiles.some((f) => f.name === file.name && f.size === file.size)) {
					validFiles.push(file);
				}
			}
		}

		selectedFiles = [...selectedFiles, ...validFiles];
	}

	function removeFile(index: number) {
		selectedFiles = selectedFiles.filter((_, i) => i !== index);
	}

	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
	}

	async function startUpload() {
		if (selectedFiles.length === 0 || isUploading) return;
		isUploading = true;
		uploadError = null;

		const formData = new FormData();
		for (const file of selectedFiles) {
			formData.append('files', file);
		}

		try {
			const res = await fetch(`/api/albums/${albumId}/tracks/upload`, {
				method: 'POST',
				body: formData
			});

			const data = await res.json();
			if (!res.ok) {
				throw new Error(data.error || 'Upload failed');
			}

			const results: any[] = data.results || [];
			const linked = results.filter((r) => r.status === 'linked_missing').length;
			const uploaded = results.filter((r) => r.status === 'uploaded').length;

			uploadResult = {
				uploaded,
				linked,
				total: results.length
			};

			if (data.tracks) {
				onUploadSuccess(data.tracks);
			}
		} catch (err: any) {
			uploadError = err.message || 'An error occurred during upload.';
		} finally {
			isUploading = false;
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
					class="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<!-- Success Summary Banner -->
			{#if uploadResult}
				<div class="rounded-xl border border-emerald-500/30 bg-emerald-950/40 p-4 flex flex-col gap-2 text-emerald-300">
					<div class="flex items-center gap-2 font-bold text-sm">
						<CheckCircle2 class="h-5 w-5 text-emerald-400" />
						Upload Complete!
					</div>
					<p class="text-xs text-neutral-300 leading-relaxed">
						Processed <strong class="text-white">{uploadResult.total}</strong> audio files:
						{#if uploadResult.linked > 0}
							<span class="text-emerald-400 font-semibold">{uploadResult.linked} missing tracks automatically linked & resolved</span>,
						{/if}
						<span class="text-neutral-200">{uploadResult.uploaded} new songs added</span>.
					</p>
					<div class="pt-2 flex justify-end">
						<button
							type="button"
							onclick={onClose}
							class="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 transition"
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
					onclick={() => fileInputRef?.click()}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							fileInputRef?.click();
						}
					}}
					ondragover={(e) => {
						e.preventDefault();
						isDragging = true;
					}}
					ondragleave={() => (isDragging = false)}
					ondrop={(e) => {
						e.preventDefault();
						isDragging = false;
						handleFilesSelected(e.dataTransfer?.files || null);
					}}
					class="relative rounded-2xl border-2 border-dashed p-8 text-center transition cursor-pointer flex flex-col items-center justify-center gap-3 {isDragging ? 'border-emerald-400 bg-emerald-950/20' : 'border-neutral-700/80 bg-neutral-950/50 hover:border-neutral-600 hover:bg-neutral-950/80'}"
				>
					<input
						type="file"
						multiple
						accept="audio/*,.flac,.mp3,.m4a,.aac,.ogg,.opus,.wav,.aiff,.alac"
						class="hidden"
						bind:this={fileInputRef}
						onchange={(e) => handleFilesSelected(e.currentTarget.files)}
					/>

					<div class="rounded-2xl border border-neutral-800 bg-neutral-900 p-3.5 text-neutral-400 shadow-inner">
						<FileAudio class="h-7 w-7 text-emerald-400" />
					</div>

					<div>
						<p class="text-sm font-semibold text-neutral-200">
							Drop audio files here, or <span class="text-emerald-400 hover:underline">browse</span>
						</p>
						<p class="text-xs text-neutral-400 mt-1">
							Supports FLAC, MP3, M4A, AAC, OGG, OPUS, WAV, AIFF, ALAC
						</p>
					</div>
				</div>

				<!-- Staged Files List -->
				{#if selectedFiles.length > 0}
					<div class="flex flex-col gap-2 max-h-52 overflow-y-auto pr-1">
						<div class="flex items-center justify-between text-xs text-neutral-400 px-1 font-medium">
							<span>Selected Files ({selectedFiles.length})</span>
							<button
								type="button"
								onclick={() => (selectedFiles = [])}
								class="text-rose-400 hover:underline cursor-pointer"
							>
								Clear All
							</button>
						</div>

						<div class="divide-y divide-neutral-800/60 rounded-xl border border-neutral-800 bg-neutral-950/40">
							{#each selectedFiles as file, idx}
								<div class="flex items-center justify-between gap-3 p-2.5 text-xs hover:bg-neutral-900/30 transition">
									<div class="flex items-center gap-2.5 min-w-0">
										<FileAudio class="h-4 w-4 text-emerald-400 shrink-0" />
										<span class="truncate font-medium text-neutral-200">{file.name}</span>
									</div>
									<div class="flex items-center gap-3 shrink-0 text-neutral-400">
										<span class="font-mono text-[11px]">{formatBytes(file.size)}</span>
										<button
											type="button"
											onclick={(e) => {
												e.stopPropagation();
												removeFile(idx);
											}}
											disabled={isUploading}
											class="text-neutral-500 hover:text-rose-400 transition"
											title="Remove"
										>
											<Trash2 class="h-3.5 w-3.5" />
										</button>
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Error Banner -->
				{#if uploadError}
					<div class="rounded-xl border border-rose-800/60 bg-rose-950/40 p-3 flex items-start gap-2.5 text-xs text-rose-300">
						<AlertTriangle class="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
						<p>{uploadError}</p>
					</div>
				{/if}

				<!-- Footer Actions -->
				<div class="flex items-center justify-between gap-3 pt-2">
					<p class="text-[11px] text-neutral-400">
						Tracks matching existing missing songs will be automatically linked.
					</p>

					<div class="flex items-center gap-2 shrink-0">
						<button
							type="button"
							onclick={onClose}
							disabled={isUploading}
							class="rounded-xl border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-700 transition"
						>
							Cancel
						</button>
						<button
							type="button"
							onclick={startUpload}
							disabled={selectedFiles.length === 0 || isUploading}
							class="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-xs font-bold text-neutral-950 transition hover:from-emerald-400 hover:to-teal-400 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-lg shadow-emerald-950/50"
						>
							{#if isUploading}
								<span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-950 border-t-transparent"></span>
								Uploading & Scanning...
							{:else}
								<Upload class="h-3.5 w-3.5" />
								Upload {selectedFiles.length > 0 ? `(${selectedFiles.length})` : ''}
							{/if}
						</button>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}
