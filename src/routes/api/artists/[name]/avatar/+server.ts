import type { RequestHandler } from './$types.js';
import { handleSubsonicCoverArt } from '$lib/server/subsonic/media.js';
import { encodeArtistId } from '$lib/server/subsonic/artist.js';

export const GET: RequestHandler = async ({ params, request }) => {
	const artistName = (params.name || '').trim();
	if (!artistName) {
		return new Response('Artist name required', { status: 400 });
	}

	const token = encodeArtistId(artistName);
	return handleSubsonicCoverArt({ id: token }, request.headers);
};
