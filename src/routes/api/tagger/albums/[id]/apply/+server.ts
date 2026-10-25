import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { applyAlbumTags } from '$lib/server/tagger.js';

export const POST: RequestHandler = async ({ params, request }) => {
	const albumId = parseInt(params.id, 10);
	if (isNaN(albumId)) {
		return json({ error: 'Invalid album ID' }, { status: 400 });
	}

	try {
		const body = await request.json();
		const {
			mbid,
			matches,
			updateCover = true,
			updateAlbumTitle = true,
			updateArtist = true,
			updateYear = true
		} = body;

		if (!mbid) {
			return json({ error: 'Release MBID is required' }, { status: 400 });
		}

		if (!Array.isArray(matches) || matches.length === 0) {
			return json({ error: 'No track matches to apply' }, { status: 400 });
		}

		const result = await applyAlbumTags(
			albumId,
			mbid,
			matches,
			{
				updateCover,
				updateAlbumTitle,
				updateArtist,
				updateYear
			}
		);

		return json({
			success: true,
			updatedTracksCount: result.updatedTracksCount,
			album: result.album,
			tracks: result.tracks
		});
	} catch (err: any) {
		console.error(`Failed to apply tags to album ${albumId}:`, err);
		return json({ error: err.message || 'Failed to apply tags' }, { status: 500 });
	}
};
