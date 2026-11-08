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
	parseTrackDetailsFromFilename,
	AUDIO_EXTENSIONS,
	findLocalCoverArt,
	importScannedAlbum,
	invalidateScanCache,
	updateAlbumInScanCache,
	refreshAlbumInScanCache,
	findCompanionLyricsFile
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

import { normalizeString, levenshteinDistance, tokenSimilarity, computeStringSimilarity } from '$lib/utils.js';
export { searchMusicBrainz, getMusicBrainzRelease };
export { normalizeString, levenshteinDistance, tokenSimilarity, computeStringSimilarity };

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

	// Special case for singles: 1 local track and 1 MusicBrainz release track
	if (localTracks.length === 1 && mbTracks.length === 1 && matches.length === 0) {
		const score = Math.max(85, calculatePairScore(localTracks[0], mbTracks[0]));
		matches.push(buildTrackMatch(localTracks[0], mbTracks[0], score));
		matchedLocalIds.add(localTracks[0].id);
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
 * Detects whether an error represents a filesystem permission, access denied, or read-only failure
 */
export function isPermissionError(err: any): boolean {
	const code = err?.code || '';
	const msg = String(err?.message || err || '');
	return (
		code === 'EACCES' ||
		code === 'EPERM' ||
		code === 'EROFS' ||
		/permission denied|read-only file system|operation not permitted|access denied/i.test(msg)
	);
}

/**
 * Formats a clear, descriptive permission error with exact path and host fix instructions
 */
export function formatPermissionError(targetPath: string, err?: any): string {
	const code = err?.code || 'EACCES';
	const sysMsg = err?.message || 'Permission denied';
	return `File Permission Denied (${code}): Trax Vault does not have write access to "${targetPath}". If running in Docker, ensure your music folder is mounted read-write (:rw) and that the files on your host have write permissions (e.g. chmod -R u+rw /path/to/music or chown -R 1000:1000 /path/to/music). Details: ${sysMsg}`;
}

/**
 * Sanitizes a string (artist, title) for safe use in operating system filenames
 * Replaces illegal filesystem characters: / \ : * ? " < > |
 */
export function sanitizeFilename(name: string): string {
	if (!name) return '';
	return name
		.replace(/[/\\:]+/g, ' - ') // Replace path separators and colons with dash
		.replace(/[*?"<>|]+/g, '')  // Remove wildcard and redirect characters
		.replace(/[\x00-\x1f\x7f]/g, '') // Remove control characters
		.replace(/\s+/g, ' ')       // Collapse multiple spaces
		.replace(/\s*-\s*-+\s*/g, ' - ') // Clean up consecutive dashes
		.trim();
}

/**
 * Formats a standardized audio filename:
 * - Single-disc: "01. Artist - Title.ext"
 * - Multi-disc: "1-01. Artist - Title.ext"
 */
export function formatStandardTrackFilename(
	track: {
		discNumber?: number;
		trackNumber: number;
		title: string;
		artist: string;
		totalDiscs?: number;
	},
	ext: string
): string {
	const cleanArtist = sanitizeFilename(track.artist) || 'Unknown Artist';
	const cleanTitle = sanitizeFilename(track.title) || 'Unknown Title';
	const trackPad = String(track.trackNumber || 1).padStart(2, '0');
	const discNum = track.discNumber || 1;
	const isMultiDisc = Boolean((track.totalDiscs && track.totalDiscs > 1) || (track.discNumber && track.discNumber > 1));
	const prefix = isMultiDisc ? `${discNum}-${trackPad}` : trackPad;
	const safeExt = ext.startsWith('.') ? ext : `.${ext}`;

	const baseName = `${prefix}. ${cleanArtist} - ${cleanTitle}`.trim().replace(/[. ]+$/, '');
	return `${baseName}${safeExt}`;
}

/**
 * Safely renames an audio file and any companion lyrics (.lrc / .txt) in the same directory
 */
export function renameAudioAndCompanionFiles(
	oldFilePath: string,
	newFileName: string
): {
	success: boolean;
	newFilePath: string;
	oldFilePath: string;
	renamedCompanionPath?: string;
	error?: string;
	isPermissionDenied?: boolean;
} {
	try {
		if (!fs.existsSync(oldFilePath)) {
			return { success: false, newFilePath: oldFilePath, oldFilePath, error: `Source file not found: ${oldFilePath}` };
		}

		const dir = path.dirname(oldFilePath);
		const oldBase = path.basename(oldFilePath, path.extname(oldFilePath));
		const ext = path.extname(oldFilePath);

		// Sanitize desired target filename
		let sanitizedTargetName = newFileName;
		if (!sanitizedTargetName.endsWith(ext)) {
			sanitizedTargetName = `${sanitizedTargetName}${ext}`;
		}

		let targetPath = path.join(dir, sanitizedTargetName);

		// If paths are identical, no file move needed
		const isSamePath = path.resolve(oldFilePath) === path.resolve(targetPath);

		// Handle collisions: if target exists and is a different file
		if (!isSamePath && fs.existsSync(targetPath)) {
			const targetExt = path.extname(sanitizedTargetName);
			const targetBase = path.basename(sanitizedTargetName, targetExt);
			let counter = 1;
			while (
				fs.existsSync(targetPath) &&
				path.resolve(targetPath).toLowerCase() !== path.resolve(oldFilePath).toLowerCase()
			) {
				targetPath = path.join(dir, `${targetBase} (${counter})${targetExt}`);
				counter++;
			}
		}

		let finalNewFilePath = oldFilePath;

		// Perform audio file rename if name changed
		if (path.resolve(oldFilePath) !== path.resolve(targetPath)) {
			try {
				fs.accessSync(dir, fs.constants.W_OK);
			} catch (accessErr: any) {
				const permErr = formatPermissionError(dir, accessErr);
				return { success: false, newFilePath: oldFilePath, oldFilePath, error: permErr, isPermissionDenied: true };
			}

			try {
				fs.renameSync(oldFilePath, targetPath);
				finalNewFilePath = targetPath;
			} catch (renameErr: any) {
				const permErr = formatPermissionError(oldFilePath, renameErr);
				return {
					success: false,
					newFilePath: oldFilePath,
					oldFilePath,
					error: permErr,
					isPermissionDenied: isPermissionError(renameErr)
				};
			}
		} else {
			finalNewFilePath = targetPath;
		}

		// Discover and rename companion lyrics file (.lrc or .txt)
		let renamedCompanionPath: string | undefined;
		const newBase = path.basename(finalNewFilePath, path.extname(finalNewFilePath));

		// Check companion files matching the old base name
		for (const compExt of ['.lrc', '.txt', '.LRC', '.TXT']) {
			const oldCompCandidate = path.join(dir, `${oldBase}${compExt}`);
			if (fs.existsSync(oldCompCandidate)) {
				const targetCompPath = path.join(dir, `${newBase}${compExt.toLowerCase()}`);
				if (path.resolve(oldCompCandidate) !== path.resolve(targetCompPath)) {
					try {
						fs.renameSync(oldCompCandidate, targetCompPath);
						renamedCompanionPath = targetCompPath;
					} catch (compErr: any) {
						console.warn(`[Tagger] Could not rename companion lyrics file ${oldCompCandidate}:`, compErr.message);
					}
				}
			}
		}

		// Also check via findCompanionLyricsFile for loose/padded matches
		if (!renamedCompanionPath) {
			const looseCompanion = findCompanionLyricsFile(oldFilePath);
			if (looseCompanion && fs.existsSync(looseCompanion.filePath)) {
				const targetCompPath = path.join(dir, `${newBase}${looseCompanion.ext.toLowerCase()}`);
				if (path.resolve(looseCompanion.filePath) !== path.resolve(targetCompPath)) {
					try {
						fs.renameSync(looseCompanion.filePath, targetCompPath);
						renamedCompanionPath = targetCompPath;
					} catch (compErr: any) {
						console.warn(`[Tagger] Could not rename companion lyrics file ${looseCompanion.filePath}:`, compErr.message);
					}
				}
			}
		}

		return {
			success: true,
			newFilePath: finalNewFilePath,
			oldFilePath,
			renamedCompanionPath
		};
	} catch (err: any) {
		console.error(`[Tagger] Error during file renaming for ${oldFilePath}:`, err);
		const isPerm = isPermissionError(err);
		return {
			success: false,
			newFilePath: oldFilePath,
			oldFilePath,
			error: isPerm ? formatPermissionError(oldFilePath, err) : (err.message || 'File rename failed'),
			isPermissionDenied: isPerm
		};
	}
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
): Promise<{ success: boolean; error?: string; isPermissionDenied?: boolean }> {
	try {
		if (!fs.existsSync(filePath)) {
			return { success: false, error: `File not found on disk: ${filePath}` };
		}

		// Proactively verify write access before modifying
		try {
			fs.accessSync(filePath, fs.constants.W_OK);
		} catch (accessErr: any) {
			const permErr = formatPermissionError(filePath, accessErr);
			console.error(`Permission check failed for ${filePath}:`, permErr);
			return { success: false, error: permErr, isPermissionDenied: true };
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
							try {
								fs.writeFileSync(filePath, Buffer.from(updatedBytes));
								return { success: true };
							} catch (wErr: any) {
								const permErr = formatPermissionError(filePath, wErr);
								console.error(`Write error saving tags to ${filePath}:`, permErr);
								return { success: false, error: permErr, isPermissionDenied: isPermissionError(wErr) };
							}
						}
					}
				}
			}
		} catch (refErr: any) {
			if (isPermissionError(refErr)) {
				return { success: false, error: formatPermissionError(filePath, refErr), isPermissionDenied: true };
			}
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

		try {
			fs.writeFileSync(filePath, Buffer.from(updatedBytes));
			return { success: true };
		} catch (wErr: any) {
			const permErr = formatPermissionError(filePath, wErr);
			console.error(`Write error saving tags (fallback) to ${filePath}:`, permErr);
			return { success: false, error: permErr, isPermissionDenied: isPermissionError(wErr) };
		}
	} catch (err: any) {
		console.error(`Failed to write tags to ${filePath}:`, err);
		const isPerm = isPermissionError(err);
		return {
			success: false,
			error: isPerm ? formatPermissionError(filePath, err) : (err.message || 'Unknown error writing tags'),
			isPermissionDenied: isPerm
		};
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
): Promise<{ success: boolean; coverPath?: string; error?: string; isPermissionDenied?: boolean }> {
	try {
		const targetFolders = (Array.isArray(albumFolderOrFolders) ? albumFolderOrFolders : [albumFolderOrFolders])
			.filter(Boolean)
			.map((f) => path.resolve(f));

		const validFolders = targetFolders.filter((f) => fs.existsSync(f));
		if (validFolders.length === 0) {
			return { success: false, error: `None of the target album directories exist: ${targetFolders.join(', ')}` };
		}

		// Proactively check write permissions on target folders
		for (const folder of validFolders) {
			try {
				fs.accessSync(folder, fs.constants.W_OK);
			} catch (permErr: any) {
				const formatted = formatPermissionError(folder, permErr);
				console.error(`[CoverArt] Folder is not writable:`, formatted);
				return { success: false, error: formatted, isPermissionDenied: true };
			}
		}

		// Helper to write downloaded buffer to all folders
		const saveCoverBuffer = (buffer: Buffer, isPng = false): string => {
			let firstSavedPath = '';
			for (const folder of validFolders) {
				const standardJpgPath = path.join(folder, 'cover.jpg');
				try {
					fs.writeFileSync(standardJpgPath, buffer);
					if (isPng) {
						try {
							fs.writeFileSync(path.join(folder, 'cover.png'), buffer);
						} catch (pngErr: any) {
							console.warn('[CoverArt] Warning: Could not write cover.png:', pngErr.message);
						}
					}
					if (!firstSavedPath) firstSavedPath = standardJpgPath;
				} catch (writeErr: any) {
					console.error(`[CoverArt] Failed to write cover file at ${standardJpgPath}:`, writeErr);
					throw new Error(formatPermissionError(standardJpgPath, writeErr));
				}
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
		const isPerm = isPermissionError(err);
		return {
			success: false,
			error: isPerm
				? formatPermissionError(Array.isArray(albumFolderOrFolders) ? albumFolderOrFolders[0] : albumFolderOrFolders, err)
				: (err.message || 'Failed to download cover'),
			isPermissionDenied: isPerm
		};
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
		renameFiles?: boolean;
	} = {}
): Promise<{
	success: boolean;
	updatedTracksCount: number;
	renamedFilesCount: number;
	totalAttempted: number;
	album: Album;
	tracks: Track[];
	coverPath?: string;
	coverDownloaded?: boolean;
	coverError?: string | null;
	fileErrors: Array<{ file: string; path: string; error: string; isPermissionDenied?: boolean }>;
	hasPermissionErrors: boolean;
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
	let renamedFilesCount = 0;
	const fileErrors: Array<{ file: string; path: string; error: string; isPermissionDenied?: boolean }> = [];
	const trackUpdates: Array<{
		id: number;
		title: string;
		artist?: string | null;
		track_number: number;
		disc_number?: number;
		file_path?: string | null;
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
		let finalDiskPath = diskPath;

		if (diskPath && fs.existsSync(diskPath)) {
			const tagResult = await writeTagsToAudioFile(diskPath, {
				title: targetTitle,
				artist: targetArtist,
				albumArtist: targetAlbumArtist,
				album: options.updateAlbumTitle ? release.title : album.title,
				year: options.updateYear && release.release_year ? release.release_year : (album.release_year || undefined),
				track: targetTrackNum,
				disc: targetDiscNum
			});

			if (tagResult.success) {
				updatedTracksCount++;

				// Rename physical file on disk (and companion lyrics) if requested (default: true)
				if (options.renameFiles !== false) {
					const ext = path.extname(diskPath);
					const totalDiscs = release.tracks.reduce((max, t) => Math.max(max, t.disc_number || 1), 1);
					const standardFilename = formatStandardTrackFilename(
						{
							discNumber: targetDiscNum,
							trackNumber: targetTrackNum,
							title: targetTitle,
							artist: targetArtist,
							totalDiscs
						},
						ext
					);

					const renameResult = renameAudioAndCompanionFiles(diskPath, standardFilename);
					if (renameResult.success) {
						finalDiskPath = renameResult.newFilePath;
						if (path.resolve(diskPath) !== path.resolve(renameResult.newFilePath)) {
							renamedFilesCount++;
						}
					} else if (renameResult.error) {
						fileErrors.push({
							file: path.basename(diskPath),
							path: diskPath,
							error: renameResult.error,
							isPermissionDenied: renameResult.isPermissionDenied
						});
					}
				}
			} else {
				console.warn(`Failed writing tags to ${diskPath}:`, tagResult.error);
				fileErrors.push({
					file: path.basename(diskPath),
					path: diskPath,
					error: tagResult.error || 'Write error',
					isPermissionDenied: tagResult.isPermissionDenied
				});
			}
		} else {
			fileErrors.push({
				file: localTr.file_path || `Track ${targetTrackNum}`,
				path: diskPath || '',
				error: 'Audio file not found on disk'
			});
		}

		trackUpdates.push({
			id: localTr.id,
			title: targetTitle,
			artist: targetArtist,
			track_number: targetTrackNum,
			disc_number: targetDiscNum,
			file_path: finalDiskPath
		});
	}

	// 2. Download cover art if requested and available (non-blocking)
	let newCoverUrl = album.cover_url;
	let coverRes: { success: boolean; coverPath?: string; error?: string; isPermissionDenied?: boolean } | undefined;
	let coverError: string | null = null;
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
			} else if (coverRes.error) {
				coverError = coverRes.error;
			}
		} catch (covErr: any) {
			console.warn('Cover art download failed non-fatally in applyAlbumTags:', covErr.message);
			coverError = covErr.message;
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
		await refreshAlbumInScanCache(folder, {
			title: options.updateAlbumTitle ? release.title : album.title,
			artist: options.updateArtist ? release.artist : album.artist,
			year: options.updateYear && release.release_year ? release.release_year : album.release_year,
			musicbrainzId: release.id,
			coverUrl: newCoverUrl,
			existingAlbumId: albumId
		});
	}

	const hasPermissionErrors =
		fileErrors.some((e) => e.isPermissionDenied) ||
		(coverError ? isPermissionError({ message: coverError }) : false);

	const overallError =
		fileErrors.find((e) => e.isPermissionDenied)?.error ||
		fileErrors[0]?.error ||
		(coverError && isPermissionError({ message: coverError }) ? coverError : undefined);

	return {
		success: updatedTracksCount > 0 && fileErrors.length === 0,
		updatedTracksCount,
		renamedFilesCount,
		totalAttempted: confirmedMatches.length,
		album: updated.album,
		tracks: updated.tracks,
		coverPath: coverRes?.coverPath || undefined,
		coverDownloaded: Boolean(coverRes?.success && coverRes?.coverPath),
		coverError,
		fileErrors,
		hasPermissionErrors,
		error: overallError
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
	is_writable: boolean;
	permission_error: string | null;
	unwritable_files: string[];
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
	let folderTitle = first?.album || path.basename(canonicalTarget);
	const validArtistTrack =
		rawTracks.find((t) => t.album_artist && t.album_artist.trim().toLowerCase() !== 'unknown artist') ||
		rawTracks.find((t) => t.artist && t.artist.trim().toLowerCase() !== 'unknown artist');
	let folderArtist = validArtistTrack?.album_artist || validArtistTrack?.artist || first?.artist || 'Unknown Artist';

	// If folderArtist is still Unknown Artist, inspect folder name
	if (!folderArtist || folderArtist.trim().toLowerCase() === 'unknown artist') {
		const folderBase = path.basename(canonicalTarget);
		const parsedFolder = parseTrackDetailsFromFilename(folderBase);
		if (parsedFolder.artist) {
			folderArtist = parsedFolder.artist;
			if (folderTitle === folderBase) {
				folderTitle = parsedFolder.title;
			}
		}
	}

	// For single-track releases (e.g. singles like MADARA)
	if (rawTracks.length === 1 && rawTracks[0]) {
		if (rawTracks[0].artist && rawTracks[0].artist.trim().toLowerCase() !== 'unknown artist') {
			folderArtist = rawTracks[0].artist;
		}
		if (rawTracks[0].title) {
			folderTitle = rawTracks[0].title;
		}
	}

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

	// Verify write permissions for target folder and all audio files
	let isWritable = true;
	let permissionError: string | null = null;
	try {
		fs.accessSync(canonicalTarget, fs.constants.W_OK);
	} catch (pErr: any) {
		isWritable = false;
		permissionError = formatPermissionError(canonicalTarget, pErr);
	}

	const unwritableFiles: string[] = [];
	for (const file of audioFiles) {
		try {
			fs.accessSync(file, fs.constants.W_OK);
		} catch {
			unwritableFiles.push(path.basename(file));
		}
	}
	if (unwritableFiles.length > 0 && isWritable) {
		isWritable = false;
		permissionError = `Permission denied: Trax Vault cannot write to ${unwritableFiles.length} audio file(s) in this folder (e.g. ${unwritableFiles.slice(0, 3).join(', ')}).`;
	}

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
		raw_tracks: rawTracks,
		is_writable: isWritable,
		permission_error: permissionError,
		unwritable_files: unwritableFiles
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
		renameFiles?: boolean;
	} = {}
): Promise<{
	success: boolean;
	updatedTracksCount: number;
	renamedFilesCount: number;
	totalAttempted: number;
	importedAlbumId?: number | null;
	folderTitle?: string;
	folderArtist?: string;
	folderYear?: number | null;
	coverUrl?: string | null;
	coverPath?: string;
	coverDownloaded?: boolean;
	coverError?: string | null;
	fileErrors: Array<{ file: string; path: string; error: string; isPermissionDenied?: boolean }>;
	hasPermissionErrors: boolean;
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
	let renamedFilesCount = 0;
	const renamedPathsMap = new Map<string, string>();
	const fileErrors: Array<{ file: string; path: string; error: string; isPermissionDenied?: boolean }> = [];
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

				// Rename physical file on disk (and companion lyrics) if requested (default: true)
				if (options.renameFiles !== false) {
					const ext = path.extname(diskPath);
					const totalDiscs = release.tracks.reduce((max, t) => Math.max(max, t.disc_number || 1), 1);
					const standardFilename = formatStandardTrackFilename(
						{
							discNumber: targetDiscNum,
							trackNumber: targetTrackNum,
							title: targetTitle,
							artist: trackArtist,
							totalDiscs
						},
						ext
					);

					const renameResult = renameAudioAndCompanionFiles(diskPath, standardFilename);
					if (renameResult.success) {
						const finalDiskPath = renameResult.newFilePath;
						if (path.resolve(diskPath) !== path.resolve(finalDiskPath)) {
							renamedFilesCount++;
						}
						renamedPathsMap.set(diskPath, finalDiskPath);
						if (localTr) {
							localTr.file_path = finalDiskPath;
						}
						const rawTr = folderData.raw_tracks.find((rt) => rt.file_path === diskPath);
						if (rawTr) {
							rawTr.file_path = finalDiskPath;
							rawTr.file_name = path.basename(finalDiskPath);
						}
					} else if (renameResult.error) {
						fileErrors.push({
							file: path.basename(diskPath),
							path: diskPath,
							error: renameResult.error,
							isPermissionDenied: renameResult.isPermissionDenied
						});
					}
				}
			} else {
				console.warn(`Failed writing tags to ${diskPath}:`, tagResult.error);
				fileErrors.push({
					file: path.basename(diskPath),
					path: diskPath,
					error: tagResult.error || 'Write error',
					isPermissionDenied: tagResult.isPermissionDenied
				});
			}
		} else {
			fileErrors.push({
				file: localTr?.file_path ? path.basename(localTr.file_path) : `Track ${match.trackNumber}`,
				path: diskPath || '',
				error: 'Audio file not found on disk'
			});
		}
	}

	// 2. Download cover art if requested (non-blocking)
	let coverPath: string | undefined;
	let coverUrl: string | null = folderData.cover_url;
	let coverDownloaded = false;
	let coverError: string | null = null;
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
			} else if (coverRes.error) {
				coverError = coverRes.error;
			}
		} catch (covErr: any) {
			console.warn('Cover art download failed non-fatally in applyFolderTags:', covErr.message);
			coverError = covErr.message;
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
					file_path?: string | null;
				}> = [];

				for (const match of confirmedMatches) {
					const localSynthetic = folderData.tracks.find((t) => t.id === match.localTrackId);
					if (!localSynthetic?.file_path) continue;

					const effectivePath = renamedPathsMap.get(match.filePath || '') || localSynthetic.file_path;
					// Match DB track by file_path or track_number (only real non-missing tracks)
					const dbTr = dbTracksRes.tracks.find(
						(dt) => (dt.file_path && (dt.file_path === localSynthetic.file_path || dt.file_path === match.filePath || dt.file_path === effectivePath)) ||
						        (!dt.is_missing && dt.track_number === localSynthetic.track_number)
					);

					if (dbTr) {
						trackUpdates.push({
							id: dbTr.id,
							title: match.title.trim(),
							artist: match.artist?.trim() || release.artist,
							track_number: match.trackNumber,
							disc_number: match.discNumber || dbTr.disc_number || 1,
							file_path: effectivePath
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
		await refreshAlbumInScanCache(folder, {
			title: targetAlbumTitle,
			artist: targetArtist,
			year: targetYear || null,
			musicbrainzId: release.id,
			coverUrl: coverUrl,
			existingAlbumId: importedAlbumId || folderData.existing_album_id || null
		});
	}

	const hasPermissionErrors =
		fileErrors.some((e) => e.isPermissionDenied) ||
		(coverError ? isPermissionError({ message: coverError }) : false);

	const overallError =
		fileErrors.find((e) => e.isPermissionDenied)?.error ||
		fileErrors[0]?.error ||
		(coverError && isPermissionError({ message: coverError }) ? coverError : undefined);

	return {
		success: updatedTracksCount > 0 && fileErrors.length === 0,
		updatedTracksCount,
		renamedFilesCount,
		totalAttempted: confirmedMatches.length,
		importedAlbumId,
		folderTitle: targetAlbumTitle,
		folderArtist: targetArtist,
		folderYear: targetYear || null,
		coverUrl,
		coverPath,
		coverDownloaded: Boolean(coverPath && fs.existsSync(coverPath)),
		coverError,
		fileErrors,
		hasPermissionErrors,
		error: overallError
	};
}

