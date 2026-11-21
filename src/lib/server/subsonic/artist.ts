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
	return 'art_' + Buffer.from(name.trim(), 'utf8').toString('hex');
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

export const FALSE_POSITIVE_DEEZER_HASHES = [
	'24b4805a1a47079669dfbe5c24920c4b', // George Gershwin (Various Artists)
	'519b6a5550a4e36a87190a7953ef3df0', // Bo Diddley (Soundtrack)
	'baa7f926e6d71d3a93359c23ed7ea20e', // Oster Lapwass (OST)
	'd2adeaa31a7a426802ea1786873db7b3', // Null
	'82de28805504050f244dfe955d5cbb79', // Anton Rubinstein
	'7fa738468c9a73ff98c1e1b78d622b81', // Emine'm
	'270c1514a25caf5757afdaa5be3b003d', // Dax (false match on "Eminem, Dr. Dre")
	'd41d8cd98f00b204e9800998ecf8427e'  // Deezer blank placeholder MD5
];

const BLOCKED_IMAGE_MD5S: Record<string, string> = {
	'cf0b6a5247e606f67470140451774cb5': '__placeholder__', // Deezer grey silhouette placeholder
	'e2d71ec4224ce1aeea889d03cf934c37': 'georgegershwin',
	'da68cee1d65dc28cf77469b9098e340c': 'dax',
	'0a2c7857c2baf3f209c3f7868b213a23': 'bodiddley'
};

/**
 * Validates that an image buffer is a real, non-placeholder JPEG/PNG/WebP image
 * and does not match known false-positive celebrity checksums.
 */
export function isValidImageBuffer(buf: Buffer | null | undefined, artistName?: string): boolean {
	if (!buf || buf.length < 2000) return false;

	// Magic byte verification: JPEG (FF D8), PNG (89 50 4E 47), WebP (RIFF....WEBP)
	const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
	const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
	const isWebp =
		buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
		buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;

	if (!isJpeg && !isPng && !isWebp) return false;

	const md5 = crypto.createHash('md5').update(buf).digest('hex');
	const allowedOwner = BLOCKED_IMAGE_MD5S[md5];
	if (allowedOwner) {
		if (allowedOwner === '__placeholder__') return false;
		const normArtist = normalizeArtistName(artistName || '');
		if (normArtist !== allowedOwner) return false;
	}

	return true;
}

/**
 * Resolves the primary dedicated root artist folder in the music library.
 * A folder is ONLY returned if its directory name matches the artist name
 * (prevents shared folders like /music/Albums or album folders from being treated as artist folders).
 */
export function findLocalArtistFolder(artistName: string): string | null {
	if (isGenericArtist(artistName)) return null;
	const targetNorm = normalizeArtistName(artistName);
	if (!targetNorm) return null;

	try {
		const albums = getAlbumsByArtist(artistName);
		const musicDir = path.resolve(getMusicDirectory());
		for (const alb of albums) {
			const track = db.prepare('SELECT file_path FROM tracks WHERE album_id = ? AND file_path IS NOT NULL LIMIT 1').get(alb.id) as { file_path?: string } | undefined;
			if (!track?.file_path) continue;

			const resolved = resolveTrackFilePath(track);
			if (!resolved) continue;

			// Walk ancestor directories from track's folder up to musicDir
			let currentDir = path.resolve(path.dirname(resolved));
			let depth = 0;
			while (currentDir !== musicDir && isPathWithin(currentDir, musicDir) && depth < 5) {
				const baseName = path.basename(currentDir);
				if (normalizeArtistName(baseName) === targetNorm && fs.existsSync(currentDir)) {
					return currentDir;
				}
				const parentDir = path.resolve(path.dirname(currentDir));
				if (parentDir === currentDir) break;
				currentDir = parentDir;
				depth++;
			}
		}
	} catch (err) {
		console.warn(`[Artist Engine] Error finding local artist folder for "${artistName}":`, err);
	}
	return null;
}

/**
 * Scans a verified dedicated artist directory to discover local artist artwork
 */
export function findLocalArtistImage(artistName: string): string | null {
	if (isGenericArtist(artistName)) return null;
	try {
		const artistFolder = findLocalArtistFolder(artistName);
		if (!artistFolder || !fs.existsSync(artistFolder)) return null;

		for (const imgName of ARTIST_IMAGE_NAMES) {
			const candidate = path.join(artistFolder, imgName);
			if (fs.existsSync(candidate)) {
				try {
					const buf = fs.readFileSync(candidate);
					if (isValidImageBuffer(buf, artistName)) {
						return candidate;
					} else {
						// Unlink corrupted/placeholder companion image
						try {
							fs.unlinkSync(candidate);
						} catch {}
					}
				} catch {}
			}
		}
	} catch (err) {
		console.warn(`[Artist Engine] Error scanning local artist image for "${artistName}":`, err);
	}
	return null;
}

/**
 * Saves artist image as companion artist.jpg directly into the artist's dedicated library folder on disk
 */
export async function saveArtistCompanionImageToFolder(
	artistName: string,
	options: { buffer?: Buffer; imageUrl?: string } = {}
): Promise<{ success: boolean; path?: string; error?: string }> {
	const folder = findLocalArtistFolder(artistName);
	if (!folder) {
		return {
			success: false,
			error: `No dedicated folder named "${artistName}" was found in your music library (albums appear to be in a flat or shared directory).`
		};
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
		const token = encodeArtistId(artistName);
		const baseDir = process.env.DATA_DIR || './data';
		const cachedFile = path.resolve(baseDir, 'artists', `${token}.jpg`);
		if (fs.existsSync(cachedFile)) {
			buf = fs.readFileSync(cachedFile);
		} else {
			const resolvedPath = await resolveAndCacheArtistAvatar(artistName);
			if (resolvedPath && fs.existsSync(resolvedPath)) {
				buf = fs.readFileSync(resolvedPath);
			}
		}
	}

	if (!buf || !isValidImageBuffer(buf, artistName)) {
		return { success: false, error: 'No valid artist portrait data available to save' };
	}

	const targetPath = path.join(folder, 'artist.jpg');
	const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
	try {
		fs.writeFileSync(tmpPath, buf);
		fs.renameSync(tmpPath, targetPath);
	} finally {
		if (fs.existsSync(tmpPath)) {
			try {
				fs.unlinkSync(tmpPath);
			} catch {}
		}
	}

	upsertArtistMetadata({ name: artistName, image_disk_path: targetPath });

	return { success: true, path: targetPath };
}

/**
 * Downloads, validates, and atomically caches an artist image to the local cache directory
 */
export async function cacheArtistImageToDisk(
	artistToken: string,
	imageUrl: string,
	overwrite: boolean = false,
	artistName?: string
): Promise<string | null> {
	if (!imageUrl || imageUrl.includes('/images/artist//') || imageUrl.includes('d41d8cd98f00b204e9800998ecf8427e')) {
		return null;
	}

	try {
		const baseDir = process.env.DATA_DIR || './data';
		const artistsDir = path.resolve(baseDir, 'artists');
		if (!fs.existsSync(artistsDir)) {
			fs.mkdirSync(artistsDir, { recursive: true });
		}

		const resolvedArtistName = artistName || decodeArtistId(artistToken);
		const targetPath = path.resolve(artistsDir, `${artistToken}.jpg`);

		if (!overwrite && fs.existsSync(targetPath)) {
			try {
				const existingBuf = fs.readFileSync(targetPath);
				if (isValidImageBuffer(existingBuf, resolvedArtistName)) {
					return targetPath;
				}
			} catch {}
		}

		const ctrl = new AbortController();
		const timeout = setTimeout(() => ctrl.abort(), 8000);
		try {
			const res = await fetch(imageUrl, {
				signal: ctrl.signal,
				headers: { 'User-Agent': 'TraxVault/1.7.32' }
			});
			if (!res.ok) return null;
			const buf = Buffer.from(await res.arrayBuffer());
			if (!isValidImageBuffer(buf, resolvedArtistName)) {
				return null;
			}

			const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
			try {
				fs.writeFileSync(tmpPath, buf);
				fs.renameSync(tmpPath, targetPath);
			} finally {
				if (fs.existsSync(tmpPath)) {
					try {
						fs.unlinkSync(tmpPath);
					} catch {}
				}
			}

			// If a dedicated artist folder on disk already had a companion artist.jpg, keep it synchronized
			try {
				const dedicatedFolder = findLocalArtistFolder(resolvedArtistName);
				if (dedicatedFolder) {
					const companionPath = path.join(dedicatedFolder, 'artist.jpg');
					if (fs.existsSync(companionPath)) {
						fs.accessSync(dedicatedFolder, fs.constants.W_OK);
						const compTmp = `${companionPath}.tmp.${process.pid}.${Date.now()}`;
						fs.writeFileSync(compTmp, buf);
						fs.renameSync(compTmp, companionPath);
					}
				}
			} catch {}

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
 * Deletes cached artist avatar from disk (and any companion artist.jpg) and clears database image pointers
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

		// Also remove legacy lowercase-hex token file if different
		const lowerToken = 'art_' + Buffer.from(artistName.trim().toLowerCase(), 'utf8').toString('hex');
		if (lowerToken !== token) {
			const lowerDiskPath = path.resolve(baseDir, 'artists', `${lowerToken}.jpg`);
			if (fs.existsSync(lowerDiskPath)) {
				try {
					fs.unlinkSync(lowerDiskPath);
				} catch {}
			}
		}

		// Check metadata for any recorded image_disk_path
		const meta = getArtistMetadata(artistName);
		if (meta?.image_disk_path && fs.existsSync(meta.image_disk_path)) {
			const baseName = path.basename(meta.image_disk_path).toLowerCase();
			if (ARTIST_IMAGE_NAMES.includes(baseName) || meta.image_disk_path.includes( path.join('data', 'artists') )) {
				try {
					fs.unlinkSync(meta.image_disk_path);
				} catch {}
			}
		}

		// Also remove companion artist.jpg from dedicated artist folder if present
		const folder = findLocalArtistFolder(artistName);
		if (folder && fs.existsSync(folder)) {
			for (const imgName of ARTIST_IMAGE_NAMES) {
				const candidate = path.join(folder, imgName);
				if (fs.existsSync(candidate)) {
					try {
						fs.unlinkSync(candidate);
					} catch {}
				}
			}
		}

		db.prepare(`
			UPDATE artist_metadata
			SET image_url = NULL, image_disk_path = NULL, updated_at = CURRENT_TIMESTAMP
			WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
		`).run(artistName);

		return true;
	} catch (err) {
		console.warn(`[Artist Engine] Failed to delete artist avatar for "${artistName}":`, err);
		return false;
	}
}

const ARTIST_AVATAR_CACHE_VERSION = '2';

/**
 * Purges corrupted/mismatched artist images and runs a one-time v2 clean migration
 * to wipe any poisoned portraits cached by pre-v1.7.32 versions.
 */
export function purgeInvalidArtistCache(): void {
	try {
		const baseDir = process.env.DATA_DIR || './data';
		const artistsDir = path.resolve(baseDir, 'artists');
		const musicDir = path.resolve(getMusicDirectory());

		// Check if v2 clean avatar cache migration has run
		const versionRow = db.prepare("SELECT value FROM system_metadata WHERE key = 'artist_avatar_cache_version'").get() as { value: string } | undefined;
		if (!versionRow || versionRow.value !== ARTIST_AVATAR_CACHE_VERSION) {
			console.log('[Artist Engine] Running v2 artist avatar cache migration — purging legacy cached portraits...');

			// 1. Delete all cached files in data/artists/
			if (fs.existsSync(artistsDir)) {
				for (const file of fs.readdirSync(artistsDir)) {
					if (file.endsWith('.jpg') || file.includes('.tmp.')) {
						try {
							fs.unlinkSync(path.join(artistsDir, file));
						} catch {}
					}
				}
			}

			// 2. Clean any poisoned artist.jpg files written to music folders by v1.7.29
			const oldRows = db.prepare('SELECT name, image_disk_path FROM artist_metadata WHERE image_disk_path IS NOT NULL').all() as Array<{ name: string; image_disk_path: string }>;
			for (const row of oldRows) {
				if (row.image_disk_path && fs.existsSync(row.image_disk_path) && isPathWithin(row.image_disk_path, musicDir)) {
					const base = path.basename(row.image_disk_path).toLowerCase();
					if (base === 'artist.jpg') {
						try {
							fs.unlinkSync(row.image_disk_path);
						} catch {}
					}
				}
			}

			// 3. Also check root musicDir and immediate subdirectories for stray shared/invalid artist.jpg files
			if (fs.existsSync(musicDir)) {
				const rootArtistJpg = path.join(musicDir, 'artist.jpg');
				if (fs.existsSync(rootArtistJpg)) {
					try {
						fs.unlinkSync(rootArtistJpg);
					} catch {}
				}

				const validArtistNorms = new Set(
					getDistinctArtists()
						.filter((a) => !isGenericArtist(a.name))
						.map((a) => normalizeArtistName(a.name))
						.filter(Boolean)
				);

				try {
					const entries = fs.readdirSync(musicDir, { withFileTypes: true });
					for (const entry of entries) {
						if (!entry.isDirectory()) continue;
						const subDir = path.join(musicDir, entry.name);
						const subArtistJpg = path.join(subDir, 'artist.jpg');
						if (fs.existsSync(subArtistJpg)) {
							const dirNorm = normalizeArtistName(entry.name);
							let shouldDelete = !validArtistNorms.has(dirNorm);
							if (!shouldDelete) {
								try {
									const buf = fs.readFileSync(subArtistJpg);
									if (!isValidImageBuffer(buf, entry.name)) {
										shouldDelete = true;
									}
								} catch {}
							}
							if (shouldDelete) {
								try {
									fs.unlinkSync(subArtistJpg);
								} catch {}
							}
						}
					}
				} catch {}
			}

			// 4. Reset image pointers in artist_metadata so all artists cleanly fetch verified studio portraits
			db.prepare('UPDATE artist_metadata SET image_url = NULL, image_disk_path = NULL').run();

			// 5. Stamp migration version
			db.prepare("INSERT OR REPLACE INTO system_metadata (key, value) VALUES ('artist_avatar_cache_version', ?)").run(ARTIST_AVATAR_CACHE_VERSION);
			console.log('[Artist Engine] v2 artist avatar cache migration complete.');
		}

		// Standard boot checks: purge generic artists and any known false-positive URLs or invalid buffers
		for (const generic of GENERIC_ARTIST_NAMES) {
			deleteArtistAvatar(generic);
		}

		const rows = db.prepare('SELECT name, image_url, image_disk_path FROM artist_metadata WHERE image_url IS NOT NULL OR image_disk_path IS NOT NULL').all() as Array<{
			name: string;
			image_url?: string | null;
			image_disk_path?: string | null;
		}>;

		for (const row of rows) {
			if (isGenericArtist(row.name)) {
				deleteArtistAvatar(row.name);
				continue;
			}
			const nameNorm = normalizeArtistName(row.name);
			if (row.image_url) {
				const hasBadUrl =
					row.image_url.includes('/images/artist//') ||
					row.image_url.includes('wikimedia') ||
					row.image_url.includes('wikipedia.org') ||
					(FALSE_POSITIVE_DEEZER_HASHES.some((h) => row.image_url!.includes(h)) &&
						!['georgegershwin', 'bodiddley', 'osterlapwass', 'eminem', 'dax'].includes(nameNorm));
				if (hasBadUrl) {
					deleteArtistAvatar(row.name);
					continue;
				}
			}
			if (row.image_disk_path) {
				if (path.basename(row.image_disk_path).toLowerCase() === 'folder.jpg' || !fs.existsSync(row.image_disk_path)) {
					db.prepare('UPDATE artist_metadata SET image_disk_path = NULL WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))').run(row.name);
				}
			}
		}

		if (fs.existsSync(artistsDir)) {
			for (const file of fs.readdirSync(artistsDir)) {
				if (!file.endsWith('.jpg')) continue;
				const full = path.join(artistsDir, file);
				try {
					const buf = fs.readFileSync(full);
					const artToken = file.replace(/\.jpg$/, '');
					const artistName = decodeArtistId(artToken);
					if (isGenericArtist(artistName) || !isValidImageBuffer(buf, artistName)) {
						deleteArtistAvatar(artistName);
					}
				} catch {}
			}
		}
	} catch (err) {
		console.warn('[Artist Engine] Failed to purge invalid artist cache:', err);
	}
}

// Serialized rate-limiting queue for Deezer API to prevent QuotaException (code 4: 50 req / 5s)
let deezerQueue: Promise<any> = Promise.resolve();
let lastDeezerReqTime = 0;
const DEEZER_MIN_INTERVAL_MS = 110;

async function deezerFetchJson(url: string, retries = 3): Promise<any | null> {
	return new Promise((resolve) => {
		deezerQueue = deezerQueue.then(async () => {
			const now = Date.now();
			const elapsed = now - lastDeezerReqTime;
			if (elapsed < DEEZER_MIN_INTERVAL_MS) {
				await new Promise((r) => setTimeout(r, DEEZER_MIN_INTERVAL_MS - elapsed));
			}

			for (let attempt = 0; attempt <= retries; attempt++) {
				const ctrl = new AbortController();
				const timer = setTimeout(() => ctrl.abort(), 6000);
				try {
					const res = await fetch(url, {
						signal: ctrl.signal,
						headers: {
							'User-Agent': 'TraxVault/1.7.32',
							Accept: 'application/json'
						}
					});
					lastDeezerReqTime = Date.now();
					if (res.status === 429 || res.status === 503) {
						if (attempt < retries) {
							await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
							continue;
						}
						resolve(null);
						return;
					}
					if (!res.ok) {
						resolve(null);
						return;
					}
					const data = await res.json();
					// Deezer returns HTTP 200 with { error: { type: 'QuotaException', code: 4 } } on rate limit
					if (data?.error) {
						if (data.error.code === 4 && attempt < retries) {
							await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
							continue;
						}
						resolve(null);
						return;
					}
					resolve(data);
					return;
				} catch {
					lastDeezerReqTime = Date.now();
					if (attempt < retries) {
						await new Promise((r) => setTimeout(r, 1000));
						continue;
					}
					resolve(null);
					return;
				} finally {
					clearTimeout(timer);
				}
			}
			resolve(null);
		});
	});
}

function getValidDeezerPicture(a: any): string | null {
	const url = a?.picture_xl || a?.picture_big || a?.picture_medium || '';
	if (!url || typeof url !== 'string') return null;
	if (url.includes('/images/artist//')) return null;
	if (url.includes('d41d8cd98f00b204e9800998ecf8427e')) return null;
	return url;
}

function findBestDeezerMatch(list: any[], queryName: string): string | null {
	if (!Array.isArray(list) || list.length === 0) return null;
	const valid = list.filter((a) => getValidDeezerPicture(a) !== null);
	if (valid.length === 0) return null;

	const qLower = queryName.trim().toLowerCase();
	const qNorm = normalizeArtistName(queryName);
	if (!qNorm) return null;
	const qNormNoThe = qNorm.replace(/^the/, '');

	// Tier 1: Exact case-insensitive string match
	const tier1 = valid
		.filter((a) => (a.name || '').trim().toLowerCase() === qLower)
		.sort((a, b) => (b.nb_fan || 0) - (a.nb_fan || 0));

	// Tier 2: Normalized alphanumeric match (handles JAY-Z vs JAY Z, A$AP Rocky vs ASAP Rocky, P!nk vs Pink, Guns N' Roses, accents, optional "The ")
	const tier2 = valid
		.filter((a) => {
			const aNorm = normalizeArtistName(a.name || '');
			if (!aNorm) return false;
			if (aNorm === qNorm) return true;
			const aNormNoThe = aNorm.replace(/^the/, '');
			return qNormNoThe.length >= 4 && aNormNoThe === qNormNoThe;
		})
		.sort((a, b) => (b.nb_fan || 0) - (a.nb_fan || 0));

	let chosen: any = null;
	if (tier1.length > 0 && tier2.length > 0) {
		const top1 = tier1[0];
		const top2 = tier2[0];
		// If Tier 2 match has >10x fans and >50,000 fans (e.g. "Pink" 15k fans vs "P!nk" 4.6M fans), prefer the major official profile
		if ((top2.nb_fan || 0) > (top1.nb_fan || 0) * 10 && (top2.nb_fan || 0) > 50000) {
			chosen = top2;
		} else {
			chosen = top1;
		}
	} else if (tier1.length > 0) {
		chosen = tier1[0];
	} else if (tier2.length > 0) {
		chosen = tier2[0];
	}

	return chosen ? getValidDeezerPicture(chosen) : null;
}

const COLLAB_DELIMITER_REGEX =
	/\s+(?:feat\.?|ft\.?|featuring|with|vs\.?|x)\s+|\s*[&,;/]\s*|\s*[\(\[\{](?:feat\.?|ft\.?|featuring)\s+[^)\]\}]+[\)\]\}]?/i;

export function extractPrimaryArtistName(artistName: string): string | null {
	if (!COLLAB_DELIMITER_REGEX.test(artistName)) return null;
	const primary = artistName.split(COLLAB_DELIMITER_REGEX)[0]?.trim();
	if (!primary || primary.toLowerCase() === artistName.trim().toLowerCase() || isGenericArtist(primary)) {
		return null;
	}
	return primary;
}

/**
 * Fetches high-resolution official studio artist portrait from Deezer (1000x1000 square)
 */
export async function fetchDeezerArtistImage(artistName: string): Promise<string | null> {
	if (isGenericArtist(artistName)) {
		return null;
	}

	try {
		// 1. Search full artist name first (preserves bands like "Tyler, The Creator", "Earth, Wind & Fire", "AC/DC")
		const data = await deezerFetchJson(`https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName.trim())}`);
		const directMatch = findBestDeezerMatch(data?.data || [], artistName);
		if (directMatch) {
			return directMatch;
		}

		// 2. If no direct match with a valid photo, and name is a collaboration (e.g. "Eminem, Dr. Dre", "Eminem feat. Rihanna"), search primary artist
		const primary = extractPrimaryArtistName(artistName);
		if (primary) {
			const primaryData = await deezerFetchJson(`https://api.deezer.com/search/artist?q=${encodeURIComponent(primary)}`);
			const primaryMatch = findBestDeezerMatch(primaryData?.data || [], primary);
			if (primaryMatch) {
				return primaryMatch;
			}
		}
	} catch (err) {
		console.warn(`[Artist Engine] Deezer lookup failed for "${artistName}":`, err);
	}
	return null;
}

/**
 * Secondary studio portrait & metadata fallback via TheAudioDB public API
 */
export async function fetchAudioDbArtistData(artistName: string): Promise<{
	imageUrl?: string;
	biography?: string;
	mbid?: string;
} | null> {
	if (isGenericArtist(artistName)) return null;

	const tryLookup = async (queryName: string) => {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), 5000);
		try {
			const res = await fetch(`https://www.theaudiodb.com/api/v1/json/123/search.php?s=${encodeURIComponent(queryName.trim())}`, {
				signal: ctrl.signal,
				headers: { 'User-Agent': 'TraxVault/1.7.32', Accept: 'application/json' }
			});
			if (!res.ok) return null;
			const data = await res.json();
			const artists = data?.artists;
			if (!Array.isArray(artists) || artists.length === 0) return null;

			const qNorm = normalizeArtistName(queryName);
			const matched = artists.find((a: any) => normalizeArtistName(a.strArtist || '') === qNorm);
			if (!matched) return null;

			return {
				imageUrl: matched.strArtistThumb || undefined,
				biography: matched.strBiographyEN ? String(matched.strBiographyEN).trim() : undefined,
				mbid: matched.strMusicBrainzID || undefined
			};
		} catch {
			return null;
		} finally {
			clearTimeout(timer);
		}
	};

	const direct = await tryLookup(artistName);
	if (direct?.imageUrl) return direct;

	const primary = extractPrimaryArtistName(artistName);
	if (primary) {
		const primaryRes = await tryLookup(primary);
		if (primaryRes) return primaryRes;
	}

	return direct;
}

// In-flight deduplication map for fast avatar resolution
const inFlightAvatarFetches = new Map<string, Promise<string | null>>();

/**
 * Fast, dedicated artist avatar resolver (decoupled from slow MusicBrainz biography queue).
 * Resolves, validates, and caches a 1000x1000 studio portrait to disk and returns the local file path.
 */
export async function resolveAndCacheArtistAvatar(
	artistName: string,
	options: { forceRefresh?: boolean } = {}
): Promise<string | null> {
	const cleanName = (artistName || '').trim();
	if (!cleanName || isGenericArtist(cleanName)) {
		if (cleanName) deleteArtistAvatar(cleanName);
		return null;
	}

	const forceRefresh = options.forceRefresh ?? false;
	const artistToken = encodeArtistId(cleanName);
	const baseDir = process.env.DATA_DIR || './data';
	const diskCacheFile = path.resolve(baseDir, 'artists', `${artistToken}.jpg`);

	if (!forceRefresh) {
		// 1. Check cached studio portrait in data/artists/<token>.jpg
		if (fs.existsSync(diskCacheFile)) {
			try {
				const buf = fs.readFileSync(diskCacheFile);
				if (isValidImageBuffer(buf, cleanName)) {
					return diskCacheFile;
				}
			} catch {}
		}

		// 2. Check existing metadata image_disk_path
		const meta = getArtistMetadata(cleanName);
		if (meta?.image_disk_path && fs.existsSync(meta.image_disk_path)) {
			const baseName = path.basename(meta.image_disk_path).toLowerCase();
			if (baseName !== 'folder.jpg') {
				try {
					const buf = fs.readFileSync(meta.image_disk_path);
					if (isValidImageBuffer(buf, cleanName)) {
						return meta.image_disk_path;
					}
				} catch {}
			}
		}

		// 3. Check dedicated local artist folder companion image
		const localCompanion = findLocalArtistImage(cleanName);
		if (localCompanion) {
			upsertArtistMetadata({ id: artistToken, name: cleanName, image_disk_path: localCompanion });
			return localCompanion;
		}
	}

	const dedupeKey = `${cleanName.toLowerCase()}::${forceRefresh}`;
	if (inFlightAvatarFetches.has(dedupeKey)) {
		return inFlightAvatarFetches.get(dedupeKey)!;
	}

	const task = (async (): Promise<string | null> => {
		try {
			// Primary source: Deezer 1000x1000 studio portrait
			let imageUrl = await fetchDeezerArtistImage(cleanName);

			// Secondary source: TheAudioDB studio portrait
			if (!imageUrl) {
				const audioDb = await fetchAudioDbArtistData(cleanName);
				if (audioDb?.imageUrl) {
					imageUrl = audioDb.imageUrl;
				}
			}

			if (imageUrl) {
				const cachedPath = await cacheArtistImageToDisk(artistToken, imageUrl, true, cleanName);
				if (cachedPath && fs.existsSync(cachedPath)) {
					upsertArtistMetadata({
						id: artistToken,
						name: cleanName,
						image_url: imageUrl,
						image_disk_path: cachedPath
					});
					return cachedPath;
				}
			}

			// Fallback: dedicated local companion file if present
			const localCompanion = findLocalArtistImage(cleanName);
			if (localCompanion) {
				upsertArtistMetadata({ id: artistToken, name: cleanName, image_disk_path: localCompanion });
				return localCompanion;
			}

			return null;
		} finally {
			inFlightAvatarFetches.delete(dedupeKey);
		}
	})();

	inFlightAvatarFetches.set(dedupeKey, task);
	return task;
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
 * Master function resolving rich artist data: checks SQLite cache, resolves studio portrait
 * via Deezer / TheAudioDB, and fetches biography & relations via MusicBrainz / Wikipedia.
 */
export async function getOrFetchArtistInfo(
	artistName: string,
	options: { count?: number; includeNotPresent?: boolean; forceRefresh?: boolean } = {}
): Promise<ArtistInfoResult> {
	const count = options.count ?? 20;
	const includeNotPresent = options.includeNotPresent ?? true;
	const forceRefresh = options.forceRefresh ?? false;
	const artistToken = encodeArtistId(artistName);

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

	const cached = getArtistMetadata(artistName);
	const now = Date.now();
	const isFresh = cached && (now - new Date(cached.updated_at).getTime() < 30 * 24 * 60 * 60 * 1000);

	const nameNorm = normalizeArtistName(artistName);
	const isFalseCelebrityImage = Boolean(
		cached?.image_url &&
		(cached.image_url.includes('/images/artist//') ||
			(FALSE_POSITIVE_DEEZER_HASHES.some((h) => cached.image_url!.includes(h)) &&
				!['georgegershwin', 'bodiddley', 'osterlapwass', 'eminem', 'dax'].includes(nameNorm)))
	);
	const hasLowQualityWikiImage = Boolean(
		cached?.image_url && (
			cached.image_url.includes('upload.wikimedia.org') ||
			cached.image_url.includes('wikipedia.org') ||
			cached.image_url.includes('wikimedia') ||
			isFalseCelebrityImage
		)
	);

	const hasValidDiskImage = Boolean(
		cached?.image_disk_path &&
		fs.existsSync(cached.image_disk_path) &&
		path.basename(cached.image_disk_path).toLowerCase() !== 'folder.jpg'
	);

	if (!forceRefresh && cached && isFresh && cached.biography && !hasLowQualityWikiImage && hasValidDiskImage) {
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

	// 1. Resolve and cache official studio portrait (Deezer -> TheAudioDB -> verified local artist.jpg)
	const localDiskPath = await resolveAndCacheArtistAvatar(artistName, {
		forceRefresh: forceRefresh || hasLowQualityWikiImage
	});
	const updatedMetaAfterAvatar = getArtistMetadata(artistName);
	const imageUrl = updatedMetaAfterAvatar?.image_url || '';

	// 2. Query MusicBrainz for MBID, relations, and Wikipedia biography
	let mbid = cached?.musicbrainz_id || '';
	let disambiguation = cached?.disambiguation || '';
	let lastFmUrl = cached?.lastfm_url || `https://www.last.fm/music/${encodeURIComponent(artistName)}`;
	let biography = cached?.biography || '';
	const mbArtistRelations: Array<{ type: string; name: string; mbid?: string }> = [];

	try {
		let detail = null;
		if (mbid && !forceRefresh) {
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

			// Resolve Wikipedia biography (never use Wikimedia Commons snapshots for the avatar)
			const wikiRes = await resolveWikimediaAndWikipedia(
				artistName,
				detail.wikidataId,
				detail.wikipediaUrl,
				undefined
			);

			if (wikiRes.biography) {
				biography = wikiRes.biography;
			}
		}
	} catch (err) {
		console.warn(`[Artist Engine] MusicBrainz lookup failed for "${artistName}":`, err);
	}

	// 3. Fallback to TheAudioDB for biography or MBID if Wikipedia was unavailable
	if (!biography || !mbid) {
		const audioDb = await fetchAudioDbArtistData(artistName);
		if (audioDb) {
			if (!biography && audioDb.biography) biography = audioDb.biography;
			if (!mbid && audioDb.mbid) mbid = audioDb.mbid;
		}
	}

	// 4. Default biography fallback
	if (!biography) {
		biography = disambiguation
			? `${artistName} (${disambiguation}).`
			: `${artistName} is an artist in your music library.`;
	}

	// 5. Build Similar Artists list
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

	for (const rel of mbArtistRelations) {
		const key = rel.name.toLowerCase();
		if (key === artistName.toLowerCase()) continue;

		if (similarMap.has(key)) {
			const existing = similarMap.get(key)!;
			existing.role = rel.type;
			if (rel.mbid) existing.musicbrainz_id = rel.mbid;
		} else {
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

	// 6. Persist to SQLite
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

/**
 * Background pre-warmer that quietly resolves and caches missing studio portraits
 * for all distinct library artists on server startup.
 */
async function warmMissingArtistAvatars(): Promise<void> {
	try {
		const artists = getDistinctArtists();
		const baseDir = process.env.DATA_DIR || './data';
		for (const art of artists) {
			if (isGenericArtist(art.name)) continue;
			const token = encodeArtistId(art.name);
			const cachedFile = path.resolve(baseDir, 'artists', `${token}.jpg`);
			if (fs.existsSync(cachedFile)) continue;

			try {
				await resolveAndCacheArtistAvatar(art.name);
			} catch {}
			await new Promise((r) => setTimeout(r, 200));
		}
	} catch (err) {
		console.warn('[Artist Engine] Background avatar pre-warmer error:', err);
	}
}

// Run cache migration & purge on module initialization, then gently pre-warm missing avatars
try {
	purgeInvalidArtistCache();
	setTimeout(() => {
		warmMissingArtistAvatars().catch(() => {});
	}, 2000);
} catch {}

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
