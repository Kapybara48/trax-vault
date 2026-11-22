import type { Track, Album } from '$lib/types/index.js';

export interface PlayerAlbum extends Album {
	tracks: Track[];
}

export type RepeatMode = 'off' | 'all' | 'one';

export interface SyncRoomSummary {
	id: string;
	type: 'personal' | 'shared';
	code: string | null;
	name: string;
	hostUserId: number;
	hostUsername: string;
	isPublic: boolean;
	allowGuestControl: boolean;
	listenerCount: number;
	currentTrackTitle: string | null;
	currentTrackArtist: string | null;
	currentCoverUrl: string | null;
	isPlaying: boolean;
}

export interface SyncDeviceInfo {
	deviceId: string;
	deviceName: string;
	userId: number;
	username: string;
	isAudioOutput: boolean;
	isStandalone: boolean;
	standaloneTrackTitle: string | null;
	standaloneTrackArtist: string | null;
	standaloneIsPlaying: boolean;
	connectedAtMs: number;
	lastSeenMs: number;
}

export interface SyncPlaybackState {
	currentTrack: Track | null;
	currentAlbum: { id?: number; title: string; artist: string; cover_url: string | null } | null;
	activeQueue: Track[];
	queueIndex: number;
	isPlaying: boolean;
	positionSec: number;
	durationSec: number;
	shuffleEnabled: boolean;
	repeatMode: RepeatMode;
	updatedAtServerMs: number;
	updatedByDeviceId: string | null;
	updatedByUsername: string | null;
}

function detectFriendlyDeviceName(): string {
	if (typeof navigator === 'undefined') return 'Web Browser';
	const ua = navigator.userAgent || '';

	let os = 'Desktop';
	if (/Android/i.test(ua)) os = 'Android';
	else if (/iPad/i.test(ua)) os = 'iPad';
	else if (/iPhone|iPod/i.test(ua)) os = 'iPhone';
	else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
	else if (/Windows/i.test(ua)) os = 'Windows PC';
	else if (/Linux/i.test(ua)) os = 'Linux PC';

	let browser = 'Browser';
	if (/Edg\//i.test(ua)) browser = 'Edge';
	else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
	else if (/Firefox\//i.test(ua)) browser = 'Firefox';
	else if (/Chrome\//i.test(ua)) browser = 'Chrome';
	else if (/Safari\//i.test(ua)) browser = 'Safari';

	return `${os} (${browser})`;
}

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

	// Multi-Device Sync & "Listen Together" Reactive State
	deviceId = $state<string>('');
	deviceName = $state<string>('Web Player');
	syncConnected = $state<boolean>(false);
	standaloneMode = $state<boolean>(false);
	localAudioEnabled = $state<boolean>(true);
	audioUnlockRequired = $state<boolean>(false);
	activeRoom = $state<SyncRoomSummary | null>(null);
	connectedDevices = $state<SyncDeviceInfo[]>([]);
	publicRooms = $state<SyncRoomSummary[]>([]);
	showSyncModal = $state<boolean>(false);
	syncModalTab = $state<'devices' | 'rooms'>('devices');
	lastSyncUpdatedBy = $state<string | null>(null);

	private audioEl: HTMLAudioElement | null = null;
	private lastSavedSessionTime = 0;

	private persistSessionSnapshot() {
		if (typeof localStorage === 'undefined' || !this.currentTrack) return;
		try {
			const snapshot = {
				track: this.currentTrack,
				album: this.currentAlbum,
				queue: this.activeQueue,
				queueIndex: this.queueIndex,
				currentTime: Math.round(this.currentTime * 10) / 10,
				duration: this.duration,
				savedAt: Date.now()
			};
			localStorage.setItem('traxvault_last_session', JSON.stringify(snapshot));
		} catch {}
	}
	private historyTrackIds: number[] = [];
	private initialized = false;
	private eventSource: EventSource | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private serverClockOffsetMs = 0;
	private remoteRefPositionSec = 0;
	private remoteRefServerMs = 0;
	private isApplyingRemoteState = false;
	private loadedAudioTrackId: number | null = null;

	init(el: HTMLAudioElement) {
		if (this.audioEl === el) return;
		this.audioEl = el;

		if (!this.initialized) {
			this.initialized = true;

			// Restore or generate persistent Device ID & Friendly Name
			try {
				let savedDeviceId = localStorage.getItem('traxvault_device_id');
				if (!savedDeviceId) {
					savedDeviceId =
						typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
							? crypto.randomUUID()
							: 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
					localStorage.setItem('traxvault_device_id', savedDeviceId);
				}
				this.deviceId = savedDeviceId;

				const savedDeviceName = localStorage.getItem('traxvault_device_name');
				if (savedDeviceName && savedDeviceName.trim()) {
					this.deviceName = savedDeviceName.trim();
				} else {
					this.deviceName = detectFriendlyDeviceName();
					localStorage.setItem('traxvault_device_name', this.deviceName);
				}

				const savedStandalone = localStorage.getItem('traxvault_standalone_mode');
				if (savedStandalone === 'true') {
					this.standaloneMode = true;
					this.localAudioEnabled = true;
				}
			} catch {
				this.deviceId = 'dev_' + Math.random().toString(36).slice(2);
				this.deviceName = detectFriendlyDeviceName();
			}

			// Restore saved volume
			try {
				const saved =
					localStorage.getItem('traxvault_player_volume') ||
					localStorage.getItem('trackvault_player_volume');
				if (saved) {
					this.volume = parseFloat(saved);
				}
			} catch {}

			// Restore saved shuffle and repeat modes
			try {
				const savedShuffle =
					localStorage.getItem('traxvault_player_shuffle') ??
					localStorage.getItem('trackvault_player_shuffle');
				if (savedShuffle !== null) {
					this.shuffleEnabled = savedShuffle === 'true';
				}
				const savedRepeat =
					localStorage.getItem('traxvault_player_repeat') ||
					localStorage.getItem('trackvault_player_repeat');
				if (savedRepeat === 'off' || savedRepeat === 'all' || savedRepeat === 'one') {
					this.repeatMode = savedRepeat;
				}
			} catch {}

			// Restore last played track and exact playback position from localStorage
			try {
				const savedSessionStr = localStorage.getItem('traxvault_last_session');
				if (savedSessionStr) {
					const savedSession = JSON.parse(savedSessionStr);
					if (savedSession && savedSession.track) {
						this.currentTrack = savedSession.track;
						if (savedSession.album) {
							this.currentAlbum = savedSession.album;
						}
						if (Array.isArray(savedSession.queue) && savedSession.queue.length > 0) {
							this.activeQueue = savedSession.queue;
						} else {
							this.activeQueue = [savedSession.track];
						}
						if (typeof savedSession.queueIndex === 'number') {
							this.queueIndex = savedSession.queueIndex;
						}
						const savedTime = typeof savedSession.currentTime === 'number' ? Math.max(0, savedSession.currentTime) : 0;
						this.currentTime = savedTime;
						this.remoteRefPositionSec = savedTime;
						this.remoteRefServerMs = Date.now();
						if (typeof savedSession.duration === 'number' && savedSession.duration > 0) {
							this.duration = savedSession.duration;
						} else if (savedSession.track.duration_ms) {
							this.duration = savedSession.track.duration_ms / 1000;
						}

						// Prepare audio element with the exact track and seek position (without auto-playing)
						this.loadedAudioTrackId = savedSession.track.id;
						el.src = `/api/tracks/${savedSession.track.id}/audio`;
						el.currentTime = savedTime;
						this.isPlaying = false;
						this.updatePlaybackState('paused');
						this.updateMediaSession();
					}
				}
			} catch (err) {
				console.warn('[Player] Could not restore last session:', err);
			}

			// Suspend / Sleep Detection Heartbeat (prevents auto-play audio jumpscares on laptop wake)
			let lastHeartbeat = Date.now();
			setInterval(() => {
				const now = Date.now();
				const elapsed = now - lastHeartbeat;
				lastHeartbeat = now;

				// If more than 3000ms elapsed between 500ms intervals, system was suspended/slept
				if (elapsed > 3000 && this.isPlaying && this.localAudioEnabled) {
					console.log(
						'[Player] System resumed from sleep/suspend. Pausing playback to prevent auto-play jumpscares.'
					);
					this.pause();
				}
			}, 500);

			if (typeof document !== 'undefined') {
				document.addEventListener('freeze', () => {
					if (this.isPlaying && this.localAudioEnabled) {
						this.pause();
					}
				});
			}

			// 50ms Companion Clock Interpolation Loop (drives smooth synced lyrics & progress bar when local audio is muted or blocked)
			setInterval(() => {
				this.tickCompanionClock();
			}, 50);

			// 5-second Reference Clock Checkpoint from Active Speaker Device
			setInterval(() => {
				this.sendPeriodicSpeakerCheckpoint();
			}, 5000);

			// Start SSE Real-Time Sync Stream
			this.connectSyncStream();
		}

		el.volume = this.getEffectiveGain();

		el.ontimeupdate = () => {
			if (!this.localAudioEnabled || this.audioUnlockRequired) return;
			this.currentTime = el.currentTime;
			this.remoteRefPositionSec = el.currentTime;
			this.remoteRefServerMs = this.getEstimatedServerNowMs();

			// Throttled persistence: save position every 1 second while playing
			const now = Date.now();
			if (now - this.lastSavedSessionTime > 1000) {
				this.lastSavedSessionTime = now;
				this.persistSessionSnapshot();
			}
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
			if (!this.localAudioEnabled) {
				el.pause();
				return;
			}
			this.audioUnlockRequired = false;
			this.isPlaying = true;
			this.updatePlaybackState('playing');
		};

		el.onplaying = () => {
			if (!this.localAudioEnabled) {
				el.pause();
				return;
			}
			this.audioUnlockRequired = false;
			this.isPlaying = true;
			this.updatePlaybackState('playing');
		};

		el.onpause = () => {
			// When in Companion mode (localAudioEnabled === false) or applying remote state,
			// pausing the local <audio> element must NOT overwrite the room's isPlaying state.
			if (!this.localAudioEnabled || this.isApplyingRemoteState || this.audioUnlockRequired) {
				return;
			}
			this.isPlaying = false;
			this.updatePlaybackState('paused');
		};

		el.onerror = () => {
			if (!this.localAudioEnabled) return;
			this.isPlaying = false;
			this.updatePlaybackState('none');
		};

		el.onended = () => {
			if (!this.localAudioEnabled) return;
			this.isPlaying = false;
			this.updatePlaybackState('paused');
			this.handleTrackEnded();
		};

		this.setupMediaSession();
	}

	private getEstimatedServerNowMs(): number {
		return Date.now() + this.serverClockOffsetMs;
	}

	private updateServerClockOffset(serverNowMs?: number) {
		if (typeof serverNowMs === 'number' && serverNowMs > 0) {
			this.serverClockOffsetMs = serverNowMs - Date.now();
		}
	}

	private computeExpectedRemotePositionSec(): number {
		if (!this.currentTrack) return 0;
		if (!this.isPlaying) return Math.max(0, this.remoteRefPositionSec);
		const elapsedSec = Math.max(
			0,
			(this.getEstimatedServerNowMs() - this.remoteRefServerMs) / 1000
		);
		const pos = this.remoteRefPositionSec + elapsedSec;
		if (this.duration > 0) {
			return Math.min(this.duration, pos);
		}
		return pos;
	}

	private tickCompanionClock() {
		if (!this.currentTrack || !this.isPlaying) return;

		// If local audio is muted (Companion mode) or waiting for user gesture unlock,
		// advance currentTime smoothly from the synchronized server clock reference
		if (!this.localAudioEnabled || this.audioUnlockRequired) {
			const expected = this.computeExpectedRemotePositionSec();
			this.currentTime = expected;
		}
	}

	private sendPeriodicSpeakerCheckpoint() {
		if (
			!this.syncConnected ||
			this.standaloneMode ||
			!this.localAudioEnabled ||
			!this.isPlaying ||
			!this.currentTrack ||
			!this.audioEl ||
			this.audioEl.paused
		) {
			return;
		}

		// Only send periodic checkpoints if there is at least 1 other synced device in the room
		const syncedDevices = this.connectedDevices.filter((d) => !d.isStandalone);
		if (syncedDevices.length <= 1) return;

		// To avoid multiple speakers broadcasting simultaneously, only the first active audio device in the synced group sends the checkpoint
		const audioDevices = syncedDevices.filter((d) => d.isAudioOutput);
		if (audioDevices.length > 0 && audioDevices[0].deviceId !== this.deviceId) {
			return;
		}

		this.broadcastPlaybackState(false);
	}

	connectSyncStream(roomCode?: string) {
		if (typeof window === 'undefined' || !this.deviceId) return;

		if (this.eventSource) {
			try {
				this.eventSource.close();
			} catch {}
			this.eventSource = null;
		}

		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		// Also check if URL has ?room=CODE
		let effectiveRoomCode = roomCode;
		if (!effectiveRoomCode) {
			try {
				const urlParams = new URLSearchParams(window.location.search);
				const urlRoom = urlParams.get('room');
				if (urlRoom && urlRoom.trim()) {
					effectiveRoomCode = urlRoom.trim().toUpperCase();
				}
			} catch {}
		}

		const params = new URLSearchParams({
			deviceId: this.deviceId,
			deviceName: this.deviceName,
			standalone: this.standaloneMode ? 'true' : 'false'
		});
		if (effectiveRoomCode) {
			params.set('roomCode', effectiveRoomCode);
		}

		const es = new EventSource(`/api/sync/stream?${params.toString()}`);
		this.eventSource = es;

		es.onopen = () => {
			this.syncConnected = true;
		};

		es.addEventListener('welcome', (ev: MessageEvent) => {
			try {
				const data = JSON.parse(ev.data);
				this.updateServerClockOffset(data.serverNowMs);
				this.syncConnected = true;

				if (data.room) this.activeRoom = data.room;
				if (Array.isArray(data.devices)) this.connectedDevices = data.devices;
				if (Array.isArray(data.publicRooms)) this.publicRooms = data.publicRooms;

				if (typeof data.myStandalone === 'boolean') {
					this.standaloneMode = data.myStandalone;
					try {
						localStorage.setItem('traxvault_standalone_mode', data.myStandalone ? 'true' : 'false');
					} catch {}
				}

				if (typeof data.myAudioOutput === 'boolean') {
					this.applyLocalAudioOutputMode(this.standaloneMode ? true : data.myAudioOutput, data.state);
				}

				if (this.standaloneMode) {
					if (this.currentTrack) {
						this.broadcastPlaybackState(false);
					}
					return;
				}

				if (data.state && data.state.currentTrack) {
					// In a personal room, if this device just refreshed and was not playing audio on the server,
					// keep the restored track and position paused locally rather than letting the server start it
					this.applyRemotePlaybackState(data.state);
				} else if (this.currentTrack) {
					// Room has no track yet, but this device restored its last session -> seed room state (paused)!
					this.broadcastPlaybackState(false);
				}
			} catch (err) {
				console.warn('[Sync] Failed to parse welcome event:', err);
			}
		});

		es.addEventListener('state_updated', (ev: MessageEvent) => {
			try {
				const data = JSON.parse(ev.data);
				this.updateServerClockOffset(data.serverNowMs);
				if (data.room) this.activeRoom = data.room;
				if (this.standaloneMode) return;
				if (data.state) {
					this.applyRemotePlaybackState(data.state);
				}
			} catch (err) {
				console.warn('[Sync] Failed to parse state_updated event:', err);
			}
		});

		es.addEventListener('devices_updated', (ev: MessageEvent) => {
			try {
				const data = JSON.parse(ev.data);
				this.updateServerClockOffset(data.serverNowMs);
				if (data.room) this.activeRoom = data.room;
				if (Array.isArray(data.devices)) {
					this.connectedDevices = data.devices;
					const myDev = data.devices.find((d: SyncDeviceInfo) => d.deviceId === this.deviceId);
					if (myDev) {
						const wasStandalone = this.standaloneMode;
						if (typeof myDev.isStandalone === 'boolean' && myDev.isStandalone !== this.standaloneMode) {
							this.standaloneMode = myDev.isStandalone;
							try {
								localStorage.setItem('traxvault_standalone_mode', myDev.isStandalone ? 'true' : 'false');
							} catch {}
						}
						if (myDev.isAudioOutput !== this.localAudioEnabled) {
							this.applyLocalAudioOutputMode(myDev.isAudioOutput, data.state);
						} else if (wasStandalone && !this.standaloneMode && data.state) {
							this.applyRemotePlaybackState(data.state, true);
						}
					}
				}
			} catch (err) {
				console.warn('[Sync] Failed to parse devices_updated event:', err);
			}
		});

		es.addEventListener('room_updated', (ev: MessageEvent) => {
			try {
				const data = JSON.parse(ev.data);
				if (data.room) this.activeRoom = data.room;
			} catch {}
		});

		es.addEventListener('lobby_updated', (ev: MessageEvent) => {
			try {
				const data = JSON.parse(ev.data);
				if (Array.isArray(data.publicRooms)) {
					this.publicRooms = data.publicRooms;
				}
			} catch {}
		});

		es.onerror = () => {
			this.syncConnected = false;
			try {
				es.close();
			} catch {}
			if (this.eventSource === es) {
				this.eventSource = null;
			}
			if (!this.reconnectTimer) {
				this.reconnectTimer = setTimeout(() => {
					this.reconnectTimer = null;
					this.connectSyncStream();
				}, 3000);
			}
		};
	}

	private applyLocalAudioOutputMode(enableAudio: boolean, latestState?: SyncPlaybackState) {
		const changed = this.localAudioEnabled !== enableAudio;
		this.localAudioEnabled = enableAudio;

		if (!this.audioEl) return;

		if (!enableAudio) {
			// Switching into Companion / Lyrics Remote mode: mute/pause local <audio> without pausing room state
			this.isApplyingRemoteState = true;
			try {
				if (!this.audioEl.paused) {
					this.audioEl.pause();
				}
				this.audioUnlockRequired = false;
			} finally {
				this.isApplyingRemoteState = false;
			}
		} else if (changed && enableAudio && this.currentTrack) {
			// Switching from Companion mode into Active Audio Output mode: sync & start local <audio>
			if (latestState) {
				this.applyRemotePlaybackState(latestState, true);
			} else {
				const targetPos = this.computeExpectedRemotePositionSec();
				this.syncLocalAudioElement(this.currentTrack, targetPos, this.isPlaying, true);
			}
		}
	}

	private syncLocalAudioElement(
		track: Track,
		targetPositionSec: number,
		shouldPlay: boolean,
		forceSeek = false
	) {
		if (!this.audioEl || !this.localAudioEnabled) return;

		const expectedSrcPath = `/api/tracks/${track.id}/audio`;
		const needsSrcLoad =
			this.loadedAudioTrackId !== track.id ||
			!this.audioEl.src ||
			!this.audioEl.src.includes(expectedSrcPath);

		if (needsSrcLoad) {
			this.loadedAudioTrackId = track.id;
			this.audioEl.src = expectedSrcPath;
			this.audioEl.currentTime = Math.max(0, targetPositionSec);
		} else {
			const drift = Math.abs(this.audioEl.currentTime - targetPositionSec);
			if (forceSeek || drift > 0.35) {
				try {
					this.audioEl.currentTime = Math.max(0, targetPositionSec);
				} catch {}
			}
		}

		if (shouldPlay) {
			if (this.audioEl.paused) {
				this.audioEl
					.play()
					.then(() => {
						this.audioUnlockRequired = false;
						this.isPlaying = true;
					})
					.catch(() => {
						// Browser blocked unprompted autoplay; keep isPlaying=true for companion lyrics
						// and prompt user for 1-click audio unlock
						this.audioUnlockRequired = true;
						this.isPlaying = true;
					});
			}
		} else {
			if (!this.audioEl.paused) {
				this.audioEl.pause();
			}
			this.audioUnlockRequired = false;
		}
	}

	private applyRemotePlaybackState(state: SyncPlaybackState, forceAudioSync = false) {
		// If this state update was just broadcast by this exact device and we aren't forcing an audio mode switch,
		// ignore the echoed SSE packet so we don't mutate reactive object references or jitter currentTime.
		if (state.updatedByDeviceId === this.deviceId && !forceAudioSync) {
			return;
		}

		this.isApplyingRemoteState = true;
		try {
			this.lastSyncUpdatedBy = state.updatedByUsername || null;
			this.remoteRefPositionSec = Math.max(0, state.positionSec || 0);
			this.remoteRefServerMs = state.updatedAtServerMs || this.getEstimatedServerNowMs();

			const trackChanged = (this.currentTrack?.id ?? null) !== (state.currentTrack?.id ?? null);
			if (trackChanged) {
				this.currentTrack = state.currentTrack;
			}

			if (state.currentAlbum) {
				const albumChanged =
					!this.currentAlbum ||
					(this.currentAlbum.id ?? 0) !== (state.currentAlbum.id ?? 0) ||
					this.currentAlbum.title !== state.currentAlbum.title ||
					this.currentAlbum.cover_url !== state.currentAlbum.cover_url;
				if (albumChanged) {
					this.currentAlbum = {
						id: state.currentAlbum.id ?? 0,
						musicbrainz_id: null,
						title: state.currentAlbum.title,
						artist: state.currentAlbum.artist,
						release_year: null,
						genre: null,
						cover_url: state.currentAlbum.cover_url,
						media_type: null,
						notes: null,
						created_at: '',
						updated_at: '',
						tracks: state.activeQueue || []
					};
				}
			} else if (this.currentAlbum !== null && !state.currentTrack) {
				this.currentAlbum = null;
			}

			if (Array.isArray(state.activeQueue)) {
				const queueChanged =
					this.activeQueue.length !== state.activeQueue.length ||
					this.activeQueue.some((t, idx) => t.id !== state.activeQueue[idx]?.id);
				if (queueChanged) {
					this.activeQueue = state.activeQueue;
				}
			}
			if (typeof state.queueIndex === 'number' && this.queueIndex !== state.queueIndex) {
				this.queueIndex = state.queueIndex;
			}
			if (typeof state.shuffleEnabled === 'boolean' && this.shuffleEnabled !== state.shuffleEnabled) {
				this.shuffleEnabled = state.shuffleEnabled;
			}
			if (state.repeatMode && this.repeatMode !== state.repeatMode) {
				this.repeatMode = state.repeatMode;
			}

			const fallbackDuration =
				state.currentTrack?.duration_ms && state.currentTrack.duration_ms > 0
					? state.currentTrack.duration_ms / 1000
					: 0;
			if (state.durationSec && state.durationSec > 0) {
				this.duration = state.durationSec;
			} else if (fallbackDuration > 0 && (trackChanged || this.duration === 0)) {
				this.duration = fallbackDuration;
			}

			this.isPlaying = Boolean(state.isPlaying);
			const targetPos = this.computeExpectedRemotePositionSec();
			if (!this.localAudioEnabled || Math.abs(this.currentTime - targetPos) > 0.35 || trackChanged) {
				this.currentTime = targetPos;
			}

			if (state.currentTrack) {
				if (this.localAudioEnabled) {
					this.syncLocalAudioElement(
						state.currentTrack,
						targetPos,
						this.isPlaying,
						trackChanged || forceAudioSync
					);
				} else if (this.audioEl && !this.audioEl.paused) {
					this.audioEl.pause();
				}

				if (trackChanged && typeof document !== 'undefined') {
					const artist =
						state.currentTrack.artist ||
						(this.currentAlbum ? this.currentAlbum.artist : 'Trax Vault');
					document.title = `${state.currentTrack.title} • ${artist} | Trax Vault`;
				}
			} else {
				if (this.audioEl && !this.audioEl.paused) {
					this.audioEl.pause();
				}
			}

			if (trackChanged) {
				this.updateMediaSession();
			}

			this.persistSessionSnapshot();
		} finally {
			this.isApplyingRemoteState = false;
		}
	}

	private async broadcastPlaybackState(activateLocalAudioIfNone = true) {
		if (this.isApplyingRemoteState || !this.deviceId || typeof fetch === 'undefined') return;

		const durationSec =
			this.duration > 0
				? this.duration
				: this.currentTrack?.duration_ms
					? this.currentTrack.duration_ms / 1000
					: 0;

		const statePayload: Partial<SyncPlaybackState> = {
			currentTrack: this.currentTrack,
			currentAlbum: this.currentAlbum
				? {
						id: this.currentAlbum.id,
						title: this.currentAlbum.title,
						artist: this.currentAlbum.artist,
						cover_url: this.currentAlbum.cover_url
					}
				: null,
			activeQueue: this.activeQueue,
			queueIndex: this.queueIndex,
			isPlaying: this.isPlaying,
			positionSec: this.currentTime,
			durationSec,
			shuffleEnabled: this.shuffleEnabled,
			repeatMode: this.repeatMode
		};

		try {
			const res = await fetch('/api/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'update_state',
					deviceId: this.deviceId,
					deviceName: this.deviceName,
					state: statePayload,
					activateLocalAudioIfNone
				})
			});
			if (res.ok) {
				const data = await res.json();
				this.updateServerClockOffset(data.serverNowMs);
			}
		} catch (err) {
			console.warn('[Sync] Failed to broadcast playback state:', err);
		}
	}

	unlockAudioPlayback() {
		if (!this.currentTrack) return;
		this.localAudioEnabled = true;
		this.audioUnlockRequired = false;
		const targetPos = this.computeExpectedRemotePositionSec();
		this.syncLocalAudioElement(this.currentTrack, targetPos, this.isPlaying, true);
	}

	async setLocalAudioMode(enableAudio: boolean, exclusive = false, targetDeviceId?: string) {
		const targetId = targetDeviceId || this.deviceId;
		if (targetId === this.deviceId) {
			this.standaloneMode = false;
			try {
				localStorage.setItem('traxvault_standalone_mode', 'false');
			} catch {}
			this.applyLocalAudioOutputMode(enableAudio);
		}

		try {
			const res = await fetch('/api/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'set_device_audio',
					deviceId: this.deviceId,
					targetDeviceId: targetId,
					isAudioOutput: enableAudio,
					exclusive
				})
			});
			const data = await res.json();
			if (res.ok) {
				this.updateServerClockOffset(data.serverNowMs);
				if (data.room) this.activeRoom = data.room;
				if (Array.isArray(data.devices)) this.connectedDevices = data.devices;
				if (!this.standaloneMode && data.state && data.state.currentTrack) {
					this.applyRemotePlaybackState(data.state, true);
				}
			}
		} catch (err) {
			console.warn('[Sync] Failed to set device audio mode:', err);
		}
	}

	async setStandaloneMode(isStandalone: boolean, targetDeviceId?: string) {
		const targetId = targetDeviceId || this.deviceId;
		if (targetId === this.deviceId) {
			this.standaloneMode = isStandalone;
			try {
				localStorage.setItem('traxvault_standalone_mode', isStandalone ? 'true' : 'false');
			} catch {}
			if (isStandalone) {
				this.applyLocalAudioOutputMode(true);
			}
		}

		try {
			const res = await fetch('/api/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'set_device_standalone',
					deviceId: this.deviceId,
					targetDeviceId: targetId,
					isStandalone
				})
			});
			const data = await res.json();
			if (res.ok) {
				this.updateServerClockOffset(data.serverNowMs);
				if (data.room) this.activeRoom = data.room;
				if (Array.isArray(data.devices)) this.connectedDevices = data.devices;
				if (!isStandalone && targetId === this.deviceId && data.state && data.state.currentTrack) {
					this.applyRemotePlaybackState(data.state, true);
				}
			}
		} catch (err) {
			console.warn('[Sync] Failed to set standalone mode:', err);
		}
	}

	async syncWithDevice(targetDeviceId: string, audioOutputOnCaller?: boolean) {
		this.standaloneMode = false;
		try {
			localStorage.setItem('traxvault_standalone_mode', 'false');
		} catch {}
		if (typeof audioOutputOnCaller === 'boolean') {
			this.localAudioEnabled = audioOutputOnCaller;
		}

		try {
			const res = await fetch('/api/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'sync_with_device',
					deviceId: this.deviceId,
					targetDeviceId,
					audioOutputOnCaller
				})
			});
			const data = await res.json();
			if (res.ok) {
				this.updateServerClockOffset(data.serverNowMs);
				if (data.room) this.activeRoom = data.room;
				if (Array.isArray(data.devices)) this.connectedDevices = data.devices;
				if (data.state && data.state.currentTrack) {
					this.applyRemotePlaybackState(data.state, true);
				}
			}
		} catch (err) {
			console.warn('[Sync] Failed to sync with target device:', err);
		}
	}

	async updateDeviceName(newName: string) {
		const clean = newName.trim().slice(0, 50);
		if (!clean) return;
		this.deviceName = clean;
		try {
			localStorage.setItem('traxvault_device_name', clean);
		} catch {}

		try {
			const res = await fetch('/api/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'rename_device',
					deviceId: this.deviceId,
					deviceName: clean
				})
			});
			const data = await res.json();
			if (res.ok && Array.isArray(data.devices)) {
				this.connectedDevices = data.devices;
			}
		} catch (err) {
			console.warn('[Sync] Failed to rename device:', err);
		}
	}

	async createListeningRoom(options: {
		roomName: string;
		isPublic: boolean;
		allowGuestControl: boolean;
	}): Promise<{ ok: boolean; error?: string; code?: string | null }> {
		try {
			const durationSec =
				this.duration > 0
					? this.duration
					: this.currentTrack?.duration_ms
						? this.currentTrack.duration_ms / 1000
						: 0;

			const res = await fetch('/api/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'create_room',
					deviceId: this.deviceId,
					deviceName: this.deviceName,
					roomName: options.roomName,
					isPublic: options.isPublic,
					allowGuestControl: options.allowGuestControl,
					initialState: {
						currentTrack: this.currentTrack,
						currentAlbum: this.currentAlbum
							? {
									id: this.currentAlbum.id,
									title: this.currentAlbum.title,
									artist: this.currentAlbum.artist,
									cover_url: this.currentAlbum.cover_url
								}
							: null,
						activeQueue: this.activeQueue,
						queueIndex: this.queueIndex,
						isPlaying: this.isPlaying,
						positionSec: this.currentTime,
						durationSec,
						shuffleEnabled: this.shuffleEnabled,
						repeatMode: this.repeatMode
					}
				})
			});
			const data = await res.json();
			if (!res.ok) {
				return { ok: false, error: data.error || 'Failed to create room.' };
			}
			this.updateServerClockOffset(data.serverNowMs);
			if (data.room) this.activeRoom = data.room;
			if (Array.isArray(data.devices)) this.connectedDevices = data.devices;
			if (Array.isArray(data.publicRooms)) this.publicRooms = data.publicRooms;
			this.localAudioEnabled = true;
			return { ok: true, code: data.room?.code };
		} catch (err: any) {
			return { ok: false, error: err?.message || 'Network error creating room.' };
		}
	}

	async joinListeningRoom(roomCode: string): Promise<{ ok: boolean; error?: string }> {
		try {
			const res = await fetch('/api/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'join_room',
					deviceId: this.deviceId,
					deviceName: this.deviceName,
					roomCode: roomCode.trim().toUpperCase()
				})
			});
			const data = await res.json();
			if (!res.ok) {
				return { ok: false, error: data.error || 'Could not join room.' };
			}
			this.updateServerClockOffset(data.serverNowMs);
			if (data.room) this.activeRoom = data.room;
			if (Array.isArray(data.devices)) this.connectedDevices = data.devices;
			if (Array.isArray(data.publicRooms)) this.publicRooms = data.publicRooms;
			this.applyLocalAudioOutputMode(true, data.state);
			if (data.state) {
				this.applyRemotePlaybackState(data.state, true);
			}
			return { ok: true };
		} catch (err: any) {
			return { ok: false, error: err?.message || 'Network error joining room.' };
		}
	}

	async leaveListeningRoom(): Promise<void> {
		try {
			const res = await fetch('/api/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'leave_room',
					deviceId: this.deviceId
				})
			});
			const data = await res.json();
			if (res.ok) {
				this.updateServerClockOffset(data.serverNowMs);
				if (data.room) this.activeRoom = data.room;
				if (Array.isArray(data.devices)) this.connectedDevices = data.devices;
				if (Array.isArray(data.publicRooms)) this.publicRooms = data.publicRooms;
			}
		} catch (err) {
			console.warn('[Sync] Failed to leave room:', err);
		}
	}

	async updateRoomSettings(settings: {
		isPublic?: boolean;
		allowGuestControl?: boolean;
		name?: string;
	}): Promise<void> {
		try {
			const res = await fetch('/api/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'update_room_settings',
					deviceId: this.deviceId,
					...settings
				})
			});
			const data = await res.json();
			if (res.ok && data.room) {
				this.activeRoom = data.room;
				if (Array.isArray(data.publicRooms)) this.publicRooms = data.publicRooms;
			}
		} catch (err) {
			console.warn('[Sync] Failed to update room settings:', err);
		}
	}

	async refreshPublicRooms(): Promise<void> {
		try {
			const res = await fetch(`/api/sync?deviceId=${encodeURIComponent(this.deviceId)}`);
			if (res.ok) {
				const data = await res.json();
				if (Array.isArray(data.publicRooms)) {
					this.publicRooms = data.publicRooms;
				}
			}
		} catch {}
	}

	openSyncModal(tab: 'devices' | 'rooms' = 'devices') {
		this.syncModalTab = tab;
		this.showSyncModal = true;
		this.refreshPublicRooms();
	}

	closeSyncModal() {
		this.showSyncModal = false;
	}

	private updatePlaybackState(state: 'playing' | 'paused' | 'none') {
		if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
			try {
				navigator.mediaSession.playbackState = state;
			} catch {}
		}
	}

	private setupMediaSession() {
		if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

		try {
			navigator.mediaSession.setActionHandler('play', () => this.play());
			navigator.mediaSession.setActionHandler('pause', () => this.pause());
			navigator.mediaSession.setActionHandler('stop', () => this.pause());
			navigator.mediaSession.setActionHandler('previoustrack', () => this.previousTrack());
			navigator.mediaSession.setActionHandler('nexttrack', () => this.nextTrack());
			navigator.mediaSession.setActionHandler('seekto', (details) => {
				if (details.seekTime !== undefined) {
					this.seekTo(details.seekTime);
				}
			});
		} catch (err) {
			console.warn('[MediaSession] Action handler setup error:', err);
		}
	}

	private updateMediaSession() {
		if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

		if (!this.currentTrack) {
			try {
				navigator.mediaSession.metadata = null;
				navigator.mediaSession.playbackState = 'none';
			} catch {}
			return;
		}

		const artist =
			this.currentTrack.artist || (this.currentAlbum ? this.currentAlbum.artist : 'Trax Vault');
		const albumTitle = this.currentAlbum ? this.currentAlbum.title : 'Trax Vault';
		const artworkUrl = this.currentAlbum?.cover_url;

		try {
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
			navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused';
		} catch (err) {
			console.warn('[MediaSession] Failed to update metadata:', err);
		}
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

		this.currentTime = 0;
		this.duration =
			track.duration_ms && track.duration_ms > 0 ? track.duration_ms / 1000 : this.duration;
		this.remoteRefPositionSec = 0;
		this.remoteRefServerMs = this.getEstimatedServerNowMs();

		// If no device in the room is currently set to output audio, enable local audio on this device
		const anyAudioDevice = this.connectedDevices.some((d) => d.isAudioOutput);
		if (!this.localAudioEnabled && !anyAudioDevice) {
			this.localAudioEnabled = true;
		}

		if (this.audioEl && this.localAudioEnabled) {
			this.loadedAudioTrackId = track.id;
			this.audioEl.src = `/api/tracks/${track.id}/audio`;
			this.audioEl
				.play()
				.then(() => {
					this.audioUnlockRequired = false;
					this.isPlaying = true;
				})
				.catch((err) => {
					console.warn('Playback error:', err);
					this.isPlaying = false;
				});
		} else {
			// Companion Mode remote control: set isPlaying=true and broadcast to active speaker device
			this.isPlaying = true;
		}

		if (typeof document !== 'undefined') {
			const artist = track.artist || (this.currentAlbum ? this.currentAlbum.artist : 'Trax Vault');
			document.title = `${track.title} • ${artist} | Trax Vault`;
		}

		this.updateMediaSession();
		this.persistSessionSnapshot();
		this.broadcastPlaybackState(true);
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

	play() {
		if (!this.currentTrack) {
			if (this.activeQueue.length > 0) {
				this.playTrack(this.activeQueue[0]);
			}
			return;
		}

		const anyAudioDevice = this.connectedDevices.some((d) => d.isAudioOutput);
		if (!this.localAudioEnabled && !anyAudioDevice) {
			this.localAudioEnabled = true;
		}

		this.remoteRefPositionSec = this.currentTime;
		this.remoteRefServerMs = this.getEstimatedServerNowMs();

		if (this.localAudioEnabled && this.audioEl) {
			const expectedSrcPath = `/api/tracks/${this.currentTrack.id}/audio`;
			if (!this.audioEl.src || !this.audioEl.src.includes(expectedSrcPath)) {
				this.loadedAudioTrackId = this.currentTrack.id;
				this.audioEl.src = expectedSrcPath;
				this.audioEl.currentTime = Math.max(0, this.currentTime);
			}
			this.audioEl
				.play()
				.then(() => {
					this.audioUnlockRequired = false;
					this.isPlaying = true;
					this.updatePlaybackState('playing');
					this.broadcastPlaybackState(true);
				})
				.catch((e) => {
					console.warn('Play error:', e);
					this.isPlaying = false;
					this.updatePlaybackState('paused');
				});
		} else {
			// Companion Mode: remotely resume playback on active speaker device
			this.isPlaying = true;
			this.updatePlaybackState('playing');
			this.broadcastPlaybackState(true);
		}
	}

	pause() {
		if (this.audioEl && !this.audioEl.paused) {
			this.audioEl.pause();
		}
		this.isPlaying = false;
		this.remoteRefPositionSec = this.currentTime;
		this.remoteRefServerMs = this.getEstimatedServerNowMs();
		this.updatePlaybackState('paused');
		this.persistSessionSnapshot();
		this.broadcastPlaybackState(false);
	}

	togglePlay() {
		if (this.audioUnlockRequired && this.localAudioEnabled) {
			this.unlockAudioPlayback();
			return;
		}
		if (this.isPlaying) {
			this.pause();
		} else {
			this.play();
		}
	}

	private handleTrackEnded() {
		if (this.repeatMode === 'one' && this.currentTrack) {
			this.currentTime = 0;
			this.remoteRefPositionSec = 0;
			this.remoteRefServerMs = this.getEstimatedServerNowMs();
			if (this.audioEl && this.localAudioEnabled) {
				this.audioEl.currentTime = 0;
				this.audioEl.play().catch((e) => console.warn(e));
			}
			this.isPlaying = true;
			this.broadcastPlaybackState(false);
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
				this.broadcastPlaybackState(false);
				return;
			}
		}

		const next = this.activeQueue[nextIdx];
		if (next) {
			this.playTrack(next, this.currentAlbum || undefined, this.activeQueue);
		}
	}

	previousTrack() {
		if (this.currentTime > 3) {
			this.seekTo(0);
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
		const maxDur =
			this.duration ||
			(this.currentTrack?.duration_ms ? this.currentTrack.duration_ms / 1000 : 100);
		const clamped = Math.max(0, Math.min(seconds, maxDur));
		if (this.audioEl && this.localAudioEnabled) {
			try {
				this.audioEl.currentTime = clamped;
			} catch {}
		}
		this.currentTime = clamped;
		this.remoteRefPositionSec = clamped;
		this.remoteRefServerMs = this.getEstimatedServerNowMs();
		this.persistSessionSnapshot();
		this.broadcastPlaybackState(false);
	}

	/**
	 * Computes human-perceived logarithmic audio gain from linear slider volume (0..1)
	 * Standard audio power taper (gamma = 2.2) provides a natural loudness transition
	 * across the entire slider range, eliminating abrupt drops.
	 */
	getEffectiveGain(): number {
		if (this.isMuted || this.volume <= 0) return 0;
		return Math.min(1, Math.max(0, Math.pow(this.volume, 2.2)));
	}

	setVolume(val: number) {
		const clamped = Math.max(0, Math.min(1, val));
		this.volume = clamped;
		if (this.isMuted && clamped > 0) {
			this.isMuted = false;
		}
		if (this.audioEl) {
			this.audioEl.volume = this.getEffectiveGain();
		}
		try {
			localStorage.setItem('traxvault_player_volume', clamped.toString());
		} catch {}
	}

	toggleMute() {
		this.isMuted = !this.isMuted;
		if (this.audioEl) {
			this.audioEl.volume = this.getEffectiveGain();
		}
	}

	toggleShuffle() {
		this.shuffleEnabled = !this.shuffleEnabled;
		try {
			localStorage.setItem('traxvault_player_shuffle', this.shuffleEnabled.toString());
		} catch {}
		this.broadcastPlaybackState(false);
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
		this.broadcastPlaybackState(false);
	}

	stop() {
		if (this.audioEl) {
			this.audioEl.pause();
			this.audioEl.currentTime = 0;
			this.audioEl.src = '';
		}
		this.loadedAudioTrackId = null;
		this.currentTrack = null;
		this.isPlaying = false;
		this.currentTime = 0;
		this.duration = 0;
		this.remoteRefPositionSec = 0;
		this.updatePlaybackState('none');
		try {
			localStorage.removeItem('traxvault_last_session');
		} catch {}
		if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
			try {
				navigator.mediaSession.metadata = null;
			} catch {}
		}
		if (typeof document !== 'undefined') {
			document.title = 'Trax Vault - Music Quality & Lyrics Tracker';
		}
		this.broadcastPlaybackState(false);
	}
}

export const player = new GlobalPlayer();
