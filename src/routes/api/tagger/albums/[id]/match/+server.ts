import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getAlbumWithTracks } from '$lib/server/db.js';
import {
	searchMusicBrainz,
	getMusicBrainzRelease,
	alignTracks,
	getMissingTracks
} from '$lib/server/tagger.js';
import type { MusicBrainzReleaseItem } from '$lib/types/index.js';

export const GET: RequestHandler = async ({ params, url }) => {
	const albumId = parseInt(params.id, 10);
	if (isNaN(albumId)) {
		return json({ error: 'Invalid album ID' }, { status: 400 });
	}

	const albumRes = getAlbumWithTracks(albumId);
	if (!albumRes) {
		return json({ error: 'Album not found' }, { status: 404 });
	}

	const { album, tracks } = albumRes;
	let targetMbid = url.searchParams.get('mbid') || album.musicbrainz_id || null;
	let candidates: MusicBrainzReleaseItem[] = [];

	try {
		// If no target MBID specified, search MusicBrainz automatically
		if (!targetMbid) {
			candidates = await searchMusicBrainz(album.title, album.artist);
			if (candidates.length > 0) {
				targetMbid = candidates[0].id;
			}
		} else {
			// Fetch candidates for release selector drawer
			candidates = await searchMusicBrainz(album.title, album.artist);
		}

		if (!targetMbid) {
			return json({
				album,
				release: null,
				matches: [],
				candidates,
				overall_score: 0,
				message: 'No matching releases found on MusicBrainz.'
			});
		}

		const release = await getMusicBrainzRelease(targetMbid);
		if (!release) {
			return json({
				album,
				release: null,
				matches: [],
				candidates,
				overall_score: 0,
				message: `Could not load release details for MBID: ${targetMbid}`
			});
		}

		const matches = alignTracks(tracks, release.tracks);
		const missingTracks = getMissingTracks(release.tracks, matches);
		const overallScore = matches.length > 0
			? Math.round(matches.reduce((sum, m) => sum + m.score, 0) / matches.length)
			: 0;

		return json({
			album,
			release,
			matches,
			missing_tracks: missingTracks,
			candidates,
			overall_score: overallScore
		});
	} catch (err: any) {
		console.error(`Track matching error for album ${albumId}:`, err);
		return json({ error: err.message || 'Matching failed' }, { status: 500 });
	}
};

export const POST: RequestHandler = async (event) => {
	return GET(event);
};
