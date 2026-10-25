import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { searchMusicBrainz } from '$lib/server/tagger.js';

export const GET: RequestHandler = async ({ url }) => {
	const query = url.searchParams.get('query') || '';
	const artist = url.searchParams.get('artist') || '';
	const album = url.searchParams.get('album') || '';

	const searchQuery = query || (album && artist ? `${album} by ${artist}` : album || artist);
	if (!searchQuery && !artist) {
		return json({ releases: [] });
	}

	try {
		const releases = await searchMusicBrainz(searchQuery, artist || undefined);
		return json({ releases });
	} catch (err: any) {
		console.error('MusicBrainz search error:', err);
		return json({ error: err.message || 'Search failed', releases: [] }, { status: 500 });
	}
};
