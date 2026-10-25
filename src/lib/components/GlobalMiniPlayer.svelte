<script lang="ts">
	import { player } from '$lib/services/player.svelte.js';
	import {
		Play,
		Pause,
		SkipBack,
		SkipForward,
		Volume2,
		VolumeX,
		Volume1,
		Disc3,
		X,
		Maximize2
	} from '@lucide/svelte';

	function formatTime(seconds: number): string {
		if (isNaN(seconds) || seconds < 0) return '0:00';
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}
</script>

{#if player.currentTrack}
	<div
		class="fixed bottom-3 sm:bottom-4 left-3 sm:left-6 right-3 sm:right-6 max-w-4xl mx-auto z-40 bg-neutral-900/90 backdrop-blur-2xl border border-neutral-800/80 rounded-2xl shadow-2xl p-2 sm:p-2.5 px-3 sm:px-4 flex items-center justify-between gap-3 sm:gap-5 animate-in slide-in-from-bottom-4 duration-200"
	>
		<!-- Left: Track info & Artwork -->
		<div class="flex items-center gap-2.5 min-w-0 max-w-[30%] sm:max-w-[28%]">
			<a
				href="/player"
				class="relative w-10 h-10 sm:w-11 sm:h-11 rounded-xl overflow-hidden bg-neutral-950 border border-neutral-800/80 flex items-center justify-center shrink-0 group shadow-md"
				title="Open in Studio Player"
			>
				{#if player.currentAlbum?.cover_url}
					<img
						src={player.currentAlbum.cover_url}
						alt={player.currentAlbum.title}
						class="w-full h-full object-cover group-hover:scale-105 transition duration-300"
					/>
				{:else}
					<Disc3 class="w-5 h-5 text-emerald-400 group-hover:rotate-45 transition duration-300" />
				{/if}
				<div class="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
					<Maximize2 class="w-3.5 h-3.5 text-white" />
				</div>
			</a>

			<div class="min-w-0 flex-1">
				<a
					href="/player"
					class="block text-xs sm:text-sm font-bold text-white truncate hover:text-emerald-400 transition"
					title={player.currentTrack.title}
				>
					{player.currentTrack.title}
				</a>
				<div class="text-[11px] text-neutral-400 truncate">
					{player.currentTrack.artist || player.currentAlbum?.artist || 'Trax Vault'}
				</div>
				<div class="hidden sm:flex items-center gap-1.5 mt-0.5">
					{#if (player.currentTrack.disc_number || 1) > 1}
						<span class="text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-950/70 border border-amber-800/60 text-amber-400 font-bold">
							CD {player.currentTrack.disc_number}
						</span>
					{/if}
					<span class="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-neutral-950 border border-emerald-500/30 text-emerald-400 font-semibold">
						{player.currentTrack.format}
					</span>
					{#if player.currentTrack.bitrate_kbps}
						<span class="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-950/70 border border-emerald-700/60 text-emerald-300 font-bold">
							{player.currentTrack.bitrate_kbps.toLocaleString()} kbps
						</span>
					{/if}
				</div>
			</div>
		</div>

		<!-- Center: Playback Controls & Progress Scrubber -->
		<div class="flex-1 flex flex-col items-center gap-1 min-w-0 max-w-md">
			<div class="flex items-center gap-2 sm:gap-3">
				<!-- Previous -->
				<button
					type="button"
					onclick={() => player.previousTrack()}
					class="text-neutral-400 hover:text-white transition cursor-pointer p-1"
					title="Previous Song"
				>
					<SkipBack class="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current" />
				</button>

				<!-- Play / Pause -->
				<button
					type="button"
					onclick={() => player.togglePlay()}
					class="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 hover:scale-105 active:scale-95 text-neutral-950 flex items-center justify-center shadow-md shadow-emerald-500/25 transition cursor-pointer"
					title={player.isPlaying ? 'Pause' : 'Play'}
				>
					{#if player.isPlaying}
						<Pause class="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current" />
					{:else}
						<Play class="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current ml-0.5" />
					{/if}
				</button>

				<!-- Next -->
				<button
					type="button"
					onclick={() => player.nextTrack()}
					class="text-neutral-400 hover:text-white transition cursor-pointer p-1"
					title="Next Song"
				>
					<SkipForward class="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current" />
				</button>
			</div>

			<!-- Scrubber Slider -->
			<div class="w-full flex items-center gap-2 text-[10px] font-mono text-neutral-400 tabular-nums">
				<span class="w-7 sm:w-8 text-right shrink-0">{formatTime(player.currentTime)}</span>
				<div class="flex-1 relative flex items-center">
					<input
						type="range"
						min="0"
						max={player.duration || 100}
						step="0.1"
						value={player.currentTime}
						oninput={(e) => player.seekTo(parseFloat(e.currentTarget.value))}
						class="w-full h-1 bg-neutral-800 hover:bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
					/>
				</div>
				<span class="w-7 sm:w-8 text-left shrink-0">{formatTime(player.duration)}</span>
			</div>
		</div>

		<!-- Right: Volume, Open Player, Dismiss/Stop -->
		<div class="flex items-center justify-end gap-1.5 sm:gap-2 shrink-0">
			<!-- Volume Controls (Mute toggle + slider on desktop) -->
			<div class="flex items-center gap-1.5">
				<button
					type="button"
					onclick={() => player.toggleMute()}
					class="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800/60 transition cursor-pointer"
					title={player.isMuted ? 'Unmute' : 'Mute'}
				>
					{#if player.isMuted || player.volume === 0}
						<VolumeX class="w-4 h-4 text-rose-400" />
					{:else if player.volume < 0.5}
						<Volume1 class="w-4 h-4 text-neutral-300" />
					{:else}
						<Volume2 class="w-4 h-4 text-neutral-300" />
					{/if}
				</button>

				<input
					type="range"
					min="0"
					max="1"
					step="0.01"
					value={player.isMuted ? 0 : player.volume}
					oninput={(e) => player.setVolume(parseFloat(e.currentTarget.value))}
					class="w-14 sm:w-20 h-1 bg-neutral-800 hover:bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 hidden md:block"
					title="Volume"
				/>
			</div>

			<!-- Open Studio Player -->
			<a
				href="/player"
				class="p-1.5 sm:p-2 rounded-xl bg-neutral-800/70 hover:bg-neutral-700/80 text-emerald-400 hover:text-emerald-300 border border-neutral-700/60 transition cursor-pointer flex items-center gap-1 text-xs font-semibold"
				title="Open Full Studio Player"
			>
				<Disc3 class="w-4 h-4 animate-spin-slow" />
				<span class="hidden lg:inline text-[11px]">Studio</span>
			</a>

			<!-- Stop & Dismiss Button -->
			<button
				type="button"
				onclick={() => player.stop()}
				class="p-1.5 rounded-xl text-neutral-400 hover:text-rose-400 hover:bg-neutral-800/60 transition cursor-pointer"
				title="Stop and Close Player"
			>
				<X class="w-4 h-4" />
			</button>
		</div>
	</div>
{/if}
