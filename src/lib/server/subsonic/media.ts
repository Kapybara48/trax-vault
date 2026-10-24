import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { db, getAlbumById, getTrackById } from '$lib/server/db.js';
import { getMusicDirectory, isPathWithin, resolveTrackFilePath } from '$lib/server/scanner.js';
import { decodeArtistId } from './handlers.js';

const MIME_MAP: Record<string, string> = {
	'.flac': 'audio/flac',
	'.mp3': 'audio/mpeg',
	'.m4a': 'audio/mp4',
	'.aac': 'audio/mp4',
	'.ogg': 'audio/ogg',
	'.opus': 'audio/ogg',
	'.wav': 'audio/wav',
	'.aif': 'audio/aiff',
	'.aiff': 'audio/aiff',
	'.alac': 'audio/mp4',
	'.wma': 'audio/x-ms-wma'
};

const IMAGE_MIME_MAP: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.gif': 'image/gif'
};

/**
 * Handle audio streaming for Subsonic /rest/stream
 */
export async function handleSubsonicStream(
	params: Record<string, any>,
	requestHeaders: Headers
): Promise<Response> {
	const trackId = parseInt(params.id, 10);
	if (isNaN(trackId)) {
		return new Response('Invalid track ID', { status: 400 });
	}

	const track = getTrackById(trackId);
	if (!track) {
		return new Response('Track not found', { status: 404 });
	}

	const filePath = resolveTrackFilePath(track);
	if (!filePath) {
		return new Response('No audio file path registered', { status: 404 });
	}

	let canonicalFilePath: string;
	try {
		canonicalFilePath = fs.existsSync(filePath) ? fs.realpathSync(filePath) : path.resolve(filePath);
	} catch {
		return new Response('Audio file not found on disk', { status: 404 });
	}

	const musicDir = getMusicDirectory();
	let canonicalMusicDir: string;
	try {
		canonicalMusicDir = fs.existsSync(musicDir) ? fs.realpathSync(musicDir) : path.resolve(musicDir);
	} catch {
		canonicalMusicDir = path.resolve(musicDir);
	}

	if (!isPathWithin(canonicalFilePath, canonicalMusicDir) && canonicalFilePath !== canonicalMusicDir) {
		return new Response('Access denied: File outside music directory', { status: 403 });
	}

	let stat: fs.Stats;
	try {
		stat = fs.statSync(canonicalFilePath);
	} catch {
		return new Response('Cannot read file metadata', { status: 404 });
	}

	const ext = path.extname(canonicalFilePath).toLowerCase();
	const contentType = MIME_MAP[ext] || 'audio/mpeg';
	const fileSize = stat.size;

	const rangeHeader = requestHeaders.get('range');
	if (rangeHeader) {
		const parts = rangeHeader.replace(/bytes=/, '').split('-');
		const start = parseInt(parts[0], 10);
		const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

		if (start >= fileSize || end >= fileSize || start > end) {
			return new Response(null, {
				status: 416,
				headers: { 'Content-Range': `bytes */${fileSize}` }
			});
		}

		const chunkSize = end - start + 1;
		const stream = fs.createReadStream(canonicalFilePath, { start, end });
		const webStream = Readable.toWeb(stream) as ReadableStream;

		return new Response(webStream, {
			status: 206,
			headers: {
				'Content-Range': `bytes ${start}-${end}/${fileSize}`,
				'Accept-Ranges': 'bytes',
				'Content-Length': chunkSize.toString(),
				'Content-Type': contentType,
				'Cache-Control': 'no-cache',
				'Access-Control-Allow-Origin': '*'
			}
		});
	}

	const stream = fs.createReadStream(canonicalFilePath);
	const webStream = Readable.toWeb(stream) as ReadableStream;

	return new Response(webStream, {
		status: 200,
		headers: {
			'Accept-Ranges': 'bytes',
			'Content-Length': fileSize.toString(),
			'Content-Type': contentType,
			'Cache-Control': 'no-cache',
			'Access-Control-Allow-Origin': '*'
		}
	});
}

function resolveCoverFromFolder(folder: string): string | null {
	const candidates = [
		'cover.jpg',
		'cover.jpeg',
		'cover.png',
		'cover.webp',
		'folder.jpg',
		'folder.png',
		'front.jpg',
		'albumart.jpg'
	];
	for (const cand of candidates) {
		const full = path.join(folder, cand);
		if (fs.existsSync(full)) return full;
	}
	return null;
}

/**
 * Handle cover art serving for Subsonic /rest/getCoverArt
 */
export async function handleSubsonicCoverArt(params: Record<string, any>): Promise<Response> {
	const rawId = String(params.id || '');
	let imageDiskPath: string | null = null;

	const musicDir = getMusicDirectory();

	const parseCoverUrlToDiskPath = (coverUrl?: string | null): string | null => {
		if (!coverUrl) return null;
		if (coverUrl.includes('path=')) {
			try {
				const url = new URL(coverUrl, 'http://localhost');
				const p = url.searchParams.get('path');
				if (p && fs.existsSync(p)) return p;
				if (p) {
					// Reconcile /music prefix if in container vs host
					const candidate = path.join(musicDir, p.replace(/^\/music\/?/, ''));
					if (fs.existsSync(candidate)) return candidate;
				}
			} catch {}
		}
		if (fs.existsSync(coverUrl)) return coverUrl;
		return null;
	};

	if (rawId.startsWith('al-')) {
		const albumId = parseInt(rawId.substring(3), 10);
		if (!isNaN(albumId)) {
			const res = getAlbumById(albumId);
			if (res) {
				imageDiskPath = parseCoverUrlToDiskPath(res.album.cover_url);
				if (!imageDiskPath) {
					// Check folder from tracks
					if (res.tracks.length > 0 && res.tracks[0].file_path) {
						const resolvedTrack = resolveTrackFilePath(res.tracks[0]);
						if (resolvedTrack) {
							imageDiskPath = resolveCoverFromFolder(path.dirname(resolvedTrack));
						}
					}
				}
			}
		}
	} else if (rawId.startsWith('tr-')) {
		const trackId = parseInt(rawId.substring(3), 10);
		if (!isNaN(trackId)) {
			const track = getTrackById(trackId);
			if (track) {
				const albRes = getAlbumById(track.album_id);
				if (albRes) {
					imageDiskPath = parseCoverUrlToDiskPath(albRes.album.cover_url);
				}
				if (!imageDiskPath && track.file_path) {
					const resolvedTrack = resolveTrackFilePath(track);
					if (resolvedTrack) {
						imageDiskPath = resolveCoverFromFolder(path.dirname(resolvedTrack));
					}
				}
			}
		}
	} else if (rawId.startsWith('art-')) {
		const artistName = decodeArtistId(rawId.substring(4));
		const album = db.prepare('SELECT id, cover_url FROM albums WHERE artist = ? AND cover_url IS NOT NULL LIMIT 1').get(artistName) as any;
		if (album) {
			imageDiskPath = parseCoverUrlToDiskPath(album.cover_url);
		}
	} else {
		// Pure numeric ID fallback: try album first, then track
		const num = parseInt(rawId, 10);
		if (!isNaN(num)) {
			const res = getAlbumById(num);
			if (res) {
				imageDiskPath = parseCoverUrlToDiskPath(res.album.cover_url);
			} else {
				const track = getTrackById(num);
				if (track) {
					const albRes = getAlbumById(track.album_id);
					imageDiskPath = parseCoverUrlToDiskPath(albRes?.album.cover_url);
				}
			}
		}
	}

	if (imageDiskPath && fs.existsSync(imageDiskPath)) {
		try {
			const ext = path.extname(imageDiskPath).toLowerCase();
			const contentType = IMAGE_MIME_MAP[ext] || 'image/jpeg';
			const buffer = fs.readFileSync(imageDiskPath);

			return new Response(buffer, {
				status: 200,
				headers: {
					'Content-Type': contentType,
					'Content-Length': buffer.length.toString(),
					'Cache-Control': 'public, max-age=86400',
					'Access-Control-Allow-Origin': '*'
				}
			});
		} catch (err) {
			console.error('Error serving cover image:', err);
		}
	}

	// 1x1 transparent PNG fallback if no image found
	const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
	return new Response(transparentPng, {
		status: 200,
		headers: {
			'Content-Type': 'image/png',
			'Content-Length': transparentPng.length.toString(),
			'Cache-Control': 'public, max-age=3600',
			'Access-Control-Allow-Origin': '*'
		}
	});
}
