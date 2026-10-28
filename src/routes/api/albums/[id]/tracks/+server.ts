import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { addTrackToAlbum } from '$lib/server/db.js';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Forbidden: Administrator privileges required' }, { status: 403 });
	}

	const albumId = parseInt(params.id, 10);
	if (isNaN(albumId)) return json({ error: 'Invalid album ID' }, { status: 400 });

	try {
		const trackData = await request.json();
		if (!trackData.title) {
			return json({ error: 'Track title is required' }, { status: 400 });
		}

		const trackId = addTrackToAlbum(albumId, trackData);
		return json({ success: true, id: trackId });
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};
