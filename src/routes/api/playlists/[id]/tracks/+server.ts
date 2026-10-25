import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
	getPlaylistById,
	getPlaylistTracks,
	updatePlaylist,
	replacePlaylistTracks,
	removePlaylistTrack
} from '$lib/server/db.js';

export const POST: RequestHandler = async ({ params, request }) => {
	const playlistId = parseInt(params.id, 10);
	if (isNaN(playlistId)) {
		return json({ error: 'Invalid playlist ID' }, { status: 400 });
	}

	try {
		const body = await request.json();
		const rawTrackIds = Array.isArray(body.trackIds) ? body.trackIds : body.trackId ? [body.trackId] : [];
		const trackIds = rawTrackIds.map((id: any) => parseInt(id, 10)).filter((n: number) => !isNaN(n));

		if (trackIds.length === 0) {
			return json({ error: 'No track IDs provided' }, { status: 400 });
		}

		updatePlaylist(playlistId, undefined, undefined, trackIds);

		const updatedTracks = getPlaylistTracks(playlistId);
		const playlist = getPlaylistById(playlistId);

		return json({ success: true, count: trackIds.length, playlist, tracks: updatedTracks });
	} catch (err: any) {
		console.error(`Failed to add tracks to playlist ${playlistId}:`, err);
		return json({ error: err.message || 'Failed to add tracks' }, { status: 500 });
	}
};

export const PUT: RequestHandler = async ({ params, request }) => {
	const playlistId = parseInt(params.id, 10);
	if (isNaN(playlistId)) {
		return json({ error: 'Invalid playlist ID' }, { status: 400 });
	}

	try {
		const body = await request.json();
		const rawTrackIds = Array.isArray(body.trackIds) ? body.trackIds : [];
		const trackIds = rawTrackIds.map((id: any) => parseInt(id, 10)).filter((n: number) => !isNaN(n));

		replacePlaylistTracks(playlistId, trackIds);

		const updatedTracks = getPlaylistTracks(playlistId);
		const playlist = getPlaylistById(playlistId);

		return json({ success: true, playlist, tracks: updatedTracks });
	} catch (err: any) {
		console.error(`Failed to reorder playlist tracks for ${playlistId}:`, err);
		return json({ error: err.message || 'Failed to reorder tracks' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ params, request, url }) => {
	const playlistId = parseInt(params.id, 10);
	if (isNaN(playlistId)) {
		return json({ error: 'Invalid playlist ID' }, { status: 400 });
	}

	try {
		let body: any = {};
		try {
			body = await request.json();
		} catch {}

		const trackIdParam = body.trackId || url.searchParams.get('trackId');
		const trackIndexParam = body.trackIndex !== undefined ? body.trackIndex : url.searchParams.get('trackIndex');

		const trackId = trackIdParam ? parseInt(trackIdParam, 10) : undefined;
		const trackIndex = trackIndexParam !== null && trackIndexParam !== undefined ? parseInt(trackIndexParam, 10) : undefined;

		if (trackId === undefined && trackIndex === undefined) {
			return json({ error: 'trackId or trackIndex is required' }, { status: 400 });
		}

		removePlaylistTrack(playlistId, trackId, trackIndex);

		const updatedTracks = getPlaylistTracks(playlistId);
		const playlist = getPlaylistById(playlistId);

		return json({ success: true, playlist, tracks: updatedTracks });
	} catch (err: any) {
		console.error(`Failed to remove track from playlist ${playlistId}:`, err);
		return json({ error: err.message || 'Failed to remove track' }, { status: 500 });
	}
};
