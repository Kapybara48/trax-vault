import fs from 'node:fs';
import path from 'node:path';
import type { RequestHandler } from './$types.js';
import { db, saveTrackLyrics } from '$lib/server/db.js';
import {
	findCompanionLyricsFile,
	resolveTrackFilePath,
	stripLrcMetadataHeaders,
	isInstrumentalLyrics,
	isCensoredLyrics,
	getMusicDirectory,
	isPathWithin
} from '$lib/server/scanner.js';
import { APP_VERSION } from '$lib/version.js';
import type { Track, LyricsStatus } from '$lib/types/index.js';

const USER_AGENT = `TraxVault/${APP_VERSION} (https://github.com/Kapybara48/trax-vault)`;

interface CandidateResult {
	id: number;
	trackName: string;
	artistName: string;
	albumName?: string | null;
	duration: number;
	instrumental: boolean;
	syncedLyrics?: string | null;
	plainLyrics?: string | null;
}

async function queryLrclib(
	title: string,
	artist: string,
	album: string,
	durationMs: number | null
): Promise<CandidateResult | null> {
	const durationSec = durationMs ? Math.round(durationMs / 1000) : 0;

	// 1. Try exact match query
	if (title.trim()) {
		const getParams = new URLSearchParams();
		getParams.set('track_name', title.trim());
		if (artist.trim()) getParams.set('artist_name', artist.trim());
		if (album.trim()) getParams.set('album_name', album.trim());
		if (durationSec > 0) getParams.set('duration', durationSec.toString());

		try {
			const res = await fetch(`https://lrclib.net/api/get?${getParams.toString()}`, {
				headers: { 'User-Agent': USER_AGENT }
			});
			if (res.ok) {
				const data = await res.json();
				if (data && data.id) {
					return {
						id: data.id,
						trackName: data.trackName || title,
						artistName: data.artistName || artist,
						albumName: data.albumName || album,
						duration: data.duration || durationSec,
						instrumental: Boolean(data.instrumental),
						syncedLyrics: data.syncedLyrics || null,
						plainLyrics: data.plainLyrics || null
					};
				}
			}
		} catch {
			// Fallback to search query
		}
	}

	// 2. Try search query
	const query = [artist.trim(), title.trim()].filter(Boolean).join(' ');
	if (!query) return null;

	try {
		const searchRes = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, {
			headers: { 'User-Agent': USER_AGENT }
		});
		if (searchRes.ok) {
			const results = await searchRes.json();
			if (Array.isArray(results) && results.length > 0) {
				// Find candidate with synced lyrics first, or fallback to first
				const withSynced = results.find((r) => Boolean(r.syncedLyrics) || Boolean(r.instrumental));
				const candidate = withSynced || results[0];
				if (candidate && candidate.id) {
					return {
						id: candidate.id,
						trackName: candidate.trackName || title,
						artistName: candidate.artistName || artist,
						albumName: candidate.albumName || album,
						duration: candidate.duration || durationSec,
						instrumental: Boolean(candidate.instrumental),
						syncedLyrics: candidate.syncedLyrics || null,
						plainLyrics: candidate.plainLyrics || null
					};
				}
			}
		}
	} catch {
		// Ignore
	}

	return null;
}

export const POST: RequestHandler = async ({ request }) => {
	let body: {
		albumId?: number | null;
		onlySynced?: boolean;
		saveToDisk?: boolean;
	};

	try {
		body = await request.json();
	} catch {
		body = {};
	}

	const albumId = body.albumId && !isNaN(body.albumId) ? body.albumId : null;
	const onlySynced = body.onlySynced !== false; // Default true
	const saveToDisk = body.saveToDisk !== false; // Default true

	// Build query for candidate tracks
	let sql = `
		SELECT 
			t.id, t.album_id, t.disc_number, t.track_number, t.title, t.artist, t.duration_ms, 
			t.format, t.lyrics, t.file_path, t.needs_attention, t.manually_checked,
			a.title as album_title, a.artist as album_artist
		FROM tracks t
		JOIN albums a ON a.id = t.album_id
		WHERE (t.is_missing = 0 OR t.is_missing IS NULL)
		  AND t.lyrics NOT IN ('synced_lrc', 'instrumental')
	`;

	const params: (number | string)[] = [];
	if (albumId) {
		sql += ' AND t.album_id = ?';
		params.push(albumId);
	}

	sql += ' ORDER BY a.artist COLLATE NOCASE, a.release_year, a.title COLLATE NOCASE, t.disc_number, t.track_number';

	const tracks = db.prepare(sql).all(...params) as Array<
		Track & { album_title: string; album_artist: string }
	>;

	const musicDir = getMusicDirectory();
	let canonicalMusicDir: string;
	try {
		canonicalMusicDir = fs.existsSync(musicDir) ? fs.realpathSync(musicDir) : path.resolve(musicDir);
	} catch {
		canonicalMusicDir = path.resolve(musicDir);
	}

	// Create SSE stream response
	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();
			function sendEvent(data: Record<string, any>) {
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
				} catch {
					// Client disconnected
				}
			}

			sendEvent({
				type: 'start',
				total: tracks.length,
				albumId
			});

			let syncedCount = 0;
			let instrumentalCount = 0;
			let plainCount = 0;
			let notFoundCount = 0;
			let errorCount = 0;

			for (let i = 0; i < tracks.length; i++) {
				if (request.signal.aborted) {
					break;
				}

				const track = tracks[i];
				const effectiveArtist = track.artist || track.album_artist || '';
				const effectiveTitle = track.title;
				const effectiveAlbum = track.album_title || '';

				try {
					const candidate = await queryLrclib(
						effectiveTitle,
						effectiveArtist,
						effectiveAlbum,
						track.duration_ms
					);

					if (!candidate) {
						notFoundCount++;
						sendEvent({
							type: 'progress',
							current: i + 1,
							total: tracks.length,
							trackId: track.id,
							title: track.title,
							artist: effectiveArtist,
							album: effectiveAlbum,
							status: 'not_found',
							message: 'No lyrics match found on LRCLIB'
						});
					} else if (candidate.instrumental || isInstrumentalLyrics(candidate.syncedLyrics || candidate.plainLyrics || '')) {
						// Instrumental song detected
						const lyricsContent = '[00:00.00]♪';
						let savedDisk = false;

						if (saveToDisk) {
							const audioPath = resolveTrackFilePath(track);
							if (audioPath) {
								const dir = path.dirname(audioPath);
								let canonicalDir: string;
								try {
									canonicalDir = fs.existsSync(dir) ? fs.realpathSync(dir) : path.resolve(dir);
								} catch {
									canonicalDir = path.resolve(dir);
								}

								if (isPathWithin(canonicalDir, canonicalMusicDir) || canonicalDir === canonicalMusicDir) {
									const existingCompanion = findCompanionLyricsFile(audioPath, track.title);
									const base = path.basename(audioPath, path.extname(audioPath));
									const companionPath = existingCompanion ? existingCompanion.filePath : path.join(dir, `${base}.lrc`);
									try {
										fs.writeFileSync(companionPath, lyricsContent, 'utf-8');
										savedDisk = true;
									} catch {}
								}
							}
						}

						saveTrackLyrics(track.id, lyricsContent, 'instrumental');
						instrumentalCount++;

						sendEvent({
							type: 'progress',
							current: i + 1,
							total: tracks.length,
							trackId: track.id,
							title: track.title,
							artist: effectiveArtist,
							album: effectiveAlbum,
							status: 'instrumental',
							lyricsStatus: 'instrumental',
							savedToDisk: savedDisk,
							message: 'Marked as instrumental [00:00.00]♪'
						});
					} else if (candidate.syncedLyrics) {
						// Synced lyrics found
						const cleanedLyrics = stripLrcMetadataHeaders(candidate.syncedLyrics);
						const lyricsStatus: LyricsStatus = isCensoredLyrics(cleanedLyrics) ? 'censored_lrc' : 'synced_lrc';
						let savedDisk = false;

						if (saveToDisk) {
							const audioPath = resolveTrackFilePath(track);
							if (audioPath) {
								const dir = path.dirname(audioPath);
								let canonicalDir: string;
								try {
									canonicalDir = fs.existsSync(dir) ? fs.realpathSync(dir) : path.resolve(dir);
								} catch {
									canonicalDir = path.resolve(dir);
								}

								if (isPathWithin(canonicalDir, canonicalMusicDir) || canonicalDir === canonicalMusicDir) {
									const existingCompanion = findCompanionLyricsFile(audioPath, track.title);
									const base = path.basename(audioPath, path.extname(audioPath));
									const companionPath = existingCompanion ? existingCompanion.filePath : path.join(dir, `${base}.lrc`);
									try {
										fs.writeFileSync(companionPath, cleanedLyrics, 'utf-8');
										savedDisk = true;
									} catch {}
								}
							}
						}

						saveTrackLyrics(track.id, cleanedLyrics, lyricsStatus);
						syncedCount++;

						sendEvent({
							type: 'progress',
							current: i + 1,
							total: tracks.length,
							trackId: track.id,
							title: track.title,
							artist: effectiveArtist,
							album: effectiveAlbum,
							status: 'synced',
							lyricsStatus,
							savedToDisk: savedDisk,
							message: lyricsStatus === 'censored_lrc' ? 'Saved censored synced LRC' : 'Saved synced LRC'
						});
					} else if (candidate.plainLyrics && !onlySynced) {
						// Plain text lyrics found and user opted to allow plain lyrics
						const cleanedLyrics = stripLrcMetadataHeaders(candidate.plainLyrics);
						let savedDisk = false;

						if (saveToDisk) {
							const audioPath = resolveTrackFilePath(track);
							if (audioPath) {
								const dir = path.dirname(audioPath);
								let canonicalDir: string;
								try {
									canonicalDir = fs.existsSync(dir) ? fs.realpathSync(dir) : path.resolve(dir);
								} catch {
									canonicalDir = path.resolve(dir);
								}

								if (isPathWithin(canonicalDir, canonicalMusicDir) || canonicalDir === canonicalMusicDir) {
									const existingCompanion = findCompanionLyricsFile(audioPath, track.title);
									const base = path.basename(audioPath, path.extname(audioPath));
									const companionPath = existingCompanion ? existingCompanion.filePath : path.join(dir, `${base}.txt`);
									try {
										fs.writeFileSync(companionPath, cleanedLyrics, 'utf-8');
										savedDisk = true;
									} catch {}
								}
							}
						}

						saveTrackLyrics(track.id, cleanedLyrics, 'plain_txt');
						plainCount++;

						sendEvent({
							type: 'progress',
							current: i + 1,
							total: tracks.length,
							trackId: track.id,
							title: track.title,
							artist: effectiveArtist,
							album: effectiveAlbum,
							status: 'plain',
							lyricsStatus: 'plain_txt',
							savedToDisk: savedDisk,
							message: 'Saved plain text lyrics'
						});
					} else {
						// Candidate only had plain lyrics, but onlySynced was requested
						notFoundCount++;
						sendEvent({
							type: 'progress',
							current: i + 1,
							total: tracks.length,
							trackId: track.id,
							title: track.title,
							artist: effectiveArtist,
							album: effectiveAlbum,
							status: 'skipped',
							message: 'Only plain lyrics found on LRCLIB (synced lyrics required)'
						});
					}
				} catch (err: any) {
					errorCount++;
					sendEvent({
						type: 'progress',
						current: i + 1,
						total: tracks.length,
						trackId: track.id,
						title: track.title,
						artist: effectiveArtist,
						album: effectiveAlbum,
						status: 'error',
						message: err.message || 'Error downloading lyrics'
					});
				}

				// Polite 120ms rate limit delay between queries
				await new Promise((r) => setTimeout(r, 120));
			}

			sendEvent({
				type: 'complete',
				summary: {
					total: tracks.length,
					syncedCount,
					instrumentalCount,
					plainCount,
					notFoundCount,
					errorCount
				}
			});

			try {
				controller.close();
			} catch {}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive'
		}
	});
};
