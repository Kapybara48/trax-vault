import fs from 'node:fs';
import path from 'node:path';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { importScannedAlbum, getMusicDirectory } from '$lib/server/scanner.js';
import type { ScannedAlbum } from '$lib/types/index.js';

const VALID_FORMATS = new Set([
	'FLAC',
	'ALAC',
	'WAV',
	'AIFF',
	'MP3_320',
	'MP3_V0',
	'MP3_192',
	'MP3_128',
	'AAC_256',
	'OGG',
	'OTHER'
]);

const VALID_QUALITIES = new Set([
	'perfect',
	'good',
	'acceptable',
	'bad',
	'needs_upgrade'
]);

const VALID_CENSORSHIP = new Set([
	'explicit',
	'clean_original',
	'censored',
	'instrumental',
	'unknown'
]);

const VALID_LYRICS = new Set([
	'synced_lrc',
	'unsynced_lrc',
	'plain_txt',
	'missing',
	'instrumental',
	'censored_lrc'
]);

function isPathWithin(targetPath: string, rootPath: string): boolean {
	const relative = path.relative(rootPath, targetPath);
	return !relative.startsWith('..') && !path.isAbsolute(relative);
}

export const POST: RequestHandler = async ({ request }) => {
	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Malformed JSON payload' }, { status: 400 });
	}

	const album = body?.album;
	const selectedTrackPaths = body?.selectedTrackPaths;

	if (!album || typeof album !== 'object') {
		return json({ error: 'Album object is required' }, { status: 400 });
	}

	const title = typeof album.title === 'string' ? album.title.trim().slice(0, 500) : '';
	const artist = typeof album.artist === 'string' ? album.artist.trim().slice(0, 500) : '';

	if (!title) {
		return json({ error: 'Album title is required' }, { status: 400 });
	}
	if (!artist) {
		return json({ error: 'Album artist is required' }, { status: 400 });
	}

	if (!Array.isArray(album.tracks) || album.tracks.length === 0) {
		return json({ error: 'Album must contain at least one track' }, { status: 400 });
	}

	if (album.tracks.length > 1000) {
		return json({ error: 'Exceeded maximum 1000 tracks per album' }, { status: 400 });
	}

	const musicDir = getMusicDirectory();
	let canonicalMusicDir: string;
	try {
		canonicalMusicDir = fs.existsSync(musicDir) ? fs.realpathSync(musicDir) : path.resolve(musicDir);
	} catch {
		canonicalMusicDir = path.resolve(musicDir);
	}

	// Validate each track
	const validatedTracks = [];
	for (const t of album.tracks) {
		if (!t || typeof t !== 'object') continue;

		const trackTitle = typeof t.title === 'string' ? t.title.trim().slice(0, 500) : '';
		if (!trackTitle) continue;

		const filePath = typeof t.file_path === 'string' ? path.resolve(t.file_path) : '';
		if (!filePath || !fs.existsSync(filePath)) {
			continue;
		}

		// Security: verify each track file is inside music directory
		let canonicalFilePath: string;
		try {
			canonicalFilePath = fs.realpathSync(filePath);
		} catch {
			continue;
		}

		if (!isPathWithin(canonicalFilePath, canonicalMusicDir) && canonicalFilePath !== canonicalMusicDir) {
			return json({ error: `Security violation: File ${filePath} is outside the allowed music directory` }, { status: 403 });
		}

		validatedTracks.push({
			...t,
			title: trackTitle,
			file_path: canonicalFilePath,
			artist: typeof t.artist === 'string' ? t.artist.trim().slice(0, 500) : artist,
			format: VALID_FORMATS.has(t.format) ? t.format : 'OTHER',
			quality_rating: VALID_QUALITIES.has(t.quality_rating) ? t.quality_rating : 'acceptable',
			censorship: VALID_CENSORSHIP.has(t.censorship) ? t.censorship : 'unknown',
			lyrics: VALID_LYRICS.has(t.lyrics) ? t.lyrics : 'missing',
			disc_number: typeof t.disc_number === 'number' && t.disc_number > 0 ? Math.floor(t.disc_number) : 1,
			track_number: typeof t.track_number === 'number' && t.track_number > 0 ? Math.floor(t.track_number) : 1,
			duration_ms: typeof t.duration_ms === 'number' && t.duration_ms >= 0 ? Math.floor(t.duration_ms) : null
		});
	}

	if (validatedTracks.length === 0) {
		return json({ error: 'No valid tracks found to import' }, { status: 400 });
	}

	// Validate selectedTrackPaths if provided
	let validSelectedPaths: string[] | undefined = undefined;
	if (Array.isArray(selectedTrackPaths)) {
		validSelectedPaths = selectedTrackPaths.map((p: string) => path.resolve(p));
	}

	const validatedAlbum: ScannedAlbum = {
		...album,
		title,
		artist,
		year: typeof album.year === 'number' ? Math.floor(album.year) : null,
		tracks: validatedTracks
	};

	try {
		const albumId = await importScannedAlbum(validatedAlbum, validSelectedPaths);
		return json({ success: true, albumId });
	} catch (err: any) {
		console.error('Import error:', err);
		return json({ error: err.message || 'Failed to import album' }, { status: 500 });
	}
};
