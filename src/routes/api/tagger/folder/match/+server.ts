import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
	scanFolderForTagger,
	searchMusicBrainz,
	getMusicBrainzRelease,
	alignTracks,
	getMissingTracks
} from '$lib/server/tagger.js';
import type { MusicBrainzReleaseItem } from '$lib/types/index.js';

export const GET: RequestHandler = async ({ url }) => {
	const folderPathParam = url.searchParams.get('folderPath');
	if (!folderPathParam) {
		return json({ error: 'Query parameter folderPath is required' }, { status: 400 });
	}

	try {
		const folderData = await scanFolderForTagger(folderPathParam);
		let targetMbid = url.searchParams.get('mbid') || folderData.musicbrainz_id || null;
		let candidates: MusicBrainzReleaseItem[] = [];

		if (!targetMbid) {
			candidates = await searchMusicBrainz(folderData.folder_title, folderData.folder_artist);
			if (candidates.length > 0) {
				targetMbid = candidates[0].id;
			}
		} else {
			candidates = await searchMusicBrainz(folderData.folder_title, folderData.folder_artist);
		}

		if (!targetMbid) {
			return json({
				folder_path: folderData.folder_path,
				folder_name: folderData.folder_name,
				folder_title: folderData.folder_title,
				folder_artist: folderData.folder_artist,
				folder_year: folderData.folder_year,
				cover_url: folderData.cover_url,
				already_in_vault: folderData.already_in_vault,
				existing_album_id: folderData.existing_album_id,
				release: null,
				candidates,
				matches: [],
				missing_tracks: [],
				overall_score: 0,
				message: 'No matching releases found on MusicBrainz.'
			});
		}

		const release = await getMusicBrainzRelease(targetMbid);
		if (!release) {
			return json({
				folder_path: folderData.folder_path,
				folder_name: folderData.folder_name,
				folder_title: folderData.folder_title,
				folder_artist: folderData.folder_artist,
				folder_year: folderData.folder_year,
				cover_url: folderData.cover_url,
				already_in_vault: folderData.already_in_vault,
				existing_album_id: folderData.existing_album_id,
				release: null,
				candidates,
				matches: [],
				missing_tracks: [],
				overall_score: 0,
				message: `Could not load release details for MBID: ${targetMbid}`
			});
		}

		const matches = alignTracks(folderData.tracks, release.tracks);
		const missingTracks = getMissingTracks(release.tracks, matches);
		const overallScore =
			matches.length > 0
				? Math.round(matches.reduce((sum, m) => sum + m.score, 0) / matches.length)
				: 0;

		return json({
			folder_path: folderData.folder_path,
			folder_name: folderData.folder_name,
			folder_title: folderData.folder_title,
			folder_artist: folderData.folder_artist,
			folder_year: folderData.folder_year,
			cover_url: folderData.cover_url,
			already_in_vault: folderData.already_in_vault,
			existing_album_id: folderData.existing_album_id,
			release,
			candidates,
			matches,
			missing_tracks: missingTracks,
			overall_score: overallScore
		});
	} catch (err: any) {
		console.error(`Folder matching error for ${folderPathParam}:`, err);
		return json({ error: err.message || 'Matching failed' }, { status: 500 });
	}
};

export const POST: RequestHandler = async (event) => {
	return GET(event);
};
