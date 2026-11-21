import path from 'node:path';
import fs from 'node:fs';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { handleSubsonicCoverArt } from '$lib/server/subsonic/media.js';
import { encodeArtistId, saveArtistCompanionImageToFolder, deleteArtistAvatar } from '$lib/server/subsonic/artist.js';
import { upsertArtistMetadata } from '$lib/server/db.js';

export const GET: RequestHandler = async ({ params, request }) => {
	const artistName = (params.name || '').trim();
	if (!artistName) {
		return new Response('Artist name required', { status: 400 });
	}

	const token = encodeArtistId(artistName);
	return handleSubsonicCoverArt({ id: `art-${token}`, artist: artistName }, request.headers);
};

export const POST: RequestHandler = async ({ params, request }) => {
	const artistName = (params.name || '').trim();
	if (!artistName) {
		return json({ error: 'Artist name required' }, { status: 400 });
	}

	try {
		const formData = await request.formData();
		const file = formData.get('file') as File | null;
		const saveToFolder = formData.get('saveToFolder') === 'true';

		if (!file) {
			return json({ error: 'No image file provided' }, { status: 400 });
		}

		const arrayBuffer = await file.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);
		if (buffer.length === 0) {
			return json({ error: 'Empty file provided' }, { status: 400 });
		}

		const token = encodeArtistId(artistName);
		const baseDir = process.env.DATA_DIR || './data';
		const artistsDir = path.resolve(baseDir, 'artists');
		if (!fs.existsSync(artistsDir)) {
			fs.mkdirSync(artistsDir, { recursive: true });
		}

		const cachedPath = path.resolve(artistsDir, `${token}.jpg`);
		fs.writeFileSync(cachedPath, buffer);

		let companionSaved = false;
		let companionPath: string | undefined;

		if (saveToFolder) {
			const compRes = await saveArtistCompanionImageToFolder(artistName, { buffer });
			if (compRes.success) {
				companionSaved = true;
				companionPath = compRes.path;
			}
		}

		upsertArtistMetadata({
			id: token,
			name: artistName,
			image_disk_path: companionPath || cachedPath
		});

		return json({
			success: true,
			avatarUrl: `/api/artists/${encodeURIComponent(artistName)}/avatar?_t=${Date.now()}`,
			companionSaved,
			companionPath
		});
	} catch (err: any) {
		console.error('[API] Failed to upload artist avatar:', err);
		return json({ error: err.message || 'Failed to upload artist avatar' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	const artistName = (params.name || '').trim();
	if (!artistName) {
		return json({ error: 'Artist name required' }, { status: 400 });
	}

	try {
		const deleted = deleteArtistAvatar(artistName);
		return json({ success: deleted });
	} catch (err: any) {
		console.error('[API] Failed to delete artist avatar:', err);
		return json({ error: err.message || 'Failed to delete artist avatar' }, { status: 500 });
	}
};
