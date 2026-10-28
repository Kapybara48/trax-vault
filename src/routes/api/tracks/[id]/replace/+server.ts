import fs from 'node:fs';
import path from 'node:path';
import { json, type RequestHandler } from '@sveltejs/kit';
import { getTrackById, getAlbumById, updateTrack } from '$lib/server/db.js';
import {
	AUDIO_EXTENSIONS,
	getMusicDirectory,
	isPathWithin,
	resolveTrackFilePath,
	scanAudioFile
} from '$lib/server/scanner.js';

function sanitizePathSegment(name: string): string {
	return name.replace(/[/\\?%*:|"<>]/g, '_').trim();
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Forbidden: Administrator privileges required' }, { status: 403 });
	}

	const trackId = parseInt(params.id as string, 10);
	if (isNaN(trackId)) {
		return json({ error: 'Invalid track ID' }, { status: 400 });
	}

	const track = getTrackById(trackId);
	if (!track) {
		return json({ error: 'Track not found' }, { status: 404 });
	}

	const albumData = getAlbumById(track.album_id);
	if (!albumData) {
		return json({ error: 'Album not found' }, { status: 404 });
	}

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch (err: any) {
		return json({ error: `Invalid multipart form data: ${err.message}` }, { status: 400 });
	}

	const file = formData.get('file') as File | null;
	if (!file || typeof file.arrayBuffer !== 'function' || !file.name) {
		return json({ error: 'No audio file provided' }, { status: 400 });
	}

	const ext = path.extname(file.name).toLowerCase();
	if (!AUDIO_EXTENSIONS.has(ext)) {
		return json({ error: `Unsupported audio format ${ext}` }, { status: 400 });
	}

	const musicDir = getMusicDirectory();
	let canonicalMusicDir: string;
	try {
		canonicalMusicDir = fs.existsSync(musicDir) ? fs.realpathSync(musicDir) : path.resolve(musicDir);
	} catch {
		canonicalMusicDir = path.resolve(musicDir);
	}

	// Resolve album folder
	let albumDir: string | null = null;
	const currentPath = resolveTrackFilePath(track);
	if (currentPath && fs.existsSync(currentPath)) {
		albumDir = path.dirname(currentPath);
	} else {
		for (const t of albumData.tracks) {
			const resolved = resolveTrackFilePath(t);
			if (resolved && fs.existsSync(resolved)) {
				albumDir = path.dirname(resolved);
				break;
			}
		}
	}

	if (!albumDir) {
		const artistFolder = sanitizePathSegment(albumData.album.artist || 'Unknown Artist');
		const albumFolder = sanitizePathSegment(albumData.album.title || 'Unknown Album');
		albumDir = path.join(canonicalMusicDir, artistFolder, albumFolder);
	}

	let canonicalAlbumDir: string;
	try {
		if (!fs.existsSync(albumDir)) {
			fs.mkdirSync(albumDir, { recursive: true });
		}
		canonicalAlbumDir = fs.realpathSync(albumDir);
	} catch (err: any) {
		return json({ error: `Failed to resolve album directory: ${err.message}` }, { status: 500 });
	}

	if (!isPathWithin(canonicalAlbumDir, canonicalMusicDir) && canonicalAlbumDir !== canonicalMusicDir) {
		return json({ error: 'Access denied: Album directory outside music storage' }, { status: 403 });
	}

	const cleanName = sanitizePathSegment(file.name);
	const targetFilePath = path.join(canonicalAlbumDir, cleanName);

	try {
		const buffer = Buffer.from(await file.arrayBuffer());
		fs.writeFileSync(targetFilePath, buffer);
	} catch (writeErr: any) {
		return json({ error: `Failed to write file to disk: ${writeErr.message}` }, { status: 500 });
	}

	// Safely remove old physical file if it exists and path differs
	if (currentPath && currentPath !== targetFilePath && fs.existsSync(currentPath)) {
		try {
			const canonicalOld = fs.realpathSync(currentPath);
			if (isPathWithin(canonicalOld, canonicalMusicDir)) {
				fs.unlinkSync(canonicalOld);
			}
		} catch (unlinkErr) {
			console.warn('Could not remove previous audio file:', unlinkErr);
		}
	}

	// Scan new audio file
	let scanned;
	try {
		scanned = await scanAudioFile(targetFilePath);
	} catch (scanErr) {
		console.warn(`Failed to scan replaced audio file:`, scanErr);
	}

	const format = scanned?.format || 'OTHER';
	const quality = scanned?.quality_rating || 'good';
	const censorship = scanned?.censorship || 'unknown';
	const lyrics = scanned?.lyrics || 'missing';
	const durationMs = scanned?.duration_ms ?? null;
	const bitrateKbps = scanned?.bitrate_kbps ?? null;
	const sampleRate = scanned?.sample_rate ?? null;
	const bitsPerSample = scanned?.bits_per_sample ?? null;
	const lyricsContent = scanned?.lyrics_content ?? null;

	const updatedTrack = updateTrack(track.id, {
		file_path: targetFilePath,
		is_missing: 0,
		duration_ms: durationMs,
		format,
		bitrate_kbps: bitrateKbps,
		sample_rate: sampleRate,
		bits_per_sample: bitsPerSample,
		quality_rating: quality,
		censorship,
		lyrics,
		lyrics_text: lyricsContent,
		manually_checked: 0
	});

	return json({
		success: true,
		track: updatedTrack
	});
};
