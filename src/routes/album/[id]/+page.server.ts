import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';
import { getAlbumById, getAlbums } from '$lib/server/db.js';

export const load: PageServerLoad = async ({ params }) => {
	const id = parseInt(params.id, 10);
	if (isNaN(id)) {
		throw error(400, 'Invalid album ID');
	}

	const result = getAlbumById(id);
	if (!result) {
		throw error(404, 'Album not found');
	}

	const allAlbums = getAlbums();

	return {
		album: result.album,
		tracks: result.tracks,
		allAlbums
	};
};
