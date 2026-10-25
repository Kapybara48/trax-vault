import fs from 'node:fs';
import path from 'node:path';
import { writeTags, readTags } from '@dantheman827/taglib-ts/simpleApi.js';
import { searchMusicBrainz, getMusicBrainzRelease } from '$lib/server/musicbrainz.js';
import { resolveTrackFilePath, getMusicDirectory, isPathWithin } from '$lib/server/scanner.js';
import { updateAlbumAndTracksFromMusicBrainz, getAlbumWithTracks } from '$lib/server/db.js';
import type {
	Track,
	Album,
	MusicBrainzReleaseItem,
	MusicBrainzReleaseDetail,
	MusicBrainzReleaseTrack,
	TrackMatch,
	AlbumMatchResult
} from '$lib/types/index.js';

export { searchMusicBrainz, getMusicBrainzRelease };

/**
 * Normalizes title or artist strings for robust fuzzy comparison
 */
export function normalizeString(str: string): string {
	if (!str) return '';
	return str
		.toLowerCase()
		.replace(/[‘’]/g, "'")
		.replace(/[“”]/g, '"')
		.replace(/[–—]/g, '-')
		.replace(/^\d{1,3}[\s.\-_]+/, '') // strip leading track numbers like "01 - " or "1. "
		.replace(/\s*[\(\[\{]?(?:feat\.?|ft\.?|featuring|with)\s+[^)\]\}]+[\)\]\}]?/gi, '') // strip featured artists
		.replace(/\s*[\(\[\{]?(?:explicit|clean|remaster(?:ed)?|bonus track|deluxe(?: edition)?|anniversary edition)[\)\]\}]?/gi, '') // strip tags
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Calculates standard Levenshtein edit distance
 */
export function levenshteinDistance(a: string, b: string): number {
	if (a === b) return 0;
	if (!a.length) return b.length;
	if (!b.length) return a.length;
	const v0 = new Array(b.length + 1);
	const v1 = new Array(b.length + 1);
	for (let i = 0; i <= b.length; i++) v0[i] = i;
	for (let i = 0; i < a.length; i++) {
		v1[0] = i + 1;
		for (let j = 0; j < b.length; j++) {
			const cost = a[i] === b[j] ? 0 : 1;
			v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
		}
		for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
	}
	return v0[b.length];
}

/**
 * Word token similarity (Dice coefficient over unique word tokens)
 */
export function tokenSimilarity(a: string, b: string): number {
	const setA = new Set(a.split(' ').filter(Boolean));
	const setB = new Set(b.split(' ').filter(Boolean));
	if (setA.size === 0 && setB.size === 0) return 1;
	if (setA.size === 0 || setB.size === 0) return 0;
	let intersection = 0;
	for (const item of setA) {
		if (setB.has(item)) intersection++;
	}
	return (2 * intersection) / (setA.size + setB.size);
}

/**
 * Returns string similarity ratio between 0.0 and 1.0
 */
export function computeStringSimilarity(strA: string, strB: string): number {
	const normA = normalizeString(strA);
	const normB = normalizeString(strB);
	if (normA === normB) return 1.0;
	if (!normA || !normB) return 0.0;
	const maxLen = Math.max(normA.length, normB.length);
	const levRatio = 1 - levenshteinDistance(normA, normB) / maxLen;
	const tokRatio = tokenSimilarity(normA, normB);
	return Math.max(0, Math.max(levRatio, tokRatio));
}

/**
 * Calculates a match score (0 - 100) between a local track and a MusicBrainz release track
 */
function calculatePairScore(local: Track, mb: MusicBrainzReleaseTrack): number {
	const titleSim = computeStringSimilarity(local.title, mb.title);
	const sameNum = local.track_number === mb.track_number;
	const sameDisc = local.disc_number === mb.disc_number;

	let score = 0;
	if (sameNum && sameDisc) {
		if (titleSim > 0.8) {
			score = 90 + titleSim * 10;
		} else if (titleSim > 0.5) {
			score = 70 + titleSim * 20;
		} else {
			score = 50 + titleSim * 20;
		}
	} else if (sameNum) {
		score = 40 + titleSim * 45;
	} else {
		if (titleSim > 0.85) {
			score = 75 + (titleSim - 0.85) * 160;
		} else if (titleSim > 0.6) {
			score = 50 + (titleSim - 0.6) * 60;
		} else {
			score = titleSim * 50;
		}
	}

	// Duration bonus or penalty
	if (local.duration_ms && mb.duration_ms) {
		const diff = Math.abs(local.duration_ms - mb.duration_ms);
		if (diff <= 3000) score += 8;
		else if (diff <= 7000) score += 4;
		else if (diff > 45000 && titleSim < 0.7) score -= 20;
	}

	return Math.max(0, Math.min(100, Math.round(score)));
}

function buildTrackMatch(local: Track, mb: MusicBrainzReleaseTrack | null, score: number): TrackMatch {
	if (!mb) {
		return {
			local_track: local,
			mb_track: null,
			score: 0,
			match_type: 'unmatched',
			title_diff: false,
			artist_diff: false,
			number_diff: false,
			duration_diff: false
		};
	}

	let matchType: 'exact' | 'high' | 'medium' | 'low' = 'low';
	if (score >= 98) matchType = 'exact';
	else if (score >= 80) matchType = 'high';
	else if (score >= 50) matchType = 'medium';

	const titleDiff = normalizeString(local.title) !== normalizeString(mb.title);
	const artistDiff = Boolean(
		local.artist && mb.artist && normalizeString(local.artist) !== normalizeString(mb.artist)
	);
	const numberDiff = local.track_number !== mb.track_number || local.disc_number !== mb.disc_number;
	const durationDiff = Boolean(
		local.duration_ms && mb.duration_ms && Math.abs(local.duration_ms - mb.duration_ms) > 6000
	);

	return {
		local_track: local,
		mb_track: mb,
		score,
		match_type: matchType,
		title_diff: titleDiff,
		artist_diff: artistDiff,
		number_diff: numberDiff,
		duration_diff: durationDiff
	};
}

/**
 * Aligns local album tracks against target MusicBrainz release tracks
 */
export function alignTracks(
	localTracks: Track[],
	mbTracks: MusicBrainzReleaseTrack[]
): TrackMatch[] {
	const pairs: Array<{ local: Track; mb: MusicBrainzReleaseTrack; score: number }> = [];

	for (const lt of localTracks) {
		for (const mt of mbTracks) {
			pairs.push({ local: lt, mb: mt, score: calculatePairScore(lt, mt) });
		}
	}

	// Sort pairs descending by match score
	pairs.sort((a, b) => b.score - a.score);

	const matchedLocalIds = new Set<number>();
	const matchedMbIds = new Set<string>();
	const matches: TrackMatch[] = [];

	for (const pair of pairs) {
		if (matchedLocalIds.has(pair.local.id) || matchedMbIds.has(pair.mb.id)) continue;
		if (pair.score < 25) continue; // Minimum match threshold

		matchedLocalIds.add(pair.local.id);
		matchedMbIds.add(pair.mb.id);
		matches.push(buildTrackMatch(pair.local, pair.mb, pair.score));
	}

	// Any unassigned local tracks
	for (const lt of localTracks) {
		if (!matchedLocalIds.has(lt.id)) {
			matches.push(buildTrackMatch(lt, null, 0));
		}
	}

	// Sort matches by local track disc and track order
	matches.sort((a, b) => {
		if (a.local_track.disc_number !== b.local_track.disc_number) {
			return a.local_track.disc_number - b.local_track.disc_number;
		}
		return a.local_track.track_number - b.local_track.track_number;
	});

	return matches;
}

/**
 * Writes audio tags directly into the target audio file on disk
 */
export async function writeTagsToAudioFile(
	filePath: string,
	tags: {
		title?: string;
		artist?: string;
		album?: string;
		year?: number;
		track?: number;
		genre?: string;
		comment?: string;
	}
): Promise<{ success: boolean; error?: string }> {
	try {
		if (!fs.existsSync(filePath)) {
			return { success: false, error: `File not found on disk: ${filePath}` };
		}

		const fileBuffer = fs.readFileSync(filePath);
		const updatedBytes = await writeTags(fileBuffer, {
			title: tags.title,
			artist: tags.artist,
			album: tags.album,
			year: tags.year,
			track: tags.track,
			genre: tags.genre,
			comment: tags.comment
		});

		if (!updatedBytes) {
			return { success: false, error: 'TagLib failed to encode updated tags for file format.' };
		}

		fs.writeFileSync(filePath, Buffer.from(updatedBytes));
		return { success: true };
	} catch (err: any) {
		console.error(`Failed to write tags to ${filePath}:`, err);
		return { success: false, error: err.message || 'Unknown error writing tags' };
	}
}

/**
 * Downloads cover artwork from Cover Art Archive or direct URL and writes cover.jpg
 */
export async function downloadAndSaveCover(
	albumFolder: string,
	imageUrl: string
): Promise<{ success: boolean; coverPath?: string; error?: string }> {
	try {
		if (!fs.existsSync(albumFolder)) {
			return { success: false, error: `Album directory not found: ${albumFolder}` };
		}

		const res = await fetch(imageUrl, {
			redirect: 'follow',
			headers: {
				'User-Agent': 'TrackVault/1.0.0 ( contact@trackvault.local )'
			}
		});

		if (!res.ok) {
			return { success: false, error: `Image fetch failed with status ${res.status}` };
		}

		const buffer = Buffer.from(await res.arrayBuffer());
		const coverFilePath = path.join(albumFolder, 'cover.jpg');
		fs.writeFileSync(coverFilePath, buffer);

		return { success: true, coverPath: coverFilePath };
	} catch (err: any) {
		console.error(`Failed to download cover from ${imageUrl}:`, err);
		return { success: false, error: err.message || 'Failed to download cover' };
	}
}

/**
 * Applies tags to all confirmed track pairs for an album:
 * 1. Writes audio tags to disk using TagLib
 * 2. Optionally downloads high-res cover art
 * 3. Updates SQLite album and tracks tables
 */
export async function applyAlbumTags(
	albumId: number,
	releaseMbid: string,
	confirmedMatches: Array<{
		localTrackId: number;
		mbTrackId: string;
		title: string;
		artist?: string | null;
		trackNumber: number;
		discNumber?: number;
	}>,
	options: {
		updateCover?: boolean;
		updateAlbumTitle?: boolean;
		updateArtist?: boolean;
		updateYear?: boolean;
	} = {}
): Promise<{
	success: boolean;
	updatedTracksCount: number;
	album: Album;
	tracks: Track[];
	error?: string;
}> {
	const albumRes = getAlbumWithTracks(albumId);
	if (!albumRes) {
		throw new Error(`Album with ID ${albumId} not found.`);
	}

	const release = await getMusicBrainzRelease(releaseMbid);
	if (!release) {
		throw new Error(`MusicBrainz release ${releaseMbid} not found.`);
	}

	const album = albumRes.album;
	const localTracks: Track[] = albumRes.tracks;

	// Resolve album folder path
	let albumFolder: string | null = null;
	for (const t of localTracks) {
		const resolved = resolveTrackFilePath(t);
		if (resolved) {
			albumFolder = path.dirname(resolved);
			break;
		}
	}

	// 1. Download cover art if requested and available
	let newCoverUrl = album.cover_url;
	if (options.updateCover && release.cover_url && albumFolder) {
		const coverRes = await downloadAndSaveCover(albumFolder, release.cover_url);
		if (coverRes.success && coverRes.coverPath) {
			const musicDir = getMusicDirectory();
			const relPath = path.relative(musicDir, coverRes.coverPath);
			const containerPath = `/music/${relPath.replace(/^\/+/, '')}`;
			newCoverUrl = `/api/library/cover?path=${encodeURIComponent(containerPath)}&t=${Date.now()}`;
		}
	}

	// 2. Write embedded audio tags to each confirmed track file on disk
	let updatedTracksCount = 0;
	const trackUpdates: Array<{
		id: number;
		title: string;
		artist?: string | null;
		track_number: number;
		disc_number?: number;
	}> = [];

	for (const match of confirmedMatches) {
		const localTr = localTracks.find((t: Track) => t.id === match.localTrackId);
		if (!localTr) continue;

		const targetTitle = match.title.trim();
		const targetArtist = match.artist?.trim() || release.artist;
		const targetTrackNum = match.trackNumber;
		const targetDiscNum = match.discNumber || localTr.disc_number || 1;

		// Write to file on disk if path can be resolved
		const diskPath = resolveTrackFilePath(localTr);
		if (diskPath && fs.existsSync(diskPath)) {
			await writeTagsToAudioFile(diskPath, {
				title: targetTitle,
				artist: targetArtist,
				album: options.updateAlbumTitle ? release.title : album.title,
				year: options.updateYear && release.release_year ? release.release_year : (album.release_year || undefined),
				track: targetTrackNum
			});
		}

		trackUpdates.push({
			id: localTr.id,
			title: targetTitle,
			artist: targetArtist,
			track_number: targetTrackNum,
			disc_number: targetDiscNum
		});
		updatedTracksCount++;
	}

	// 3. Persist changes into SQLite database
	const albumUpdate: {
		title?: string;
		artist?: string;
		release_year?: number | null;
		genre?: string | null;
		cover_url?: string | null;
		musicbrainz_id?: string | null;
	} = {
		musicbrainz_id: release.id
	};

	if (options.updateAlbumTitle) albumUpdate.title = release.title;
	if (options.updateArtist) albumUpdate.artist = release.artist;
	if (options.updateYear && release.release_year) albumUpdate.release_year = release.release_year;
	if (newCoverUrl) albumUpdate.cover_url = newCoverUrl;

	const updated = updateAlbumAndTracksFromMusicBrainz(albumId, albumUpdate, trackUpdates);
	if (!updated) {
		throw new Error('Failed to update album in database');
	}

	return {
		success: true,
		updatedTracksCount,
		album: updated.album,
		tracks: updated.tracks
	};
}
