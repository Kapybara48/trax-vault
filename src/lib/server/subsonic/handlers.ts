import path from 'node:path';
import fs from 'node:fs';
import {
	db,
	getAlbumById,
	getTrackById,
	getDistinctArtists,
	getAlbumsByArtist,
	getAlbumList,
	getRandomTracks,
	getAllGenres,
	getAlbums,
	recordTrackPlay,
	starItem,
	unstarItem,
	isItemStarred,
	getStarredItems,
	getUserPlaylists,
	getPlaylistById,
	getPlaylistTracks,
	createPlaylist,
	updatePlaylist,
	replacePlaylistTracks,
	deletePlaylist,
	getAllTracksPaged,
	getTracksByGenre,
	getTopTracksByArtist,
	getPlayQueue,
	savePlayQueue
} from '$lib/server/db.js';
import {
	findCompanionLyricsFile,
	resolveTrackFilePath,
	getLibraryScanStatus,
	syncLibraryFromDisk,
	isInstrumentalLyrics,
	stripLrcMetadataHeaders
} from '$lib/server/scanner.js';
import type { Album, Track } from '$lib/types/index.js';
import type { User } from '$lib/server/auth.js';
import { SubsonicErrorCode } from './types.js';

export function formatIsoDate(dateStr?: string | null): string {
	if (!dateStr) return new Date().toISOString();
	if (dateStr.includes('T') && (dateStr.endsWith('Z') || dateStr.includes('+'))) return dateStr;
	const normalized = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T');
	const withZ = normalized.endsWith('Z') ? normalized : normalized + 'Z';
	const parsed = new Date(withZ);
	return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export function encodeArtistId(name: string): string {
	return 'art_' + Buffer.from(name, 'utf8').toString('hex');
}

export function decodeArtistId(id: string): string {
	const cleanId = id.replace(/^art-/, '');
	if (cleanId.startsWith('art_')) {
		try {
			return Buffer.from(cleanId.substring(4), 'hex').toString('utf8');
		} catch {
			return cleanId;
		}
	}
	// Fallback: check if an album exists with this ID and use its artist
	const numericId = parseInt(cleanId, 10);
	if (!isNaN(numericId)) {
		const row = db.prepare('SELECT artist FROM albums WHERE id = ?').get(numericId) as { artist: string } | undefined;
		if (row?.artist) return row.artist;
	}
	return cleanId;
}

function getContentType(format?: string, filePath?: string): string {
	const ext = filePath ? path.extname(filePath).toLowerCase() : '';
	if (ext === '.flac' || format?.startsWith('FLAC')) return 'audio/flac';
	if (ext === '.mp3' || format?.startsWith('MP3')) return 'audio/mpeg';
	if (ext === '.m4a' || ext === '.aac' || format?.startsWith('AAC') || format?.startsWith('ALAC')) return 'audio/mp4';
	if (ext === '.ogg' || ext === '.opus' || format?.startsWith('OGG')) return 'audio/ogg';
	if (ext === '.wav' || format?.startsWith('WAV')) return 'audio/wav';
	if (ext === '.aiff' || ext === '.aif' || format?.startsWith('AIFF')) return 'audio/aiff';
	return 'audio/mpeg';
}

export function trackToSubsonicSong(
	track: Track,
	album?: Album | null,
	isStarred: boolean = false
): Record<string, any> {
	const albumTitle = track.album_title || album?.title || 'Unknown Album';
	const artistName = track.artist || track.album_artist || album?.artist || 'Unknown Artist';
	const albumArtistName = track.album_artist || album?.artist || artistName;
	const albumId = (track.album_id || album?.id || '').toString();
	const artistId = encodeArtistId(artistName);
	const albumArtistId = encodeArtistId(albumArtistName);
	const durationSeconds = Math.round((track.duration_ms || 0) / 1000);
	const ext = track.format ? track.format.toLowerCase().replace(/_.*/, '') : 'flac';

	// Compute real file size on disk or estimate from bitrate & duration
	let sizeBytes = 0;
	const resolvedPath = resolveTrackFilePath(track);
	if (resolvedPath && fs.existsSync(resolvedPath)) {
		try {
			sizeBytes = fs.statSync(resolvedPath).size;
		} catch {}
	}
	if (!sizeBytes && durationSeconds > 0) {
		sizeBytes = Math.round((durationSeconds * (track.bitrate_kbps || 320) * 1000) / 8);
	}

	const song: Record<string, any> = {
		id: track.id.toString(),
		parent: albumId,
		isDir: false,
		isVideo: false,
		title: track.title,
		album: albumTitle,
		artist: artistName,
		track: track.track_number || 1,
		discNumber: track.disc_number || 1,
		year: track.album_year || (track as any).year || album?.release_year || undefined,
		genre: (track as any).album_genre || (track as any).genre || album?.genre || undefined,
		coverArt: `tr-${track.id}`,
		size: sizeBytes,
		contentType: getContentType(track.format, track.file_path || undefined),
		suffix: ext,
		format: ext,
		duration: durationSeconds,
		bitRate: track.bitrate_kbps || 0,
		path: track.file_path || `${artistName}/${albumTitle}/${track.track_number} ${track.title}.${ext}`,
		playCount: track.play_count || 0,
		created: formatIsoDate(track.created_at),
		type: 'music',
		albumId,
		artistId,
		artists: [{ id: artistId, name: artistName }],
		albumArtists: [{ id: albumArtistId, name: albumArtistName }]
	};

	if (isStarred) {
		song.starred = formatIsoDate(track.created_at) || new Date().toISOString();
	}

	return song;
}

export function albumToSubsonicAlbum(
	album: Album,
	tracks?: Track[],
	isStarred: boolean = false
): Record<string, any> {
	let durationSeconds = 0;
	let songCount = album.track_count || 0;

	if (tracks && tracks.length > 0) {
		durationSeconds = Math.round(tracks.reduce((sum, t) => sum + (t.duration_ms || 0), 0) / 1000);
		songCount = tracks.length;
	} else if (album.id) {
		const row = db.prepare('SELECT SUM(duration_ms) as total_ms, COUNT(*) as count FROM tracks WHERE album_id = ?').get(album.id) as any;
		if (row && row.total_ms) {
			durationSeconds = Math.round((row.total_ms || 0) / 1000);
			songCount = row.count || songCount;
		}
	}

	const artistId = encodeArtistId(album.artist);

	const alb: Record<string, any> = {
		id: album.id.toString(),
		name: album.title,
		title: album.title,
		album: album.title,
		artist: album.artist,
		artistId,
		artists: [{ id: artistId, name: album.artist }],
		coverArt: `al-${album.id}`,
		songCount: songCount,
		duration: durationSeconds,
		created: formatIsoDate(album.created_at),
		isDir: true,
		isVideo: false,
		parent: artistId,
		year: album.release_year || undefined,
		genre: album.genre || undefined
	};

	if (isStarred) {
		alb.starred = formatIsoDate(album.created_at) || new Date().toISOString();
	}

	if (tracks && tracks.length > 0) {
		alb.song = tracks.map((t) => trackToSubsonicSong(t, album));
	}

	return alb;
}

// Subsonic API Handlers
export const subsonicHandlers: Record<
	string,
	(params: Record<string, any>, user: User) => Promise<{ data?: any; error?: { code: SubsonicErrorCode; message: string } }>
> = {
	ping: async () => {
		return { data: {} };
	},

	getLicense: async () => {
		return {
			data: {
				license: {
					valid: true,
					email: 'admin@traxvault.local',
					licenseExpires: '2099-12-31T23:59:59Z',
					trialExpires: '2099-12-31T23:59:59Z'
				}
			}
		};
	},

	getMusicFolders: async () => {
		return {
			data: {
				musicFolders: {
					musicFolder: [{ id: 0, name: 'Trax Vault Music' }]
				}
			}
		};
	},

	getUser: async (params, user) => {
		const targetUsername = (params.username || params.u || user.username).trim().toLowerCase();
		return {
			data: {
				user: {
					username: targetUsername,
					email: `${targetUsername}@vault.local`,
					scrobblingEnabled: true,
					adminRole: true,
					settingsRole: true,
					downloadRole: true,
					uploadRole: true,
					playlistRole: true,
					coverArtRole: true,
					commentRole: true,
					podcastRole: true,
					streamRole: true,
					jukeboxRole: true,
					shareRole: true,
					videoConversionRole: false,
					folder: [0]
				}
			}
		};
	},

	getUsers: async (_params, user) => {
		return {
			data: {
				users: {
					user: [
						{
							username: user.username,
							email: `${user.username}@vault.local`,
							scrobblingEnabled: true,
							adminRole: true,
							settingsRole: true,
							downloadRole: true,
							uploadRole: true,
							playlistRole: true,
							coverArtRole: true,
							commentRole: true,
							podcastRole: true,
							streamRole: true,
							jukeboxRole: true,
							shareRole: true,
							videoConversionRole: false,
							folder: [0]
						}
					]
				}
			}
		};
	},

	getScanStatus: async () => {
		const row = db.prepare('SELECT COUNT(*) as count FROM tracks').get() as { count: number } | undefined;
		const albumRow = db.prepare('SELECT COUNT(*) as count FROM albums').get() as { count: number } | undefined;
		const { scanning, lastScan } = getLibraryScanStatus();
		const lastRow = db.prepare(`
			SELECT MAX(m) as last_updated FROM (
				SELECT MAX(updated_at) as m FROM tracks
				UNION
				SELECT MAX(created_at) as m FROM tracks
				UNION
				SELECT MAX(updated_at) as m FROM albums
				UNION
				SELECT MAX(created_at) as m FROM albums
			)
		`).get() as any;
		const dbLastModified = lastRow?.last_updated ? new Date(formatIsoDate(lastRow.last_updated)).getTime() : Date.now();

		return {
			data: {
				scanStatus: {
					scanning,
					count: row?.count || 0,
					folderCount: albumRow?.count || 1,
					lastScan: lastScan || dbLastModified
				}
			}
		};
	},

	startScan: async () => {
		syncLibraryFromDisk().catch((err) => console.error('[Subsonic] startScan background sync error:', err));
		const row = db.prepare('SELECT COUNT(*) as count FROM tracks').get() as { count: number } | undefined;
		const albumRow = db.prepare('SELECT COUNT(*) as count FROM albums').get() as { count: number } | undefined;
		return {
			data: {
				scanStatus: {
					scanning: true,
					count: row?.count || 0,
					folderCount: albumRow?.count || 1
				}
			}
		};
	},

	getNowPlaying: async () => {
		return {
			data: {
				nowPlaying: {
					entry: []
				}
			}
		};
	},

	getBookmarks: async () => {
		return {
			data: {
				bookmarks: {
					bookmark: []
				}
			}
		};
	},

	getIndexes: async (params, user) => {
		const rawArtists = getDistinctArtists();
		const indexMap = new Map<string, any[]>();

		for (const art of rawArtists) {
			const firstChar = art.name.trim().charAt(0).toUpperCase();
			const indexLetter = /^[A-Z]$/.test(firstChar) ? firstChar : '#';

			if (!indexMap.has(indexLetter)) {
				indexMap.set(indexLetter, []);
			}

			const isStarred = isItemStarred(user.id, 'artist', art.name as any);
			const artObj: Record<string, any> = {
				id: encodeArtistId(art.name),
				name: art.name,
				albumCount: art.album_count || 1,
				coverArt: encodeArtistId(art.name),
				roles: ['artist']
			};
			if (isStarred) artObj.starred = new Date().toISOString();

			indexMap.get(indexLetter)!.push(artObj);
		}

		const indexes = Array.from(indexMap.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, artist]) => ({ name, artist }));

		const lastRow = db.prepare(`
			SELECT MAX(m) as last_updated FROM (
				SELECT MAX(updated_at) as m FROM tracks
				UNION
				SELECT MAX(created_at) as m FROM tracks
				UNION
				SELECT MAX(updated_at) as m FROM albums
				UNION
				SELECT MAX(created_at) as m FROM albums
			)
		`).get() as any;
		const lastModified = lastRow?.last_updated ? new Date(formatIsoDate(lastRow.last_updated)).getTime() : Date.now();

		return {
			data: {
				indexes: {
					lastModified,
					ignoredArticles: 'The El La Los Las Le Les',
					index: indexes,
					child: [],
					shortcut: []
				}
			}
		};
	},

	getMusicDirectory: async (params, user) => {
		const rawId = (params.id || '').toString();
		if (!rawId) {
			return { error: { code: SubsonicErrorCode.REQUIRED_PARAM_MISSING, message: "Parameter 'id' is required" } };
		}

		// 1. Artist directory (art_... or art-...) -> list albums as child dirs
		if (rawId.startsWith('art_') || rawId.startsWith('art-')) {
			const artistName = decodeArtistId(rawId);
			const albums = getAlbumsByArtist(artistName);
			return {
				data: {
					directory: {
						id: rawId,
						parent: '0',
						name: artistName,
						child: albums.map((a) => {
							const isStarred = isItemStarred(user.id, 'album', a.id);
							const albSub = albumToSubsonicAlbum(a, undefined, isStarred);
							return {
								...albSub,
								id: `al-${a.id}`,
								parent: rawId,
								isDir: true
							};
						})
					}
				}
			};
		}

		// 2. Album directory (explicit al-... or numeric id matching an existing album) -> list songs as files
		const cleanId = rawId.replace(/^[a-z]+-/, '');
		const albumId = parseInt(cleanId, 10);
		if (!isNaN(albumId) && (rawId.startsWith('al-') || (rawId !== '0' && rawId !== 'root' && getAlbumById(albumId)))) {
			const result = getAlbumById(albumId);
			if (result) {
				const isStarred = isItemStarred(user.id, 'album', albumId);
				const parentArtistId = encodeArtistId(result.album.artist);
				return {
					data: {
						directory: {
							id: rawId,
							parent: parentArtistId,
							name: result.album.title,
							child: result.tracks.map((t) => {
								const isSongStarred = isItemStarred(user.id, 'track', t.id);
								return trackToSubsonicSong(t, result.album, isSongStarred);
							})
						}
					}
				};
			}
		}

		// 3. Root directory (folder id 0, "root", "folder-0", "mf-0", etc.) -> list all artists as dirs
		const artists = getDistinctArtists();
		return {
			data: {
				directory: {
					id: rawId,
					name: 'Trax Vault Music',
					child: artists.map((art) => ({
						id: encodeArtistId(art.name),
						parent: rawId,
						isDir: true,
						title: art.name,
						name: art.name,
						artist: art.name,
						albumCount: art.album_count || 1
					}))
				}
			}
		};
	},

	getArtists: async (_params, user) => {
		const rawArtists = getDistinctArtists();
		// Group into alphabetical index
		const indexMap = new Map<string, any[]>();

		for (const art of rawArtists) {
			const firstChar = art.name.trim().charAt(0).toUpperCase();
			const indexLetter = /^[A-Z]$/.test(firstChar) ? firstChar : '#';

			if (!indexMap.has(indexLetter)) {
				indexMap.set(indexLetter, []);
			}

			const isStarred = isItemStarred(user.id, 'artist', art.name as any);
			const artObj: Record<string, any> = {
				id: encodeArtistId(art.name),
				name: art.name,
				albumCount: art.album_count || 1,
				coverArt: encodeArtistId(art.name),
				roles: ['artist']
			};
			if (isStarred) artObj.starred = new Date().toISOString();

			indexMap.get(indexLetter)!.push(artObj);
		}

		const indexes = Array.from(indexMap.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, artist]) => ({ name, artist }));

		return {
			data: {
				artists: {
					ignoredArticles: 'The El La Los Las Le Les',
					index: indexes
				}
			}
		};
	},

	getArtist: async (params, user) => {
		const rawId = (params.id || '').toString();
		if (!rawId) {
			return { error: { code: SubsonicErrorCode.REQUIRED_PARAM_MISSING, message: "Parameter 'id' is required" } };
		}

		const artistName = decodeArtistId(rawId);
		const albums = getAlbumsByArtist(artistName);

		const isArtistStarred = isItemStarred(user.id, 'artist', artistName as any);
		const artistObj: Record<string, any> = {
			id: encodeArtistId(artistName),
			name: artistName,
			albumCount: albums.length,
			coverArt: encodeArtistId(artistName),
			roles: ['artist'],
			album: albums.map((a) => {
				const isAlbumStarred = isItemStarred(user.id, 'album', a.id);
				return albumToSubsonicAlbum(a, undefined, isAlbumStarred);
			})
		};

		if (isArtistStarred) {
			artistObj.starred = new Date().toISOString();
		}

		return { data: { artist: artistObj } };
	},

	getArtistInfo: async (params) => {
		const rawId = params.id;
		const artistName = rawId ? decodeArtistId(rawId) : '';
		return {
			data: {
				artistInfo: {
					biography: `Artist: ${artistName}`,
					musicBrainzId: '',
					lastFmUrl: '',
					smallImageUrl: '',
					mediumImageUrl: '',
					largeImageUrl: ''
				}
			}
		};
	},

	getArtistInfo2: async (params) => {
		const rawId = params.id;
		const artistName = rawId ? decodeArtistId(rawId) : '';
		return {
			data: {
				artistInfo2: {
					biography: `Artist: ${artistName}`,
					musicBrainzId: '',
					lastFmUrl: '',
					smallImageUrl: '',
					mediumImageUrl: '',
					largeImageUrl: ''
				}
			}
		};
	},

	getAlbumInfo: async (params) => {
		const rawId = (params.id || '').toString().replace(/^al-/, '');
		const albumId = parseInt(rawId, 10);
		const albumRes = !isNaN(albumId) ? getAlbumById(albumId) : null;
		return {
			data: {
				albumInfo: {
					notes: albumRes?.album.notes || (albumRes ? `${albumRes.album.title} by ${albumRes.album.artist}` : ''),
					musicBrainzId: '',
					lastFmUrl: '',
					smallImageUrl: albumId ? `al-${albumId}` : '',
					mediumImageUrl: albumId ? `al-${albumId}` : '',
					largeImageUrl: albumId ? `al-${albumId}` : ''
				}
			}
		};
	},

	getAlbumInfo2: async (params) => {
		const rawId = (params.id || '').toString().replace(/^al-/, '');
		const albumId = parseInt(rawId, 10);
		const albumRes = !isNaN(albumId) ? getAlbumById(albumId) : null;
		return {
			data: {
				albumInfo2: {
					notes: albumRes?.album.notes || (albumRes ? `${albumRes.album.title} by ${albumRes.album.artist}` : ''),
					musicBrainzId: '',
					lastFmUrl: '',
					smallImageUrl: albumId ? `al-${albumId}` : '',
					mediumImageUrl: albumId ? `al-${albumId}` : '',
					largeImageUrl: albumId ? `al-${albumId}` : ''
				}
			}
		};
	},

	getAlbum: async (params, user) => {
		const rawId = (params.id || '').toString().replace(/^[a-z]+-/, '');
		const albumId = parseInt(rawId, 10);
		if (isNaN(albumId)) {
			return { error: { code: SubsonicErrorCode.REQUIRED_PARAM_MISSING, message: "Valid 'id' is required" } };
		}

		const result = getAlbumById(albumId);
		if (!result) {
			return { error: { code: SubsonicErrorCode.DATA_NOT_FOUND, message: 'Album not found' } };
		}

		const isStarred = isItemStarred(user.id, 'album', albumId);

		return {
			data: {
				album: albumToSubsonicAlbum(result.album, result.tracks, isStarred)
			}
		};
	},

	getSong: async (params, user) => {
		const rawId = (params.id || '').toString().replace(/^[a-z]+-/, '');
		const songId = parseInt(rawId, 10);
		if (isNaN(songId)) {
			return { error: { code: SubsonicErrorCode.REQUIRED_PARAM_MISSING, message: "Valid 'id' is required" } };
		}

		const track = getTrackById(songId);
		if (!track) {
			return { error: { code: SubsonicErrorCode.DATA_NOT_FOUND, message: 'Song not found' } };
		}

		const albumRes = getAlbumById(track.album_id);
		const isStarred = isItemStarred(user.id, 'track', songId);

		return {
			data: {
				song: trackToSubsonicSong(track, albumRes?.album, isStarred)
			}
		};
	},

	getAlbumList2: async (params, user) => {
		const type = params.type || 'newest';
		const size = parseInt(params.size, 10) || 10;
		const offset = parseInt(params.offset, 10) || 0;
		const genre = params.genre;

		const albums = getAlbumList(type, size, offset, genre);

		return {
			data: {
				albumList2: {
					album: albums.map((a) => {
						const isStarred = isItemStarred(user.id, 'album', a.id);
						return albumToSubsonicAlbum(a, undefined, isStarred);
					})
				}
			}
		};
	},

	getAlbumList: async (params, user) => {
		const type = params.type || 'newest';
		const size = parseInt(params.size, 10) || 10;
		const offset = parseInt(params.offset, 10) || 0;

		const albums = getAlbumList(type, size, offset);

		return {
			data: {
				albumList: {
					album: albums.map((a) => {
						const isStarred = isItemStarred(user.id, 'album', a.id);
						return albumToSubsonicAlbum(a, undefined, isStarred);
					})
				}
			}
		};
	},

	getRandomSongs: async (params) => {
		const size = parseInt(params.size, 10) || 10;
		const genre = params.genre;

		const tracks = getRandomTracks(size, genre);

		return {
			data: {
				randomSongs: {
					song: tracks.map((t) => trackToSubsonicSong(t, null))
				}
			}
		};
	},

	getGenres: async () => {
		const genres = getAllGenres();
		return {
			data: {
				genres: {
					genre: genres.map((g) => ({
						value: g.genre,
						songCount: g.song_count,
						albumCount: g.album_count
					}))
				}
			}
		};
	},

	getSongsByGenre: async (params, user) => {
		const genre = params.genre;
		if (!genre) {
			return { error: { code: SubsonicErrorCode.REQUIRED_PARAM_MISSING, message: "Parameter 'genre' is required" } };
		}
		const count = parseInt(params.count, 10) || 50;
		const offset = parseInt(params.offset, 10) || 0;
		const tracks = getTracksByGenre(genre, offset, count);

		return {
			data: {
				songsByGenre: {
					song: tracks.map((t) => {
						const isStarred = isItemStarred(user.id, 'track', t.id);
						return trackToSubsonicSong(t, null, isStarred);
					})
				}
			}
		};
	},

	getTopSongs: async (params, user) => {
		const rawArtist = params.artist || (params.artistId ? decodeArtistId(params.artistId) : '');
		const count = parseInt(params.count, 10) || 50;
		const tracks = rawArtist ? getTopTracksByArtist(rawArtist, count) : [];

		return {
			data: {
				topSongs: {
					song: tracks.map((t) => {
						const isStarred = isItemStarred(user.id, 'track', t.id);
						return trackToSubsonicSong(t, null, isStarred);
					})
				}
			}
		};
	},

	getSimilarSongs: async (params, user) => {
		const count = parseInt(params.count, 10) || 50;
		const rawId = (params.id || '').toString().replace(/^[a-z]+-/, '');
		const songId = parseInt(rawId, 10);
		let tracks: Track[] = [];
		if (!isNaN(songId)) {
			const source = getTrackById(songId);
			if (source) {
				tracks = getTopTracksByArtist(source.artist || '', count);
			}
		}
		if (tracks.length === 0) {
			tracks = getRandomTracks(count);
		}
		return {
			data: {
				similarSongs: {
					song: tracks.map((t) => {
						const isStarred = isItemStarred(user.id, 'track', t.id);
						return trackToSubsonicSong(t, null, isStarred);
					})
				}
			}
		};
	},

	getSimilarSongs2: async (params, user) => {
		const count = parseInt(params.count, 10) || 50;
		const rawId = (params.id || '').toString().replace(/^[a-z]+-/, '');
		const songId = parseInt(rawId, 10);
		let tracks: Track[] = [];
		if (!isNaN(songId)) {
			const source = getTrackById(songId);
			if (source) {
				tracks = getTopTracksByArtist(source.artist || '', count);
			}
		}
		if (tracks.length === 0) {
			tracks = getRandomTracks(count);
		}
		return {
			data: {
				similarSongs2: {
					song: tracks.map((t) => {
						const isStarred = isItemStarred(user.id, 'track', t.id);
						return trackToSubsonicSong(t, null, isStarred);
					})
				}
			}
		};
	},

	getPlayQueue: async (_params, user) => {
		const q = getPlayQueue(user.id);
		let songs: any[] = [];
		if (q && q.trackIds.length > 0) {
			for (const trId of q.trackIds) {
				const tr = getTrackById(trId);
				if (tr) {
					const isStarred = isItemStarred(user.id, 'track', tr.id);
					songs.push(trackToSubsonicSong(tr, null, isStarred));
				}
			}
		}
		return {
			data: {
				playQueue: {
					current: q?.current ? q.current.toString() : undefined,
					position: q?.position || 0,
					changed: q?.changed || new Date().toISOString(),
					changedBy: user.username,
					entry: songs
				}
			}
		};
	},

	savePlayQueue: async (params, user) => {
		const current = params.current ? parseInt(params.current, 10) : null;
		const position = parseInt(params.position, 10) || 0;
		let ids: number[] = [];
		if (params.id) {
			const idList = Array.isArray(params.id) ? params.id : [params.id];
			ids = idList.map((id: string) => parseInt(id, 10)).filter((n: number) => !isNaN(n));
		}
		savePlayQueue(user.id, isNaN(current as any) ? null : current, position, ids);
		return { data: {} };
	},

	getSongs: async (params, user) => {
		const size = parseInt(params.size || params.count, 10) || 500;
		const offset = parseInt(params.offset, 10) || 0;
		const tracks = getAllTracksPaged(offset, size);
		return {
			data: {
				songs: {
					song: tracks.map((t) => {
						const isStarred = isItemStarred(user.id, 'track', t.id);
						return trackToSubsonicSong(t, null, isStarred);
					})
				}
			}
		};
	},

	search3: async (params, user) => {
		let rawQuery = (params.query ?? '').toString().trim();
		if (
			rawQuery === '*' ||
			rawQuery === '""' ||
			rawQuery === "''" ||
			rawQuery === '""' ||
			rawQuery === "''"
		) {
			rawQuery = '';
		}
		if (rawQuery.startsWith('"') && rawQuery.endsWith('"') && rawQuery.length >= 2) {
			rawQuery = rawQuery.slice(1, -1).trim();
		}
		const query = rawQuery;

		const artistCount = params.artistCount !== undefined ? parseInt(params.artistCount, 10) : 20;
		const artistOffset = params.artistOffset !== undefined ? parseInt(params.artistOffset, 10) : 0;
		const albumCount = params.albumCount !== undefined ? parseInt(params.albumCount, 10) : 20;
		const albumOffset = params.albumOffset !== undefined ? parseInt(params.albumOffset, 10) : 0;
		const songCount = params.songCount !== undefined ? parseInt(params.songCount, 10) : 50;
		const songOffset = params.songOffset !== undefined ? parseInt(params.songOffset, 10) : 0;

		let matchingArtists: any[] = [];
		let matchingAlbums: Album[] = [];
		let matchingTracks: Track[] = [];

		if (!query) {
			if (artistCount > 0) {
				matchingArtists = db.prepare(
					'SELECT artist as name, COUNT(id) as album_count FROM albums GROUP BY artist ORDER BY artist COLLATE NOCASE ASC LIMIT ? OFFSET ?'
				).all(artistCount, artistOffset) as any[];
			}

			if (albumCount > 0) {
				matchingAlbums = db.prepare(
					'SELECT a.*, (SELECT COUNT(*) FROM tracks WHERE album_id = a.id) as track_count FROM albums a ORDER BY a.title COLLATE NOCASE ASC LIMIT ? OFFSET ?'
				).all(albumCount, albumOffset) as Album[];
			}

			if (songCount > 0) {
				matchingTracks = getAllTracksPaged(songOffset, songCount);
			}
		} else {
			if (artistCount > 0) {
				matchingArtists = db.prepare(
					'SELECT artist as name, COUNT(id) as album_count FROM albums WHERE artist LIKE ? GROUP BY artist ORDER BY artist COLLATE NOCASE ASC LIMIT ? OFFSET ?'
				).all(`%${query}%`, artistCount, artistOffset) as any[];
			}

			if (albumCount > 0) {
				matchingAlbums = db.prepare(
					'SELECT a.*, (SELECT COUNT(*) FROM tracks WHERE album_id = a.id) as track_count FROM albums a WHERE a.title LIKE ? OR a.artist LIKE ? ORDER BY a.title COLLATE NOCASE ASC LIMIT ? OFFSET ?'
				).all(`%${query}%`, `%${query}%`, albumCount, albumOffset) as Album[];
			}

			if (songCount > 0) {
				matchingTracks = db.prepare(`
					SELECT t.*, a.title as album_title, a.artist as album_artist, a.cover_url as album_cover_url, a.release_year as album_year, a.genre as album_genre
					FROM tracks t
					JOIN albums a ON t.album_id = a.id
					WHERE t.title LIKE ? OR t.artist LIKE ? OR a.title LIKE ?
					ORDER BY t.title COLLATE NOCASE ASC
					LIMIT ? OFFSET ?
				`).all(`%${query}%`, `%${query}%`, `%${query}%`, songCount, songOffset) as Track[];
			}
		}

		return {
			data: {
				searchResult3: {
					artist: matchingArtists.map((art) => {
						const isStarred = isItemStarred(user.id, 'artist', art.name as any);
						const obj: Record<string, any> = {
							id: encodeArtistId(art.name),
							name: art.name,
							albumCount: art.album_count || 1,
							coverArt: `art-${encodeArtistId(art.name)}`,
							roles: ['artist']
						};
						if (isStarred) obj.starred = new Date().toISOString();
						return obj;
					}),
					album: matchingAlbums.map((a: Album) => {
						const isStarred = isItemStarred(user.id, 'album', a.id);
						return albumToSubsonicAlbum(a, undefined, isStarred);
					}),
					song: matchingTracks.map((t) => {
						const isStarred = isItemStarred(user.id, 'track', t.id);
						return trackToSubsonicSong(t, null, isStarred);
					})
				}
			}
		};
	},

	search2: async (params, user) => {
		const res = await (subsonicHandlers.search3 as any)(params, user);
		if (res.error) return res;
		return {
			data: {
				searchResult2: res.data?.searchResult3 || { artist: [], album: [], song: [] }
			}
		};
	},

	getStarred2: async (_params, user) => {
		const starred = getStarredItems(user.id);

		return {
			data: {
				starred2: {
					artist: starred.artistNames.map((name) => {
						const albums = getAlbumsByArtist(name);
						return {
							id: encodeArtistId(name),
							name,
							albumCount: albums.length,
							coverArt: `art-${encodeArtistId(name)}`,
							roles: ['artist'],
							starred: new Date().toISOString()
						};
					}),
					album: starred.albums.map((a) => albumToSubsonicAlbum(a, undefined, true)),
					song: starred.tracks.map((t) => trackToSubsonicSong(t, null, true))
				}
			}
		};
	},

	getStarred: async (_params, user) => {
		const starred = getStarredItems(user.id);
		return {
			data: {
				starred: {
					artist: starred.artistNames.map((name) => {
						const albums = getAlbumsByArtist(name);
						return {
							id: encodeArtistId(name),
							name,
							albumCount: albums.length,
							coverArt: `art-${encodeArtistId(name)}`,
							roles: ['artist'],
							starred: new Date().toISOString()
						};
					}),
					album: starred.albums.map((a) => albumToSubsonicAlbum(a, undefined, true)),
					song: starred.tracks.map((t) => trackToSubsonicSong(t, null, true))
				}
			}
		};
	},

	star: async (params, user) => {
		// Subsonic star can pass id (array or single), albumId, or artistId
		const trackIds = Array.isArray(params.id) ? params.id : params.id ? [params.id] : [];
		for (const tId of trackIds) {
			const num = parseInt(tId, 10);
			if (!isNaN(num)) starItem(user.id, 'track', num);
		}

		const albumIds = Array.isArray(params.albumId) ? params.albumId : params.albumId ? [params.albumId] : [];
		for (const aId of albumIds) {
			const num = parseInt(aId, 10);
			if (!isNaN(num)) starItem(user.id, 'album', num);
		}

		const artistIds = Array.isArray(params.artistId) ? params.artistId : params.artistId ? [params.artistId] : [];
		for (const artId of artistIds) {
			const name = decodeArtistId(artId);
			starItem(user.id, 'artist', name as any);
		}

		return { data: {} };
	},

	unstar: async (params, user) => {
		const trackIds = Array.isArray(params.id) ? params.id : params.id ? [params.id] : [];
		for (const tId of trackIds) {
			const num = parseInt(tId, 10);
			if (!isNaN(num)) unstarItem(user.id, 'track', num);
		}

		const albumIds = Array.isArray(params.albumId) ? params.albumId : params.albumId ? [params.albumId] : [];
		for (const aId of albumIds) {
			const num = parseInt(aId, 10);
			if (!isNaN(num)) unstarItem(user.id, 'album', num);
		}

		const artistIds = Array.isArray(params.artistId) ? params.artistId : params.artistId ? [params.artistId] : [];
		for (const artId of artistIds) {
			const name = decodeArtistId(artId);
			unstarItem(user.id, 'artist', name as any);
		}

		return { data: {} };
	},

	scrobble: async (params) => {
		const rawId = (params.id || '').toString().replace(/^[a-z]+-/, '');
		const songId = parseInt(rawId, 10);
		const submission = params.submission === 'true' || params.submission === true || params.submission === '1';

		if (!isNaN(songId) && submission) {
			recordTrackPlay(songId);
		}

		return { data: {} };
	},

	getPlaylists: async (params, user) => {
		const targetUserId = params.username
			? (db.prepare('SELECT id FROM users WHERE username = ?').get(params.username) as { id: number } | undefined)?.id || user.id
			: user.id;
		const playlists = getUserPlaylists(targetUserId);
		return {
			data: {
				playlists: {
					playlist: playlists.map((p) => ({
						id: p.id.toString(),
						name: p.name,
						comment: p.comment || undefined,
						owner: user.username,
						public: p.is_public === 1,
						songCount: p.song_count || 0,
						duration: Math.round((p.duration_ms || 0) / 1000),
						created: p.created_at,
						changed: p.updated_at,
						coverArt: `pl-${p.id}`
					}))
				}
			}
		};
	},

	getPlaylist: async (params) => {
		const playlistId = parseInt(params.id, 10);
		if (isNaN(playlistId)) {
			return { error: { code: SubsonicErrorCode.REQUIRED_PARAM_MISSING, message: "Valid 'id' is required" } };
		}

		const playlist = getPlaylistById(playlistId);
		if (!playlist) {
			return { error: { code: SubsonicErrorCode.DATA_NOT_FOUND, message: 'Playlist not found' } };
		}

		const tracks = getPlaylistTracks(playlistId);

		return {
			data: {
				playlist: {
					id: playlist.id.toString(),
					name: playlist.name,
					comment: playlist.comment || undefined,
					public: playlist.is_public === 1,
					songCount: tracks.length,
					duration: Math.round((playlist.duration_ms || 0) / 1000),
					created: playlist.created_at,
					changed: playlist.updated_at,
					coverArt: `pl-${playlist.id}`,
					entry: tracks.map((t) => trackToSubsonicSong(t, null))
				}
			}
		};
	},

	createPlaylist: async (params, user) => {
		const rawSongIds = params.songId ? (Array.isArray(params.songId) ? params.songId : [params.songId]) : [];
		const songIds = rawSongIds.map((s: string) => parseInt(s, 10)).filter((n: number) => !isNaN(n));

		const existingId = params.playlistId ? parseInt(params.playlistId, 10) : null;
		let playlistId: number;

		if (existingId && !isNaN(existingId)) {
			// Updating / replacing an existing playlist (Symfonium full sync)
			const existing = getPlaylistById(existingId);
			if (!existing) {
				return { error: { code: SubsonicErrorCode.DATA_NOT_FOUND, message: 'Playlist not found' } };
			}
			playlistId = existingId;
			if (params.name?.trim()) {
				updatePlaylist(playlistId, params.name.trim());
			}
			replacePlaylistTracks(playlistId, songIds);
		} else {
			// Creating a new playlist
			const name = params.name?.trim();
			if (!name) {
				return { error: { code: SubsonicErrorCode.REQUIRED_PARAM_MISSING, message: "Parameter 'name' is required" } };
			}
			playlistId = createPlaylist(user.id, name, undefined, songIds);
		}

		const playlist = getPlaylistById(playlistId);
		const tracks = getPlaylistTracks(playlistId);

		return {
			data: {
				playlist: {
					id: playlistId.toString(),
					name: playlist?.name || params.name || '',
					comment: playlist?.comment || undefined,
					owner: user.username,
					public: playlist?.is_public === 1,
					songCount: tracks.length,
					duration: Math.round((playlist?.duration_ms || 0) / 1000),
					created: playlist?.created_at,
					changed: playlist?.updated_at,
					coverArt: `pl-${playlistId}`,
					entry: tracks.map((t) => trackToSubsonicSong(t, null))
				}
			}
		};
	},

	updatePlaylist: async (params) => {
		const playlistId = parseInt(params.playlistId || params.id, 10);
		if (isNaN(playlistId)) {
			return { error: { code: SubsonicErrorCode.REQUIRED_PARAM_MISSING, message: "Valid 'playlistId' is required" } };
		}

		const name = params.name?.trim();
		const comment = params.comment?.trim();
		const isPublic =
			params.public !== undefined
				? params.public === true || params.public === 'true' || params.public === '1'
					? 1
					: 0
				: undefined;

		const rawAddIds = params.songIdToAdd ? (Array.isArray(params.songIdToAdd) ? params.songIdToAdd : [params.songIdToAdd]) : [];
		const trackIdsToAdd = rawAddIds.map((s: string) => parseInt(s, 10)).filter((n: number) => !isNaN(n));

		const rawRemoveIndices = params.songIndexToRemove ? (Array.isArray(params.songIndexToRemove) ? params.songIndexToRemove : [params.songIndexToRemove]) : [];
		const trackIndicesToRemove = rawRemoveIndices.map((s: string) => parseInt(s, 10)).filter((n: number) => !isNaN(n));

		updatePlaylist(playlistId, name, comment, trackIdsToAdd, trackIndicesToRemove, isPublic);

		return { data: {} };
	},

	deletePlaylist: async (params) => {
		const playlistId = parseInt(params.id || params.playlistId, 10);
		if (!isNaN(playlistId)) {
			deletePlaylist(playlistId);
		}
		return { data: {} };
	},

	getOpenSubsonicExtensions: async () => {
		return {
			data: {
				openSubsonicExtensions: [
					{
						name: 'songLyrics',
						versions: [1]
					},
					{
						name: 'topSongsByArtistId',
						versions: [1]
					}
				]
			}
		};
	},

	getLyricsBySongId: async (params) => {
		const rawId = (params.id || '').toString().replace(/^[a-z]+-/, '');
		const songId = parseInt(rawId, 10);
		if (isNaN(songId)) {
			return { error: { code: SubsonicErrorCode.REQUIRED_PARAM_MISSING, message: "Valid 'id' is required" } };
		}

		const track = getTrackById(songId);
		if (!track) {
			return { error: { code: SubsonicErrorCode.DATA_NOT_FOUND, message: 'Song not found' } };
		}

		if (track.lyrics === 'instrumental' || track.censorship === 'instrumental') {
			return {
				data: {
					lyricsList: {
						structuredLyrics: []
					}
				}
			};
		}

		let lyricsText = track.lyrics_text || '';

		// Attempt disk companion read
		if (track.file_path) {
			const resolvedPath = resolveTrackFilePath(track);
			if (resolvedPath && fs.existsSync(resolvedPath)) {
				const companion = findCompanionLyricsFile(resolvedPath, track.title);
				if (companion && companion.content) {
					lyricsText = companion.content;
				}
			}
		}

		lyricsText = stripLrcMetadataHeaders(lyricsText);

		if (!lyricsText.trim()) {
			return {
				data: {
					lyricsList: {
						structuredLyrics: []
					}
				}
			};
		}

		// If instrumental lyrics text, OpenSubsonic clients (Symfonium/Feishin) expect empty structuredLyrics
		if (isInstrumentalLyrics(lyricsText)) {
			return {
				data: {
					lyricsList: {
						structuredLyrics: []
					}
				}
			};
		}

		// Parse lines (support multi-timestamp and synced vs unsynced)
		const lines = lyricsText.split(/\r?\n/);
		const timedLines: Array<{ start: number; value: string }> = [];
		const plainLines: string[] = [];
		let isSynced = false;

		const timeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{2,3}))?\]/g;

		for (const rawLine of lines) {
			const line = rawLine.trim();
			if (!line) continue;

			// Skip any leftover metadata tags like [ti:...] or empty brackets []
			if (/^\[[a-zA-Z_]{1,15}:[^\]]*\]/i.test(line) || /^\[\s*\]$/.test(line)) {
				continue;
			}

			const matches = [...line.matchAll(timeRegex)];
			if (matches.length > 0) {
				isSynced = true;
				const text = line.replace(timeRegex, '').trim();
				for (const match of matches) {
					const min = parseInt(match[1], 10);
					const sec = parseInt(match[2], 10);
					const msStr = match[3] || '0';
					const ms = parseInt(msStr.padEnd(3, '0').slice(0, 3), 10);
					const totalMs = min * 60000 + sec * 1000 + ms;
					timedLines.push({ start: totalMs, value: text });
				}
			} else {
				plainLines.push(line);
			}
		}

		if (isSynced) {
			timedLines.sort((a, b) => a.start - b.start);
		}

		const resultLines = isSynced
			? timedLines
			: plainLines.map((l) => ({ start: 0, value: l }));

		return {
			data: {
				lyricsList: {
					structuredLyrics: [
						{
							lang: 'eng',
							synced: isSynced,
							line: resultLines
						}
					]
				}
			}
		};
	},

	getLyrics: async (params) => {
		const artist = params.artist?.trim();
		const title = params.title?.trim();

		let track: Track | undefined;
		if (artist && title) {
			track = db.prepare(
				'SELECT * FROM tracks WHERE title LIKE ? AND (artist LIKE ? OR (artist IS NULL AND album_id IN (SELECT id FROM albums WHERE artist LIKE ?))) LIMIT 1'
			).get(`%${title}%`, `%${artist}%`, `%${artist}%`) as Track | undefined;
		}

		let lyricsText = track?.lyrics_text || '';
		if (track) {
			const resolvedPath = resolveTrackFilePath(track);
			if (resolvedPath && fs.existsSync(resolvedPath)) {
				const companion = findCompanionLyricsFile(resolvedPath, track.title);
				if (companion && companion.content) {
					lyricsText = companion.content;
				}
			}
		}

		lyricsText = stripLrcMetadataHeaders(lyricsText);

		return {
			data: {
				lyrics: {
					artist: artist || '',
					title: title || '',
					content: lyricsText
				}
			}
		};
	},

	jukeboxControl: async (params) => {
		return {
			data: {
				jukeboxStatus: {
					currentIndex: 0,
					playing: false,
					gain: 1.0,
					position: 0
				}
			}
		};
	}
};
