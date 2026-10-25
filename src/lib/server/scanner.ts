import fs from 'node:fs';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { db } from '$lib/server/db.js';
import { createAlbum } from '$lib/server/db.js';
import type {
	ScannedAlbum,
	ScannedTrack,
	AudioFormat,
	QualityRating,
	CensorshipStatus,
	LyricsStatus
} from '$lib/types/index.js';

export const AUDIO_EXTENSIONS = new Set([
	'.flac',
	'.mp3',
	'.m4a',
	'.aac',
	'.ogg',
	'.opus',
	'.wav',
	'.aiff',
	'.wma',
	'.alac'
]);

export function getMusicDirectory(): string {
	if (process.env.MUSIC_DIR) {
		return path.resolve(process.env.MUSIC_DIR);
	}
	return path.resolve('./music');
}

export function isPathWithin(targetPath: string, rootPath: string): boolean {
	const relative = path.relative(rootPath, targetPath);
	return !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Robustly resolve track audio file path across host and Docker container mount environments
 */
export function resolveTrackFilePath(track: { id?: number; file_path?: string | null; notes?: string | null }): string | null {
	if (track.file_path && fs.existsSync(track.file_path)) {
		return track.file_path;
	}

	const musicDir = getMusicDirectory();

	// If track.file_path has a path from host or container mismatch
	if (track.file_path) {
		const musicIdx = track.file_path.indexOf('/music/');
		if (musicIdx !== -1) {
			const subPath = track.file_path.slice(musicIdx + '/music/'.length);
			const candidate = path.join(musicDir, subPath);
			if (fs.existsSync(candidate)) return candidate;
		}
	}

	// Fallback: check if notes contain folder/filename information from previous imports
	if (track.notes?.startsWith('Imported from: ')) {
		const filename = track.notes.replace('Imported from: ', '').trim();
		const directPath = path.join(musicDir, filename);
		if (fs.existsSync(directPath)) return directPath;
	}

	return null;
}

/**
 * Determine audio format and quality rating based on metadata
 */
export function detectFormatAndQuality(
	container?: string,
	codec?: string,
	bitrate?: number,
	bitsPerSample?: number,
	sampleRate?: number
): { format: AudioFormat; quality: QualityRating } {
	const c = (codec || container || '').toLowerCase();
	const brKbps = bitrate && bitrate > 0 ? Math.round(bitrate / 1000) : 0;
	// Genuine verified Hi-Res requires both high bit depth (>16 bit) and high sample rate (>=48kHz)
	const isVerifiedHiRes = !!(bitsPerSample && bitsPerSample > 16 && sampleRate && sampleRate >= 48000);

	// FLAC
	if (c.includes('flac')) {
		const quality: QualityRating = isVerifiedHiRes ? 'perfect' : 'good';
		return { format: 'FLAC', quality };
	}

	// ALAC
	if (c.includes('alac') || c.includes('apple lossless')) {
		const quality: QualityRating = isVerifiedHiRes ? 'perfect' : 'good';
		return { format: 'ALAC', quality };
	}

	// WAV / PCM / AIFF
	if (c.includes('wav') || c.includes('pcm') || c.includes('aiff')) {
		const fmt = c.includes('aiff') ? 'AIFF' : 'WAV';
		const quality: QualityRating = isVerifiedHiRes ? 'perfect' : 'good';
		return { format: fmt, quality };
	}

	// AAC / M4A
	if (c.includes('aac') || c.includes('mp4a') || c.includes('m4a')) {
		if (brKbps >= 240 && brKbps <= 280) {
			return { format: 'AAC_256', quality: 'good' };
		}
		if (brKbps >= 180) {
			return { format: 'OTHER', quality: 'good' };
		}
		if (brKbps >= 120) {
			return { format: 'OTHER', quality: 'acceptable' };
		}
		if (brKbps > 0 && brKbps < 120) {
			return { format: 'OTHER', quality: 'bad' };
		}
		return { format: 'OTHER', quality: 'acceptable' };
	}

	// OGG / Vorbis / Opus
	if (c.includes('ogg') || c.includes('vorbis') || c.includes('opus')) {
		let quality: QualityRating = 'acceptable';
		if (brKbps >= 190) quality = 'good';
		else if (brKbps > 0 && brKbps < 120) quality = 'bad';
		return { format: 'OGG', quality };
	}

	// MP3 or other lossy MPEG layer 3
	if (c.includes('mpeg') || c.includes('mp3') || c.includes('layer 3')) {
		// Specific known CBR presets
		if (brKbps >= 310) {
			return { format: 'MP3_320', quality: 'good' };
		}
		if (brKbps >= 185 && brKbps <= 200) {
			return { format: 'MP3_192', quality: 'acceptable' };
		}
		if (brKbps >= 120 && brKbps <= 135) {
			return { format: 'MP3_128', quality: 'acceptable' };
		}
		// VBR / V0 preset: only classify as MP3_V0 if explicitly indicated or in typical V0 range (220-260kbps VBR)
		if (c.includes('vbr') || c.includes('v0')) {
			return { format: 'MP3_V0', quality: 'good' };
		}
		// Other bitrates (e.g. 256kbps CBR, 224kbps, 160kbps, or sub-128kbps)
		let quality: QualityRating = 'acceptable';
		if (brKbps >= 220) {
			quality = 'good';
		} else if (brKbps > 0 && brKbps < 120) {
			quality = 'bad';
		}
		return { format: 'OTHER', quality };
	}

	return { format: 'OTHER', quality: 'acceptable' };
}

export interface CompanionLyricsResult {
	filePath: string;
	fileName: string;
	ext: string;
	type: LyricsStatus;
	content: string;
	isWritable: boolean;
}

/**
 * Detects whether lyrics text represents an instrumental track
 * (e.g. [00:00.00]♪, [00:00.00][instrumental], [au:Instrumental], etc.)
 */
export function isInstrumentalLyrics(content: string): boolean {
	if (!content || !content.trim()) return false;
	const trimmed = content.trim();

	// 1. Explicit [au:Instrumental] metadata tag
	if (/^\[au:\s*instrumental\]/im.test(trimmed)) {
		return true;
	}

	// 2. Timestamped instrumental indicator, e.g. [00:00.00]♪ or [00:00.00][instrumental]
	if (/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*(♪|♫|\[instrumental\]|\(instrumental\)|instrumental)/i.test(trimmed)) {
		return true;
	}

	// 3. File containing only non-vocal indicator line(s)
	const nonHeaderLines = trimmed
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l && !/^\[(ti|ar|al|length|by|offset|re|ve):/i.test(l));

	if (nonHeaderLines.length === 1) {
		const lineClean = nonHeaderLines[0]
			.replace(/^\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/, '')
			.trim()
			.toLowerCase();
		if (
			lineClean === '♪' ||
			lineClean === '♫' ||
			lineClean === '[instrumental]' ||
			lineClean === '(instrumental)' ||
			lineClean === 'instrumental'
		) {
			return true;
		}
	}

	return false;
}

/**
 * Searches the directory of an audio file for matching companion .lrc or .txt files.
 * Handles exact name matching, case-insensitivity (.LRC / .lrc), track number padding variations
 * (e.g., '001 ... .lrc' alongside '01 ... .flac'), and title matching.
 */
export function findCompanionLyricsFile(
	audioFilePath: string,
	trackTitle?: string
): CompanionLyricsResult | null {
	try {
		const dir = path.dirname(audioFilePath);
		if (!fs.existsSync(dir)) return null;

		const audioBase = path.basename(audioFilePath, path.extname(audioFilePath));
		const audioExt = path.extname(audioFilePath).toLowerCase();

		// Read all files in folder
		const files = fs.readdirSync(dir);

		// 1. Direct exact base match (.lrc first, then .txt)
		for (const targetExt of ['.lrc', '.txt']) {
			const candidate = files.find(
				(f) =>
					f.toLowerCase() === `${audioBase.toLowerCase()}${targetExt}` &&
					f.toLowerCase() !== `${audioBase.toLowerCase()}${audioExt}`
			);
			if (candidate) {
				const fullPath = path.join(dir, candidate);
				try {
					const content = fs.readFileSync(fullPath, 'utf-8');
					const ext = path.extname(candidate).toLowerCase();
					const hasTimestamps = /\[\d{1,2}:\d{2}/.test(content);
					let isWritable = true;
					try {
						fs.accessSync(fullPath, fs.constants.W_OK);
					} catch {
						isWritable = false;
					}
					const isInst = isInstrumentalLyrics(content);
					return {
						filePath: fullPath,
						fileName: candidate,
						ext,
						type: isInst ? 'instrumental' : ext === '.lrc' || hasTimestamps ? 'synced_lrc' : 'plain_txt',
						content,
						isWritable
					};
				} catch {
					// Continue to next candidate
				}
			}
		}

		// 2. Normalized track-number / padding variations (e.g. 01 vs 001 vs 1)
		const matchDigits = audioBase.match(/^(\d+)\s*[-._ ]\s*(.*)$/);
		const trackNum = matchDigits ? parseInt(matchDigits[1], 10) : null;
		const trackRest = matchDigits ? matchDigits[2].trim().toLowerCase() : audioBase.toLowerCase();

		for (const f of files) {
			const fExt = path.extname(f).toLowerCase();
			if (fExt !== '.lrc' && fExt !== '.txt') continue;

			const fBase = path.basename(f, fExt);
			const fDigitsMatch = fBase.match(/^(\d+)\s*[-._ ]\s*(.*)$/);
			const fNum = fDigitsMatch ? parseInt(fDigitsMatch[1], 10) : null;
			const fRest = fDigitsMatch ? fDigitsMatch[2].trim().toLowerCase() : fBase.toLowerCase();

			let isMatch = false;

			// If both have track numbers and they match numerically, and title/rest matches
			if (trackNum !== null && fNum !== null && trackNum === fNum) {
				if (!trackRest || !fRest || trackRest === fRest || fRest.includes(trackRest) || trackRest.includes(fRest)) {
					isMatch = true;
				}
			}

			// If title is provided, check if filename matches title
			if (!isMatch && trackTitle && trackTitle.trim().length > 3) {
				const normTitle = trackTitle.trim().toLowerCase();
				if (fBase.toLowerCase().includes(normTitle)) {
					isMatch = true;
				}
			}

			if (isMatch) {
				const fullPath = path.join(dir, f);
				try {
					const content = fs.readFileSync(fullPath, 'utf-8');
					const hasTimestamps = /\[\d{1,2}:\d{2}/.test(content);
					let isWritable = true;
					try {
						fs.accessSync(fullPath, fs.constants.W_OK);
					} catch {
						isWritable = false;
					}
					const isInst = isInstrumentalLyrics(content);
					return {
						filePath: fullPath,
						fileName: f,
						ext: fExt,
						type: isInst ? 'instrumental' : fExt === '.lrc' || hasTimestamps ? 'synced_lrc' : 'plain_txt',
						content,
						isWritable
					};
				} catch {
					// Continue
				}
			}
		}
	} catch (err) {
		console.warn('Error finding companion lyrics file:', err);
	}

	return null;
}

/**
 * Detect lyrics: checks companion .lrc / .txt files in same directory, or embedded lyrics tags
 */
export function detectLyrics(
	filePath: string,
	embeddedLyrics?: any,
	trackTitle?: string
): {
	status: LyricsStatus;
	hasLrc: boolean;
	hasTxt: boolean;
	hasEmbedded: boolean;
	lyricsContent?: string;
	companionPath?: string;
} {
	const companion = findCompanionLyricsFile(filePath, trackTitle);
	if (companion) {
		return {
			status: companion.type,
			hasLrc: companion.ext === '.lrc',
			hasTxt: companion.ext === '.txt',
			hasEmbedded: false,
			lyricsContent: companion.content,
			companionPath: companion.filePath
		};
	}

	// Check embedded lyrics
	if (embeddedLyrics) {
		const text = Array.isArray(embeddedLyrics)
			? embeddedLyrics.map((l) => (typeof l === 'string' ? l : l.text || '')).join('\n')
			: typeof embeddedLyrics === 'string'
			? embeddedLyrics
			: embeddedLyrics.text || '';

		if (text.trim().length > 0) {
			const hasTimestamps = /\[\d{1,2}:\d{2}/.test(text);
			const isInst = isInstrumentalLyrics(text);
			return {
				status: isInst ? 'instrumental' : hasTimestamps ? 'synced_lrc' : 'plain_txt',
				hasLrc: false,
				hasTxt: false,
				hasEmbedded: true,
				lyricsContent: text
			};
		}
	}

	return { status: 'missing', hasLrc: false, hasTxt: false, hasEmbedded: false };
}

/**
 * Detect censorship status from title, tags, or file name.
 * Returns 'unknown' if no explicit, clean, or censorship metadata exists.
 */
export function detectCensorship(title: string, rawTags?: any): CensorshipStatus {
	const lowerTitle = title.toLowerCase();

	if (
		lowerTitle.includes('(radio edit)') ||
		lowerTitle.includes('(clean)') ||
		lowerTitle.includes('[clean]') ||
		lowerTitle.includes('(clean version)') ||
		lowerTitle.includes('(censored)')
	) {
		return 'censored'; // Radio edit / censored
	}

	if (
		lowerTitle.includes('(explicit)') ||
		lowerTitle.includes('[explicit]') ||
		lowerTitle.includes('explicit version')
	) {
		return 'explicit';
	}

	if (
		lowerTitle.includes('(instrumental)') ||
		lowerTitle.includes('[instrumental]')
	) {
		return 'instrumental';
	}

	// Check iTunes advisory tag: 1 = explicit, 2 = clean/censored
	if (rawTags?.itunesAdvisory === 1 || rawTags?.['ITUNESADVISORY'] === '1') {
		return 'explicit';
	}
	if (rawTags?.itunesAdvisory === 2 || rawTags?.['ITUNESADVISORY'] === '2') {
		return 'censored';
	}

	// Do not assume clean_original without evidence!
	return 'unknown';
}

/**
 * Find local folder cover art image if available
 */
export function findLocalCoverArt(dir: string): string | null {
	const candidates = [
		'cover.jpg',
		'cover.jpeg',
		'cover.png',
		'cover.webp',
		'folder.jpg',
		'folder.png',
		'front.jpg',
		'front.jpeg',
		'front.png',
		'albumart.jpg',
		'album.jpg'
	];

	for (const candidate of candidates) {
		const full = path.join(dir, candidate);
		if (fs.existsSync(full)) {
			return `/api/library/cover?path=${encodeURIComponent(full)}`;
		}
	}

	return null;
}

/**
 * Extract MusicBrainz ID string safely (handles arrays or strings)
 */
function cleanMbId(val: any): string | null {
	if (!val) return null;
	if (Array.isArray(val)) {
		val = val[0];
	}
	if (typeof val === 'string' && val.trim().length >= 32) {
		return val.trim();
	}
	return null;
}

/**
 * Scan a single audio file and extract all tags + MusicBrainz data
 */
export async function scanAudioFile(filePath: string): Promise<ScannedTrack | null> {
	try {
		const metadata = await parseFile(filePath, { duration: true, skipCovers: true });
		const common = metadata.common;
		const format = metadata.format;

		const fileName = path.basename(filePath);
		const title = common.title || path.basename(filePath, path.extname(filePath));
		const artist = common.artist || common.albumartist || 'Unknown Artist';
		const albumArtist = common.albumartist || common.artist || 'Unknown Artist';
		const album = common.album || path.basename(path.dirname(filePath));
		const year = common.year || null;
		const trackNumber = common.track?.no || 1;
		const discNumber = common.disk?.no || 1;
		const durationMs = format.duration ? Math.round(format.duration * 1000) : null;

		const { format: audioFmt, quality: audioQuality } = detectFormatAndQuality(
			format.container,
			format.codec,
			format.bitrate,
			format.bitsPerSample,
			format.sampleRate
		);

		const { status: lyricsStatus, hasLrc, hasTxt, hasEmbedded, lyricsContent } = detectLyrics(filePath, common.lyrics, title);
		const censorshipStatus = detectCensorship(title, common);

		// MusicBrainz tags
		const mbAlbumId = cleanMbId(common.musicbrainz_albumid);
		const mbTrackId = cleanMbId(common.musicbrainz_trackid);
		const mbArtistId = cleanMbId(common.musicbrainz_artistid);
		const mbReleaseGroupId = cleanMbId(common.musicbrainz_releasegroupid);

		const bitrateKbps = format.bitrate ? Math.round(format.bitrate / 1000) : null;

		return {
			file_path: filePath,
			file_name: fileName,
			title,
			artist,
			album_artist: albumArtist,
			album,
			year,
			track_number: trackNumber,
			disc_number: discNumber,
			duration_ms: durationMs,
			format: audioFmt,
			bitrate_kbps: bitrateKbps,
			sample_rate: format.sampleRate || null,
			bits_per_sample: format.bitsPerSample || null,
			quality_rating: audioQuality,
			censorship: censorshipStatus,
			lyrics: lyricsStatus,
			has_lrc_file: hasLrc,
			has_txt_file: hasTxt,
			has_embedded_lyrics: hasEmbedded,
			lyrics_content: lyricsContent || null,
			musicbrainz_album_id: mbAlbumId,
			musicbrainz_track_id: mbTrackId,
			musicbrainz_artist_id: mbArtistId,
			musicbrainz_releasegroup_id: mbReleaseGroupId,
			selected: true
		};
	} catch (err) {
		console.warn(`Failed to parse metadata for file ${filePath}:`, err);
		return null;
	}
}

/**
 * Scan a music folder recursively and group audio files by album.
 * Enforces boundary so only paths within getMusicDirectory() can be scanned.
 */
export async function scanLibraryDirectory(targetDir?: string): Promise<{
	albums: ScannedAlbum[];
	totalFiles: number;
	libraryPath: string;
	exists: boolean;
}> {
	const musicDir = getMusicDirectory();
	let canonicalMusicDir: string;
	try {
		canonicalMusicDir = fs.existsSync(musicDir) ? fs.realpathSync(musicDir) : path.resolve(musicDir);
	} catch {
		canonicalMusicDir = path.resolve(musicDir);
	}

	const requested = targetDir ? path.resolve(targetDir) : canonicalMusicDir;
	let canonicalTarget: string;
	try {
		canonicalTarget = fs.existsSync(requested) ? fs.realpathSync(requested) : requested;
	} catch {
		canonicalTarget = requested;
	}

	// Boundary check
	if (!isPathWithin(canonicalTarget, canonicalMusicDir) && canonicalTarget !== canonicalMusicDir) {
		throw new Error(`Access denied: Target directory is outside configured music directory (${canonicalMusicDir}).`);
	}

	if (!fs.existsSync(canonicalTarget)) {
		return { albums: [], totalFiles: 0, libraryPath: canonicalTarget, exists: false };
	}

	const audioFiles: string[] = [];

	function walk(currentDir: string) {
		try {
			const entries = fs.readdirSync(currentDir, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.name.startsWith('.')) continue; // skip hidden files/.git

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
			console.error(`Cannot read directory ${currentDir}:`, err);
		}
	}

	walk(canonicalTarget);

	// Parse audio metadata for each file
	const scannedTracks: ScannedTrack[] = [];
	for (const file of audioFiles) {
		const track = await scanAudioFile(file);
		if (track) {
			scannedTracks.push(track);
		}
	}

	// Group tracks by album:
	// Prevent merging disparate folders: identify album folder (handling CD1/Disc 2 subfolders)
	const albumGroups: { [key: string]: { tracks: ScannedTrack[]; folder: string } } = {};

	for (const tr of scannedTracks) {
		const trackFolder = path.dirname(tr.file_path);
		const folderName = path.basename(trackFolder).toLowerCase();
		const isDiscSubfolder = /^(cd|disc|disk)\s*\d+$/i.test(folderName);
		const albumFolder = isDiscSubfolder ? path.dirname(trackFolder) : trackFolder;

		let key: string;
		if (tr.musicbrainz_album_id) {
			// Scoped to the album folder so unrelated folders never get accidentally merged
			key = `${albumFolder}::mb:${tr.musicbrainz_album_id}`;
		} else if (tr.album && tr.album !== 'Unknown Album') {
			key = `${albumFolder}::${tr.album.toLowerCase()}`;
		} else {
			key = `dir:${albumFolder}`;
		}

		if (!albumGroups[key]) {
			albumGroups[key] = { tracks: [], folder: albumFolder };
		}
		albumGroups[key].tracks.push(tr);
	}

	const scannedAlbums: ScannedAlbum[] = [];

	for (const [key, group] of Object.entries(albumGroups)) {
		// MusicBrainz ID if present on ANY track in this album
		const mbId = group.tracks.find((t) => t.musicbrainz_album_id)?.musicbrainz_album_id || null;

		// Only propagate album MBID to sibling tracks if album titles are consistent
		if (mbId) {
			const candidateAlbum = group.tracks.find((t) => t.musicbrainz_album_id)?.album;
			for (const t of group.tracks) {
				if (!t.musicbrainz_album_id) {
					// Check for conflicting album title before propagating
					if (!candidateAlbum || !t.album || t.album.toLowerCase() === candidateAlbum.toLowerCase()) {
						t.musicbrainz_album_id = mbId;
					}
				}
			}
		}

		// Sort tracks by disc and track number
		group.tracks.sort((a, b) => {
			if (a.disc_number !== b.disc_number) return a.disc_number - b.disc_number;
			return a.track_number - b.track_number;
		});

		const first = group.tracks[0];
		const albumTitle = first.album || path.basename(group.folder);
		const albumArtist = group.tracks.find((t) => t.album_artist)?.album_artist || first.artist || 'Unknown Artist';
		const albumYear = group.tracks.find((t) => t.year)?.year || null;

		// Cover Art: Local cover file or Cover Art Archive via MBID
		let coverUrl = findLocalCoverArt(group.folder);
		if (!coverUrl && mbId) {
			coverUrl = `https://coverartarchive.org/release/${mbId}/front-500`;
		}

		// Check if already in vault SQLite DB
		let alreadyInVault = false;
		if (mbId) {
			const row = db.prepare('SELECT id FROM albums WHERE musicbrainz_id = ?').get(mbId);
			if (row) alreadyInVault = true;
		}
		if (!alreadyInVault) {
			const row = db.prepare(
				'SELECT id FROM albums WHERE LOWER(title) = LOWER(?) AND LOWER(artist) = LOWER(?)'
			).get(albumTitle, albumArtist);
			if (row) alreadyInVault = true;
		}

		const hasFlac = group.tracks.some((t) => t.format === 'FLAC' || t.format === 'ALAC');
		const hasLrc = group.tracks.some((t) => t.lyrics === 'synced_lrc');

		scannedAlbums.push({
			album_key: key,
			title: albumTitle,
			artist: albumArtist,
			year: albumYear,
			folder_path: group.folder,
			musicbrainz_id: mbId,
			cover_url: coverUrl,
			track_count: group.tracks.length,
			has_flac: hasFlac,
			has_lrc: hasLrc,
			already_in_vault: alreadyInVault,
			tracks: group.tracks,
			selected: !alreadyInVault
		});
	}

	// Sort albums: albums not in vault first, then alphabetically
	scannedAlbums.sort((a, b) => {
		if (a.already_in_vault !== b.already_in_vault) {
			return a.already_in_vault ? 1 : -1;
		}
		return a.title.localeCompare(b.title);
	});

	return {
		albums: scannedAlbums,
		totalFiles: audioFiles.length,
		libraryPath: canonicalTarget,
		exists: true
	};
}

/**
 * Import a scanned album and only its chosen/selected tracks into Track Vault
 */
export async function importScannedAlbum(
	album: ScannedAlbum,
	selectedFilePaths?: string[]
): Promise<number> {
	let chosenTracks = album.tracks;
	if (selectedFilePaths && selectedFilePaths.length > 0) {
		const selectedSet = new Set(selectedFilePaths);
		chosenTracks = album.tracks.filter((t) => selectedSet.has(t.file_path));
	}

	if (chosenTracks.length === 0) {
		throw new Error('No tracks selected for import');
	}

	const tracksData = chosenTracks.map((t) => ({
		disc_number: t.disc_number,
		track_number: t.track_number,
		title: t.title,
		artist: t.artist !== album.artist ? t.artist : null,
		duration_ms: t.duration_ms,
		format: t.format,
		bitrate_kbps: t.bitrate_kbps,
		sample_rate: t.sample_rate,
		bits_per_sample: t.bits_per_sample,
		quality_rating: t.quality_rating,
		censorship: t.censorship,
		lyrics: t.lyrics,
		file_path: t.file_path,
		lyrics_text: t.lyrics_content ?? null,
		notes: `Imported from: ${path.basename(t.file_path)}`
	}));

	const albumId = createAlbum(
		{
			musicbrainz_id: album.musicbrainz_id,
			title: album.title,
			artist: album.artist,
			release_year: album.year,
			cover_url: album.cover_url,
			media_type: album.has_flac ? 'FLAC Digital' : 'Digital',
			notes: `Imported from local library folder: ${album.folder_path}`
		},
		tracksData
	);

	return albumId;
}

/**
 * Backfill missing bitrate and audio fidelity metadata for imported tracks in the database
 */
export async function backfillTrackBitrates(): Promise<number> {
	try {
		const nullTracks = db.prepare(`
			SELECT id, file_path, notes, duration_ms 
			FROM tracks 
			WHERE bitrate_kbps IS NULL AND (file_path IS NOT NULL OR notes LIKE 'Imported from:%')
		`).all() as Array<{ id: number; file_path: string | null; notes: string | null; duration_ms: number | null }>;

		if (nullTracks.length === 0) return 0;

		const updateStmt = db.prepare(`
			UPDATE tracks 
			SET bitrate_kbps = ?, sample_rate = ?, bits_per_sample = ? 
			WHERE id = ?
		`);

		const updatesToApply: Array<{ id: number; bitrate: number | null; sampleRate: number | null; bitsPerSample: number | null }> = [];

		for (const tr of nullTracks) {
			const resolvedPath = resolveTrackFilePath(tr);
			if (!resolvedPath || !fs.existsSync(resolvedPath)) continue;

			try {
				const meta = await parseFile(resolvedPath, { duration: true, skipCovers: true });
				let bitrateKbps = meta.format.bitrate ? Math.round(meta.format.bitrate / 1000) : null;

				// Fallback: estimate from file size and duration if bitrate is missing
				if (!bitrateKbps && tr.duration_ms && tr.duration_ms > 0) {
					try {
						const stat = fs.statSync(resolvedPath);
						bitrateKbps = Math.round((stat.size * 8) / tr.duration_ms);
					} catch {}
				}

				updatesToApply.push({
					id: tr.id,
					bitrate: bitrateKbps,
					sampleRate: meta.format.sampleRate || null,
					bitsPerSample: meta.format.bitsPerSample || null
				});
			} catch (err) {
				console.warn(`Failed extracting bitrate for track ID ${tr.id}:`, err);
			}
		}

		if (updatesToApply.length > 0) {
			const batch = db.transaction((items: typeof updatesToApply) => {
				for (const item of items) {
					updateStmt.run(item.bitrate, item.sampleRate, item.bitsPerSample, item.id);
				}
			});
			batch(updatesToApply);
			console.log(`[TrackVault] Successfully backfilled exact bitrate for ${updatesToApply.length} tracks.`);
		}

		return updatesToApply.length;
	} catch (err) {
		console.warn('Track bitrate backfill notice:', err);
		return 0;
	}
}
