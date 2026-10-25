import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
	getPlaylistById,
	getPlaylistTracks,
	updatePlaylist,
	deletePlaylist
} from '$lib/server/db.js';

export const GET: RequestHandler = async ({ params }) => {
	const playlistId = parseInt(params.id, 10);
	if (isNaN(playlistId)) {
		return json({ error: 'Invalid playlist ID' }, { status: 400 });
	}

	try {
		const playlist = getPlaylistById(playlistId);
		if (!playlist) {
			return json({ error: 'Playlist not found' }, { status: 404 });
		}

		const tracks = getPlaylistTracks(playlistId);
		return json({ playlist, tracks });
	} catch (err: any) {
		console.error(`Failed to get playlist ${playlistId}:`, err);
		return json({ error: err.message || 'Failed to get playlist' }, { status: 500 });
	}
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const playlistId = parseInt(params.id, 10);
	if (isNaN(playlistId)) {
		return json({ error: 'Invalid playlist ID' }, { status: 400 });
	}

	try {
		const body = await request.json();
		const name = body.name !== undefined ? String(body.name).trim() : undefined;
		const comment = body.comment !== undefined ? String(body.comment).trim() : undefined;
		const isPublic =
			body.is_public !== undefined ? (body.is_public ? 1 : 0) : undefined;

		updatePlaylist(playlistId, name, comment, undefined, undefined, isPublic);

		const updated = getPlaylistById(playlistId);
		return json({ success: true, playlist: updated });
	} catch (err: any) {
		console.error(`Failed to update playlist ${playlistId}:`, err);
		return json({ error: err.message || 'Failed to update playlist' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	const playlistId = parseInt(params.id, 10);
	if (isNaN(playlistId)) {
		return json({ error: 'Invalid playlist ID' }, { status: 400 });
	}

	try {
		deletePlaylist(playlistId);
		return json({ success: true });
	} catch (err: any) {
		console.error(`Failed to delete playlist ${playlistId}:`, err);
		return json({ error: err.message || 'Failed to delete playlist' }, { status: 500 });
	}
};
