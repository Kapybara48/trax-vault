import type { PageServerLoad } from './$types.js';
import { db, getAlbums, getUserPlaylists } from '$lib/server/db.js';
import type { Album, Track, Playlist } from '$lib/types/index.js';

export interface PlayerAlbum extends Album {
	tracks: Track[];
}

export interface PlayerPlaylist extends Playlist {
	song_count: number;
	duration_ms: number;
	cover_url: string | null;
	tracks: Track[];
}

export const load: PageServerLoad = async ({ url, locals }) => {
	const initialAlbumId = url.searchParams.get('albumId') ? parseInt(url.searchParams.get('albumId')!, 10) : null;
	const initialTrackId = url.searchParams.get('trackId') ? parseInt(url.searchParams.get('trackId')!, 10) : null;
	const initialPlaylistId = url.searchParams.get('playlistId') ? parseInt(url.searchParams.get('playlistId')!, 10) : null;
	const initialView = url.searchParams.get('view') === 'playlists' || initialPlaylistId ? 'playlists' : 'albums';

	const userId = locals.user?.id || 1;

	// Fetch all albums
	const rawAlbums = getAlbums();

	// Fetch all tracks with album details (omitting bulky lyrics_text and server-side file_path)
	const allTracks = db.prepare(`
		SELECT 
			t.id,
			t.album_id,
			t.disc_number,
			t.track_number,
			t.title,
			t.artist,
			t.duration_ms,
			t.format,
			t.bitrate_kbps,
			t.sample_rate,
			t.bits_per_sample,
			t.quality_rating,
			t.censorship,
			t.lyrics,
			t.needs_attention,
			t.manually_checked,
			a.title as album_title,
			a.artist as album_artist,
			a.cover_url as album_cover_url,
			a.release_year as album_year
		FROM tracks t
		JOIN albums a ON a.id = t.album_id
		ORDER BY a.artist COLLATE NOCASE ASC, a.release_year ASC, a.title COLLATE NOCASE ASC, t.disc_number ASC, t.track_number ASC
	`).all() as Track[];

	// Group tracks by album_id
	const tracksByAlbum = new Map<number, Track[]>();
	for (const tr of allTracks) {
		const existing = tracksByAlbum.get(tr.album_id) || [];
		existing.push(tr);
		tracksByAlbum.set(tr.album_id, existing);
	}

	const albums: PlayerAlbum[] = rawAlbums.map((alb) => ({
		...alb,
		tracks: tracksByAlbum.get(alb.id) || []
	}));

	// Fetch user's playlists
	const rawPlaylists = getUserPlaylists(userId);

	// Fetch all tracks for these playlists
	const allPlaylistTracks = db.prepare(`
		SELECT 
			pt.playlist_id,
			pt.track_order,
			t.id,
			t.album_id,
			t.disc_number,
			t.track_number,
			t.title,
			t.artist,
			t.duration_ms,
			t.format,
			t.bitrate_kbps,
			t.sample_rate,
			t.bits_per_sample,
			t.quality_rating,
			t.censorship,
			t.lyrics,
			t.needs_attention,
			t.manually_checked,
			a.title as album_title,
			a.artist as album_artist,
			a.cover_url as album_cover_url,
			a.release_year as album_year
		FROM playlist_tracks pt
		JOIN tracks t ON pt.track_id = t.id
		JOIN albums a ON t.album_id = a.id
		ORDER BY pt.playlist_id ASC, pt.track_order ASC
	`).all() as Array<Track & { playlist_id: number; track_order: number }>;

	const tracksByPlaylist = new Map<number, Track[]>();
	for (const ptr of allPlaylistTracks) {
		const list = tracksByPlaylist.get(ptr.playlist_id) || [];
		list.push(ptr);
		tracksByPlaylist.set(ptr.playlist_id, list);
	}

	const playlists: PlayerPlaylist[] = rawPlaylists.map((pl) => ({
		...pl,
		tracks: tracksByPlaylist.get(pl.id) || []
	}));

	return {
		albums,
		playlists,
		initialAlbumId,
		initialTrackId,
		initialPlaylistId,
		initialView
	};
};
