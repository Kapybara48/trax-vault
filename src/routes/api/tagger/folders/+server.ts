import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { scanLibraryDirectory } from '$lib/server/scanner.js';
import type { ScannedFolderItem } from '$lib/types/index.js';

export const GET: RequestHandler = async () => {
	try {
		const scanResult = await scanLibraryDirectory();
		const folders: ScannedFolderItem[] = scanResult.albums.map((a) => ({
			album_key: a.album_key,
			folder_path: a.folder_path,
			title: a.title,
			artist: a.artist,
			year: a.year,
			track_count: a.track_count,
			already_in_vault: a.already_in_vault,
			cover_url: a.cover_url
		}));

		return json({
			folders,
			totalFolders: folders.length,
			totalFiles: scanResult.totalFiles
		});
	} catch (err: any) {
		console.error('Failed to list folders for tagger:', err);
		return json({ error: err.message || 'Failed to list folders' }, { status: 500 });
	}
};
