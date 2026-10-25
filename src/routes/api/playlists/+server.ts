import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getUserPlaylists, createPlaylist, getPlaylistById } from '$lib/server/db.js';

export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.user?.id || 1;
	try {
		const playlists = getUserPlaylists(userId);
		return json({ playlists });
	} catch (err: any) {
		console.error('Failed to get playlists:', err);
		return json({ error: err.message || 'Failed to get playlists' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.user?.id || 1;
	try {
		const body = await request.json();
		const name = (body.name || '').trim();
		if (!name) {
			return json({ error: 'Playlist name is required' }, { status: 400 });
		}

		const comment = body.comment?.trim() || null;
		const isPublic = body.is_public ? 1 : 0;
		const trackIds = Array.isArray(body.trackIds) ? body.trackIds : [];

		const playlistId = createPlaylist(userId, name, comment, trackIds, isPublic);
		const playlist = getPlaylistById(playlistId);

		return json({ success: true, playlistId, playlist });
	} catch (err: any) {
		console.error('Failed to create playlist:', err);
		return json({ error: err.message || 'Failed to create playlist' }, { status: 500 });
	}
};
