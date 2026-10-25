import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';
import { getPlaylistById, getPlaylistTracks } from '$lib/server/db.js';

export const load: PageServerLoad = async ({ params }) => {
	const playlistId = parseInt(params.id, 10);
	if (isNaN(playlistId)) {
		throw error(400, 'Invalid playlist ID');
	}

	const playlist = getPlaylistById(playlistId);
	if (!playlist) {
		throw error(404, 'Playlist not found');
	}

	const tracks = getPlaylistTracks(playlistId);

	return {
		playlist,
		tracks
	};
};
