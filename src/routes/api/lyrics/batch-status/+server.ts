import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db.js';

export const GET: RequestHandler = async ({ url }) => {
	const albumIdParam = url.searchParams.get('albumId');
	const albumId = albumIdParam ? parseInt(albumIdParam, 10) : null;

	// Total library counts of songs needing synced lyrics
	const totalNeedingRow = db.prepare(`
		SELECT COUNT(*) as count 
		FROM tracks 
		WHERE (is_missing = 0 OR is_missing IS NULL) 
		  AND lyrics NOT IN ('synced_lrc', 'instrumental')
	`).get() as { count: number };

	const totalSyncedRow = db.prepare(`
		SELECT COUNT(*) as count 
		FROM tracks 
		WHERE (is_missing = 0 OR is_missing IS NULL) 
		  AND lyrics = 'synced_lrc'
	`).get() as { count: number };

	const totalInstrumentalRow = db.prepare(`
		SELECT COUNT(*) as count 
		FROM tracks 
		WHERE (is_missing = 0 OR is_missing IS NULL) 
		  AND lyrics = 'instrumental'
	`).get() as { count: number };

	let albumNeedingCount = 0;
	let albumTitle: string | null = null;
	let albumArtist: string | null = null;

	if (albumId && !isNaN(albumId)) {
		const alb = db.prepare('SELECT title, artist FROM albums WHERE id = ?').get(albumId) as { title: string; artist: string } | undefined;
		if (alb) {
			albumTitle = alb.title;
			albumArtist = alb.artist;

			const albumNeedingRow = db.prepare(`
				SELECT COUNT(*) as count 
				FROM tracks 
				WHERE album_id = ? 
				  AND (is_missing = 0 OR is_missing IS NULL) 
				  AND lyrics NOT IN ('synced_lrc', 'instrumental')
			`).get(albumId) as { count: number };

			albumNeedingCount = albumNeedingRow.count;
		}
	}

	return json({
		success: true,
		totalNeedingLyrics: totalNeedingRow.count,
		totalSyncedLyrics: totalSyncedRow.count,
		totalInstrumental: totalInstrumentalRow.count,
		albumId,
		albumTitle,
		albumArtist,
		albumNeedingLyrics: albumNeedingCount
	});
};
