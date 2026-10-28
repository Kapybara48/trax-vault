import fs from 'node:fs';
import { json, type RequestHandler } from '@sveltejs/kit';
import { getTrackById, updateTrack } from '$lib/server/db.js';
import { resolveTrackFilePath, scanAudioFile } from '$lib/server/scanner.js';

export const POST: RequestHandler = async ({ params, locals }) => {
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

	const filePath = resolveTrackFilePath(track);
	if (!filePath || !fs.existsSync(filePath)) {
		return json({ error: 'No physical audio file found on disk for this track' }, { status: 404 });
	}

	let scanned;
	try {
		scanned = await scanAudioFile(filePath);
	} catch (err: any) {
		return json({ error: `Failed to scan audio file: ${err.message}` }, { status: 500 });
	}

	if (!scanned) {
		return json({ error: 'Could not extract metadata from audio file' }, { status: 500 });
	}

	const updatedTrack = updateTrack(track.id, {
		file_path: filePath,
		is_missing: 0,
		duration_ms: scanned.duration_ms,
		format: scanned.format,
		bitrate_kbps: scanned.bitrate_kbps,
		sample_rate: scanned.sample_rate,
		bits_per_sample: scanned.bits_per_sample,
		quality_rating: scanned.quality_rating,
		censorship: scanned.censorship,
		lyrics: scanned.lyrics,
		lyrics_text: scanned.lyrics_content
	});

	return json({
		success: true,
		track: updatedTrack
	});
};
