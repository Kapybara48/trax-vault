import fs from 'node:fs';
import path from 'node:path';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getTrackById, saveTrackLyrics } from '$lib/server/db.js';
import {
	findCompanionLyricsFile,
	resolveTrackFilePath,
	isInstrumentalLyrics,
	isCensoredLyrics,
	stripLrcMetadataHeaders,
	getMusicDirectory,
	isPathWithin
} from '$lib/server/scanner.js';
import type { LyricsStatus } from '$lib/types/index.js';

export const GET: RequestHandler = async ({ params }) => {
	const trackId = parseInt(params.id, 10);
	if (isNaN(trackId)) {
		return json({ error: 'Invalid track ID' }, { status: 400 });
	}

	const track = getTrackById(trackId);
	if (!track) {
		return json({ error: 'Track not found' }, { status: 404 });
	}

	let lyricsText = track.lyrics_text || '';
	let companionPath: string | null = null;
	let hasCompanion = false;
	let isWritable = true;
	const audioPath = resolveTrackFilePath(track);

	// 1. Read directly from the song's folder if companion file exists on disk
	if (audioPath) {
		const companion = findCompanionLyricsFile(audioPath, track.title);
		if (companion) {
			companionPath = companion.filePath;
			hasCompanion = true;
			lyricsText = companion.content;
			isWritable = companion.isWritable;

			// Keep DB in sync with disk content
			if (track.lyrics_text !== companion.content) {
				try {
					saveTrackLyrics(trackId, companion.content, companion.type);
				} catch {
					// Ignore
				}
			}
		}
	}

	lyricsText = stripLrcMetadataHeaders(lyricsText);

	// If marked instrumental in database and has no text, supply default musical note marker
	if (track.lyrics === 'instrumental' && !lyricsText.trim()) {
		lyricsText = '[00:00.00]♪';
	}

	return json({
		success: true,
		lyrics_text: lyricsText,
		lyrics_status: track.lyrics,
		status: track.lyrics,
		companion_path: companionPath,
		has_companion: hasCompanion,
		is_writable: isWritable,
		has_audio_file: !!audioPath,
		file_path: audioPath || track.file_path
	});
};

export const POST: RequestHandler = async ({ params, request }) => {
	const trackId = parseInt(params.id, 10);
	if (isNaN(trackId)) {
		return json({ error: 'Invalid track ID' }, { status: 400 });
	}

	const track = getTrackById(trackId);
	if (!track) {
		return json({ error: 'Track not found' }, { status: 404 });
	}

	let body: {
		lyrics_text: string;
		status?: LyricsStatus;
		save_to_disk?: boolean;
		overwrite?: boolean;
	};

	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON payload' }, { status: 400 });
	}

	const rawText = typeof body.lyrics_text === 'string' ? body.lyrics_text : '';
	let lyricsText = stripLrcMetadataHeaders(rawText);

	// Auto-detect status if not specified or verify synced vs plain vs instrumental vs censored
	let status: LyricsStatus = body.status || 'synced_lrc';
	if (!body.status) {
		if (isInstrumentalLyrics(lyricsText) || track.lyrics === 'instrumental') {
			status = 'instrumental';
		} else if (isCensoredLyrics(lyricsText)) {
			status = 'censored_lrc';
		} else {
			const hasTimestamps = /\[\d{1,2}:\d{2}/.test(lyricsText);
			status = hasTimestamps ? 'synced_lrc' : 'plain_txt';
		}
	}

	// For instrumental tracks, ensure standard marker if text is empty
	if (status === 'instrumental' && !lyricsText.trim()) {
		lyricsText = '[00:00.00]♪';
	}

	// 1. Save directly to the song's folder file on disk IF explicitly requested
	let savedToDisk = false;
	let diskError: string | null = null;
	let diskPath: string | null = null;
	const shouldSaveToDisk = body.save_to_disk === true;
	const audioPath = resolveTrackFilePath(track);

	if (shouldSaveToDisk && audioPath) {
		const dir = path.dirname(audioPath);

		// Validate path boundary against configured music directory
		const musicDir = getMusicDirectory();
		let canonicalMusicDir: string;
		try {
			canonicalMusicDir = fs.existsSync(musicDir) ? fs.realpathSync(musicDir) : path.resolve(musicDir);
		} catch {
			canonicalMusicDir = path.resolve(musicDir);
		}

		let canonicalDiskDir: string;
		try {
			canonicalDiskDir = fs.existsSync(dir) ? fs.realpathSync(dir) : path.resolve(dir);
		} catch {
			canonicalDiskDir = path.resolve(dir);
		}

		if (!isPathWithin(canonicalDiskDir, canonicalMusicDir) && canonicalDiskDir !== canonicalMusicDir) {
			return json({ error: 'Access denied: Target directory outside music directory' }, { status: 403 });
		}
		
		// Check if companion file already exists
		const existingCompanion = findCompanionLyricsFile(audioPath, track.title);
		if (existingCompanion) {
			diskPath = existingCompanion.filePath;
		} else {
			const base = path.basename(audioPath, path.extname(audioPath));
			const ext = (status === 'synced_lrc' || status === 'censored_lrc' || status === 'instrumental' || /\[\d{1,2}:\d{2}/.test(lyricsText)) ? '.lrc' : '.txt';
			diskPath = path.join(dir, `${base}${ext}`);
		}

		const fileAlreadyExists = !!existingCompanion || (diskPath && fs.existsSync(diskPath));

		// Require explicit confirmation to overwrite an existing companion file
		if (fileAlreadyExists && body.overwrite !== true) {
			diskError = 'Companion lyrics file already exists on disk. Explicit overwrite confirmation required.';
		} else {
			try {
				fs.writeFileSync(diskPath, lyricsText, 'utf-8');
				savedToDisk = true;
			} catch (err: any) {
				diskError =
					err.code === 'EROFS'
						? 'Music directory is mounted read-only (:ro). Synced lyrics saved to Trax Vault database only.'
						: `Could not write to disk: ${err.message}`;
			}
		}
	}

	// 2. Save to SQLite database
	let updatedTrack;
	try {
		updatedTrack = saveTrackLyrics(trackId, lyricsText, status);
	} catch (err: any) {
		return json({ error: `Database error: ${err.message}` }, { status: 500 });
	}

	return json({
		success: true,
		track: updatedTrack,
		saved_to_db: true,
		saved_to_disk: savedToDisk,
		disk_path: diskPath,
		disk_error: diskError
	});
};
