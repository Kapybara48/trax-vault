import fs from 'node:fs';
import path from 'node:path';
import { json, type RequestHandler } from '@sveltejs/kit';
import { getAlbumById, addTrackToAlbum, updateTrack } from '$lib/server/db.js';
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

	const albumId = parseInt(params.id as string, 10);
	if (isNaN(albumId)) {
		return json({ error: 'Invalid album ID' }, { status: 400 });
	}

	const albumData = getAlbumById(albumId);
	if (!albumData) {
		return json({ error: 'Album not found' }, { status: 404 });
	}

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch (err: any) {
		return json({ error: `Invalid multipart form data: ${err.message}` }, { status: 400 });
	}

	const files = formData.getAll('files') as File[];
	if (!files || files.length === 0) {
		return json({ error: 'No files provided for upload' }, { status: 400 });
	}

	const musicDir = getMusicDirectory();
	let canonicalMusicDir: string;
	try {
		canonicalMusicDir = fs.existsSync(musicDir) ? fs.realpathSync(musicDir) : path.resolve(musicDir);
	} catch {
		canonicalMusicDir = path.resolve(musicDir);
	}

	// 1. Resolve target album directory
	let albumDir: string | null = null;
	for (const t of albumData.tracks) {
		const resolved = resolveTrackFilePath(t);
		if (resolved && fs.existsSync(resolved)) {
			albumDir = path.dirname(resolved);
			break;
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
		return json({ error: `Failed to create/resolve album directory: ${err.message}` }, { status: 500 });
	}

	if (!isPathWithin(canonicalAlbumDir, canonicalMusicDir) && canonicalAlbumDir !== canonicalMusicDir) {
		return json({ error: 'Access denied: Album directory outside music storage' }, { status: 403 });
	}

	const existingTracks = [...albumData.tracks];
	const results: { file: string; status: 'uploaded' | 'linked_missing' | 'skipped'; trackId?: number; error?: string }[] = [];

	for (const file of files) {
		if (!file || typeof file.arrayBuffer !== 'function' || !file.name) {
			continue;
		}

		const ext = path.extname(file.name).toLowerCase();
		if (!AUDIO_EXTENSIONS.has(ext)) {
			results.push({ file: file.name, status: 'skipped', error: `Unsupported audio format ${ext}` });
			continue;
		}

		const cleanName = sanitizePathSegment(file.name);
		const targetFilePath = path.join(canonicalAlbumDir, cleanName);

		try {
			const buffer = Buffer.from(await file.arrayBuffer());
			fs.writeFileSync(targetFilePath, buffer);
		} catch (writeErr: any) {
			results.push({ file: file.name, status: 'skipped', error: `Write failed: ${writeErr.message}` });
			continue;
		}

		// Scan newly written audio file
		let scanned;
		try {
			scanned = await scanAudioFile(targetFilePath);
		} catch (scanErr: any) {
			console.warn(`Failed to scan uploaded audio file ${cleanName}:`, scanErr);
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
		const trackTitle = scanned?.title || path.basename(file.name, ext);
		const trackNumber = scanned?.track_number ?? null;
		const discNumber = scanned?.disc_number ?? 1;

		// Check if we can link an existing missing track (is_missing === 1)
		const missingIndex = existingTracks.findIndex((t) => {
			if (t.is_missing !== 1) return false;
			if (trackNumber && t.track_number === trackNumber && t.disc_number === discNumber) {
				return true;
			}
			const normT = t.title.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
			const normScanned = trackTitle.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
			return normT.length > 0 && normT === normScanned;
		});

		if (missingIndex !== -1) {
			const missingTrack = existingTracks[missingIndex];
			const updated = updateTrack(missingTrack.id, {
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
			existingTracks[missingIndex] = updated;
			results.push({ file: file.name, status: 'linked_missing', trackId: missingTrack.id });
		} else {
			const newId = addTrackToAlbum(albumId, {
				disc_number: discNumber,
				track_number: trackNumber ?? undefined,
				title: trackTitle,
				artist: scanned?.artist || albumData.album.artist || 'Unknown Artist',
				duration_ms: durationMs,
				format,
				bitrate_kbps: bitrateKbps,
				sample_rate: sampleRate,
				bits_per_sample: bitsPerSample,
				quality_rating: quality,
				censorship,
				lyrics,
				manually_checked: 0,
				is_missing: 0,
				file_path: targetFilePath,
				lyrics_text: lyricsContent
			});
			results.push({ file: file.name, status: 'uploaded', trackId: newId });
		}
	}

	const refreshed = getAlbumById(albumId);

	return json({
		success: true,
		results,
		tracks: refreshed?.tracks || []
	});
};
