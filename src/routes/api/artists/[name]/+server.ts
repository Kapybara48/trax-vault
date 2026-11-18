import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getOrFetchArtistInfo } from '$lib/server/subsonic/artist.js';

export const GET: RequestHandler = async ({ params }) => {
	const name = (params.name || '').trim();
	if (!name) {
		return json({ error: 'Artist name required' }, { status: 400 });
	}

	try {
		const info = await getOrFetchArtistInfo(name);
		return json({ success: true, artist: info });
	} catch (err: any) {
		return json({ error: err.message || 'Failed to get artist metadata' }, { status: 500 });
	}
};
