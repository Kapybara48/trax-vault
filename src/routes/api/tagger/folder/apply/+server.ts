import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { applyFolderTags } from '$lib/server/tagger.js';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const {
			folderPath,
			mbid,
			matches,
			coverUrl,
			updateCover = true,
			updateAlbumTitle = true,
			updateArtist = true,
			updateYear = true,
			importToVault = false
		} = body;

		if (!folderPath) {
			return json({ error: 'folderPath is required' }, { status: 400 });
		}

		if (!mbid) {
			return json({ error: 'Release MBID is required' }, { status: 400 });
		}

		if (!Array.isArray(matches) || matches.length === 0) {
			return json({ error: 'No track matches to apply' }, { status: 400 });
		}

		const result = await applyFolderTags(
			folderPath,
			mbid,
			matches,
			{
				updateCover,
				coverUrl,
				updateAlbumTitle,
				updateArtist,
				updateYear,
				importToVault
			}
		);

		return json({
			success: true,
			updatedTracksCount: result.updatedTracksCount,
			importedAlbumId: result.importedAlbumId || null,
			folderTitle: result.folderTitle,
			folderArtist: result.folderArtist,
			folderYear: result.folderYear,
			coverUrl: result.coverUrl,
			coverPath: result.coverPath || null,
			coverDownloaded: result.coverDownloaded || false
		});
	} catch (err: any) {
		console.error('Failed to apply folder tags:', err);
		return json({ error: err.message || 'Failed to apply tags' }, { status: 500 });
	}
};
