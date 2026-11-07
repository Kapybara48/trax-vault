import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';
import net from 'node:net';

// Ensure IPv4 is prioritized in DNS resolution and disable Happy Eyeballs autoSelectFamily
// to prevent ETIMEDOUT when external APIs like coverartarchive.org or archive.org are queried
try {
	if (typeof (net as any).setDefaultAutoSelectFamily === 'function') {
		(net as any).setDefaultAutoSelectFamily(false);
	}
	dns.setDefaultResultOrder('ipv4first');
} catch {}
import { writeTags, readTags } from '@dantheman827/taglib-ts/simpleApi.js';
import { FileRef } from '@dantheman827/taglib-ts/fileRef.js';
import { APP_VERSION } from '$lib/version.js';
import { searchMusicBrainz, getMusicBrainzRelease } from '$lib/server/musicbrainz.js';
import {
	resolveTrackFilePath,
	resolveMusicFolderPath,
	getMusicDirectory,
	isPathWithin,
	scanAudioFile,
	AUDIO_EXTENSIONS,
	findLocalCoverArt,
	importScannedAlbum,
	invalidateScanCache,
	updateAlbumInScanCache
} from '$lib/server/scanner.js';
import {
	updateAlbumAndTracksFromMusicBrainz,
	mergeScannedTracksIntoVaultAlbum,
	getAlbumWithTracks,
	db
} from '$lib/server/db.js';
import type {
	Track,
	Album,
	MusicBrainzReleaseItem,
	MusicBrainzReleaseDetail,
	MusicBrainzReleaseTrack,
	TrackMatch,
	AlbumMatchResult,
	FolderMatchResult,
	ScannedTrack,
	ScannedAlbum
} from '$lib/types/index.js';

export { searchMusicBrainz, getMusicBrainzRelease };

/**
 * Normalizes title or artist strings for robust fuzzy comparison
 */
export function normalizeString(str: string): string {
	if (!str) return '';
	return String(str)
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
		albumArtist?: string;
		album?: string;
		year?: number;
		track?: number;
		disc?: number;
		genre?: string;
		comment?: string;
	}
): Promise<{ success: boolean; error?: string }> {
	try {
		if (!fs.existsSync(filePath)) {
			return { success: false, error: `File not found on disk: ${filePath}` };
		}

		const fileBuffer = fs.readFileSync(filePath);
		const filename = path.basename(filePath);

		// First try: TagLib FileRef with PropertyMap for full multi-tag and ALBUMARTIST support
		try {
			const ref = await FileRef.fromByteArray(fileBuffer, filename, false);
			if (ref && ref.isValid) {
				const tag = ref.tag();
				if (tag) {
					if (tags.title !== undefined) tag.title = tags.title;
					if (tags.artist !== undefined) tag.artist = tags.artist;
					if (tags.album !== undefined) tag.album = tags.album;
					if (tags.year !== undefined) tag.year = tags.year;
					if (tags.track !== undefined) tag.track = tags.track;
					if (tags.genre !== undefined) tag.genre = tags.genre;
					if (tags.comment !== undefined) tag.comment = tags.comment;
				}

				const props = ref.properties();
				if (tags.title !== undefined) props.replace('TITLE', [tags.title]);
				if (tags.artist !== undefined) props.replace('ARTIST', [tags.artist]);
				const albArt = tags.albumArtist || tags.artist;
				if (albArt) {
					props.replace('ALBUMARTIST', [albArt]);
					props.replace('ALBUM ARTIST', [albArt]);
				}
				if (tags.album !== undefined) props.replace('ALBUM', [tags.album]);
				if (tags.year !== undefined) {
					props.replace('DATE', [String(tags.year)]);
					props.replace('YEAR', [String(tags.year)]);
				}
				if (tags.track !== undefined) props.replace('TRACKNUMBER', [String(tags.track)]);
				if (tags.disc !== undefined) props.replace('DISCNUMBER', [String(tags.disc)]);
				if (tags.genre !== undefined) props.replace('GENRE', [tags.genre]);
				if (tags.comment !== undefined) props.replace('COMMENT', [tags.comment]);

				ref.setProperties(props);

				const saved = await ref.save();
				if (saved) {
					const file = ref.file();
					if (file) {
						const stream = file.stream() as any;
						const updatedBytes = typeof stream.data === 'function' ? stream.data().data : null;
						if (updatedBytes && updatedBytes.length > 0) {
							fs.writeFileSync(filePath, Buffer.from(updatedBytes));
							return { success: true };
						}
					}
				}
			}
		} catch (refErr: any) {
			console.warn(`FileRef write attempt failed for ${filename}, falling back to writeTags:`, refErr.message);
		}

		// Fallback: simpleApi writeTags with explicit filename hint
		const updatedBytes = await writeTags(
			{ data: fileBuffer, filename },
			{
				title: tags.title,
				artist: tags.artist,
				album: tags.album,
				year: tags.year,
				track: tags.track,
				genre: tags.genre,
				comment: tags.comment
			}
		);

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
 * Downloads cover artwork from Cover Art Archive or direct URL and writes cover.jpg directly into target folders.
 * Features fast JSON discovery, bounded timeouts (4-6s), and non-blocking execution so requests never hang.
 */
export async function downloadAndSaveCover(
	albumFolderOrFolders: string | string[],
	imageUrl: string,
	fallbackUrls: string[] = []
): Promise<{ success: boolean; coverPath?: string; error?: string }> {
	try {
		const targetFolders = (Array.isArray(albumFolderOrFolders) ? albumFolderOrFolders : [albumFolderOrFolders])
			.filter(Boolean)
			.map((f) => path.resolve(f));

		const validFolders = targetFolders.filter((f) => fs.existsSync(f));
		if (validFolders.length === 0) {
			return { success: false, error: `None of the target album directories exist: ${targetFolders.join(', ')}` };
		}

		// Helper to write downloaded buffer to all folders
		const saveCoverBuffer = (buffer: Buffer, isPng = false): string => {
			let firstSavedPath = '';
			for (const folder of validFolders) {
				const standardJpgPath = path.join(folder, 'cover.jpg');
				fs.writeFileSync(standardJpgPath, buffer);
				if (isPng) {
					try {
						fs.writeFileSync(path.join(folder, 'cover.png'), buffer);
					} catch {}
				}
				if (!firstSavedPath) firstSavedPath = standardJpgPath;
			}
			return firstSavedPath;
		};

		// Helper to download an image from a direct URL with generous timeout (CoverArtArchive multi-hop redirects can take 8-15s)
		const fetchImageBuffer = async (url: string, timeoutMs = 25000): Promise<{ buffer: Buffer; isPng: boolean } | null> => {
			const ctrl = new AbortController();
			const tId = setTimeout(() => ctrl.abort(), timeoutMs);
			try {
				const res = await fetch(url, {
					redirect: 'follow',
					signal: ctrl.signal,
					headers: { 'User-Agent': `TraxVault/${APP_VERSION} ( contact@traxvault.local )` }
				});
				if (!res.ok) {
					console.warn(`[CoverArt] HTTP ${res.status} ${res.statusText} for ${url}`);
					return null;
				}
				const contentType = res.headers.get('content-type') || '';
				const buf = Buffer.from(await res.arrayBuffer());
				if (buf.length >= 1000) {
					console.log(`[CoverArt] Successfully downloaded image (${buf.length} bytes) from ${url}`);
					return { buffer: buf, isPng: contentType.includes('png') };
				}
			} catch (e: any) {
				console.warn(`[CoverArt] Image download attempt failed for ${url}:`, e.message);
			} finally {
				clearTimeout(tId);
			}
			return null;
		};

		// Extract MBID to query CoverArtArchive JSON index
		const allUrlCandidates = [imageUrl, ...fallbackUrls].filter(Boolean);
		let extractedMbid: string | null = null;
		for (const u of allUrlCandidates) {
			const m = u.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
			if (m) {
				extractedMbid = m[0];
				break;
			}
		}

		// Strategy 1: Direct CoverArtArchive front endpoints (fastest & highest resolution)
		const directCandidates: string[] = [];
		if (extractedMbid) {
			directCandidates.push(`https://coverartarchive.org/release/${extractedMbid}/front`);
			directCandidates.push(`https://coverartarchive.org/release/${extractedMbid}/front-500`);
			directCandidates.push(`https://coverartarchive.org/release/${extractedMbid}/front-250`);
		}
		if (imageUrl && !imageUrl.endsWith('.json') && !directCandidates.includes(imageUrl)) {
			directCandidates.push(imageUrl);
		}
		for (const u of fallbackUrls) {
			if (u && !u.endsWith('.json') && !directCandidates.includes(u)) {
				directCandidates.push(u);
			}
		}

		for (const directUrl of directCandidates) {
			const downloaded = await fetchImageBuffer(directUrl, 25000);
			if (downloaded) {
				const saved = saveCoverBuffer(downloaded.buffer, downloaded.isPng);
				console.log(`[CoverArt] Saved cover artwork to ${saved}`);
				return { success: true, coverPath: saved };
			}
		}

		// Strategy 2: Archive.org metadata API (direct storage cluster lookup, bypasses CAA redirect lags)
		if (extractedMbid) {
			try {
				const ctrl = new AbortController();
				const tId = setTimeout(() => ctrl.abort(), 12000);
				try {
					const metaRes = await fetch(`https://archive.org/metadata/mbid-${extractedMbid}`, {
						signal: ctrl.signal,
						headers: { 'User-Agent': `TraxVault/${APP_VERSION} ( contact@traxvault.local )`, Accept: 'application/json' }
					});
					if (metaRes.ok) {
						const metaData: any = await metaRes.json();
						if (metaData && metaData.server && metaData.dir && Array.isArray(metaData.files)) {
							// Find candidate cover image file: prefer thumb500 or full JPEG/PNG
							const imageFiles = metaData.files.filter((f: any) =>
								f.name &&
								!f.name.endsWith('.xml') &&
								!f.name.endsWith('.sqlite') &&
								!f.name.endsWith('.torrent') &&
								(f.name.includes('thumb500') || f.name.includes('front') || f.format === 'JPEG' || f.format === 'PNG')
							);
							// Order: thumb500 first, then original full image
							imageFiles.sort((a: any, b: any) => {
								const a500 = a.name.includes('thumb500') ? 0 : 1;
								const b500 = b.name.includes('thumb500') ? 0 : 1;
								return a500 - b500;
							});

							for (const imgFile of imageFiles) {
								const directStorageUrl = `https://${metaData.server}${metaData.dir}/${encodeURIComponent(imgFile.name)}`;
								const downloaded = await fetchImageBuffer(directStorageUrl, 25000);
								if (downloaded) {
									const saved = saveCoverBuffer(downloaded.buffer, downloaded.isPng);
									console.log(`[CoverArt] Saved cover artwork from Archive.org direct storage to ${saved}`);
									return { success: true, coverPath: saved };
								}
							}
						}
					}
				} finally {
					clearTimeout(tId);
				}
			} catch (iaErr: any) {
				console.warn(`[CoverArt] Archive.org metadata lookup failed for ${extractedMbid}:`, iaErr.message);
			}
		}

		// Strategy 3: Fast CoverArtArchive JSON index lookup fallback if direct links were 404
		if (extractedMbid) {
			try {
				const ctrl = new AbortController();
				const tId = setTimeout(() => ctrl.abort(), 12000);
				let caaData: any = null;
				try {
					const caaRes = await fetch(`https://coverartarchive.org/release/${extractedMbid}`, {
						signal: ctrl.signal,
						headers: { 'User-Agent': `TraxVault/${APP_VERSION} ( contact@traxvault.local )`, Accept: 'application/json' }
					});
					if (caaRes.ok) {
						caaData = await caaRes.json();
					}
				} finally {
					clearTimeout(tId);
				}

				if (caaData && Array.isArray(caaData.images)) {
					const front = caaData.images.find((i: any) => i.front) || caaData.images[0];
					if (front) {
						const jsonDirectLinks = [
							front.thumbnails?.['500'],
							front.image,
							front.thumbnails?.['250'],
							front.thumbnails?.['1200']
						].filter(Boolean);

						for (const directUrl of jsonDirectLinks) {
							const downloaded = await fetchImageBuffer(directUrl, 25000);
							if (downloaded) {
								const saved = saveCoverBuffer(downloaded.buffer, downloaded.isPng);
								console.log(`[CoverArt] Saved cover artwork from CAA JSON to ${saved}`);
								return { success: true, coverPath: saved };
							}
						}
					}
				}
			} catch (caaErr: any) {
				console.warn(`[CoverArt] CoverArtArchive release JSON lookup failed for ${extractedMbid}:`, caaErr.message);
			}
		}

		// Strategy 4: Release Group CoverArtArchive JSON lookup
		for (const u of fallbackUrls) {
			const rgMatch = u.match(/release-group\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
			if (rgMatch) {
				const rgMbid = rgMatch[1];
				try {
					const ctrl = new AbortController();
					const tId = setTimeout(() => ctrl.abort(), 12000);
					let rgData: any = null;
					try {
						const rgRes = await fetch(`https://coverartarchive.org/release-group/${rgMbid}`, {
							signal: ctrl.signal,
							headers: { 'User-Agent': `TraxVault/${APP_VERSION} ( contact@traxvault.local )`, Accept: 'application/json' }
						});
						if (rgRes.ok) {
							rgData = await rgRes.json();
						}
					} finally {
						clearTimeout(tId);
					}

					if (rgData && Array.isArray(rgData.images)) {
						const front = rgData.images.find((i: any) => i.front) || rgData.images[0];
						if (front) {
							const directUrl = front.thumbnails?.['500'] || front.image || front.thumbnails?.['250'];
							if (directUrl) {
								const downloaded = await fetchImageBuffer(directUrl, 25000);
								if (downloaded) {
									const saved = saveCoverBuffer(downloaded.buffer, downloaded.isPng);
									console.log(`[CoverArt] Saved cover artwork from RG JSON to ${saved}`);
									return { success: true, coverPath: saved };
								}
							}
						}
					}
				} catch {}
				break;
			}
		}

		return { success: false, error: 'Cover artwork could not be found or downloaded.' };
	} catch (err: any) {
		console.warn('Cover download error:', err.message);
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
		coverUrl?: string | null;
		updateAlbumTitle?: boolean;
		updateArtist?: boolean;
		updateYear?: boolean;
	} = {}
): Promise<{
	success: boolean;
	updatedTracksCount: number;
	album: Album;
	tracks: Track[];
	coverPath?: string;
	coverDownloaded?: boolean;
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

	// Resolve album folder paths
	const trackFolders = new Set<string>();
	for (const t of localTracks) {
		const resolved = resolveTrackFilePath(t);
		if (resolved) {
			trackFolders.add(path.dirname(resolved));
		} else if (t.file_path) {
			const musicDir = getMusicDirectory();
			const direct = path.resolve(musicDir, t.file_path.replace(/^[/\\]+/, ''));
			trackFolders.add(path.dirname(direct));
		}
	}
	const targetFoldersList = Array.from(trackFolders);
	let albumFolder: string | null = targetFoldersList[0] || null;

	// 1. Write embedded audio tags to each confirmed track file on disk FIRST
	let updatedTracksCount = 0;
	const trackUpdates: Array<{
		id: number;
		title: string;
		artist?: string | null;
		track_number: number;
		disc_number?: number;
	}> = [];

	const targetAlbumArtist = options.updateArtist ? release.artist : album.artist;

	for (const match of confirmedMatches) {
		const localTr = localTracks.find((t: Track) => t.id === match.localTrackId);
		if (!localTr || localTr.is_missing === 1 || !localTr.file_path) continue;

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
				albumArtist: targetAlbumArtist,
				album: options.updateAlbumTitle ? release.title : album.title,
				year: options.updateYear && release.release_year ? release.release_year : (album.release_year || undefined),
				track: targetTrackNum,
				disc: targetDiscNum
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

	// 2. Download cover art if requested and available (non-blocking)
	let newCoverUrl = album.cover_url;
	let coverRes: { success: boolean; coverPath?: string; error?: string } | undefined;
	if (options.updateCover && targetFoldersList.length > 0) {
		try {
			const fallbacks = [
				options.coverUrl || '',
				`https://coverartarchive.org/release/${release.id}/front`,
				`https://coverartarchive.org/release/${release.id}/front-500`,
				release.release_group_id ? `https://coverartarchive.org/release-group/${release.release_group_id}/front-500` : '',
				release.release_group_id ? `https://coverartarchive.org/release-group/${release.release_group_id}/front` : ''
			].filter(Boolean);

			const primaryUrl = options.coverUrl || release.cover_url || `https://coverartarchive.org/release/${release.id}/front`;
			coverRes = await downloadAndSaveCover(targetFoldersList, primaryUrl, fallbacks);
			if (coverRes.success && coverRes.coverPath) {
				const musicDir = getMusicDirectory();
				const relPath = path.relative(musicDir, coverRes.coverPath);
				const containerPath = `/music/${relPath.replace(/^\/+/, '')}`;
				newCoverUrl = `/api/library/cover?path=${encodeURIComponent(containerPath)}&t=${Date.now()}`;
			}
		} catch (covErr: any) {
			console.warn('Cover art download failed non-fatally in applyAlbumTags:', covErr.message);
		}
	}

	// 3. Compute missing tracks from MusicBrainz release
	// Only count confirmed matches that matched a REAL local file with physical audio on disk
	const matchedRealMbTrackIds = new Set<string>();
	for (const match of confirmedMatches) {
		const localTr = localTracks.find((t: Track) => t.id === match.localTrackId);
		if (localTr && localTr.is_missing !== 1 && !!localTr.file_path) {
			matchedRealMbTrackIds.add(match.mbTrackId);
		}
	}
	const missingMbTracks = release.tracks.filter((t) => !matchedRealMbTrackIds.has(t.id));
	const missingTracksToAdd = missingMbTracks.map((mt) => ({
		disc_number: mt.disc_number,
		track_number: mt.track_number,
		title: mt.title,
		artist: mt.artist || release.artist,
		duration_ms: mt.duration_ms
	}));

	// 4. Persist changes into SQLite database
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

	const updated = updateAlbumAndTracksFromMusicBrainz(albumId, albumUpdate, trackUpdates, missingTracksToAdd);
	if (!updated) {
		throw new Error('Failed to update album in database');
	}

	for (const folder of targetFoldersList) {
		updateAlbumInScanCache(folder, {
			title: options.updateAlbumTitle ? release.title : album.title,
			artist: options.updateArtist ? release.artist : album.artist,
			year: options.updateYear && release.release_year ? release.release_year : album.release_year,
			cover_url: newCoverUrl
		});
		invalidateScanCache(folder);
	}

	return {
		success: true,
		updatedTracksCount,
		album: updated.album,
		tracks: updated.tracks,
		coverPath: coverRes?.coverPath || undefined,
		coverDownloaded: Boolean(coverRes?.success && coverRes?.coverPath)
	};
}

/**
 * Computes list of MusicBrainz release tracks that are missing from local tracks/matches
 */
export function getMissingTracks(
	releaseTracks: MusicBrainzReleaseTrack[],
	matches: TrackMatch[]
): MusicBrainzReleaseTrack[] {
	const matchedMbIds = new Set<string>();
	for (const m of matches) {
		if (m.mb_track?.id) {
			matchedMbIds.add(m.mb_track.id);
		}
	}
	return releaseTracks.filter((rt) => !matchedMbIds.has(rt.id));
}

/**
 * Scans a folder on disk and prepares it for MusicBrainz matching and tag alignment
 */
export async function scanFolderForTagger(folderPath: string): Promise<{
	folder_path: string;
	folder_name: string;
	folder_title: string;
	folder_artist: string;
	folder_year: number | null;
	cover_url: string | null;
	musicbrainz_id: string | null;
	already_in_vault: boolean;
	existing_album_id: number | null;
	tracks: Track[];
	raw_tracks: ScannedTrack[];
}> {
	const musicDir = getMusicDirectory();
	let canonicalMusicDir: string;
	try {
		canonicalMusicDir = fs.existsSync(musicDir) ? fs.realpathSync(musicDir) : path.resolve(musicDir);
	} catch {
		canonicalMusicDir = path.resolve(musicDir);
	}

	const resolvedFolder = resolveMusicFolderPath(folderPath);
	const requested = resolvedFolder || path.resolve(folderPath);
	let canonicalTarget: string;
	try {
		canonicalTarget = fs.existsSync(requested) ? fs.realpathSync(requested) : requested;
	} catch {
		canonicalTarget = requested;
	}

	// Boundary verification
	if (!isPathWithin(canonicalTarget, canonicalMusicDir) && canonicalTarget !== canonicalMusicDir) {
		throw new Error(`Access denied: Target directory is outside configured music directory (${canonicalMusicDir}).`);
	}

	if (!fs.existsSync(canonicalTarget)) {
		throw new Error(`Directory not found: ${canonicalTarget}`);
	}

	const audioFiles: string[] = [];

	function walk(currentDir: string) {
		try {
			const entries = fs.readdirSync(currentDir, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.name.startsWith('.')) continue;

				const fullPath = path.join(currentDir, entry.name);
				if (entry.isDirectory()) {
					walk(fullPath);
				} else if (entry.isFile()) {
					const ext = path.extname(entry.name).toLowerCase();
					if (AUDIO_EXTENSIONS.has(ext)) {
						audioFiles.push(fullPath);
					}
				}
			}
		} catch (err) {
			console.warn(`Error scanning directory ${currentDir}:`, err);
		}
	}

	walk(canonicalTarget);

	const rawTracks: ScannedTrack[] = [];
	for (const file of audioFiles) {
		const track = await scanAudioFile(file);
		if (track) {
			rawTracks.push(track);
		}
	}

	// Sort raw tracks by disc number then track number
	rawTracks.sort((a, b) => {
		if (a.disc_number !== b.disc_number) return a.disc_number - b.disc_number;
		return a.track_number - b.track_number;
	});

	const first = rawTracks[0];
	const folderTitle = first?.album || path.basename(canonicalTarget);
	const validArtistTrack =
		rawTracks.find((t) => t.album_artist && t.album_artist.trim().toLowerCase() !== 'unknown artist') ||
		rawTracks.find((t) => t.artist && t.artist.trim().toLowerCase() !== 'unknown artist');
	const folderArtist = validArtistTrack?.album_artist || validArtistTrack?.artist || first?.artist || 'Unknown Artist';
	const folderYear = rawTracks.find((t) => t.year)?.year || null;
	const mbId = rawTracks.find((t) => t.musicbrainz_album_id)?.musicbrainz_album_id || null;

	let coverUrl = findLocalCoverArt(canonicalTarget);
	if (!coverUrl && mbId) {
		coverUrl = `https://coverartarchive.org/release/${mbId}/front-500`;
	}

	// Check if already in vault SQLite DB
	let alreadyInVault = false;
	let existingAlbumId: number | null = null;

	if (mbId) {
		const row = db.prepare('SELECT id FROM albums WHERE musicbrainz_id = ?').get(mbId) as
			| { id: number }
			| undefined;
		if (row) {
			alreadyInVault = true;
			existingAlbumId = row.id;
		}
	}
	if (!alreadyInVault) {
		const row = db
			.prepare('SELECT id FROM albums WHERE LOWER(title) = LOWER(?) AND LOWER(artist) = LOWER(?)')
			.get(folderTitle, folderArtist) as { id: number } | undefined;
		if (row) {
			alreadyInVault = true;
			existingAlbumId = row.id;
		}
	}

	// Construct synthetic Track objects for alignment
	const tracks: Track[] = rawTracks.map((rt, idx) => ({
		id: idx + 1,
		album_id: existingAlbumId || 0,
		disc_number: rt.disc_number,
		track_number: rt.track_number,
		title: rt.title,
		artist: rt.artist,
		duration_ms: rt.duration_ms,
		format: rt.format,
		quality_rating: rt.quality_rating,
		censorship: rt.censorship,
		lyrics: rt.lyrics,
		needs_attention: 0,
		manually_checked: 0,
		notes: null,
		file_path: rt.file_path,
		lyrics_text: rt.lyrics_content || null,
		bitrate_kbps: rt.bitrate_kbps,
		sample_rate: rt.sample_rate,
		bits_per_sample: rt.bits_per_sample,
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString()
	}));

	return {
		folder_path: canonicalTarget,
		folder_name: path.basename(canonicalTarget),
		folder_title: folderTitle,
		folder_artist: folderArtist,
		folder_year: folderYear,
		cover_url: coverUrl,
		musicbrainz_id: mbId,
		already_in_vault: alreadyInVault,
		existing_album_id: existingAlbumId,
		tracks,
		raw_tracks: rawTracks
	};
}

/**
 * Applies tags to audio files in a local folder, saves cover.jpg, and optionally imports into Vault
 */
export async function applyFolderTags(
	folderPath: string,
	releaseMbid: string,
	confirmedMatches: Array<{
		localTrackId: number;
		filePath?: string;
		mbTrackId: string;
		title: string;
		artist?: string | null;
		trackNumber: number;
		discNumber?: number;
	}>,
	options: {
		updateCover?: boolean;
		coverUrl?: string | null;
		updateAlbumTitle?: boolean;
		updateArtist?: boolean;
		updateYear?: boolean;
		importToVault?: boolean;
	} = {}
): Promise<{
	success: boolean;
	updatedTracksCount: number;
	importedAlbumId?: number | null;
	folderTitle?: string;
	folderArtist?: string;
	folderYear?: number | null;
	coverUrl?: string | null;
	coverPath?: string;
	coverDownloaded?: boolean;
	error?: string;
}> {
	const folderData = await scanFolderForTagger(folderPath);
	const canonicalTarget = folderData.folder_path;
	const musicDir = getMusicDirectory();
	let canonicalMusicDir: string;
	try {
		canonicalMusicDir = fs.existsSync(musicDir) ? fs.realpathSync(musicDir) : path.resolve(musicDir);
	} catch {
		canonicalMusicDir = path.resolve(musicDir);
	}

	const release = await getMusicBrainzRelease(releaseMbid);
	if (!release) {
		throw new Error(`MusicBrainz release ${releaseMbid} not found.`);
	}

	// Resolve all folders containing tracks (including subfolders or root canonical target)
	const trackFolders = new Set<string>();
	trackFolders.add(canonicalTarget);
	for (const t of folderData.tracks) {
		if (t.file_path) {
			trackFolders.add(path.dirname(t.file_path));
		}
	}
	const targetFoldersList = Array.from(trackFolders);

	// 1. Write audio tags to disk FIRST so verified tags are safely persisted even if cover fails
	let updatedTracksCount = 0;
	const targetAlbumTitle = options.updateAlbumTitle ? release.title : folderData.folder_title;
	const targetArtist = options.updateArtist ? release.artist : folderData.folder_artist;
	const targetYear =
		options.updateYear && release.release_year ? release.release_year : folderData.folder_year || undefined;

	for (const match of confirmedMatches) {
		// Find matching local file path
		const localTr = folderData.tracks.find((t) => t.id === match.localTrackId);
		const diskPath = match.filePath || localTr?.file_path;

		if (diskPath && fs.existsSync(diskPath)) {
			const targetTitle = match.title.trim();
			const trackArtist = match.artist?.trim() || targetArtist;
			const targetTrackNum = match.trackNumber;
			const targetDiscNum = match.discNumber || localTr?.disc_number || 1;

			const tagResult = await writeTagsToAudioFile(diskPath, {
				title: targetTitle,
				artist: trackArtist,
				albumArtist: targetArtist,
				album: targetAlbumTitle,
				year: targetYear,
				track: targetTrackNum,
				disc: targetDiscNum
			});

			if (tagResult.success) {
				updatedTracksCount++;
			} else {
				console.warn(`Failed writing tags to ${diskPath}:`, tagResult.error);
			}
		}
	}

	// 2. Download cover art if requested (non-blocking)
	let coverPath: string | undefined;
	let coverUrl: string | null = folderData.cover_url;
	let coverDownloaded = false;
	if (options.updateCover) {
		try {
			const fallbacks = [
				options.coverUrl || '',
				`https://coverartarchive.org/release/${release.id}/front`,
				`https://coverartarchive.org/release/${release.id}/front-500`,
				release.release_group_id ? `https://coverartarchive.org/release-group/${release.release_group_id}/front-500` : '',
				release.release_group_id ? `https://coverartarchive.org/release-group/${release.release_group_id}/front` : ''
			].filter(Boolean);

			const primaryUrl = options.coverUrl || release.cover_url || `https://coverartarchive.org/release/${release.id}/front`;
			const coverRes = await downloadAndSaveCover(targetFoldersList, primaryUrl, fallbacks);
			if (coverRes.success && coverRes.coverPath) {
				coverPath = coverRes.coverPath;
				coverDownloaded = true;
				const relPath = path.relative(canonicalMusicDir, coverPath);
				const containerPath = `/music/${relPath.replace(/^\/+/, '')}`;
				coverUrl = `/api/library/cover?path=${encodeURIComponent(containerPath)}&t=${Date.now()}`;
			}
		} catch (covErr: any) {
			console.warn('Cover art download failed non-fatally in applyFolderTags:', covErr.message);
		}
	}

	// 3. If importToVault requested
	let importedAlbumId: number | null = folderData.existing_album_id;

	if (options.importToVault) {
		if (folderData.already_in_vault && folderData.existing_album_id) {
			// Already in vault: update album and tracks in DB
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
			if (coverUrl) albumUpdate.cover_url = coverUrl;

			// Map confirmed matches to track IDs in the DB
			const dbTracksRes = getAlbumWithTracks(folderData.existing_album_id);
			if (dbTracksRes) {
				const trackUpdates: Array<{
					id: number;
					title: string;
					artist?: string | null;
					track_number: number;
					disc_number?: number;
				}> = [];

				for (const match of confirmedMatches) {
					const localSynthetic = folderData.tracks.find((t) => t.id === match.localTrackId);
					if (!localSynthetic?.file_path) continue;

					// Match DB track by file_path or track_number (only real non-missing tracks)
					const dbTr = dbTracksRes.tracks.find(
						(dt) => (dt.file_path && dt.file_path === localSynthetic.file_path) ||
						        (!dt.is_missing && dt.track_number === localSynthetic.track_number)
					);

					if (dbTr) {
						trackUpdates.push({
							id: dbTr.id,
							title: match.title.trim(),
							artist: match.artist?.trim() || release.artist,
							track_number: match.trackNumber,
							disc_number: match.discNumber || dbTr.disc_number || 1
						});
					}
				}

				const confirmedMbTrackIds = new Set(confirmedMatches.map((m) => m.mbTrackId));
				const missingMbTracks = release.tracks.filter((t) => !confirmedMbTrackIds.has(t.id));
				const missingTracksToAdd = missingMbTracks.map((mt) => ({
					disc_number: mt.disc_number,
					track_number: mt.track_number,
					title: mt.title,
					artist: mt.artist || release.artist,
					duration_ms: mt.duration_ms
				}));

				updateAlbumAndTracksFromMusicBrainz(folderData.existing_album_id, albumUpdate, trackUpdates, missingTracksToAdd);
			}
		} else {
			// Re-scan folder now that tags are written
			const rescan = await scanFolderForTagger(canonicalTarget);

			// Check if after writing the new tags, this album now matches an existing Vault album!
			if (rescan.already_in_vault && rescan.existing_album_id) {
				const merged = mergeScannedTracksIntoVaultAlbum(rescan.existing_album_id, rescan.raw_tracks, {
					overwriteTags: true,
					coverUrl: coverUrl || rescan.cover_url,
					musicbrainzId: release.id
				});
				importedAlbumId = merged ? merged.album.id : rescan.existing_album_id;
			} else {
				const scannedAlbum: ScannedAlbum = {
					album_key: `dir:${canonicalTarget}`,
					title: options.updateAlbumTitle ? release.title : rescan.folder_title,
					artist: options.updateArtist ? release.artist : rescan.folder_artist,
					year: options.updateYear && release.release_year ? release.release_year : rescan.folder_year,
					folder_path: canonicalTarget,
					musicbrainz_id: release.id,
					cover_url: coverUrl || rescan.cover_url,
					track_count: rescan.raw_tracks.length,
					has_flac: rescan.raw_tracks.some((t) => t.format === 'FLAC' || t.format === 'ALAC'),
					has_lrc: rescan.raw_tracks.some((t) => t.lyrics === 'synced_lrc' || t.lyrics === 'censored_lrc'),
					already_in_vault: false,
					tracks: rescan.raw_tracks,
					selected: true
				};

				importedAlbumId = await importScannedAlbum(scannedAlbum);
			}

			// Insert missing tracks from the release that have no local audio files
			const importedTrackNumbers = new Set(rescan.raw_tracks.map((t) => t.track_number));
			const missingReleaseTracks = release.tracks.filter((rt) => !importedTrackNumbers.has(rt.track_number));
			if (missingReleaseTracks.length > 0 && importedAlbumId) {
				const checkTrackStmt = db.prepare('SELECT id FROM tracks WHERE album_id = ? AND disc_number = ? AND track_number = ?');
				const insertMissingStmt = db.prepare(`
					INSERT INTO tracks (
						album_id, disc_number, track_number, title, artist, duration_ms,
						format, quality_rating, censorship, lyrics, needs_attention,
						manually_checked, is_missing, notes, file_path, lyrics_text
					) VALUES (
						?, ?, ?, ?, ?, ?,
						'OTHER', 'needs_upgrade', 'unknown', 'missing', 1,
						0, 1, '[Missing Song] Missing from local album on disk', NULL, NULL
					)
				`);
				for (const mt of missingReleaseTracks) {
					const existing = checkTrackStmt.get(importedAlbumId, mt.disc_number, mt.track_number);
					if (!existing) {
						insertMissingStmt.run(
							importedAlbumId,
							mt.disc_number,
							mt.track_number,
							mt.title.trim(),
							mt.artist?.trim() ?? release.artist,
							mt.duration_ms ?? null
						);
					}
				}
			}
		}
	}

	for (const folder of targetFoldersList) {
		updateAlbumInScanCache(folder, {
			title: targetAlbumTitle,
			artist: targetArtist,
			year: targetYear || null,
			cover_url: coverUrl
		});
	}

	return {
		success: true,
		updatedTracksCount,
		importedAlbumId,
		folderTitle: targetAlbumTitle,
		folderArtist: targetArtist,
		folderYear: targetYear || null,
		coverUrl,
		coverPath,
		coverDownloaded: Boolean(coverPath && fs.existsSync(coverPath))
	};
}

