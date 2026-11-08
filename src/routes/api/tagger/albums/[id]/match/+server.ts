import fs from 'node:fs';
import path from 'node:path';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getAlbumWithTracks } from '$lib/server/db.js';
import { resolveTrackFilePath } from '$lib/server/scanner.js';
import {
	searchMusicBrainz,
	getMusicBrainzRelease,
	alignTracks,
	getMissingTracks,
	formatPermissionError
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

		// Only real local tracks with physical audio files should be matched against MusicBrainz release tracks
		const realTracks = tracks.filter((t) => t.is_missing !== 1 && !!t.file_path);
		const matches = alignTracks(realTracks, release.tracks);
		const missingTracks = getMissingTracks(release.tracks, matches);
		const overallScore = matches.length > 0
			? Math.round(matches.reduce((sum, m) => sum + m.score, 0) / matches.length)
			: 0;

		// Verify write permissions on track audio files and directory
		let isWritable = true;
		let permissionError: string | null = null;
		let permissionPath: string | null = null;
		const unwritableFiles: string[] = [];

		for (const t of realTracks) {
			const resolved = resolveTrackFilePath(t);
			if (resolved && fs.existsSync(resolved)) {
				try {
					fs.accessSync(resolved, fs.constants.W_OK);
				} catch {
					unwritableFiles.push(path.basename(resolved));
				}
				if (!permissionPath) {
					const dir = path.dirname(resolved);
					permissionPath = dir;
					try {
						fs.accessSync(dir, fs.constants.W_OK);
					} catch (dErr: any) {
						isWritable = false;
						permissionError = formatPermissionError(dir, dErr);
					}
				}
			}
		}

		if (unwritableFiles.length > 0 && isWritable) {
			isWritable = false;
			permissionError = `Permission denied: Trax Vault cannot modify ${unwritableFiles.length} audio file(s) in this album.`;
		}

		return json({
			album,
			release,
			matches,
			missing_tracks: missingTracks,
			candidates,
			overall_score: overallScore,
			is_writable: isWritable,
			permission_error: permissionError,
			permission_path: permissionPath,
			unwritable_files: unwritableFiles
		});
	} catch (err: any) {
		console.error(`Track matching error for album ${albumId}:`, err);
		return json({ error: err.message || 'Matching failed' }, { status: 500 });
	}
};

export const POST: RequestHandler = async (event) => {
	return GET(event);
};
