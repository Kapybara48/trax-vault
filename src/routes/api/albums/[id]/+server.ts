import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getAlbumById, updateAlbum, deleteAlbum } from '$lib/server/db.js';
import { invalidateScanCache } from '$lib/server/scanner.js';

export const GET: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id, 10);
	if (isNaN(id)) return json({ error: 'Invalid album ID' }, { status: 400 });

	const data = getAlbumById(id);
	if (!data) return json({ error: 'Album not found' }, { status: 404 });

	return json(data);
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const id = parseInt(params.id, 10);
	if (isNaN(id)) return json({ error: 'Invalid album ID' }, { status: 400 });

	try {
		const updates = await request.json();
		updateAlbum(id, updates);
		return json({ success: true });
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id, 10);
	if (isNaN(id)) return json({ error: 'Invalid album ID' }, { status: 400 });

	try {
		deleteAlbum(id);
		invalidateScanCache();
		return json({ success: true });
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};
