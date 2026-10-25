import type { PageServerLoad } from './$types.js';
import { getAlbums, getAlbumWithTracks } from '$lib/server/db.js';
import { scanLibraryDirectory } from '$lib/server/scanner.js';
import type { ScannedFolderItem } from '$lib/types/index.js';

export const load: PageServerLoad = async ({ url }) => {
	const albums = getAlbums();
	const albumIdParam = url.searchParams.get('albumId');
	const initialAlbumId = albumIdParam ? parseInt(albumIdParam, 10) : null;
	const initialFolderPath = url.searchParams.get('folderPath') || null;

	let initialAlbumData = null;
	if (initialAlbumId && !isNaN(initialAlbumId)) {
		initialAlbumData = getAlbumWithTracks(initialAlbumId);
	}

	let folders: ScannedFolderItem[] = [];
	try {
		const scanResult = await scanLibraryDirectory();
		folders = scanResult.albums.map((a) => ({
			album_key: a.album_key,
			folder_path: a.folder_path,
			title: a.title,
			artist: a.artist,
			year: a.year,
			track_count: a.track_count,
			already_in_vault: a.already_in_vault,
			cover_url: a.cover_url
		}));
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

