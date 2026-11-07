import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { scanLibraryDirectory, resolveMusicFolderPath } from '$lib/server/scanner.js';
import type { ScannedFolderItem } from '$lib/types/index.js';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const force = url.searchParams.get('force') === 'true';
		const scanResult = await scanLibraryDirectory(undefined, { force });
		const folderMap = new Map<string, ScannedFolderItem>();

		for (const a of scanResult.albums) {
			if (!a.folder_path) continue;
			const resolvedPath = resolveMusicFolderPath(a.folder_path) || a.folder_path;
			const existing = folderMap.get(resolvedPath);
			if (existing) {
				existing.track_count += a.track_count || 0;
				existing.already_in_vault = existing.already_in_vault || a.already_in_vault;
				existing.cover_url = existing.cover_url || a.cover_url;
			} else {
				folderMap.set(resolvedPath, {
					album_key: a.album_key,
					folder_path: resolvedPath,
					title: String(a.title || 'Unknown Album'),
					artist: String(a.artist || 'Unknown Artist'),
					year: a.year,
					track_count: a.track_count || 0,
					already_in_vault: a.already_in_vault,
					cover_url: a.cover_url
				});
			}
		}

		const folders = Array.from(folderMap.values());

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

