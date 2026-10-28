import fs from 'node:fs';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { db, createAlbum, addTrackToAlbum, getAlbumFixerRules, computeNeedsAttention } from '$lib/server/db.js';
import type {
	ScannedAlbum,
	ScannedTrack,
	AudioFormat,
	QualityRating,
	CensorshipStatus,
	LyricsStatus
} from '$lib/types/index.js';

export const AUDIO_EXTENSIONS = new Set([
	'.flac',
	'.mp3',
	'.m4a',
	'.aac',
	'.ogg',
	'.opus',
	'.wav',
	'.aif',
	'.aiff',
	'.wma',
	'.alac',
	'.ape',
	'.wv',
	'.dsf',
	'.dff',
	'.m4b',
	'.mpc'
]);

export function getMusicDirectory(): string {
	if (process.env.MUSIC_DIR) {
		return path.resolve(process.env.MUSIC_DIR);
	}
	return path.resolve('./music');
}

export function isPathWithin(targetPath: string, rootPath: string): boolean {
	const relative = path.relative(rootPath, targetPath);
	return !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Robustly resolve track audio file path across host and Docker container mount environments
 */
export function resolveTrackFilePath(track: { id?: number; file_path?: string | null; notes?: string | null }): string | null {
	if (track.file_path && fs.existsSync(track.file_path)) {
		return track.file_path;
	}

	const musicDir = getMusicDirectory();

	// If track.file_path has a path from host or container mismatch
	if (track.file_path) {
		const musicIdx = track.file_path.indexOf('/music/');
		if (musicIdx !== -1) {
			const subPath = track.file_path.slice(musicIdx + '/music/'.length);
			const candidate = path.join(musicDir, subPath);
			if (fs.existsSync(candidate)) return candidate;
		}
	}

	// Fallback: check if notes contain folder/filename information from previous imports
	if (track.notes?.startsWith('Imported from: ')) {
		const filename = track.notes.replace('Imported from: ', '').trim();
		const directPath = path.join(musicDir, filename);
		if (fs.existsSync(directPath)) return directPath;
	}

	return null;
}

/**
 * Determine audio format and quality rating based on metadata
 */
export function detectFormatAndQuality(
	container?: string,
	codec?: string,
	bitrate?: number,
	bitsPerSample?: number,
	sampleRate?: number
): { format: AudioFormat; quality: QualityRating } {
	const c = (codec || container || '').toLowerCase();
	const brKbps = bitrate && bitrate > 0 ? Math.round(bitrate / 1000) : 0;
	// Genuine verified Hi-Res requires both high bit depth (>16 bit) and high sample rate (>=48kHz)
	const isVerifiedHiRes = !!(bitsPerSample && bitsPerSample > 16 && sampleRate && sampleRate >= 48000);

	// FLAC
	if (c.includes('flac')) {
		const quality: QualityRating = isVerifiedHiRes ? 'perfect' : 'good';
		return { format: 'FLAC', quality };
	}

	// ALAC
	if (c.includes('alac') || c.includes('apple lossless')) {
		const quality: QualityRating = isVerifiedHiRes ? 'perfect' : 'good';
		return { format: 'ALAC', quality };
	}

	// WAV / PCM / AIFF
	if (c.includes('wav') || c.includes('pcm') || c.includes('aiff')) {
		const fmt = c.includes('aiff') ? 'AIFF' : 'WAV';
		const quality: QualityRating = isVerifiedHiRes ? 'perfect' : 'good';
		return { format: fmt, quality };
	}

	// AAC / M4A
	if (c.includes('aac') || c.includes('mp4a') || c.includes('m4a')) {
		if (brKbps >= 240 && brKbps <= 280) {
			return { format: 'AAC_256', quality: 'good' };
		}
		if (brKbps >= 180) {
			return { format: 'OTHER', quality: 'good' };
		}
		if (brKbps >= 120) {
			return { format: 'OTHER', quality: 'acceptable' };
		}
		if (brKbps > 0 && brKbps < 120) {
			return { format: 'OTHER', quality: 'bad' };
		}
		return { format: 'OTHER', quality: 'acceptable' };
	}

	// OGG / Vorbis / Opus
	if (c.includes('ogg') || c.includes('vorbis') || c.includes('opus')) {
		let quality: QualityRating = 'acceptable';
		if (brKbps >= 190) quality = 'good';
		else if (brKbps > 0 && brKbps < 120) quality = 'bad';
		return { format: 'OGG', quality };
	}

	// MP3 or other lossy MPEG layer 3
	if (c.includes('mpeg') || c.includes('mp3') || c.includes('layer 3')) {
		// Specific known CBR presets
		if (brKbps >= 310) {
			return { format: 'MP3_320', quality: 'good' };
		}
		if (brKbps >= 185 && brKbps <= 200) {
			return { format: 'MP3_192', quality: 'acceptable' };
		}
		if (brKbps >= 120 && brKbps <= 135) {
			return { format: 'MP3_128', quality: 'acceptable' };
		}
		// VBR / V0 preset: only classify as MP3_V0 if explicitly indicated or in typical V0 range (220-260kbps VBR)
		if (c.includes('vbr') || c.includes('v0')) {
			return { format: 'MP3_V0', quality: 'good' };
		}
		// Other bitrates (e.g. 256kbps CBR, 224kbps, 160kbps, or sub-128kbps)
		let quality: QualityRating = 'acceptable';
		if (brKbps >= 220) {
			quality = 'good';
		} else if (brKbps > 0 && brKbps < 120) {
			quality = 'bad';
		}
		return { format: 'OTHER', quality };
	}

	return { format: 'OTHER', quality: 'acceptable' };
}

export interface CompanionLyricsResult {
	filePath: string;
	fileName: string;
	ext: string;
	type: LyricsStatus;
	content: string;
	isWritable: boolean;
}

import { isInstrumentalLyrics, isCensoredLyrics, stripLrcMetadataHeaders } from '$lib/utils.js';
export { isInstrumentalLyrics, isCensoredLyrics, stripLrcMetadataHeaders };

/**
 * Searches the directory of an audio file for matching companion .lrc or .txt files.
 * Handles exact name matching, case-insensitivity (.LRC / .lrc), track number padding variations
 * (e.g., '001 ... .lrc' alongside '01 ... .flac'), and title matching.
 */
export function findCompanionLyricsFile(
	audioFilePath: string,
	trackTitle?: string,
	dirFilesCache?: Map<string, string[]>
): CompanionLyricsResult | null {
	try {
		const dir = path.dirname(audioFilePath);
		let files: string[];
		if (dirFilesCache && dirFilesCache.has(dir)) {
			files = dirFilesCache.get(dir)!;
		} else {
			if (!fs.existsSync(dir)) return null;
			files = fs.readdirSync(dir);
			if (dirFilesCache) dirFilesCache.set(dir, files);
		}

		const audioBase = path.basename(audioFilePath, path.extname(audioFilePath));
		const audioExt = path.extname(audioFilePath).toLowerCase();

		// 1. Direct exact base match (.lrc first, then .txt)
		for (const targetExt of ['.lrc', '.txt']) {
			const candidate = files.find(
				(f) =>
					f.toLowerCase() === `${audioBase.toLowerCase()}${targetExt}` &&
					f.toLowerCase() !== `${audioBase.toLowerCase()}${audioExt}`
			);
			if (candidate) {
				const fullPath = path.join(dir, candidate);
				try {
					const content = fs.readFileSync(fullPath, 'utf-8');
					const ext = path.extname(candidate).toLowerCase();
					const hasTimestamps = /\[\d{1,2}:\d{2}/.test(content);
					let isWritable = true;
					try {
						fs.accessSync(fullPath, fs.constants.W_OK);
					} catch {
						isWritable = false;
					}
					const isInst = isInstrumentalLyrics(content);
					const isCensored = !isInst && isCensoredLyrics(content);
					return {
						filePath: fullPath,
						fileName: candidate,
						ext,
						type: isInst ? 'instrumental' : isCensored ? 'censored_lrc' : ext === '.lrc' || hasTimestamps ? 'synced_lrc' : 'plain_txt',
						content,
						isWritable
					};
				} catch {
					// Continue to next candidate
				}
			}
		}

		// 2. Normalized track-number / padding variations (e.g. 01 vs 001 vs 1)
		const matchDigits = audioBase.match(/^(\d+)\s*[-._ ]\s*(.*)$/);
		const trackNum = matchDigits ? parseInt(matchDigits[1], 10) : null;
		const trackRest = matchDigits ? matchDigits[2].trim().toLowerCase() : audioBase.toLowerCase();

		for (const f of files) {
			const fExt = path.extname(f).toLowerCase();
			if (fExt !== '.lrc' && fExt !== '.txt') continue;

			const fBase = path.basename(f, fExt);
			const fDigitsMatch = fBase.match(/^(\d+)\s*[-._ ]\s*(.*)$/);
			const fNum = fDigitsMatch ? parseInt(fDigitsMatch[1], 10) : null;
			const fRest = fDigitsMatch ? fDigitsMatch[2].trim().toLowerCase() : fBase.toLowerCase();

			let isMatch = false;

			// If both have track numbers and they match numerically, and title/rest matches
			if (trackNum !== null && fNum !== null && trackNum === fNum) {
				if (!trackRest || !fRest || trackRest === fRest || fRest.includes(trackRest) || trackRest.includes(fRest)) {
					isMatch = true;
				}
			}

			// If title is provided, check if filename matches title
			if (!isMatch && trackTitle && trackTitle.trim().length > 3) {
				const normTitle = trackTitle.trim().toLowerCase();
				if (fBase.toLowerCase().includes(normTitle)) {
					isMatch = true;
				}
			}

			if (isMatch) {
				const fullPath = path.join(dir, f);
				try {
					const content = fs.readFileSync(fullPath, 'utf-8');
					const hasTimestamps = /\[\d{1,2}:\d{2}/.test(content);
					let isWritable = true;
					try {
						fs.accessSync(fullPath, fs.constants.W_OK);
					} catch {
						isWritable = false;
					}
					const isInst = isInstrumentalLyrics(content);
					const isCensored = !isInst && isCensoredLyrics(content);
					return {
						filePath: fullPath,
						fileName: f,
						ext: fExt,
						type: isInst ? 'instrumental' : isCensored ? 'censored_lrc' : fExt === '.lrc' || hasTimestamps ? 'synced_lrc' : 'plain_txt',
						content,
						isWritable
					};
				} catch {
					// Continue
				}
			}
		}
	} catch (err) {
		console.warn('Error finding companion lyrics file:', err);
	}

	return null;
}

/**
 * Detect lyrics: checks companion .lrc / .txt files in same directory, or embedded lyrics tags
 */
export function detectLyrics(
	filePath: string,
	embeddedLyrics?: any,
	trackTitle?: string,
	dirFilesCache?: Map<string, string[]>
): {
	status: LyricsStatus;
	hasLrc: boolean;
	hasTxt: boolean;
	hasEmbedded: boolean;
	lyricsContent?: string;
	companionPath?: string;
} {
	const companion = findCompanionLyricsFile(filePath, trackTitle, dirFilesCache);
	if (companion) {
		return {
			status: companion.type,
			hasLrc: companion.ext === '.lrc',
			hasTxt: companion.ext === '.txt',
			hasEmbedded: false,
			lyricsContent: companion.content,
			companionPath: companion.filePath
		};
	}

	// Check embedded lyrics
	if (embeddedLyrics) {
		const text = Array.isArray(embeddedLyrics)
			? embeddedLyrics.map((l) => (typeof l === 'string' ? l : l.text || '')).join('\n')
			: typeof embeddedLyrics === 'string'
			? embeddedLyrics
			: embeddedLyrics.text || '';

		if (text.trim().length > 0) {
			const hasTimestamps = /\[\d{1,2}:\d{2}/.test(text);
			const isInst = isInstrumentalLyrics(text);
			const isCensored = !isInst && isCensoredLyrics(text);
			return {
				status: isInst ? 'instrumental' : isCensored ? 'censored_lrc' : hasTimestamps ? 'synced_lrc' : 'plain_txt',
				hasLrc: false,
				hasTxt: false,
				hasEmbedded: true,
				lyricsContent: text
			};
		}
	}

	return { status: 'missing', hasLrc: false, hasTxt: false, hasEmbedded: false };
}

/**
 * Detect censorship status from title, tags, or file name.
 * Returns 'unknown' if no explicit, clean, or censorship metadata exists.
 */
export function detectCensorship(title: string, rawTags?: any): CensorshipStatus {
	const lowerTitle = title.toLowerCase();

	if (
		lowerTitle.includes('(radio edit)') ||
		lowerTitle.includes('(clean)') ||
		lowerTitle.includes('[clean]') ||
		lowerTitle.includes('(clean version)') ||
		lowerTitle.includes('(censored)')
	) {
		return 'censored'; // Radio edit / censored
	}

	if (
		lowerTitle.includes('(explicit)') ||
		lowerTitle.includes('[explicit]') ||
		lowerTitle.includes('explicit version')
	) {
		return 'explicit';
	}

	if (
		lowerTitle.includes('(instrumental)') ||
		lowerTitle.includes('[instrumental]')
	) {
		return 'instrumental';
	}

	// Check iTunes advisory tag: 1 = explicit, 2 = clean/censored
	if (rawTags?.itunesAdvisory === 1 || rawTags?.['ITUNESADVISORY'] === '1') {
		return 'explicit';
	}
	if (rawTags?.itunesAdvisory === 2 || rawTags?.['ITUNESADVISORY'] === '2') {
		return 'censored';
	}

	// Do not assume clean_original without evidence!
	return 'unknown';
}

/**
 * Find local folder cover art image if available
 */
export function findLocalCoverArt(dir: string, dirFilesCache?: Map<string, string[]>): string | null {
	const candidates = [
		'cover.jpg',
		'cover.jpeg',
		'cover.png',
		'cover.webp',
		'folder.jpg',
		'folder.png',
		'front.jpg',
		'front.jpeg',
		'front.png',
		'albumart.jpg',
		'album.jpg'
	];

	let files: string[];
	if (dirFilesCache && dirFilesCache.has(dir)) {
		files = dirFilesCache.get(dir)!;
	} else {
		try {
			if (!fs.existsSync(dir)) return null;
			files = fs.readdirSync(dir);
			if (dirFilesCache) dirFilesCache.set(dir, files);
		} catch {
			return null;
		}
	}

	const lowerSet = new Set(files.map((f) => f.toLowerCase()));
	for (const candidate of candidates) {
		if (lowerSet.has(candidate)) {
			const matched = files.find((f) => f.toLowerCase() === candidate) || candidate;
			const full = path.join(dir, matched);
			return `/api/library/cover?path=${encodeURIComponent(full)}`;
		}
	}

	return null;
}

/**
 * Extract MusicBrainz ID string safely (handles arrays or strings)
 */
function cleanMbId(val: any): string | null {
	if (!val) return null;
	if (Array.isArray(val)) {
		val = val[0];
	}
	if (typeof val === 'string' && val.trim().length >= 32) {
		return val.trim();
	}
	return null;
}

/**
 * Scan a single audio file and extract all tags + MusicBrainz data
 */
export async function scanAudioFile(
	filePath: string,
	dirFilesCache?: Map<string, string[]>
): Promise<ScannedTrack | null> {
	try {
		const metadata = await parseFile(filePath, { duration: true, skipCovers: true });
		const common = metadata.common;
		const format = metadata.format;

		const fileName = path.basename(filePath);
		const title = common.title || path.basename(filePath, path.extname(filePath));
		const artist = common.artist || common.albumartist || 'Unknown Artist';
		const albumArtist = common.albumartist || common.artist || 'Unknown Artist';
		const album = common.album || path.basename(path.dirname(filePath));
		const year = common.year || null;
		const trackNumber = common.track?.no || 1;
		const discNumber = common.disk?.no || 1;
		const durationMs = format.duration ? Math.round(format.duration * 1000) : null;

		const { format: audioFmt, quality: audioQuality } = detectFormatAndQuality(
			format.container,
			format.codec,
			format.bitrate,
			format.bitsPerSample,
			format.sampleRate
		);

		const { status: lyricsStatus, hasLrc, hasTxt, hasEmbedded, lyricsContent } = detectLyrics(
			filePath,
			common.lyrics,
			title,
			dirFilesCache
		);
		const censorshipStatus = detectCensorship(title, common);

		// MusicBrainz tags
		const mbAlbumId = cleanMbId(common.musicbrainz_albumid);
		const mbTrackId = cleanMbId(common.musicbrainz_trackid);
		const mbArtistId = cleanMbId(common.musicbrainz_artistid);
		const mbReleaseGroupId = cleanMbId(common.musicbrainz_releasegroupid);

		const bitrateKbps = format.bitrate ? Math.round(format.bitrate / 1000) : null;

		return {
			file_path: filePath,
			file_name: fileName,
			title,
			artist,
			album_artist: albumArtist,
			album,
			year,
			track_number: trackNumber,
			disc_number: discNumber,
			duration_ms: durationMs,
			format: audioFmt,
			bitrate_kbps: bitrateKbps,
			sample_rate: format.sampleRate || null,
			bits_per_sample: format.bitsPerSample || null,
			quality_rating: audioQuality,
			censorship: censorshipStatus,
			lyrics: lyricsStatus,
			has_lrc_file: hasLrc,
			has_txt_file: hasTxt,
			has_embedded_lyrics: hasEmbedded,
			lyrics_content: lyricsContent || null,
			musicbrainz_album_id: mbAlbumId,
			musicbrainz_track_id: mbTrackId,
			musicbrainz_artist_id: mbArtistId,
			musicbrainz_releasegroup_id: mbReleaseGroupId,
			selected: true
		};
	} catch (err) {
		console.warn(`Failed to parse metadata for file ${filePath}:`, err);
		return null;
	}
}

/**
 * Concurrency pool helper for executing async operations in parallel with a bounded worker limit.
 */
async function asyncPool<T, R>(limit: number, array: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = new Array(array.length);
	let index = 0;
	const workers = Array.from({ length: Math.min(limit, array.length) }, async () => {
		while (index < array.length) {
			const i = index++;
			results[i] = await fn(array[i]);
		}
	});
	await Promise.all(workers);
	return results;
}

export interface ScanResult {
	albums: ScannedAlbum[];
	totalFiles: number;
	libraryPath: string;
	exists: boolean;
	scannedAt?: number;
}

interface ScanCacheEntry {
	timestamp: number;
	result: ScanResult;
}

const scanCache = new Map<string, ScanCacheEntry>();
const inFlightScans = new Map<string, Promise<ScanResult>>();

function getScanSnapshotPath(canonicalTarget: string): string {
	const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve('./data');
	if (!fs.existsSync(dataDir)) {
		try {
			fs.mkdirSync(dataDir, { recursive: true });
		} catch {
			// ignore
		}
	}
	const safeKey = Buffer.from(canonicalTarget).toString('hex').slice(0, 16);
	return path.join(dataDir, `scan_snapshot_${safeKey}.json`);
}

function saveScanSnapshot(canonicalTarget: string, result: ScanResult): void {
	try {
		const filePath = getScanSnapshotPath(canonicalTarget);
		fs.writeFileSync(filePath, JSON.stringify(result), 'utf-8');
	} catch (err) {
		console.warn('[Scanner] Failed to save scan snapshot to disk:', err);
	}
}

function loadScanSnapshot(canonicalTarget: string): ScanResult | null {
	try {
		const filePath = getScanSnapshotPath(canonicalTarget);
		if (fs.existsSync(filePath)) {
			const content = fs.readFileSync(filePath, 'utf-8');
			return JSON.parse(content) as ScanResult;
		}
	} catch (err) {
		console.warn('[Scanner] Failed to load scan snapshot from disk:', err);
	}
	return null;
}

export function reconcileScanAlbumsWithVault(albums: ScannedAlbum[]): void {
	try {
		const vaultAlbums = db.prepare(
			'SELECT id, musicbrainz_id, LOWER(title) as l_title, LOWER(artist) as l_artist FROM albums'
		).all() as Array<{ id: number; musicbrainz_id: string | null; l_title: string; l_artist: string }>;

		const vaultMbIdMap = new Map<string, number>();
		const vaultTitleArtistMap = new Map<string, number>();

		for (const va of vaultAlbums) {
			if (va.musicbrainz_id) {
				vaultMbIdMap.set(va.musicbrainz_id.trim(), va.id);
			}
			vaultTitleArtistMap.set(`${va.l_title}:::${va.l_artist}`, va.id);
		}

		for (const alb of albums) {
			let alreadyInVault = false;
			let existingAlbumId: number | null = null;

			if (alb.musicbrainz_id && vaultMbIdMap.has(alb.musicbrainz_id.trim())) {
				alreadyInVault = true;
				existingAlbumId = vaultMbIdMap.get(alb.musicbrainz_id.trim())!;
			} else {
				const lookupKey = `${alb.title.toLowerCase()}:::${alb.artist.toLowerCase()}`;
				if (vaultTitleArtistMap.has(lookupKey)) {
					alreadyInVault = true;
					existingAlbumId = vaultTitleArtistMap.get(lookupKey)!;
				}
			}

			alb.already_in_vault = alreadyInVault;
			alb.existing_album_id = existingAlbumId;
			if (!alreadyInVault && !alb.tracks.some((t) => t.selected)) {
				alb.selected = true;
				for (const t of alb.tracks) {
					t.selected = true;
				}
			}
		}

		albums.sort((a, b) => {
			if (a.already_in_vault !== b.already_in_vault) {
				return a.already_in_vault ? 1 : -1;
			}
			return a.title.localeCompare(b.title);
		});
	} catch (err) {
		console.warn('[Scanner] Failed to reconcile albums with vault DB:', err);
	}
}

export function invalidateScanCache(targetDir?: string): void {
	if (targetDir) {
		const canonical = path.resolve(targetDir);
		const cached = scanCache.get(canonical);
		if (cached) {
			reconcileScanAlbumsWithVault(cached.result.albums);
			saveScanSnapshot(canonical, cached.result);
		}
	} else {
		for (const [canonical, cached] of scanCache.entries()) {
			reconcileScanAlbumsWithVault(cached.result.albums);
			saveScanSnapshot(canonical, cached.result);
		}
	}
}

/**
 * Scan a music folder recursively and group audio files by album.
 * Enforces boundary so only paths within getMusicDirectory() can be scanned.
 * Features in-memory caching, in-flight deduplication, and 16-worker concurrency.
 */
export async function scanLibraryDirectory(
	targetDir?: string,
	options?: { force?: boolean }
): Promise<ScanResult> {
	const musicDir = getMusicDirectory();
	let canonicalMusicDir: string;
	try {
		canonicalMusicDir = fs.existsSync(musicDir) ? fs.realpathSync(musicDir) : path.resolve(musicDir);
	} catch {
		canonicalMusicDir = path.resolve(musicDir);
	}

	const requested = targetDir ? path.resolve(targetDir) : canonicalMusicDir;
	let canonicalTarget: string;
	try {
		canonicalTarget = fs.existsSync(requested) ? fs.realpathSync(requested) : requested;
	} catch {
		canonicalTarget = requested;
	}

	// Boundary check
	if (!isPathWithin(canonicalTarget, canonicalMusicDir) && canonicalTarget !== canonicalMusicDir) {
		throw new Error(`Access denied: Target directory is outside configured music directory (${canonicalMusicDir}).`);
	}

	if (!fs.existsSync(canonicalTarget)) {
		return { albums: [], totalFiles: 0, libraryPath: canonicalTarget, exists: false };
	}

	// 1. Check in-memory cache if not forced
	if (!options?.force) {
		const cached = scanCache.get(canonicalTarget);
		if (cached) {
			reconcileScanAlbumsWithVault(cached.result.albums);
			return cached.result;
		}

		// 2. Check persistent disk snapshot if not forced
		const diskSnapshot = loadScanSnapshot(canonicalTarget);
		if (diskSnapshot) {
			reconcileScanAlbumsWithVault(diskSnapshot.albums);
			scanCache.set(canonicalTarget, {
				timestamp: diskSnapshot.scannedAt || Date.now(),
				result: diskSnapshot
			});
			return diskSnapshot;
		}

		// 3. Check in-flight scan deduplication
		if (inFlightScans.has(canonicalTarget)) {
			return inFlightScans.get(canonicalTarget)!;
		}
	}

	const scanPromise = (async () => {
		const audioFiles: string[] = [];
		const dirFilesCache = new Map<string, string[]>();

		function walk(currentDir: string) {
			try {
				const entries = fs.readdirSync(currentDir, { withFileTypes: true });
				const entryNames: string[] = [];
				for (const entry of entries) {
					if (entry.name.startsWith('.')) continue; // skip hidden files/.git
					entryNames.push(entry.name);

					const fullPath = path.join(currentDir, entry.name);
					if (entry.isDirectory()) {
						walk(fullPath);
					} else if (entry.isFile()) {
						const ext = path.extname(entry.name).toLowerCase();
						if (AUDIO_EXTENSIONS.has(ext)) {
							audioFiles.push(fullPath);
						}
					}
				}
				dirFilesCache.set(currentDir, entryNames);
			} catch (err) {
				console.error(`Cannot read directory ${currentDir}:`, err);
			}
		}

		walk(canonicalTarget);

		// Concurrently parse audio metadata using 16 workers
		const parsedTracks = await asyncPool(16, audioFiles, (file) => scanAudioFile(file, dirFilesCache));
		const scannedTracks: ScannedTrack[] = parsedTracks.filter((t): t is ScannedTrack => t !== null);

		// Group tracks by album:
		// Prevent merging disparate folders: identify album folder (handling CD1/Disc 2 subfolders)
		const albumGroups: { [key: string]: { tracks: ScannedTrack[]; folder: string } } = {};

		for (const tr of scannedTracks) {
			const trackFolder = path.dirname(tr.file_path);
			const folderName = path.basename(trackFolder).toLowerCase();
			const isDiscSubfolder = /^(cd|disc|disk)\s*\d+([_ -].*)?$/i.test(folderName) || /^(bonus|extra)\s*(cd|disc|disk)/i.test(folderName);
			const albumFolder = isDiscSubfolder ? path.dirname(trackFolder) : trackFolder;

			let key: string;
			if (tr.musicbrainz_album_id) {
				// Scoped to the album folder so unrelated folders never get accidentally merged
				key = `${albumFolder}::mb:${tr.musicbrainz_album_id}`;
			} else if (tr.album && tr.album !== 'Unknown Album') {
				key = `${albumFolder}::${tr.album.toLowerCase()}`;
			} else {
				key = `dir:${albumFolder}`;
			}

			if (!albumGroups[key]) {
				albumGroups[key] = { tracks: [], folder: albumFolder };
			}
			albumGroups[key].tracks.push(tr);
		}

		// Single query to fetch existing vault albums for O(1) in-memory lookups
		const vaultAlbums = db.prepare(
			'SELECT id, musicbrainz_id, LOWER(title) as l_title, LOWER(artist) as l_artist FROM albums'
		).all() as Array<{ id: number; musicbrainz_id: string | null; l_title: string; l_artist: string }>;

		const vaultMbIdMap = new Map<string, number>();
		const vaultTitleArtistMap = new Map<string, number>();

		for (const va of vaultAlbums) {
			if (va.musicbrainz_id) {
				vaultMbIdMap.set(va.musicbrainz_id.trim(), va.id);
			}
			vaultTitleArtistMap.set(`${va.l_title}:::${va.l_artist}`, va.id);
		}

		const scannedAlbums: ScannedAlbum[] = [];

		for (const [key, group] of Object.entries(albumGroups)) {
			// MusicBrainz ID if present on ANY track in this album
			const mbId = group.tracks.find((t) => t.musicbrainz_album_id)?.musicbrainz_album_id || null;

			// Only propagate album MBID to sibling tracks if album titles are consistent
			if (mbId) {
				const candidateAlbum = group.tracks.find((t) => t.musicbrainz_album_id)?.album;
				for (const t of group.tracks) {
					if (!t.musicbrainz_album_id) {
						// Check for conflicting album title before propagating
						if (!candidateAlbum || !t.album || t.album.toLowerCase() === candidateAlbum.toLowerCase()) {
							t.musicbrainz_album_id = mbId;
						}
					}
				}
			}

			// Sort tracks by disc and track number
			group.tracks.sort((a, b) => {
				if (a.disc_number !== b.disc_number) return a.disc_number - b.disc_number;
				return a.track_number - b.track_number;
			});

			const first = group.tracks[0];
			const albumTitle = first.album || path.basename(group.folder);
			const albumArtist = group.tracks.find((t) => t.album_artist)?.album_artist || first.artist || 'Unknown Artist';
			const albumYear = group.tracks.find((t) => t.year)?.year || null;

			// Cover Art: Local cover file or Cover Art Archive via MBID
			let coverUrl = findLocalCoverArt(group.folder, dirFilesCache);
			if (!coverUrl && mbId) {
				coverUrl = `https://coverartarchive.org/release/${mbId}/front-500`;
			}

			// Check if already in vault SQLite DB (O(1) in-memory lookup)
			let alreadyInVault = false;
			let existingAlbumId: number | null = null;
			if (mbId && vaultMbIdMap.has(mbId.trim())) {
				alreadyInVault = true;
				existingAlbumId = vaultMbIdMap.get(mbId.trim())!;
			} else {
				const lookupKey = `${albumTitle.toLowerCase()}:::${albumArtist.toLowerCase()}`;
				if (vaultTitleArtistMap.has(lookupKey)) {
					alreadyInVault = true;
					existingAlbumId = vaultTitleArtistMap.get(lookupKey)!;
				}
			}

			const hasFlac = group.tracks.some((t) => t.format === 'FLAC' || t.format === 'ALAC');
			const hasLrc = group.tracks.some((t) => t.lyrics === 'synced_lrc' || t.lyrics === 'censored_lrc');

			scannedAlbums.push({
				album_key: key,
				title: albumTitle,
				artist: albumArtist,
				year: albumYear,
				folder_path: group.folder,
				musicbrainz_id: mbId,
				cover_url: coverUrl,
				track_count: group.tracks.length,
				has_flac: hasFlac,
				has_lrc: hasLrc,
				already_in_vault: alreadyInVault,
				existing_album_id: existingAlbumId,
				tracks: group.tracks,
				selected: !alreadyInVault
			});
		}

		// Sort albums: albums not in vault first, then alphabetically
		scannedAlbums.sort((a, b) => {
			if (a.already_in_vault !== b.already_in_vault) {
				return a.already_in_vault ? 1 : -1;
			}
			return a.title.localeCompare(b.title);
		});

		const scannedAt = Date.now();
		const result: ScanResult = {
			albums: scannedAlbums,
			totalFiles: audioFiles.length,
			libraryPath: canonicalTarget,
			exists: true,
			scannedAt
		};

		scanCache.set(canonicalTarget, { timestamp: scannedAt, result });
		saveScanSnapshot(canonicalTarget, result);
		return result;
	})();

	inFlightScans.set(canonicalTarget, scanPromise);
	try {
		return await scanPromise;
	} finally {
		inFlightScans.delete(canonicalTarget);
	}
}

/**
 * Import a scanned album and only its chosen/selected tracks into Trax Vault
 */
export async function importScannedAlbum(
	album: ScannedAlbum,
	selectedFilePaths?: string[]
): Promise<number> {
	let chosenTracks = album.tracks;
	if (selectedFilePaths && selectedFilePaths.length > 0) {
		const selectedSet = new Set(selectedFilePaths);
		chosenTracks = album.tracks.filter((t) => selectedSet.has(t.file_path));
	}

	if (chosenTracks.length === 0) {
		throw new Error('No tracks selected for import');
	}

	const tracksData = chosenTracks.map((t) => ({
		disc_number: t.disc_number,
		track_number: t.track_number,
		title: t.title,
		artist: t.artist !== album.artist ? t.artist : null,
		duration_ms: t.duration_ms,
		format: t.format,
		bitrate_kbps: t.bitrate_kbps,
		sample_rate: t.sample_rate,
		bits_per_sample: t.bits_per_sample,
		quality_rating: t.quality_rating,
		censorship: t.censorship,
		lyrics: t.lyrics,
		file_path: t.file_path,
		lyrics_text: t.lyrics_content ?? null,
		notes: `Imported from: ${path.basename(t.file_path)}`
	}));

	const albumId = createAlbum(
		{
			musicbrainz_id: album.musicbrainz_id,
			title: album.title,
			artist: album.artist,
			release_year: album.year,
			cover_url: album.cover_url,
			media_type: album.has_flac ? 'FLAC Digital' : 'Digital',
			notes: `Imported from local library folder: ${album.folder_path}`
		},
		tracksData
	);

	invalidateScanCache();
	return albumId;
}

/**
 * Backfill missing bitrate and audio fidelity metadata for imported tracks in the database
 */
export async function backfillTrackBitrates(): Promise<number> {
	try {
		const nullTracks = db.prepare(`
			SELECT id, file_path, notes, duration_ms 
			FROM tracks 
			WHERE bitrate_kbps IS NULL AND (file_path IS NOT NULL OR notes LIKE 'Imported from:%')
		`).all() as Array<{ id: number; file_path: string | null; notes: string | null; duration_ms: number | null }>;

		if (nullTracks.length === 0) return 0;

		const updateStmt = db.prepare(`
			UPDATE tracks 
			SET bitrate_kbps = ?, sample_rate = ?, bits_per_sample = ? 
			WHERE id = ?
		`);

		const updatesToApply: Array<{ id: number; bitrate: number | null; sampleRate: number | null; bitsPerSample: number | null }> = [];

		for (const tr of nullTracks) {
			const resolvedPath = resolveTrackFilePath(tr);
			if (!resolvedPath || !fs.existsSync(resolvedPath)) continue;

			try {
				const meta = await parseFile(resolvedPath, { duration: true, skipCovers: true });
				let bitrateKbps = meta.format.bitrate ? Math.round(meta.format.bitrate / 1000) : null;

				// Fallback: estimate from file size and duration if bitrate is missing
				if (!bitrateKbps && tr.duration_ms && tr.duration_ms > 0) {
					try {
						const stat = fs.statSync(resolvedPath);
						bitrateKbps = Math.round((stat.size * 8) / tr.duration_ms);
					} catch {}
				}

				updatesToApply.push({
					id: tr.id,
					bitrate: bitrateKbps,
					sampleRate: meta.format.sampleRate || null,
					bitsPerSample: meta.format.bitsPerSample || null
				});
			} catch (err) {
				console.warn(`Failed extracting bitrate for track ID ${tr.id}:`, err);
			}
		}

		if (updatesToApply.length > 0) {
			const batch = db.transaction((items: typeof updatesToApply) => {
				for (const item of items) {
					updateStmt.run(item.bitrate, item.sampleRate, item.bitsPerSample, item.id);
				}
			});
			batch(updatesToApply);
			console.log(`[TraxVault] Successfully backfilled exact bitrate for ${updatesToApply.length} tracks.`);
		}

		return updatesToApply.length;
	} catch (err) {
		console.warn('Track bitrate backfill notice:', err);
		return 0;
	}
}

let isLibraryScanning = false;
let lastLibraryScanTimestamp = 0;

export function getLibraryScanStatus(): { scanning: boolean; lastScan: number } {
	return { scanning: isLibraryScanning, lastScan: lastLibraryScanTimestamp };
}

/**
 * Scan configured music directory, automatically import any new albums or missing tracks,
 * and report real-time scanning status for Subsonic clients (Symfonium/Feishin/DSub).
 */
export async function syncLibraryFromDisk(): Promise<{
	importedAlbums: number;
	newTracks: number;
	totalAlbums: number;
	totalTracks: number;
}> {
	if (isLibraryScanning) {
		console.log('[Scanner] Scan is already running in background, skipping duplicate invocation.');
		const trackCount = (db.prepare('SELECT COUNT(*) as count FROM tracks').get() as any)?.count || 0;
		const albumCount = (db.prepare('SELECT COUNT(*) as count FROM albums').get() as any)?.count || 0;
		return { importedAlbums: 0, newTracks: 0, totalAlbums: albumCount, totalTracks: trackCount };
	}

	isLibraryScanning = true;
	console.log('[Scanner] Starting automated library synchronization from disk...');

	let importedAlbums = 0;
	let newTracksCount = 0;

	try {
		const scanResult = await scanLibraryDirectory(undefined, { force: true });

		for (const scannedAlb of scanResult.albums) {
			if (!scannedAlb.already_in_vault) {
				try {
					await importScannedAlbum(scannedAlb);
					importedAlbums++;
					console.log(`[Scanner] Auto-imported new album: ${scannedAlb.artist} - ${scannedAlb.title} (${scannedAlb.tracks.length} tracks)`);
				} catch (importErr) {
					console.error(`[Scanner] Failed to auto-import ${scannedAlb.title}:`, importErr);
				}
			} else {
				// Check if existing album in vault has new tracks on disk that were not previously imported
				const existingRow = scannedAlb.musicbrainz_id
					? (db.prepare('SELECT id FROM albums WHERE musicbrainz_id = ?').get(scannedAlb.musicbrainz_id) as { id: number } | undefined)
					: (db.prepare('SELECT id FROM albums WHERE LOWER(title) = LOWER(?) AND LOWER(artist) = LOWER(?)').get(scannedAlb.title, scannedAlb.artist) as { id: number } | undefined);

				if (existingRow?.id) {
					const albumId = existingRow.id;
					const existingTracks = db.prepare('SELECT file_path, track_number, disc_number FROM tracks WHERE album_id = ?').all(albumId) as Array<{ file_path: string | null; track_number: number; disc_number: number }>;
					const existingFilePaths = new Set(existingTracks.map((t) => (t.file_path ? path.resolve(t.file_path) : '')));

					const missingTracks = scannedAlb.tracks.filter((t) => !existingFilePaths.has(path.resolve(t.file_path)));

					if (missingTracks.length > 0) {
						for (const t of missingTracks) {
							try {
								// Check if this album already had a missing track with matching disc & track_number or title
								const missingTrackRow = db.prepare(`
									SELECT id FROM tracks 
									WHERE album_id = ? AND is_missing = 1 
									  AND (track_number = ? OR LOWER(title) = LOWER(?))
									LIMIT 1
								`).get(albumId, t.track_number, t.title) as { id: number } | undefined;

								if (missingTrackRow) {
									const rules = getAlbumFixerRules(albumId);
									const needsAtt = computeNeedsAttention(t.quality_rating, t.censorship, t.lyrics, t.format, rules, 0);
									db.prepare(`
										UPDATE tracks SET
											file_path = ?,
											duration_ms = COALESCE(?, duration_ms),
											format = ?,
											bitrate_kbps = ?,
											sample_rate = ?,
											bits_per_sample = ?,
											quality_rating = ?,
											censorship = ?,
											lyrics = ?,
											is_missing = 0,
											needs_attention = ?,
											notes = ?,
											updated_at = datetime('now')
										WHERE id = ?
									`).run(
										t.file_path,
										t.duration_ms,
										t.format,
										t.bitrate_kbps,
										t.sample_rate,
										t.bits_per_sample,
										t.quality_rating,
										t.censorship,
										t.lyrics,
										needsAtt,
										`Matched missing song from disk: ${path.basename(t.file_path)}`,
										missingTrackRow.id
									);
									newTracksCount++;
									continue;
								}

								addTrackToAlbum(albumId, {
									disc_number: t.disc_number,
									track_number: t.track_number,
									title: t.title,
									artist: t.artist !== scannedAlb.artist ? t.artist : null,
									duration_ms: t.duration_ms,
									format: t.format,
									bitrate_kbps: t.bitrate_kbps,
									sample_rate: t.sample_rate,
									bits_per_sample: t.bits_per_sample,
									quality_rating: t.quality_rating,
									censorship: t.censorship,
									lyrics: t.lyrics,
									file_path: t.file_path,
									lyrics_text: t.lyrics_content ?? null,
									notes: `Auto-synced from: ${path.basename(t.file_path)}`
								});
								newTracksCount++;
							} catch (err) {
								console.warn(`[Scanner] Could not add track ${t.title} to album ${albumId}:`, err);
							}
						}
						console.log(`[Scanner] Added ${missingTracks.length} new tracks to existing album: ${scannedAlb.title}`);
					}
				}
			}
		}

		lastLibraryScanTimestamp = Date.now();
		console.log(`[Scanner] Library synchronization complete. Auto-imported ${importedAlbums} albums and ${newTracksCount} new tracks.`);
	} catch (scanErr) {
		console.error('[Scanner] Error during library synchronization:', scanErr);
	} finally {
		isLibraryScanning = false;
	}

	const trackCount = (db.prepare('SELECT COUNT(*) as count FROM tracks').get() as any)?.count || 0;
	const albumCount = (db.prepare('SELECT COUNT(*) as count FROM albums').get() as any)?.count || 0;
	return { importedAlbums, newTracks: newTracksCount, totalAlbums: albumCount, totalTracks: trackCount };
}
