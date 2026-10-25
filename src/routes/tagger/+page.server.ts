import type { PageServerLoad } from './$types.js';
import { getAlbums, getAlbumWithTracks } from '$lib/server/db.js';

export const load: PageServerLoad = async ({ url }) => {
	const albums = getAlbums();
	const albumIdParam = url.searchParams.get('albumId');
	const initialAlbumId = albumIdParam ? parseInt(albumIdParam, 10) : null;

	let initialAlbumData = null;
	if (initialAlbumId && !isNaN(initialAlbumId)) {
		initialAlbumData = getAlbumWithTracks(initialAlbumId);
	}

	return {
		albums,
		initialAlbumId: initialAlbumData ? initialAlbumId : null,
		initialAlbumData
	};
};
