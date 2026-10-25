import type { Track, Album } from '$lib/types/index.js';

export interface PlayerAlbum extends Album {
	tracks: Track[];
}

export type RepeatMode = 'off' | 'all' | 'one';

class GlobalPlayer {
	currentTrack = $state<Track | null>(null);
	currentAlbum = $state<PlayerAlbum | null>(null);
	activeQueue = $state<Track[]>([]);
	queueIndex = $state<number>(-1);
	isPlaying = $state<boolean>(false);
	currentTime = $state<number>(0);
	duration = $state<number>(0);
	volume = $state<number>(0.8);
	isMuted = $state<boolean>(false);
	shuffleEnabled = $state<boolean>(false);
	repeatMode = $state<RepeatMode>('off');

	private audioEl: HTMLAudioElement | null = null;
	private historyTrackIds: number[] = [];
	private initialized = false;

	init(el: HTMLAudioElement) {
		if (this.audioEl === el) return;
		this.audioEl = el;

		if (!this.initialized) {
			this.initialized = true;

			// Restore saved volume
			try {
				const saved = localStorage.getItem('traxvault_player_volume') || localStorage.getItem('trackvault_player_volume');
				if (saved) {
					this.volume = parseFloat(saved);
				}
			} catch {}

			// Restore saved shuffle and repeat modes
			try {
				const savedShuffle = localStorage.getItem('traxvault_player_shuffle') ?? localStorage.getItem('trackvault_player_shuffle');
				if (savedShuffle !== null) {
					this.shuffleEnabled = savedShuffle === 'true';
				}
				const savedRepeat = localStorage.getItem('traxvault_player_repeat') || localStorage.getItem('trackvault_player_repeat');
				if (savedRepeat === 'off' || savedRepeat === 'all' || savedRepeat === 'one') {
					this.repeatMode = savedRepeat;
				}
			} catch {}
		}

		el.volume = this.isMuted ? 0 : this.volume;

		el.ontimeupdate = () => {
			this.currentTime = el.currentTime;
		};

		el.ondurationchange = () => {
			if (!isNaN(el.duration) && el.duration > 0) {
				this.duration = el.duration;
			}
		};

		el.onloadedmetadata = () => {
			if (!isNaN(el.duration) && el.duration > 0) {
				this.duration = el.duration;
			}
		};

		el.onplay = () => {
			this.isPlaying = true;
		};

		el.onplaying = () => {
			this.isPlaying = true;
		};

		el.onpause = () => {
			this.isPlaying = false;
		};

		el.onerror = () => {
			this.isPlaying = false;
		};

		el.onended = () => {
			this.isPlaying = false;
			this.handleTrackEnded();
		};

		this.setupMediaSession();
	}

	private setupMediaSession() {
		if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

		navigator.mediaSession.setActionHandler('play', () => this.togglePlay());
		navigator.mediaSession.setActionHandler('pause', () => this.togglePlay());
		navigator.mediaSession.setActionHandler('previoustrack', () => this.previousTrack());
		navigator.mediaSession.setActionHandler('nexttrack', () => this.nextTrack());
		navigator.mediaSession.setActionHandler('seekto', (details) => {
			if (details.seekTime !== undefined) {
				this.seekTo(details.seekTime);
			}
		});
	}

	private updateMediaSession() {
		if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !this.currentTrack) return;

		const artist = this.currentTrack.artist || (this.currentAlbum ? this.currentAlbum.artist : 'Trax Vault');
		const albumTitle = this.currentAlbum ? this.currentAlbum.title : 'Trax Vault';
		const artworkUrl = this.currentAlbum?.cover_url;

		navigator.mediaSession.metadata = new MediaMetadata({
			title: this.currentTrack.title,
			artist: artist,
			album: albumTitle,
			artwork: artworkUrl
				? [
						{ src: artworkUrl, sizes: '300x300', type: 'image/jpeg' },
						{ src: artworkUrl, sizes: '512x512', type: 'image/jpeg' }
				  ]
				: []
		});
	}

	playTrack(track: Track, album?: PlayerAlbum, queue?: Track[]) {
		this.currentTrack = track;
		if (album) {
			this.currentAlbum = album;
		}

		if (queue && queue.length > 0) {
			this.activeQueue = queue;
		} else if (this.currentAlbum && this.currentAlbum.tracks.length > 0) {
			this.activeQueue = this.currentAlbum.tracks;
		} else if (this.activeQueue.length === 0 || !this.activeQueue.some((t) => t.id === track.id)) {
			this.activeQueue = [track];
		}

		this.queueIndex = this.activeQueue.findIndex((t) => t.id === track.id);
		if (this.queueIndex === -1 && this.activeQueue.length > 0) {
			this.queueIndex = 0;
		}

		if (this.historyTrackIds.length > 50) this.historyTrackIds.shift();
		this.historyTrackIds.push(track.id);

		if (this.audioEl) {
			this.audioEl.src = `/api/tracks/${track.id}/audio`;
			this.audioEl
				.play()
				.then(() => {
					this.isPlaying = true;
				})
				.catch((err) => {
					console.warn('Playback error:', err);
					this.isPlaying = false;
				});
		}

		if (typeof document !== 'undefined') {
			const artist = track.artist || (this.currentAlbum ? this.currentAlbum.artist : 'Trax Vault');
			document.title = `${track.title} • ${artist} | Trax Vault`;
		}

		this.updateMediaSession();
	}

	playPlaylist(
		playlist: { id: number; name: string; comment?: string | null; cover_url?: string | null },
		tracks: Track[],
		startIndex: number = 0
	) {
		if (!tracks || tracks.length === 0) return;
		const safeIndex = Math.max(0, Math.min(startIndex, tracks.length - 1));

		const syntheticAlbum: PlayerAlbum = {
			id: -playlist.id,
			musicbrainz_id: null,
			title: playlist.name,
			artist: 'Playlist',
			release_year: null,
			genre: null,
			cover_url: playlist.cover_url || tracks[0]?.album_cover_url || null,
			media_type: 'Playlist',
			notes: playlist.comment || null,
			created_at: '',
			updated_at: '',
			tracks
		};

		this.playTrack(tracks[safeIndex], syntheticAlbum, tracks);
	}

	togglePlay() {
		if (!this.audioEl) return;

		if (!this.currentTrack) {
			if (this.activeQueue.length > 0) {
				this.playTrack(this.activeQueue[0]);
			}
			return;
		}

		if (this.isPlaying) {
			this.audioEl.pause();
			this.isPlaying = false;
		} else {
			this.audioEl
				.play()
				.then(() => {
					this.isPlaying = true;
				})
				.catch((e) => {
					console.warn('Play error:', e);
					this.isPlaying = false;
				});
		}
	}

	private handleTrackEnded() {
		if (this.repeatMode === 'one' && this.currentTrack) {
			if (this.audioEl) {
				this.audioEl.currentTime = 0;
				this.audioEl.play().catch((e) => console.warn(e));
			}
			return;
		}
		this.nextTrack();
	}

	nextTrack() {
		if (!this.activeQueue.length) return;

		let nextIdx = this.queueIndex + 1;

		if (this.shuffleEnabled && this.activeQueue.length > 1) {
			let rand = Math.floor(Math.random() * this.activeQueue.length);
			if (rand === this.queueIndex) {
				rand = (rand + 1) % this.activeQueue.length;
			}
			nextIdx = rand;
		}

		if (nextIdx >= this.activeQueue.length) {
			if (this.repeatMode === 'all') {
				nextIdx = 0;
			} else {
				this.isPlaying = false;
				return;
			}
		}

		const next = this.activeQueue[nextIdx];
		if (next) {
			this.playTrack(next, this.currentAlbum || undefined, this.activeQueue);
		}
	}

	previousTrack() {
		if (this.audioEl && this.audioEl.currentTime > 3) {
			this.audioEl.currentTime = 0;
			return;
		}

		if (!this.activeQueue.length) return;

		let prevIdx = this.queueIndex - 1;
		if (prevIdx < 0) {
			if (this.repeatMode === 'all') {
				prevIdx = this.activeQueue.length - 1;
			} else {
				prevIdx = 0;
			}
		}

		const prev = this.activeQueue[prevIdx];
		if (prev) {
			this.playTrack(prev, this.currentAlbum || undefined, this.activeQueue);
		}
	}

	seekTo(seconds: number) {
		if (!this.audioEl) return;
		const clamped = Math.max(0, Math.min(seconds, this.duration || 0));
		this.audioEl.currentTime = clamped;
		this.currentTime = clamped;
	}

	setVolume(val: number) {
		const clamped = Math.max(0, Math.min(1, val));
		this.volume = clamped;
		if (this.isMuted && clamped > 0) {
			this.isMuted = false;
		}
		if (this.audioEl) {
			this.audioEl.volume = this.isMuted ? 0 : this.volume;
		}
		try {
			localStorage.setItem('traxvault_player_volume', clamped.toString());
		} catch {}
	}

	toggleMute() {
		this.isMuted = !this.isMuted;
		if (this.audioEl) {
			this.audioEl.volume = this.isMuted ? 0 : this.volume;
		}
	}

	toggleShuffle() {
		this.shuffleEnabled = !this.shuffleEnabled;
		try {
			localStorage.setItem('traxvault_player_shuffle', this.shuffleEnabled.toString());
		} catch {}
	}

	toggleRepeat() {
		if (this.repeatMode === 'off') {
			this.repeatMode = 'all';
		} else if (this.repeatMode === 'all') {
			this.repeatMode = 'one';
		} else {
			this.repeatMode = 'off';
		}
		try {
			localStorage.setItem('traxvault_player_repeat', this.repeatMode);
		} catch {}
	}

	stop() {
		if (this.audioEl) {
			this.audioEl.pause();
			this.audioEl.currentTime = 0;
			this.audioEl.src = '';
		}
		this.currentTrack = null;
		this.isPlaying = false;
		this.currentTime = 0;
		this.duration = 0;
		if (typeof document !== 'undefined') {
			document.title = 'Trax Vault - Music Quality & Lyrics Tracker';
		}
	}
}

export const player = new GlobalPlayer();
