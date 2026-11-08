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
			importToVault = false,
			renameFiles = true
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
				importToVault,
				renameFiles
			}
		);

		if (result.hasPermissionErrors) {
			return json({
				success: false,
				error: result.error || 'Permission denied: Trax Vault cannot write to audio files or folder.',
				updatedTracksCount: result.updatedTracksCount,
				renamedFilesCount: result.renamedFilesCount || 0,
				totalAttempted: result.totalAttempted,
				importedAlbumId: result.importedAlbumId || null,
				folderTitle: result.folderTitle,
				folderArtist: result.folderArtist,
				folderYear: result.folderYear,
				coverUrl: result.coverUrl,
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
				renamedFilesCount: 0,
				totalAttempted: result.totalAttempted,
				fileErrors: result.fileErrors || [],
				coverError: result.coverError || null,
				hasPermissionErrors: false
			}, { status: 500 });
		}

		return json({
			success: true,
			updatedTracksCount: result.updatedTracksCount,
			renamedFilesCount: result.renamedFilesCount || 0,
			totalAttempted: result.totalAttempted,
			importedAlbumId: result.importedAlbumId || null,
			folderTitle: result.folderTitle,
			folderArtist: result.folderArtist,
			folderYear: result.folderYear,
			coverUrl: result.coverUrl,
			coverPath: result.coverPath || null,
			coverDownloaded: result.coverDownloaded || false,
			coverError: result.coverError || null,
			fileErrors: result.fileErrors || [],
			hasPermissionErrors: false
		});
	} catch (err: any) {
		console.error('Failed to apply folder tags:', err);
		return json({ error: err.message || 'Failed to apply tags' }, { status: 500 });
	}
};
