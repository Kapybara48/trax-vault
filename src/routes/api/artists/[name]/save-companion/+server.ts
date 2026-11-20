import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { saveArtistCompanionImageToFolder } from '$lib/server/subsonic/artist.js';

export const POST: RequestHandler = async ({ params }) => {
	const artistName = (params.name || '').trim();
	if (!artistName) {
		return json({ error: 'Artist name required' }, { status: 400 });
	}

	try {
		const result = await saveArtistCompanionImageToFolder(artistName);
		if (!result.success) {
			return json({ error: result.error || 'Failed to save companion image' }, { status: 400 });
		}
		return json({ success: true, path: result.path });
	} catch (err: any) {
		console.error('[API] Failed to save companion artist image:', err);
		return json({ error: err.message || 'Internal error saving companion image' }, { status: 500 });
	}
};
