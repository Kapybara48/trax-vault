import type { PageServerLoad } from './$types.js';
import { getAlbums, getAlbumWithTracks } from '$lib/server/db.js';
import { scanLibraryDirectory, resolveMusicFolderPath } from '$lib/server/scanner.js';
import type { ScannedFolderItem } from '$lib/types/index.js';

export const load: PageServerLoad = async ({ url }) => {
	const albums = getAlbums();
	const albumIdParam = url.searchParams.get('albumId');
	const initialAlbumId = albumIdParam ? parseInt(albumIdParam, 10) : null;
	const rawFolderPath = url.searchParams.get('folderPath') || null;
	const initialFolderPath = rawFolderPath ? (resolveMusicFolderPath(rawFolderPath) || rawFolderPath) : null;

	let initialAlbumData = null;
	if (initialAlbumId && !isNaN(initialAlbumId)) {
		initialAlbumData = getAlbumWithTracks(initialAlbumId);
	}

	let folders: ScannedFolderItem[] = [];
	try {
		const scanResult = await scanLibraryDirectory();
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

		folders = Array.from(folderMap.values());
	} catch (err) {
		console.warn('Failed to load folders for tagger initial page load:', err);
	}

	return {
		albums,
		folders,
		initialAlbumId: initialAlbumData ? initialAlbumId : null,
		initialAlbumData,
		initialFolderPath
	};
};


