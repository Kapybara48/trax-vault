import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { searchArtistCandidates } from '$lib/server/subsonic/artist.js';

export const GET: RequestHandler = async ({ url }) => {
	const q = (url.searchParams.get('q') || '').trim();
	if (!q) {
		return json({ candidates: [] });
	}

	try {
		const candidates = await searchArtistCandidates(q);
		return json({ candidates });
	} catch (err: any) {
		console.error('[API] Failed to search artist candidates:', err);
		return json({ error: err.message || 'Search failed', candidates: [] }, { status: 500 });
	}
};
