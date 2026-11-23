import type { Track, Album } from '$lib/types/index.js';

export interface OfflineTrack {
	id: number;
	title: string;
	artist: string;
	album_title: string;
	album_id: number;
	track_number: number;
	duration: number;
	format: string;
	bitrate_kbps: number | null;
	audio_blob: Blob;
	audio_mime: string;
	lyrics_text: string | null;
	lyrics_status: string | null;
	cover_url: string | null;
	cover_blob: Blob | null;
	downloaded_at: number;
	file_size: number;
}

export interface OfflineAlbum {
	id: number;
	title: string;
	artist: string;
	cover_url: string | null;
	cover_blob: Blob | null;
	track_ids: number[];
	downloaded_at: number;
}

export interface OfflinePlaylist {
	id: number;
	name: string;
	track_ids: number[];
	downloaded_at: number;
}

export interface DownloadQueueItem {
	id: string;
	track: Track;
	album?: { id?: number; title?: string; artist?: string; cover_url?: string | null };
	playlist?: { id?: number; name?: string };
	quality: 'original' | '320' | '192' | '128';
	status: 'pending' | 'downloading' | 'completed' | 'failed';
	progressPercent: number;
	error?: string;
}

export interface QueueSummary {
	isDownloading: boolean;
	isPaused: boolean;
	totalItems: number;
	completedItems: number;
	failedItems: number;
	overallProgressPercent: number;
	activeTrackTitle: string;
	activeParentTitle: string;
	activeTrackPercent: number;
}

const DB_NAME = 'traxvault_offline_v1';
const DB_VERSION = 1;

class OfflineStorageManager {
	downloadedTrackIds = $state<Set<number>>(new Set());
	downloadedAlbumIds = $state<Set<number>>(new Set());
	downloadedPlaylistIds = $state<Set<number>>(new Set());

	// Queue State
	downloadQueue = $state<DownloadQueueItem[]>([]);
	activeItem = $state<DownloadQueueItem | null>(null);
	completedCount = $state<number>(0);
	totalBatchCount = $state<number>(0);
	failedItems = $state<DownloadQueueItem[]>([]);
	isPaused = $state<boolean>(false);

	isDownloading = $state(false);
	downloadProgress = $state<Record<number, number>>({});
	currentDownloadLabel = $state<string>('');

	offlineStorageBytes = $state<number>(0);
	offlineTrackCount = $state<number>(0);

	downloadQuality = $state<'original' | '320' | '192' | '128'>('original');

	private db: IDBDatabase | null = null;
	private initPromise: Promise<IDBDatabase> | null = null;
	private activeObjectUrls: Map<number, string> = new Map();
	private isProcessingQueue = false;
	private pendingAlbumsMeta: Map<number, { album: any; requiredTrackIds: number[]; coverBlob: Blob | null }> = new Map();
	private pendingPlaylistsMeta: Map<number, { playlist: any; requiredTrackIds: number[] }> = new Map();

	constructor() {
		if (typeof window !== 'undefined') {
			try {
				const savedQuality = localStorage.getItem('traxvault_download_quality');
				if (savedQuality && ['original', '320', '192', '128'].includes(savedQuality)) {
					this.downloadQuality = savedQuality as any;
				}
			} catch {}
			this.init();
		}
	}

	async init(): Promise<IDBDatabase> {
		if (this.db) return this.db;
		if (this.initPromise) return this.initPromise;

		if (typeof window === 'undefined' || !window.indexedDB) {
			return Promise.reject(new Error('IndexedDB not supported'));
		}

		this.initPromise = new Promise((resolve, reject) => {
			const req = indexedDB.open(DB_NAME, DB_VERSION);

			req.onupgradeneeded = (e) => {
				const db = (e.target as IDBOpenDBRequest).result;
				if (!db.objectStoreNames.contains('tracks')) {
					const trackStore = db.createObjectStore('tracks', { keyPath: 'id' });
					trackStore.createIndex('album_id', 'album_id', { unique: false });
				}
				if (!db.objectStoreNames.contains('albums')) {
					db.createObjectStore('albums', { keyPath: 'id' });
				}
				if (!db.objectStoreNames.contains('playlists')) {
					db.createObjectStore('playlists', { keyPath: 'id' });
				}
			};

			req.onsuccess = () => {
				this.db = req.result;
				this.refreshCachedIds().catch(() => {});
				this.refreshStats().catch(() => {});
				resolve(this.db);
			};

			req.onerror = () => {
				console.error('[OfflineStorage] Failed to open IndexedDB:', req.error);
				reject(req.error);
			};
		});

		return this.initPromise;
	}

	setDownloadQuality(quality: 'original' | '320' | '192' | '128') {
		this.downloadQuality = quality;
		try {
			localStorage.setItem('traxvault_download_quality', quality);
		} catch {}
	}

	isDownloaded(trackId: number): boolean {
		return this.downloadedTrackIds.has(trackId);
	}

	isDownloadingTrack(trackId: number): boolean {
		return this.activeItem?.track.id === trackId || trackId in this.downloadProgress;
	}

	isAlbumDownloaded(albumId: number): boolean {
		return this.downloadedAlbumIds.has(albumId);
	}

	isPlaylistDownloaded(playlistId: number): boolean {
		return this.downloadedPlaylistIds.has(playlistId);
	}

	isAlbumQueued(albumId: number): boolean {
		if (this.activeItem?.album?.id === albumId) return true;
		return this.downloadQueue.some((item) => item.album?.id === albumId);
	}

	isAlbumDownloading(albumId: number): boolean {
		return this.activeItem?.album?.id === albumId;
	}

	getAlbumDownloadProgress(albumId: number, totalTracksCount = 0): { downloaded: number; queued: number; total: number; percent: number } | null {
		const queuedCount = this.downloadQueue.filter((item) => item.album?.id === albumId).length + (this.activeItem?.album?.id === albumId ? 1 : 0);
		if (queuedCount === 0 && !this.isAlbumDownloaded(albumId)) return null;

		const total = totalTracksCount > 0 ? totalTracksCount : queuedCount;
		const downloaded = Math.max(0, total - queuedCount);
		const percent = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 100;
		return { downloaded, queued: queuedCount, total, percent };
	}

	get queueSummary(): QueueSummary {
		const totalItems = this.totalBatchCount > 0 ? this.totalBatchCount : this.completedCount + this.downloadQueue.length + (this.activeItem ? 1 : 0);
		const activeTrackPercent = this.activeItem ? (this.downloadProgress[this.activeItem.track.id] ?? this.activeItem.progressPercent) : 0;
		const overallProgressPercent = totalItems > 0
			? Math.min(100, Math.round(((this.completedCount + activeTrackPercent / 100) / totalItems) * 100))
			: 0;

		return {
			isDownloading: this.isDownloading,
			isPaused: this.isPaused,
			totalItems,
			completedItems: this.completedCount,
			failedItems: this.failedItems.length,
			overallProgressPercent,
			activeTrackTitle: this.activeItem?.track.title || '',
			activeParentTitle: this.activeItem?.album?.title || this.activeItem?.playlist?.name || '',
			activeTrackPercent
		};
	}

	private async refreshCachedIds() {
		try {
			const db = await this.init();
			const tx = db.transaction(['tracks', 'albums', 'playlists'], 'readonly');

			const trackReq = tx.objectStore('tracks').getAllKeys();
			const albumReq = tx.objectStore('albums').getAllKeys();
			const playlistReq = tx.objectStore('playlists').getAllKeys();

			await new Promise<void>((resolve, reject) => {
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});

			this.downloadedTrackIds = new Set(trackReq.result.map((k) => Number(k)));
			this.downloadedAlbumIds = new Set(albumReq.result.map((k) => Number(k)));
			this.downloadedPlaylistIds = new Set(playlistReq.result.map((k) => Number(k)));
		} catch (err) {
			console.warn('[OfflineStorage] Error refreshing cached IDs:', err);
		}
	}

	async refreshStats() {
		try {
			const db = await this.init();
			const tx = db.transaction(['tracks'], 'readonly');
			const store = tx.objectStore('tracks');
			const req = store.getAll();

			await new Promise<void>((resolve, reject) => {
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});

			const tracks: OfflineTrack[] = req.result || [];
			this.offlineTrackCount = tracks.length;
			let totalBytes = 0;
			for (const t of tracks) {
				totalBytes += t.file_size || 0;
				if (t.cover_blob) totalBytes += t.cover_blob.size;
			}
			this.offlineStorageBytes = totalBytes;
		} catch (err) {
			console.warn('[OfflineStorage] Error calculating storage stats:', err);
		}
	}

	async getOfflineTrack(trackId: number): Promise<OfflineTrack | null> {
		try {
			const db = await this.init();
			return new Promise((resolve) => {
				const tx = db.transaction('tracks', 'readonly');
				const req = tx.objectStore('tracks').get(trackId);
				req.onsuccess = () => resolve(req.result || null);
				req.onerror = () => resolve(null);
			});
		} catch {
			return null;
		}
	}

	getBlobUrlForTrack(offlineTrack: OfflineTrack): string {
		const existing = this.activeObjectUrls.get(offlineTrack.id);
		if (existing) return existing;

		const url = URL.createObjectURL(offlineTrack.audio_blob);
		this.activeObjectUrls.set(offlineTrack.id, url);
		return url;
	}

	revokeTrackBlobUrl(trackId: number) {
		const url = this.activeObjectUrls.get(trackId);
		if (url) {
			URL.revokeObjectURL(url);
			this.activeObjectUrls.delete(trackId);
		}
	}

	/**
	 * Enqueue a single track for download.
	 */
	enqueueTrack(
		track: Track,
		album?: { id?: number; title?: string; artist?: string; cover_url?: string | null },
		playlist?: { id?: number; name?: string },
		quality?: 'original' | '320' | '192' | '128'
	) {
		if (this.isDownloaded(track.id)) return;
		if (this.downloadQueue.some((item) => item.track.id === track.id) || this.activeItem?.track.id === track.id) {
			return;
		}

		const item: DownloadQueueItem = {
			id: `${track.id}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
			track,
			album,
			playlist,
			quality: quality || this.downloadQuality,
			status: 'pending',
			progressPercent: 0
		};

		this.downloadQueue.push(item);
		this.downloadQueue = [...this.downloadQueue];
		this.totalBatchCount = Math.max(this.totalBatchCount, this.completedCount + this.downloadQueue.length + (this.activeItem ? 1 : 0));
		this.processQueue();
	}

	/**
	 * Enqueue an entire album for download.
	 */
	async enqueueAlbum(
		album: { id: number; title: string; artist: string; cover_url?: string | null; tracks: Track[] },
		quality?: 'original' | '320' | '192' | '128'
	) {
		if (!album.tracks || album.tracks.length === 0) return;

		const effQuality = quality || this.downloadQuality;
		const missingTracks = album.tracks.filter(
			(t) => !this.isDownloaded(t.id) &&
				!this.downloadQueue.some((q) => q.track.id === t.id) &&
				this.activeItem?.track.id !== t.id
		);

		// If all tracks are already downloaded, ensure album record exists in IDB
		if (missingTracks.length === 0) {
			if (!this.isAlbumDownloaded(album.id)) {
				await this.saveAlbumMetadata(album);
			}
			return;
		}

		// Register pending album metadata for finalization when tracks finish
		if (!this.pendingAlbumsMeta.has(album.id)) {
			let coverBlob: Blob | null = null;
			if (album.cover_url) {
				try {
					const res = await fetch(album.cover_url);
					if (res.ok) coverBlob = await res.blob();
				} catch {}
			}
			this.pendingAlbumsMeta.set(album.id, {
				album,
				requiredTrackIds: album.tracks.map((t) => t.id),
				coverBlob
			});
		}

		for (const track of missingTracks) {
			this.downloadQueue.push({
				id: `${track.id}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
				track,
				album,
				quality: effQuality,
				status: 'pending',
				progressPercent: 0
			});
		}

		this.downloadQueue = [...this.downloadQueue];
		this.totalBatchCount = this.completedCount + this.downloadQueue.length + (this.activeItem ? 1 : 0);
		this.processQueue();
	}

	/**
	 * Bulk enqueue multiple albums for download (e.g. Download All Library).
	 */
	async enqueueAlbums(
		albums: Array<{ id: number; title: string; artist: string; cover_url?: string | null; tracks: Track[] }>,
		quality?: 'original' | '320' | '192' | '128'
	) {
		for (const album of albums) {
			await this.enqueueAlbum(album, quality);
		}
	}

	/**
	 * Bulk enqueue an artist's entire catalog.
	 */
	async enqueueArtist(
		artistName: string,
		albums: Array<{ id: number; title: string; artist: string; cover_url?: string | null; tracks: Track[] }>,
		standaloneTracks?: Track[],
		quality?: 'original' | '320' | '192' | '128'
	) {
		if (albums && albums.length > 0) {
			await this.enqueueAlbums(albums, quality);
		}
		if (standaloneTracks && standaloneTracks.length > 0) {
			for (const t of standaloneTracks) {
				this.enqueueTrack(t, undefined, undefined, quality);
			}
		}
	}

	/**
	 * Enqueue an entire playlist for download.
	 */
	async enqueuePlaylist(
		playlist: { id: number; name: string; tracks?: Track[] },
		quality?: 'original' | '320' | '192' | '128'
	) {
		if (!playlist.tracks || playlist.tracks.length === 0) return;
		const effQuality = quality || this.downloadQuality;

		const missingTracks = playlist.tracks.filter(
			(t) => !this.isDownloaded(t.id) &&
				!this.downloadQueue.some((q) => q.track.id === t.id) &&
				this.activeItem?.track.id !== t.id
		);

		if (missingTracks.length === 0) {
			if (!this.isPlaylistDownloaded(playlist.id)) {
				await this.savePlaylistMetadata(playlist);
			}
			return;
		}

		if (!this.pendingPlaylistsMeta.has(playlist.id)) {
			this.pendingPlaylistsMeta.set(playlist.id, {
				playlist,
				requiredTrackIds: playlist.tracks.map((t) => t.id)
			});
		}

		for (const track of missingTracks) {
			this.downloadQueue.push({
				id: `${track.id}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
				track,
				playlist,
				quality: effQuality,
				status: 'pending',
				progressPercent: 0
			});
		}

		this.downloadQueue = [...this.downloadQueue];
		this.totalBatchCount = this.completedCount + this.downloadQueue.length + (this.activeItem ? 1 : 0);
		this.processQueue();
	}

	pauseQueue() {
		this.isPaused = true;
	}

	resumeQueue() {
		this.isPaused = false;
		this.processQueue();
	}

	cancelQueue() {
		this.downloadQueue = [];
		this.activeItem = null;
		this.isDownloading = false;
		this.currentDownloadLabel = '';
		this.completedCount = 0;
		this.totalBatchCount = 0;
		this.downloadProgress = {};
	}

	cancelAlbum(albumId: number) {
		this.downloadQueue = this.downloadQueue.filter((item) => item.album?.id !== albumId);
		this.pendingAlbumsMeta.delete(albumId);
		if (this.activeItem?.album?.id === albumId) {
			// Current track will finish, remaining were purged
		}
	}

	retryFailed() {
		if (this.failedItems.length === 0) return;
		const toRetry = [...this.failedItems];
		this.failedItems = [];
		for (const item of toRetry) {
			item.status = 'pending';
			item.error = undefined;
			this.downloadQueue.push(item);
		}
		this.downloadQueue = [...this.downloadQueue];
		this.totalBatchCount += toRetry.length;
		this.processQueue();
	}

	clearFailed() {
		this.failedItems = [];
	}

	/**
	 * Core background queue worker loop.
	 * Executes sequentially to prevent bandwidth contention and mobile resource limits.
	 */
	private async processQueue() {
		if (this.isProcessingQueue || this.isPaused) return;
		if (this.downloadQueue.length === 0) {
			if (!this.activeItem) {
				this.isDownloading = false;
				this.currentDownloadLabel = '';
				// Clean up any completed pending albums
				await this.checkAllPendingAlbums();
			}
			return;
		}

		this.isProcessingQueue = true;
		this.isDownloading = true;

		while (this.downloadQueue.length > 0 && !this.isPaused) {
			const item = this.downloadQueue.shift();
			if (!item) break;

			// Skip if somehow already downloaded
			if (this.isDownloaded(item.track.id)) {
				this.completedCount++;
				await this.checkPendingAlbumsForTrack(item.track.id);
				continue;
			}

			this.activeItem = item;
			item.status = 'downloading';
			this.downloadProgress[item.track.id] = 0;
			this.currentDownloadLabel = `Downloading "${item.track.title}"${item.album ? ` • ${item.album.title}` : ''}...`;

			const success = await this.executeTrackDownload(item);

			delete this.downloadProgress[item.track.id];
			this.downloadProgress = { ...this.downloadProgress };

			if (success) {
				item.status = 'completed';
				this.completedCount++;
				this.downloadedTrackIds.add(item.track.id);
				this.downloadedTrackIds = new Set(this.downloadedTrackIds);
				await this.checkPendingAlbumsForTrack(item.track.id);
				await this.checkPendingPlaylistsForTrack(item.track.id);
			} else {
				item.status = 'failed';
				this.failedItems.push(item);
				this.failedItems = [...this.failedItems];
			}

			this.activeItem = null;
		}

		this.isProcessingQueue = false;

		if (this.downloadQueue.length === 0 && !this.activeItem) {
			this.isDownloading = false;
			this.currentDownloadLabel = '';
			await this.checkAllPendingAlbums();
			await this.refreshStats();
		}
	}

	private async executeTrackDownload(item: DownloadQueueItem): Promise<boolean> {
		const track = item.track;
		const effQuality = item.quality;

		try {
			const audioUrl =
				effQuality === 'original'
					? `/api/tracks/${track.id}/audio?download=true`
					: `/api/tracks/${track.id}/audio?download=true&bitrate=${effQuality}&format=mp3`;

			// 1. Download audio file with chunked progress
			const audioRes = await fetch(audioUrl);
			if (!audioRes.ok) throw new Error(`HTTP ${audioRes.status}`);

			const contentLength = Number(audioRes.headers.get('content-length') || 0);
			const contentType = audioRes.headers.get('content-type') || 'audio/mpeg';

			let audioBlob: Blob;
			if (audioRes.body && contentLength > 0) {
				const reader = audioRes.body.getReader();
				const chunks: Uint8Array[] = [];
				let receivedBytes = 0;

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					if (value) {
						chunks.push(value);
						receivedBytes += value.length;
						const pct = Math.round((receivedBytes / contentLength) * 90);
						this.downloadProgress[track.id] = pct;
						item.progressPercent = pct;
					}
				}
				audioBlob = new Blob(chunks as BlobPart[], { type: contentType });
			} else {
				audioBlob = await audioRes.blob();
			}

			item.progressPercent = 92;

			// 2. Fetch synchronized lyrics
			let lyricsText: string | null = null;
			let lyricsStatus: string | null = track.lyrics || (track as any).lyrics_status || null;
			try {
				const lyricsRes = await fetch(`/api/tracks/${track.id}/lyrics`);
				if (lyricsRes.ok) {
					const lyricsJson = await lyricsRes.json();
					lyricsText = lyricsJson.lyrics_text || null;
					lyricsStatus = lyricsJson.lyrics_status || lyricsStatus;
				}
			} catch {}

			item.progressPercent = 95;

			// 3. Fetch cover artwork blob if available
			let coverBlob: Blob | null = null;
			const coverUrl = item.album?.cover_url || (track as any).cover_url || null;
			if (coverUrl) {
				try {
					const coverRes = await fetch(coverUrl);
					if (coverRes.ok) {
						coverBlob = await coverRes.blob();
					}
				} catch {}
			}

			// 4. Save into IndexedDB
			const offlineTrack: OfflineTrack = {
				id: track.id,
				title: track.title,
				artist: track.artist || item.album?.artist || 'Unknown Artist',
				album_title: item.album?.title || 'Unknown Album',
				album_id: item.album?.id || (track as any).album_id || 0,
				track_number: track.track_number || 1,
				duration: Math.round((track.duration_ms || 0) / 1000),
				format: effQuality === 'original' ? track.format || 'Audio' : 'mp3',
				bitrate_kbps: effQuality === 'original' ? (track.bitrate_kbps ?? null) : Number(effQuality),
				audio_blob: audioBlob,
				audio_mime: contentType,
				lyrics_text: lyricsText,
				lyrics_status: lyricsStatus,
				cover_url: coverUrl,
				cover_blob: coverBlob,
				downloaded_at: Date.now(),
				file_size: audioBlob.size
			};

			const db = await this.init();
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction('tracks', 'readwrite');
				tx.objectStore('tracks').put(offlineTrack);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});

			item.progressPercent = 100;
			return true;
		} catch (err: any) {
			console.error(`[OfflineStorage] Failed to download track ${track.id} (${track.title}):`, err);
			item.error = err.message || 'Download failed';
			return false;
		}
	}

	private async checkPendingAlbumsForTrack(trackId: number) {
		for (const [albumId, meta] of this.pendingAlbumsMeta.entries()) {
			if (meta.requiredTrackIds.includes(trackId)) {
				const allDone = meta.requiredTrackIds.every((tid) => this.downloadedTrackIds.has(tid));
				if (allDone) {
					await this.saveAlbumMetadata(meta.album, meta.coverBlob);
					this.pendingAlbumsMeta.delete(albumId);
				}
			}
		}
	}

	private async checkPendingPlaylistsForTrack(trackId: number) {
		for (const [playlistId, meta] of this.pendingPlaylistsMeta.entries()) {
			if (meta.requiredTrackIds.includes(trackId)) {
				const allDone = meta.requiredTrackIds.every((tid) => this.downloadedTrackIds.has(tid));
				if (allDone) {
					await this.savePlaylistMetadata(meta.playlist);
					this.pendingPlaylistsMeta.delete(playlistId);
				}
			}
		}
	}

	private async checkAllPendingAlbums() {
		for (const [albumId, meta] of this.pendingAlbumsMeta.entries()) {
			const allDone = meta.requiredTrackIds.every((tid) => this.downloadedTrackIds.has(tid));
			if (allDone) {
				await this.saveAlbumMetadata(meta.album, meta.coverBlob);
				this.pendingAlbumsMeta.delete(albumId);
			}
		}
	}

	private async saveAlbumMetadata(
		album: { id: number; title: string; artist: string; cover_url?: string | null; tracks: Track[] },
		coverBlob?: Blob | null
	) {
		try {
			let effBlob = coverBlob;
			if (!effBlob && album.cover_url) {
				try {
					const res = await fetch(album.cover_url);
					if (res.ok) effBlob = await res.blob();
				} catch {}
			}

			const db = await this.init();
			const offlineAlbum: OfflineAlbum = {
				id: album.id,
				title: album.title,
				artist: album.artist,
				cover_url: album.cover_url || null,
				cover_blob: effBlob || null,
				track_ids: album.tracks.map((t) => t.id),
				downloaded_at: Date.now()
			};
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction('albums', 'readwrite');
				tx.objectStore('albums').put(offlineAlbum);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});

			this.downloadedAlbumIds.add(album.id);
			this.downloadedAlbumIds = new Set(this.downloadedAlbumIds);
		} catch (err) {
			console.warn('[OfflineStorage] Error saving offline album entry:', err);
		}
	}

	private async savePlaylistMetadata(playlist: { id: number; name: string; tracks?: Track[] }) {
		try {
			const db = await this.init();
			const offlinePlaylist: OfflinePlaylist = {
				id: playlist.id,
				name: playlist.name,
				track_ids: (playlist.tracks || []).map((t) => t.id),
				downloaded_at: Date.now()
			};
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction('playlists', 'readwrite');
				tx.objectStore('playlists').put(offlinePlaylist);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});

			this.downloadedPlaylistIds.add(playlist.id);
			this.downloadedPlaylistIds = new Set(this.downloadedPlaylistIds);
		} catch (err) {
			console.warn('[OfflineStorage] Error saving offline playlist entry:', err);
		}
	}

	// Backward-compatible wrappers for existing code
	async downloadTrack(
		track: Track,
		album?: { id?: number; title?: string; artist?: string; cover_url?: string | null },
		quality?: 'original' | '320' | '192' | '128'
	): Promise<boolean> {
		this.enqueueTrack(track, album, undefined, quality);
		return true;
	}

	async downloadAlbum(
		album: { id: number; title: string; artist: string; cover_url?: string | null; tracks: Track[] },
		quality?: 'original' | '320' | '192' | '128'
	) {
		await this.enqueueAlbum(album, quality);
	}

	async downloadPlaylist(
		playlist: { id: number; name: string; tracks?: Track[] },
		quality?: 'original' | '320' | '192' | '128'
	) {
		await this.enqueuePlaylist(playlist, quality);
	}

	async deleteTrack(trackId: number): Promise<boolean> {
		this.revokeTrackBlobUrl(trackId);
		try {
			const db = await this.init();
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction('tracks', 'readwrite');
				tx.objectStore('tracks').delete(trackId);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});

			this.downloadedTrackIds.delete(trackId);
			this.downloadedTrackIds = new Set(this.downloadedTrackIds);

			// Check if any album/playlist lost its tracks and clean up if needed
			await this.refreshCachedIds();
			await this.refreshStats();
			return true;
		} catch (err) {
			console.error(`[OfflineStorage] Error deleting track ${trackId}:`, err);
			return false;
		}
	}

	async deleteAlbum(albumId: number) {
		try {
			const db = await this.init();
			// Find tracks belonging to this album
			const offlineAlbum: OfflineAlbum | null = await new Promise((resolve) => {
				const tx = db.transaction('albums', 'readonly');
				const req = tx.objectStore('albums').get(albumId);
				req.onsuccess = () => resolve(req.result || null);
				req.onerror = () => resolve(null);
			});

			if (offlineAlbum && offlineAlbum.track_ids) {
				for (const tid of offlineAlbum.track_ids) {
					await this.deleteTrack(tid);
				}
			}

			// Delete album entry
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction('albums', 'readwrite');
				tx.objectStore('albums').delete(albumId);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});

			this.downloadedAlbumIds.delete(albumId);
			this.downloadedAlbumIds = new Set(this.downloadedAlbumIds);
			await this.refreshStats();
		} catch (err) {
			console.error(`[OfflineStorage] Error deleting album ${albumId}:`, err);
		}
	}

	async deletePlaylist(playlistId: number) {
		try {
			const db = await this.init();
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction('playlists', 'readwrite');
				tx.objectStore('playlists').delete(playlistId);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});

			this.downloadedPlaylistIds.delete(playlistId);
			this.downloadedPlaylistIds = new Set(this.downloadedPlaylistIds);
		} catch (err) {
			console.error(`[OfflineStorage] Error deleting playlist ${playlistId}:`, err);
		}
	}

	async getAllDownloadedTracks(): Promise<OfflineTrack[]> {
		try {
			const db = await this.init();
			return new Promise((resolve) => {
				const tx = db.transaction('tracks', 'readonly');
				const req = tx.objectStore('tracks').getAll();
				req.onsuccess = () => resolve(req.result || []);
				req.onerror = () => resolve([]);
			});
		} catch {
			return [];
		}
	}

	async getAllDownloadedAlbums(): Promise<OfflineAlbum[]> {
		try {
			const db = await this.init();
			return new Promise((resolve) => {
				const tx = db.transaction('albums', 'readonly');
				const req = tx.objectStore('albums').getAll();
				req.onsuccess = () => resolve(req.result || []);
				req.onerror = () => resolve([]);
			});
		} catch {
			return [];
		}
	}

	async getAllOfflineAlbums(): Promise<any[]> {
		const offlineAlbums = await this.getAllDownloadedAlbums();
		const offlineTracks = await this.getAllDownloadedTracks();
		return offlineAlbums.map((oa) => {
			const tracks = offlineTracks.filter((t) => oa.track_ids.includes(t.id));
			return {
				id: oa.id,
				title: oa.title,
				artist: oa.artist,
				cover_url: oa.cover_url,
				track_count: tracks.length,
				checked_count: tracks.length,
				tracks: tracks.map((t) => ({
					id: t.id,
					album_id: t.album_id,
					title: t.title,
					artist: t.artist,
					album_title: t.album_title,
					track_number: t.track_number,
					duration_ms: (t.duration || 0) * 1000,
					format: t.format,
					bitrate_kbps: t.bitrate_kbps,
					lyrics: t.lyrics_status,
					is_missing: 0
				}))
			};
		});
	}

	async getAllOfflinePlaylists(): Promise<any[]> {
		try {
			const db = await this.init();
			const offlinePlaylists: OfflinePlaylist[] = await new Promise((resolve) => {
				const tx = db.transaction('playlists', 'readonly');
				const req = tx.objectStore('playlists').getAll();
				req.onsuccess = () => resolve(req.result || []);
				req.onerror = () => resolve([]);
			});
			const offlineTracks = await this.getAllDownloadedTracks();
			return offlinePlaylists.map((op) => {
				const tracks = offlineTracks.filter((t) => op.track_ids.includes(t.id));
				return {
					id: op.id,
					name: op.name,
					comment: 'Offline Playlist',
					is_public: 0,
					tracks: tracks.map((t) => ({
						id: t.id,
						album_id: t.album_id,
						title: t.title,
						artist: t.artist,
						album_title: t.album_title,
						track_number: t.track_number,
						duration_ms: (t.duration || 0) * 1000,
						format: t.format,
						bitrate_kbps: t.bitrate_kbps,
						lyrics: t.lyrics_status,
						is_missing: 0
					}))
				};
			});
		} catch {
			return [];
		}
	}

	async clearAllOfflineMusic() {
		for (const [, url] of this.activeObjectUrls) {
			URL.revokeObjectURL(url);
		}
		this.activeObjectUrls.clear();

		try {
			const db = await this.init();
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction(['tracks', 'albums', 'playlists'], 'readwrite');
				tx.objectStore('tracks').clear();
				tx.objectStore('albums').clear();
				tx.objectStore('playlists').clear();
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});

			this.downloadedTrackIds = new Set();
			this.downloadedAlbumIds = new Set();
			this.downloadedPlaylistIds = new Set();
			this.offlineStorageBytes = 0;
			this.offlineTrackCount = 0;
		} catch (err) {
			console.error('[OfflineStorage] Error clearing offline music:', err);
		}
	}
}

export const offlineStorage = new OfflineStorageManager();
