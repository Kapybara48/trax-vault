import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getTrackById } from '$lib/server/db.js';
import { getMusicDirectory, isPathWithin, resolveTrackFilePath } from '$lib/server/scanner.js';
import { shouldTranscode, getOrTranscodeTrack } from '$lib/server/transcoder.js';

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

export const GET: RequestHandler = async ({ params, request, url }) => {
	const trackId = parseInt(params.id, 10);
	if (isNaN(trackId)) {
		return json({ error: 'Invalid track ID' }, { status: 400 });
	}

	const track = getTrackById(trackId);
	if (!track) {
		return json({ error: 'Track not found' }, { status: 404 });
	}

	const filePath = resolveTrackFilePath(track);
	if (!filePath) {
		return json(
			{ error: 'No local audio file path is registered for this track on the server.' },
			{ status: 404 }
		);
	}

	const musicDir = getMusicDirectory();
	let canonicalMusicDir: string;
	try {
		canonicalMusicDir = fs.existsSync(musicDir) ? fs.realpathSync(musicDir) : path.resolve(musicDir);
	} catch {
		canonicalMusicDir = path.resolve(musicDir);
	}

	let canonicalFilePath: string;
	try {
		canonicalFilePath = fs.realpathSync(filePath);
	} catch {
		return json({ error: 'Audio file not found on disk' }, { status: 404 });
	}

	if (!isPathWithin(canonicalFilePath, canonicalMusicDir) && canonicalFilePath !== canonicalMusicDir) {
		return json({ error: 'Access denied: File outside music directory' }, { status: 403 });
	}

	let stat: fs.Stats;
	try {
		stat = fs.statSync(canonicalFilePath);
	} catch {
		return json({ error: 'Cannot read file metadata' }, { status: 404 });
	}

	const ext = path.extname(canonicalFilePath).toLowerCase();
	const isDownload = url.searchParams.get('download') === 'true';

	const requestedBitrateRaw = url.searchParams.get('bitrate') || url.searchParams.get('maxBitRate');
	const requestedBitrate = requestedBitrateRaw ? parseInt(requestedBitrateRaw, 10) : null;
	const requestedFormat = url.searchParams.get('format') || null;

	let streamFilePath = canonicalFilePath;
	let streamFileSize = stat.size;
	let streamContentType = MIME_MAP[ext] || 'audio/mpeg';
	let streamFileName = path.basename(canonicalFilePath);

	if (shouldTranscode(track, requestedBitrate, requestedFormat)) {
		try {
			const transcodeRes = await getOrTranscodeTrack({
				track,
				canonicalSourcePath: canonicalFilePath,
				bitrateKbps: requestedBitrate || 192,
				targetFormat: requestedFormat || 'mp3'
			});
			streamFilePath = transcodeRes.filePath;
			streamFileSize = transcodeRes.fileSize;
			streamContentType = transcodeRes.contentType;
			const base = path.basename(canonicalFilePath, path.extname(canonicalFilePath));
			streamFileName = `${base}.${transcodeRes.targetFormat}`;
		} catch (err) {
			console.error(`[API/Audio] Transcoding failed for track ${trackId}, streaming original:`, err);
		}
	}

	const rangeHeader = request.headers.get('range');
	if (rangeHeader && !isDownload) {
		const parts = rangeHeader.replace(/bytes=/, '').split('-');
		const start = parseInt(parts[0], 10);
		const end = parts[1] ? parseInt(parts[1], 10) : streamFileSize - 1;

		if (start >= streamFileSize || end >= streamFileSize || start > end) {
			return new Response(null, {
				status: 416,
				headers: { 'Content-Range': `bytes */${streamFileSize}` }
			});
		}

		const chunkSize = end - start + 1;
		const stream = fs.createReadStream(streamFilePath, { start, end });
		const webStream = Readable.toWeb(stream) as ReadableStream;

		return new Response(webStream, {
			status: 206,
			headers: {
				'Content-Range': `bytes ${start}-${end}/${streamFileSize}`,
				'Accept-Ranges': 'bytes',
				'Content-Length': chunkSize.toString(),
				'Content-Type': streamContentType,
				'Cache-Control': 'no-cache'
			}
		});
	}

	const stream = fs.createReadStream(streamFilePath);
	const webStream = Readable.toWeb(stream) as ReadableStream;

	const headers: Record<string, string> = {
		'Accept-Ranges': 'bytes',
		'Content-Length': streamFileSize.toString(),
		'Content-Type': streamContentType,
		'Cache-Control': 'no-cache'
	};

	if (isDownload) {
		headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(streamFileName)}`;
	}

	return new Response(webStream, {
		status: 200,
		headers
	});
};
