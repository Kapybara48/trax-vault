import type { PageServerLoad } from './$types.js';
import { db, getAlbums, getUserPlaylists } from '$lib/server/db.js';
import { encodeArtistId } from '$lib/server/subsonic/artist.js';
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

export interface PlayerArtist {
	name: string;
	album_count: number;
	song_count: number;
	cover_url: string | null;
	avatar_url?: string | null;
	biography?: string | null;
	musicbrainz_id?: string | null;
	lastfm_url?: string | null;
	albums: PlayerAlbum[];
	tracks: Track[];
}

export const load: PageServerLoad = async ({ url, locals }) => {
	const initialAlbumId = url.searchParams.get('albumId') ? parseInt(url.searchParams.get('albumId')!, 10) : null;
	const initialTrackId = url.searchParams.get('trackId') ? parseInt(url.searchParams.get('trackId')!, 10) : null;
	const initialPlaylistId = url.searchParams.get('playlistId') ? parseInt(url.searchParams.get('playlistId')!, 10) : null;
	const initialArtist = url.searchParams.get('artist') || null;
	const initialView = url.searchParams.get('view') === 'playlists' || initialPlaylistId
		? 'playlists'
		: (url.searchParams.get('view') === 'artists' || initialArtist ? 'artists' : 'albums');

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
			t.is_missing,
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
			t.is_missing,
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

	// Aggregate artists and their discography / songs
	const artistsMap = new Map<string, {
		name: string;
		albumIds: Set<number>;
		cover_url: string | null;
		albums: PlayerAlbum[];
		tracks: Track[];
	}>();

	for (const alb of albums) {
		const albArtist = alb.artist?.trim() || 'Unknown Artist';
		const key = albArtist.toLowerCase();
		let entry = artistsMap.get(key);
		if (!entry) {
			entry = {
				name: albArtist,
				albumIds: new Set<number>(),
				cover_url: alb.cover_url || null,
				albums: [],
				tracks: []
			};
			artistsMap.set(key, entry);
		}
		if (!entry.albumIds.has(alb.id)) {
			entry.albumIds.add(alb.id);
			entry.albums.push(alb);
			if (!entry.cover_url && alb.cover_url) {
				entry.cover_url = alb.cover_url;
			}
		}
		for (const tr of alb.tracks) {
			entry.tracks.push(tr);
		}
	}

	// Query cached artist metadata
	const rawMeta = db.prepare('SELECT name, biography, musicbrainz_id, lastfm_url, image_url, image_disk_path FROM artist_metadata').all() as Array<{
		name: string;
		biography?: string | null;
		musicbrainz_id?: string | null;
		lastfm_url?: string | null;
		image_url?: string | null;
		image_disk_path?: string | null;
	}>;
	const metaMap = new Map<string, typeof rawMeta[0]>();
	for (const m of rawMeta) {
		metaMap.set(m.name.toLowerCase(), m);
	}

	const artists: PlayerArtist[] = Array.from(artistsMap.values())
		.map((a) => {
			const m = metaMap.get(a.name.toLowerCase());
			const hasAvatar = m && (m.image_disk_path || m.image_url);
			const token = encodeArtistId(a.name);
			return {
				name: a.name,
				album_count: a.albums.length,
				song_count: a.tracks.length,
				cover_url: a.cover_url,
				avatar_url: hasAvatar ? `/rest/getCoverArt.view?id=art-${token}` : null,
				biography: m?.biography || null,
				musicbrainz_id: m?.musicbrainz_id || null,
				lastfm_url: m?.lastfm_url || null,
				albums: a.albums,
				tracks: a.tracks
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

	return {
		albums,
		playlists,
		artists,
		initialAlbumId,
		initialTrackId,
		initialPlaylistId,
		initialArtist,
		initialView
	};
};
