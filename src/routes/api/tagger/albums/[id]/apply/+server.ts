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
			coverUrl,
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
				coverUrl,
				updateAlbumTitle,
				updateArtist,
				updateYear
			}
		);

		if (result.hasPermissionErrors) {
			return json({
				success: false,
				error: result.error || 'Permission denied: Trax Vault cannot write to audio files or album directory.',
				updatedTracksCount: result.updatedTracksCount,
				totalAttempted: result.totalAttempted,
				album: result.album,
				tracks: result.tracks,
				coverPath: result.coverPath || null,
				coverDownloaded: result.coverDownloaded || false,
				coverError: result.coverError || null,
				fileErrors: result.fileErrors || [],
				hasPermissionErrors: true
			}, { status: 403 });
		}

		if (result.updatedTracksCount === 0 && result.totalAttempted > 0) {
			return json({
				success: false,
				error: result.error || 'Failed to write tags to any audio files on disk.',
				updatedTracksCount: 0,
				totalAttempted: result.totalAttempted,
				fileErrors: result.fileErrors || [],
				coverError: result.coverError || null,
				hasPermissionErrors: false
			}, { status: 500 });
		}

		return json({
			success: true,
			updatedTracksCount: result.updatedTracksCount,
			totalAttempted: result.totalAttempted,
			album: result.album,
			tracks: result.tracks,
			coverPath: result.coverPath || null,
			coverDownloaded: result.coverDownloaded || false,
			coverError: result.coverError || null,
			fileErrors: result.fileErrors || [],
			hasPermissionErrors: false
		});
	} catch (err: any) {
		console.error(`Failed to apply tags to album ${albumId}:`, err);
		return json({ error: err.message || 'Failed to apply tags' }, { status: 500 });
	}
};
