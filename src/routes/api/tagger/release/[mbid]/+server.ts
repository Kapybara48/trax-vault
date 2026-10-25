import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getMusicBrainzRelease } from '$lib/server/tagger.js';

export const GET: RequestHandler = async ({ params }) => {
	const mbid = params.mbid;
	if (!mbid) {
		return json({ error: 'Release MBID is required' }, { status: 400 });
	}

	try {
		const release = await getMusicBrainzRelease(mbid);
		if (!release) {
			return json({ error: 'Release not found on MusicBrainz' }, { status: 404 });
		}

		return json({ release });
	} catch (err: any) {
		console.error(`MusicBrainz release fetch error for ${mbid}:`, err);
		return json({ error: err.message || 'Failed to fetch release' }, { status: 500 });
	}
};
