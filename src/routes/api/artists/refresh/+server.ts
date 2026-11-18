import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getOrFetchArtistInfo } from '$lib/server/subsonic/artist.js';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json().catch(() => ({}));
		const artistName = (body.artist || '').trim();

		if (!artistName) {
			return json({ error: "Missing required parameter 'artist'" }, { status: 400 });
		}

		const info = await getOrFetchArtistInfo(artistName, { forceRefresh: true });
		return json({ success: true, artist: info });
	} catch (err: any) {
		console.error('[API] Failed to refresh artist metadata:', err);
		return json({ error: err.message || 'Failed to refresh artist' }, { status: 500 });
	}
};
