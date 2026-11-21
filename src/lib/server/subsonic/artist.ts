import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db, getAlbumsByArtist, getArtistMetadata, upsertArtistMetadata, findSimilarArtistsInLibrary, getDistinctArtists } from '$lib/server/db.js';
import {
	searchMusicBrainzArtist,
	getMusicBrainzArtistDetail,
	resolveWikimediaAndWikipedia
} from '$lib/server/musicbrainz.js';
import { getMusicDirectory, isPathWithin, resolveTrackFilePath } from '$lib/server/scanner.js';
import { isGenericArtist, normalizeArtistName, GENERIC_ARTIST_NAMES } from '$lib/utils.js';
import type { ArtistMetadata, SimilarArtist } from '$lib/types/index.js';

export function encodeArtistId(name: string): string {
	return 'art_' + Buffer.from(name, 'utf8').toString('hex');
}

export function decodeArtistId(id: string): string {
	const cleanId = id.replace(/^art[-_]/, '');
	if (cleanId.startsWith('art_')) {
		try {
			return Buffer.from(cleanId.substring(4), 'hex').toString('utf8');
		} catch {
			return cleanId;
		}
	}
	// If hex string (even length, only hex characters)
	if (/^[0-9a-f]{4,}$/i.test(cleanId) && cleanId.length % 2 === 0) {
		try {
			const decoded = Buffer.from(cleanId, 'hex').toString('utf8');
			// If it decoded to valid printable characters, return it
			if (decoded && /^[\x20-\x7E\p{L}\p{N}\p{P}\p{Z}]+$/u.test(decoded)) {
				return decoded;
			}
		} catch {}
	}
	// Fallback: ONLY if cleanId is purely numeric digits
	if (/^\d+$/.test(cleanId)) {
		const numericId = parseInt(cleanId, 10);
		const row = db.prepare('SELECT artist FROM albums WHERE id = ?').get(numericId) as { artist: string } | undefined;
		if (row?.artist) return row.artist;
	}
	return cleanId;
}

const ARTIST_IMAGE_NAMES = [
	'artist.jpg',
	'artist.jpeg',
	'artist.png',
	'artist.webp',
	'band.jpg',
	'band.png',
	'artist-thumb.jpg'
];

/**
 * Scans directories of an artist's tracks/albums to discover local artist artwork
 */
export function findLocalArtistImage(artistName: string): string | null {
	try {
		const musicDir = getMusicDirectory();
		const albums = getAlbumsByArtist(artistName);
		for (const alb of albums) {
			const track = db.prepare('SELECT file_path FROM tracks WHERE album_id = ? AND file_path IS NOT NULL LIMIT 1').get(alb.id) as { file_path?: string } | undefined;
			if (!track?.file_path) continue;

			const resolved = resolveTrackFilePath(track);
			if (!resolved) continue;

			// Check parent artist folder (must be inside musicDir and not musicDir itself)
			const albumFolder = path.dirname(resolved);
			const artistFolder = path.dirname(albumFolder);

			if (artistFolder !== musicDir && isPathWithin(artistFolder, musicDir) && fs.existsSync(artistFolder)) {
				for (const imgName of ARTIST_IMAGE_NAMES) {
					const candidate = path.join(artistFolder, imgName);
					if (fs.existsSync(candidate)) {
						return candidate;
					}
				}
			}
		}
	} catch (err) {
		console.warn(`[Artist Engine] Error scanning local artist image for "${artistName}":`, err);
	}
	return null;
}

/**
 * Resolves the primary root artist folder in the music library
 */
export function findLocalArtistFolder(artistName: string): string | null {
	try {
		const albums = getAlbumsByArtist(artistName);
		const musicDir = getMusicDirectory();
		for (const alb of albums) {
			const track = db.prepare('SELECT file_path FROM tracks WHERE album_id = ? AND file_path IS NOT NULL LIMIT 1').get(alb.id) as { file_path?: string } | undefined;
			if (!track?.file_path) continue;

			const resolved = resolveTrackFilePath(track);
			if (!resolved) continue;

			const albumFolder = path.dirname(resolved);
			const artistFolder = path.dirname(albumFolder);

			// If the artist folder is inside musicDir and not musicDir itself
			if (artistFolder !== musicDir && isPathWithin(artistFolder, musicDir) && fs.existsSync(artistFolder)) {
				return artistFolder;
			}
			// Fallback: album folder if inside musicDir
			if (albumFolder !== musicDir && isPathWithin(albumFolder, musicDir) && fs.existsSync(albumFolder)) {
				return albumFolder;
			}
		}
	} catch (err) {
		console.warn(`[Artist Engine] Error finding local artist folder for "${artistName}":`, err);
	}
	return null;
}

/**
 * Saves artist image as companion artist.jpg directly into the artist's library folder on disk
 */
export async function saveArtistCompanionImageToFolder(
	artistName: string,
	options: { buffer?: Buffer; imageUrl?: string } = {}
): Promise<{ success: boolean; path?: string; error?: string }> {
	const folder = findLocalArtistFolder(artistName);
	if (!folder) {
		return { success: false, error: `Could not locate music folder for artist "${artistName}"` };
	}

	try {
		fs.accessSync(folder, fs.constants.W_OK);
	} catch {
		return { success: false, error: `Artist folder "${folder}" is read-only or permission is denied` };
	}

	let buf = options.buffer;
	if (!buf && options.imageUrl) {
		try {
			const res = await fetch(options.imageUrl);
			if (res.ok) {
				buf = Buffer.from(await res.arrayBuffer());
			}
		} catch (err: any) {
			return { success: false, error: `Failed to download image: ${err.message}` };
		}
	}

	if (!buf) {
		// Read from cached disk image if available
		const token = encodeArtistId(artistName);
		const baseDir = process.env.DATA_DIR || './data';
		const cachedFile = path.resolve(baseDir, 'artists', `${token}.jpg`);
		if (fs.existsSync(cachedFile)) {
			buf = fs.readFileSync(cachedFile);
		} else {
			const meta = getArtistMetadata(artistName);
			if (meta?.image_url) {
				try {
					const res = await fetch(meta.image_url);
					if (res.ok) buf = Buffer.from(await res.arrayBuffer());
				} catch {}
			}
		}
	}

	if (!buf || buf.length === 0) {
		return { success: false, error: 'No image data available to save' };
	}

	const targetPath = path.join(folder, 'artist.jpg');
	fs.writeFileSync(targetPath, buf);

	// Update SQLite to point to local companion image
	upsertArtistMetadata({ name: artistName, image_disk_path: targetPath });

	return { success: true, path: targetPath };
}

/**
 * Downloads and caches an artist image to the local cache directory
 */
export async function cacheArtistImageToDisk(artistToken: string, imageUrl: string, overwrite: boolean = false): Promise<string | null> {
	try {
		const baseDir = process.env.DATA_DIR || './data';
		const artistsDir = path.resolve(baseDir, 'artists');
		if (!fs.existsSync(artistsDir)) {
			fs.mkdirSync(artistsDir, { recursive: true });
		}

		const targetPath = path.resolve(artistsDir, `${artistToken}.jpg`);
		if (!overwrite && fs.existsSync(targetPath)) {
			return targetPath;
		}

		const ctrl = new AbortController();
		const timeout = setTimeout(() => ctrl.abort(), 8000);
		try {
			const res = await fetch(imageUrl, {
				signal: ctrl.signal,
				headers: { 'User-Agent': 'TraxVault/1.7.25' }
			});
			if (!res.ok) return null;
			const buffer = await res.arrayBuffer();
			fs.writeFileSync(targetPath, Buffer.from(buffer));
			return targetPath;
		} finally {
			clearTimeout(timeout);
		}
	} catch (err) {
		console.warn(`[Artist Engine] Failed to cache artist image for token ${artistToken}:`, err);
		return null;
	}
}

/**
 * Deletes cached artist avatar from disk and clears database image pointers
 */
export function deleteArtistAvatar(artistName: string): boolean {
	try {
		const token = encodeArtistId(artistName);
		const baseDir = process.env.DATA_DIR || './data';
		const diskPath = path.resolve(baseDir, 'artists', `${token}.jpg`);
		if (fs.existsSync(diskPath)) {
			try {
				fs.unlinkSync(diskPath);
			} catch {}
		}

		db.prepare(`
			UPDATE artist_metadata
			SET image_url = NULL, image_disk_path = NULL, updated_at = CURRENT_TIMESTAMP
			WHERE LOWER(name) = LOWER(?)
		`).run(artistName);

		return true;
	} catch (err) {
		console.warn(`[Artist Engine] Failed to delete artist avatar for "${artistName}":`, err);
		return false;
	}
}

export const FALSE_POSITIVE_DEEZER_HASHES = [
	'24b4805a1a47079669dfbe5c24920c4b', // George Gershwin (Various Artists)
	'519b6a5550a4e36a87190a7953ef3df0', // Bo Diddley (Soundtrack)
	'baa7f926e6d71d3a93359c23ed7ea20e', // Oster Lapwass (OST)
	'd2adeaa31a7a426802ea1786873db7b3', // Null
	'82de28805504050f244dfe955d5cbb79', // Anton Rubinstein
	'7fa738468c9a73ff98c1e1b78d622b81'  // Emine'm
];

const GERSHWIN_MD5 = 'e2d71ec4224ce1aeea889d03cf934c37';

/**
 * Purges corrupted/mismatched artist images (e.g., George Gershwin or Bo Diddley on "Various Artists")
 */
export function purgeInvalidArtistCache(): void {
	try {
		for (const generic of GENERIC_ARTIST_NAMES) {
			deleteArtistAvatar(generic);
		}

		// Purge any metadata rows that contain false-positive celebrity portraits
		const rows = db.prepare('SELECT name, image_url, image_disk_path FROM artist_metadata WHERE image_url IS NOT NULL').all() as Array<{ name: string; image_url: string; image_disk_path?: string }>;
		for (const row of rows) {
			const nameLower = row.name.toLowerCase();
			const isCelebrityMismatch = FALSE_POSITIVE_DEEZER_HASHES.some((h) => row.image_url.includes(h)) &&
				!['george gershwin', 'bo diddley', 'oster lapwass', "emine'm"].includes(nameLower);
			if (isCelebrityMismatch) {
				deleteArtistAvatar(row.name);
			}
		}

		// Check cached disk files for Gershwin portrait hash
		const baseDir = process.env.DATA_DIR || './data';
		const artistsDir = path.resolve(baseDir, 'artists');
		if (fs.existsSync(artistsDir)) {
			const files = fs.readdirSync(artistsDir);
			for (const file of files) {
				if (!file.endsWith('.jpg')) continue;
				const full = path.join(artistsDir, file);
				try {
					const buf = fs.readFileSync(full);
					const fileMd5 = crypto.createHash('md5').update(buf).digest('hex');
					if (fileMd5 === GERSHWIN_MD5) {
						const artToken = file.replace(/\.jpg$/, '');
						const artistName = decodeArtistId(artToken);
						if (artistName.toLowerCase() !== 'george gershwin') {
							deleteArtistAvatar(artistName);
						}
					}
				} catch {}
			}
		}
	} catch (err) {
		console.warn('[Artist Engine] Failed to purge invalid artist cache:', err);
	}
}

// Auto-purge invalid generic artist images on module initialization
try {
	purgeInvalidArtistCache();
} catch {}

/**
 * Fetches high-resolution official studio artist portrait from Deezer (1000x1000 square)
 */
export async function fetchDeezerArtistImage(artistName: string): Promise<string | null> {
	if (isGenericArtist(artistName)) {
		return null;
	}

	try {
		const ctrl = new AbortController();
		const timeout = setTimeout(() => ctrl.abort(), 5000);
		try {
			let targetName = artistName;
			let res = await fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(targetName)}`, {
				signal: ctrl.signal,
				headers: { 'User-Agent': 'TraxVault/1.7.30' }
			});
			if (!res.ok) return null;
			let data = await res.json();
			let list = data.data || [];

			// If no results and name has collaboration delimiters (feat, ft, &, with, ,)
			if (list.length === 0 && (artistName.includes('feat.') || artistName.includes('ft.') || artistName.includes('&') || artistName.includes(',') || artistName.toLowerCase().includes(' with '))) {
				const primary = artistName.split(/ feat\.? | ft\.? | & |, | with /i)[0].trim();
				if (primary && primary.toLowerCase() !== artistName.toLowerCase() && !isGenericArtist(primary)) {
					targetName = primary;
					res = await fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(primary)}`, {
						signal: ctrl.signal,
						headers: { 'User-Agent': 'TraxVault/1.7.30' }
					});
					if (res.ok) {
						data = await res.json();
						list = data.data || [];
					}
				}
			}

			if (list.length === 0) return null;

			// Strict matching: Exact case-insensitive match or normalized match (strips punctuation/accents)
			const targetNorm = normalizeArtistName(targetName);
			const originalNorm = normalizeArtistName(artistName);

			const exactMatches = list.filter((a: any) => {
				const aName = (a.name || '').trim().toLowerCase();
				if (aName === targetName.toLowerCase() || aName === artistName.toLowerCase()) {
					return true;
				}
				const aNorm = normalizeArtistName(a.name || '');
				return aNorm === targetNorm || aNorm === originalNorm;
			});

			// If no exact or normalized match, RETURN NULL! (NEVER pick a random celebrity with the most fans)
			if (exactMatches.length === 0) {
				return null;
			}

			// If multiple exact matches, sort candidates by fan count
			const best = exactMatches.sort((a: any, b: any) => (b.nb_fan || 0) - (a.nb_fan || 0))[0];

			if (best) {
				return best.picture_xl || best.picture_big || best.picture_medium || null;
			}
		} finally {
			clearTimeout(timeout);
		}
	} catch (err) {
		console.warn(`[Artist Engine] Deezer lookup failed for "${artistName}":`, err);
	}
	return null;
}

export interface ArtistInfoResult {
	id: string;
	name: string;
	biography: string;
	musicBrainzId: string;
	lastFmUrl: string;
	smallImageUrl: string;
	mediumImageUrl: string;
	largeImageUrl: string;
	similarArtists: SimilarArtist[];
}

/**
 * Master function resolving rich artist data: checks SQLite cache, local files, MusicBrainz,
 * Wikidata/Wikimedia Commons, Wikipedia, and Deezer fallback.
 */
export async function getOrFetchArtistInfo(
	artistName: string,
	options: { count?: number; includeNotPresent?: boolean; forceRefresh?: boolean } = {}
): Promise<ArtistInfoResult> {
	const count = options.count ?? 20;
	const includeNotPresent = options.includeNotPresent ?? true;
	const forceRefresh = options.forceRefresh ?? false;
	const artistToken = encodeArtistId(artistName);

	// If generic compilation artist, clear any previously saved wrong human image and return
	if (isGenericArtist(artistName)) {
		deleteArtistAvatar(artistName);
		return {
			id: artistToken,
			name: artistName,
			biography: `${artistName} compilation in your music vault.`,
			musicBrainzId: '',
			lastFmUrl: `https://www.last.fm/music/${encodeURIComponent(artistName)}`,
			smallImageUrl: `/rest/getCoverArt.view?id=art-${artistToken}`,
			mediumImageUrl: `/rest/getCoverArt.view?id=art-${artistToken}`,
			largeImageUrl: `/rest/getCoverArt.view?id=art-${artistToken}`,
			similarArtists: []
		};
	}

	if (forceRefresh) {
		const baseDir = process.env.DATA_DIR || './data';
		const oldDisk = path.resolve(baseDir, 'artists', `${artistToken}.jpg`);
		if (fs.existsSync(oldDisk)) {
			try {
				fs.unlinkSync(oldDisk);
			} catch {}
		}
	}

	// 1. Check existing SQLite cache (skip if forceRefresh or if image is old low-quality wiki image)
	const cached = getArtistMetadata(artistName);
	const now = Date.now();
	const isFresh = cached && (now - new Date(cached.updated_at).getTime() < 30 * 24 * 60 * 60 * 1000);

	// Detect if cached image was from low-quality Wikimedia / Wikipedia source or known false positive
	const isFalseCelebrityImage = Boolean(
		cached?.image_url &&
		FALSE_POSITIVE_DEEZER_HASHES.some((h) => cached.image_url!.includes(h)) &&
		!['george gershwin', 'bo diddley', 'oster lapwass', "emine'm"].includes(cached.name.toLowerCase())
	);
	const hasLowQualityWikiImage = Boolean(
		cached?.image_url && (
			cached.image_url.includes('upload.wikimedia.org') ||
			cached.image_url.includes('wikipedia.org') ||
			cached.image_url.includes('wikimedia') ||
			isFalseCelebrityImage
		)
	);

	if (!forceRefresh && cached && isFresh && cached.biography && !hasLowQualityWikiImage && (cached.image_disk_path || cached.image_url)) {
		let similar: SimilarArtist[] = [];
		if (cached.similar_artists) {
			try {
				similar = JSON.parse(cached.similar_artists);
			} catch {}
		}
		if (!includeNotPresent) {
			similar = similar.filter((s) => Boolean(s.id));
		}
		similar = similar.slice(0, count);

		const imgRef = `/rest/getCoverArt.view?id=art-${artistToken}`;
		return {
			id: artistToken,
			name: cached.name,
			biography: cached.biography,
			musicBrainzId: cached.musicbrainz_id || '',
			lastFmUrl: cached.lastfm_url || `https://www.last.fm/music/${encodeURIComponent(cached.name)}`,
			smallImageUrl: imgRef,
			mediumImageUrl: imgRef,
			largeImageUrl: imgRef,
			similarArtists: similar
		};
	}

	// 2. Discover local companion image if present in music library (user's personal files)
	const localUserDiskPath = findLocalArtistImage(artistName);
	let localDiskPath: string | undefined = localUserDiskPath || undefined;

	// 3. Official high-resolution studio portrait from Deezer (1000x1000 square)
	let imageUrl = '';
	if (!localDiskPath) {
		const deezerImg = await fetchDeezerArtistImage(artistName);
		if (deezerImg) {
			imageUrl = deezerImg;
		}
	}

	// 4. Query MusicBrainz for MBID and relations
	let mbid = cached?.musicbrainz_id || '';
	let disambiguation = cached?.disambiguation || '';
	let lastFmUrl = cached?.lastfm_url || `https://www.last.fm/music/${encodeURIComponent(artistName)}`;
	let biography = cached?.biography || '';
	const mbArtistRelations: Array<{ type: string; name: string; mbid?: string }> = [];

	try {
		let detail = null;
		if (mbid) {
			detail = await getMusicBrainzArtistDetail(mbid);
		} else {
			const search = await searchMusicBrainzArtist(artistName);
			if (search) {
				mbid = search.id;
				disambiguation = search.disambiguation || '';
				detail = await getMusicBrainzArtistDetail(search.id);
			}
		}

		if (detail) {
			if (detail.disambiguation) disambiguation = detail.disambiguation;
			if (detail.lastfmUrl) lastFmUrl = detail.lastfmUrl;
			if (detail.artistRelations) mbArtistRelations.push(...detail.artistRelations);

			// Resolve Wikipedia biography and fallback image
			const wikiRes = await resolveWikimediaAndWikipedia(
				artistName,
				detail.wikidataId,
				detail.wikipediaUrl,
				detail.imageUrl
			);

			if (wikiRes.biography) {
				biography = wikiRes.biography;
			}
			// Only fall back to Wikimedia / Wikipedia image if Deezer did not provide an image
			if (!imageUrl && wikiRes.imageUrl) {
				imageUrl = wikiRes.imageUrl;
			}
		}
	} catch (err) {
		console.warn(`[Artist Engine] MusicBrainz lookup failed for "${artistName}":`, err);
	}

	// 5. Default biography fallback if Wikipedia was unavailable
	if (!biography) {
		biography = disambiguation
			? `${artistName} (${disambiguation}).`
			: `${artistName} is an artist in your music library.`;
	}

	// 6. Build Similar Artists list
	// A: Start with artists in library sharing the same genre
	const librarySimilar = findSimilarArtistsInLibrary(artistName, count);
	const similarMap = new Map<string, SimilarArtist>();

	for (const libArt of librarySimilar) {
		const token = encodeArtistId(libArt.name);
		similarMap.set(libArt.name.toLowerCase(), {
			id: token,
			name: libArt.name,
			albumCount: libArt.album_count,
			coverArt: token,
			artistImageUrl: `/rest/getCoverArt.view?id=art-${token}`
		});
	}

	// B: Merge with MusicBrainz artist relations (band members, spinoffs, related)
	for (const rel of mbArtistRelations) {
		const key = rel.name.toLowerCase();
		if (key === artistName.toLowerCase()) continue;

		if (similarMap.has(key)) {
			const existing = similarMap.get(key)!;
			existing.role = rel.type;
			if (rel.mbid) existing.musicbrainz_id = rel.mbid;
		} else {
			// Check if artist is in user library
			const libCheck = db.prepare('SELECT COUNT(id) as c FROM albums WHERE artist = ?').get(rel.name) as { c: number } | undefined;
			if (libCheck && libCheck.c > 0) {
				const token = encodeArtistId(rel.name);
				similarMap.set(key, {
					id: token,
					name: rel.name,
					albumCount: libCheck.c,
					coverArt: token,
					artistImageUrl: `/rest/getCoverArt.view?id=art-${token}`,
					musicbrainz_id: rel.mbid,
					role: rel.type
				});
			} else {
				similarMap.set(key, {
					name: rel.name,
					musicbrainz_id: rel.mbid,
					role: rel.type
				});
			}
		}
	}

	const allSimilar = Array.from(similarMap.values());
	let finalSimilar = allSimilar;
	if (!includeNotPresent) {
		finalSimilar = finalSimilar.filter((s) => Boolean(s.id));
	}
	finalSimilar = finalSimilar.slice(0, count);

	// 7. Persist to SQLite (persists complete similar artists list)
	upsertArtistMetadata({
		id: artistToken,
		name: artistName,
		musicbrainz_id: mbid || null,
		disambiguation: disambiguation || null,
		biography,
		image_url: imageUrl || null,
		image_disk_path: localDiskPath || null,
		lastfm_url: lastFmUrl || null,
		similar_artists: JSON.stringify(allSimilar)
	});

	// Cache high-resolution image to disk
	if (imageUrl && !localDiskPath) {
		const shouldOverwrite = forceRefresh || hasLowQualityWikiImage;
		try {
			const diskPath = await cacheArtistImageToDisk(artistToken, imageUrl, shouldOverwrite);
			if (diskPath) {
				localDiskPath = diskPath;
				upsertArtistMetadata({ name: artistName, image_disk_path: diskPath });
			}
		} catch (err) {
			console.warn(`[Artist Engine] Failed caching image for "${artistName}":`, err);
		}
	}

	const imgRef = `/rest/getCoverArt.view?id=art-${artistToken}`;
	return {
		id: artistToken,
		name: artistName,
		biography,
		musicBrainzId: mbid,
		lastFmUrl,
		smallImageUrl: imgRef,
		mediumImageUrl: imgRef,
		largeImageUrl: imgRef,
		similarArtists: finalSimilar
	};
}

export interface EnrichmentStatus {
	running: boolean;
	current: number;
	total: number;
	currentArtist: string;
	successCount: number;
	errorCount: number;
	startedAt: number | null;
	completedAt: number | null;
}

let enrichmentStatus: EnrichmentStatus = {
	running: false,
	current: 0,
	total: 0,
	currentArtist: '',
	successCount: 0,
	errorCount: 0,
	startedAt: null,
	completedAt: null
};

let abortController: AbortController | null = null;

export function getEnrichmentStatus(): EnrichmentStatus {
	return { ...enrichmentStatus };
}

export function cancelBulkArtistEnrichment(): void {
	if (abortController) {
		abortController.abort();
	}
	enrichmentStatus.running = false;
	enrichmentStatus.completedAt = Date.now();
}

export function startBulkArtistEnrichment(options: { forceRefresh?: boolean; saveToFolder?: boolean } = {}): { started: boolean; total: number; message: string } {
	if (enrichmentStatus.running) {
		return { started: false, total: enrichmentStatus.total, message: 'Enrichment is already in progress' };
	}

	const rawArtists = getDistinctArtists();
	if (rawArtists.length === 0) {
		return { started: false, total: 0, message: 'No artists found in library' };
	}

	enrichmentStatus = {
		running: true,
		current: 0,
		total: rawArtists.length,
		currentArtist: '',
		successCount: 0,
		errorCount: 0,
		startedAt: Date.now(),
		completedAt: null
	};

	abortController = new AbortController();
	const signal = abortController.signal;

	// Run in background without blocking response
	(async () => {
		for (let i = 0; i < rawArtists.length; i++) {
			if (signal.aborted) break;
			const art = rawArtists[i];
			enrichmentStatus.current = i + 1;
			enrichmentStatus.currentArtist = art.name;

			try {
				await getOrFetchArtistInfo(art.name, {
					forceRefresh: options.forceRefresh ?? false
				});

				if (options.saveToFolder) {
					await saveArtistCompanionImageToFolder(art.name);
				}

				enrichmentStatus.successCount++;
			} catch (err) {
				console.warn(`[Bulk Enrichment] Failed to enrich "${art.name}":`, err);
				enrichmentStatus.errorCount++;
			}

			// Polite throttle between artists
			if (i < rawArtists.length - 1 && !signal.aborted) {
				await new Promise((r) => setTimeout(r, 800));
			}
		}

		enrichmentStatus.running = false;
		enrichmentStatus.completedAt = Date.now();
	})().catch((err) => {
		console.error('[Bulk Enrichment] Unexpected runner error:', err);
		enrichmentStatus.running = false;
		enrichmentStatus.completedAt = Date.now();
	});

	return { started: true, total: rawArtists.length, message: `Started enrichment for ${rawArtists.length} artists` };
}
