import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import type { Track } from '$lib/types/index.js';

let cachedFfmpegPath: string | null = null;
let testedFfmpeg = false;

/**
 * Resolves the path to the ffmpeg executable.
 * Checks environment variable, ffmpeg-static package, and system PATH.
 */
export function getFfmpegPath(): string | null {
	if (testedFfmpeg) return cachedFfmpegPath;
	testedFfmpeg = true;

	// 1. Explicit environment variable override
	if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
		cachedFfmpegPath = process.env.FFMPEG_PATH;
		return cachedFfmpegPath;
	}

	// 2. ffmpeg-static npm package binary
	if (ffmpegPath && typeof ffmpegPath === 'string' && fs.existsSync(ffmpegPath)) {
		try {
			// Ensure executable permissions if on Linux/macOS
			fs.chmodSync(ffmpegPath, 0o755);
		} catch {}
		cachedFfmpegPath = ffmpegPath;
		return cachedFfmpegPath;
	}

	// 3. Common system binary paths
	const commonPaths = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/bin/ffmpeg'];
	for (const p of commonPaths) {
		if (fs.existsSync(p)) {
			cachedFfmpegPath = p;
			return cachedFfmpegPath;
		}
	}

	cachedFfmpegPath = null;
	return null;
}

/**
 * Returns whether audio transcoding is available on this server.
 */
export function isTranscodingSupported(): boolean {
	return getFfmpegPath() !== null;
}

/**
 * Checks if a track should be transcoded given client constraints.
 */
export function shouldTranscode(
	track: Track,
	maxBitrateKbps?: number | null,
	targetFormat?: string | null
): boolean {
	if (!isTranscodingSupported()) return false;

	const format = (targetFormat || '').toLowerCase().trim();
	const isSpecificFormatRequested = format === 'mp3' || format === 'opus' || format === 'aac' || format === 'ogg';

	// If no bitrate cap and no specific transcode format requested, stream original
	if (!maxBitrateKbps && !isSpecificFormatRequested) {
		return false;
	}

	// If max bitrate is specified and track is lossless or has higher bitrate
	if (maxBitrateKbps && maxBitrateKbps > 0) {
		const trackFormat = (track.format || '').toUpperCase();
		const isLossless =
			trackFormat === 'FLAC' ||
			trackFormat === 'ALAC' ||
			trackFormat === 'WAV' ||
			trackFormat === 'AIFF' ||
			trackFormat === 'APE' ||
			trackFormat === 'DSD' ||
			trackFormat === 'DSF';

		if (isLossless) {
			// Lossless tracks should be transcoded if client requested any lossy bitrate (e.g. <= 320)
			if (maxBitrateKbps <= 320) return true;
		}

		if (track.bitrate_kbps && track.bitrate_kbps > 0) {
			// If track bitrate is meaningfully higher than requested cap (margin of 16kbps)
			if (track.bitrate_kbps > maxBitrateKbps + 16) {
				return true;
			}
		} else if (isLossless) {
			return true;
		}
	}

	// If a specific format was requested that differs from original
	if (isSpecificFormatRequested && track.file_path) {
		const ext = path.extname(track.file_path).toLowerCase().replace(/^\./, '');
		if (ext !== format) {
			return true;
		}
	}

	return false;
}

export interface TranscodeResult {
	filePath: string;
	contentType: string;
	fileSize: number;
	fromCache: boolean;
	targetFormat: string;
}

// In-flight transcode promises map to prevent duplicate parallel encoding of the same track & bitrate
const activeTranscodes = new Map<string, Promise<TranscodeResult>>();

/**
 * Transcodes an audio track to the requested bitrate and format, with persistent caching.
 */
export async function getOrTranscodeTrack(options: {
	track: Track;
	canonicalSourcePath: string;
	bitrateKbps: number;
	targetFormat?: string;
}): Promise<TranscodeResult> {
	const ffmpeg = getFfmpegPath();
	if (!ffmpeg) {
		throw new Error('FFmpeg is not available on this server for audio transcoding.');
	}

	const { track, canonicalSourcePath } = options;
	const rawFormat = (options.targetFormat || 'mp3').toLowerCase().trim();
	const targetFormat = rawFormat === 'opus' ? 'opus' : rawFormat === 'ogg' ? 'ogg' : 'mp3';
	const bitrate = Math.max(32, Math.min(320, Math.round(options.bitrateKbps)));

	const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve('./data');
	const cacheDir = path.join(dataDir, 'transcode_cache');
	if (!fs.existsSync(cacheDir)) {
		fs.mkdirSync(cacheDir, { recursive: true });
	}

	const cacheFileName = `${track.id}_${bitrate}k.${targetFormat}`;
	const cacheFilePath = path.join(cacheDir, cacheFileName);
	const lockKey = `${track.id}:${bitrate}:${targetFormat}`;

	const contentType = targetFormat === 'opus' || targetFormat === 'ogg' ? 'audio/ogg' : 'audio/mpeg';

	// Check if cached file already exists and is valid
	if (fs.existsSync(cacheFilePath)) {
		try {
			const cacheStat = fs.statSync(cacheFilePath);
			const sourceStat = fs.statSync(canonicalSourcePath);
			if (cacheStat.size > 0 && cacheStat.mtimeMs >= sourceStat.mtimeMs) {
				return {
					filePath: cacheFilePath,
					contentType,
					fileSize: cacheStat.size,
					fromCache: true,
					targetFormat
				};
			}
		} catch {}
	}

	// Deduplicate in-flight transcode operations
	const existingPromise = activeTranscodes.get(lockKey);
	if (existingPromise) {
		return existingPromise;
	}

	const transcodePromise = (async () => {
		const tempFilePath = `${cacheFilePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;

		const args = [
			'-y',
			'-v',
			'error',
			'-i',
			canonicalSourcePath,
			'-vn' // omit video/embedded images for pure audio streaming
		];

		if (targetFormat === 'opus') {
			args.push('-c:a', 'libopus', '-b:a', `${bitrate}k`, '-f', 'opus');
		} else if (targetFormat === 'ogg') {
			args.push('-c:a', 'libvorbis', '-b:a', `${bitrate}k`, '-f', 'ogg');
		} else {
			// Default: High-compatibility MP3
			args.push('-c:a', 'libmp3lame', '-b:a', `${bitrate}k`, '-f', 'mp3');
		}

		args.push(tempFilePath);

		await new Promise<void>((resolve, reject) => {
			const proc = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
			let stderr = '';

			proc.stderr?.on('data', (chunk) => {
				stderr += chunk.toString();
			});

			proc.on('error', (err) => {
				reject(err);
			});

			proc.on('close', (code) => {
				if (code === 0) {
					resolve();
				} else {
					reject(new Error(`FFmpeg transcoding failed with code ${code}: ${stderr}`));
				}
			});
		});

		try {
			fs.renameSync(tempFilePath, cacheFilePath);
			const stat = fs.statSync(cacheFilePath);
			return {
				filePath: cacheFilePath,
				contentType,
				fileSize: stat.size,
				fromCache: false,
				targetFormat
			};
		} catch (err) {
			try {
				if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
			} catch {}
			throw err;
		} finally {
			activeTranscodes.delete(lockKey);
		}
	})();

	activeTranscodes.set(lockKey, transcodePromise);
	return transcodePromise;
}

/**
 * Deletes all cached transcoded audio files to free up disk space.
 */
export function clearTranscodeCache(): { count: number; freedBytes: number } {
	const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve('./data');
	const cacheDir = path.join(dataDir, 'transcode_cache');
	if (!fs.existsSync(cacheDir)) {
		return { count: 0, freedBytes: 0 };
	}

	let count = 0;
	let freedBytes = 0;

	for (const file of fs.readdirSync(cacheDir)) {
		try {
			const full = path.join(cacheDir, file);
			const stat = fs.statSync(full);
			freedBytes += stat.size;
			fs.unlinkSync(full);
			count++;
		} catch {}
	}

	return { count, freedBytes };
}
