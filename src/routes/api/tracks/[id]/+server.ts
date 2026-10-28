import fs from 'node:fs';
import path from 'node:path';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { updateTrack, deleteTrack, getTrackById } from '$lib/server/db.js';
import { getMusicDirectory, isPathWithin, resolveTrackFilePath } from '$lib/server/scanner.js';

export const GET: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id, 10);
	if (isNaN(id)) return json({ error: 'Invalid track ID' }, { status: 400 });

	const track = getTrackById(id);
	if (!track) return json({ error: 'Track not found' }, { status: 404 });

	return json({ success: true, track });
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Forbidden: Administrator privileges required' }, { status: 403 });
	}

	const id = parseInt(params.id, 10);
	if (isNaN(id)) return json({ error: 'Invalid track ID' }, { status: 400 });

	try {
		const updates = await request.json();
		const updatedTrack = updateTrack(id, updates);
		return json({ success: true, track: updatedTrack });
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ params, url, request, locals }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Forbidden: Administrator privileges required' }, { status: 403 });
	}

	const id = parseInt(params.id, 10);
	if (isNaN(id)) return json({ error: 'Invalid track ID' }, { status: 400 });

	const track = getTrackById(id);
	if (!track) return json({ error: 'Track not found' }, { status: 404 });

	let deleteFile = url.searchParams.get('deleteFile') === 'true';
	if (!deleteFile && request.headers.get('content-type')?.includes('application/json')) {
		try {
			const body = await request.json();
			if (body.deleteFile === true) deleteFile = true;
		} catch {}
	}

	let fileDeleted = false;

	if (deleteFile) {
		const filePath = resolveTrackFilePath(track);
		if (filePath && fs.existsSync(filePath)) {
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
				canonicalFilePath = path.resolve(filePath);
			}

			if (isPathWithin(canonicalFilePath, canonicalMusicDir)) {
				try {
					fs.unlinkSync(canonicalFilePath);
					fileDeleted = true;

					// Check and unlink companion lyrics file if exists
					const dir = path.dirname(canonicalFilePath);
					const baseNoExt = path.basename(canonicalFilePath, path.extname(canonicalFilePath));
					for (const ext of ['.lrc', '.txt']) {
						const companion = path.join(dir, `${baseNoExt}${ext}`);
						if (fs.existsSync(companion) && isPathWithin(companion, canonicalMusicDir)) {
							try {
								fs.unlinkSync(companion);
							} catch (e) {
								console.warn('Failed to unlink companion lyrics file:', e);
							}
						}
					}
				} catch (err: any) {
					console.error('Failed to unlink audio file from disk:', err);
					return json({ error: `Failed to delete file from disk: ${err.message}` }, { status: 500 });
				}
			}
		}
	}

	try {
		deleteTrack(id);
		return json({ success: true, fileDeleted });
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};
