import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import {
	APP_NAME,
	APP_VERSION,
	CURRENT_SCHEMA_VERSION,
	MIN_COMPATIBLE_VERSION,
	MIN_COMPATIBLE_SCHEMA_VERSION
} from '$lib/version.js';
import type {
	Album,
	Track,
	CollectionStats,
	AudioFormat,
	QualityRating,
	CensorshipStatus,
	LyricsStatus,
	FixerRules,
	SearchFilters,
	Playlist
} from '$lib/types/index.js';
import { parseSearchQuery } from '$lib/search.js';

/**
 * Version Lifecycle & Migration Engine
 * Implements N-1 Stepping Stone Upgrade Policy:
 * - v1.6: Legacy database (trackvault.db)
 * - v1.7: Bridge release: auto-migrates trackvault.db to traxvault.db with safety backup
 * - v2.0: Requires v1.7+ (schema >= 170). Direct upgrade from v1.6 is rejected.
 */
function prepareDatabase(): { dbPath: string; migratedFromLegacy: boolean } {
	const baseDir = process.env.DATA_DIR || './data';
	const newDbPath = path.resolve(baseDir, 'traxvault.db');
	const legacyDbPath = path.resolve(baseDir, 'trackvault.db');

	if (!fs.existsSync(baseDir)) {
		fs.mkdirSync(baseDir, { recursive: true });
	}

	// 1. If traxvault.db exists, it is the primary database
	if (fs.existsSync(newDbPath)) {
		return { dbPath: newDbPath, migratedFromLegacy: false };
	}

	// 2. If legacy trackvault.db exists, check version compatibility
	if (fs.existsSync(legacyDbPath)) {
		// Stepping Stone Policy Check:
		// If MIN_COMPATIBLE_SCHEMA_VERSION is greater than 160 (e.g. in v2.0+),
		// direct upgrade from v1.6 is strictly prohibited!
		if (MIN_COMPATIBLE_SCHEMA_VERSION > 160) {
			const fatalMsg =
				`\n====================================================================\n` +
				`[FATAL ERROR] Incompatible database detected!\n` +
				`Found legacy 'trackvault.db' (v1.6).\n` +
				`${APP_NAME} v${APP_VERSION} requires an existing database from at least v${MIN_COMPATIBLE_VERSION}.\n` +
				`Direct upgrades from v1.6 to v${APP_VERSION} are not supported to prevent data corruption.\n\n` +
				`PLEASE FOLLOW THIS STEPPING-STONE UPGRADE:\n` +
				`1. Upgrade to Trax Vault v1.7 first so it can migrate your database.\n` +
				`2. Then upgrade to Trax Vault v${APP_VERSION}.\n` +
				`====================================================================\n`;
			console.error(fatalMsg);
			throw new Error(fatalMsg);
		}

		// Backward-compatible v1.6 -> v1.7 Migration Bridge:
		console.log(`[Migration] Detected legacy v1.6 database (${legacyDbPath}).`);
		console.log(`[Migration] Starting automatic upgrade to v1.7 (${newDbPath})...`);

		try {
			// Step A: Checkpoint and flush WAL to ensure main database file is complete
			try {
				const tempLegacyDb = new Database(legacyDbPath);
				tempLegacyDb.pragma('wal_checkpoint(TRUNCATE)');
				tempLegacyDb.close();
			} catch (walErr) {
				console.warn('[Migration] Notice during legacy WAL checkpoint:', walErr);
			}

			// Step B: Copy trackvault.db to traxvault.db
			fs.copyFileSync(legacyDbPath, newDbPath);

			// Step C: Safely archive legacy database files as .bak
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const backupLegacyDb = path.resolve(baseDir, `trackvault.db.v1.6.${timestamp}.bak`);
			fs.renameSync(legacyDbPath, backupLegacyDb);

			// Also archive any remaining -wal or -shm if they exist
			const legacyWal = `${legacyDbPath}-wal`;
			const legacyShm = `${legacyDbPath}-shm`;
			if (fs.existsSync(legacyWal)) {
				fs.renameSync(legacyWal, `${backupLegacyDb}-wal`);
			}
			if (fs.existsSync(legacyShm)) {
				fs.renameSync(legacyShm, `${backupLegacyDb}-shm`);
			}

			console.log(
				`[Migration] Successfully migrated database to ${newDbPath}!\n` +
				`[Migration] Safety backup saved at ${backupLegacyDb}`
			);

			return { dbPath: newDbPath, migratedFromLegacy: true };
		} catch (migErr: any) {
			console.error('[Migration Error] Failed to migrate legacy database:', migErr);
			throw new Error(`Failed to migrate legacy trackvault.db: ${migErr.message}`);
		}
	}

	// 3. Fresh installation: create traxvault.db
	return { dbPath: newDbPath, migratedFromLegacy: false };
}

const { dbPath: DB_PATH, migratedFromLegacy } = prepareDatabase();

export const db = new Database(DB_PATH);

// Configure SQLite for high performance and integrity
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

// Initialize schema
db.exec(`
	CREATE TABLE IF NOT EXISTS albums (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		musicbrainz_id TEXT,
		title TEXT NOT NULL,
		artist TEXT NOT NULL,
		release_year INTEGER,
		genre TEXT,
		cover_url TEXT,
		media_type TEXT,
		notes TEXT,
		fixer_rules TEXT,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS tracks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
		disc_number INTEGER NOT NULL DEFAULT 1,
		track_number INTEGER NOT NULL,
		title TEXT NOT NULL,
		artist TEXT,
		duration_ms INTEGER,
		format TEXT NOT NULL DEFAULT 'FLAC',
		bitrate_kbps INTEGER,
		sample_rate INTEGER,
		bits_per_sample INTEGER,
		quality_rating TEXT NOT NULL DEFAULT 'good',
		censorship TEXT NOT NULL DEFAULT 'explicit',
		lyrics TEXT NOT NULL DEFAULT 'none',
		needs_attention INTEGER NOT NULL DEFAULT 0,
		manually_checked INTEGER NOT NULL DEFAULT 0,
		play_count INTEGER NOT NULL DEFAULT 0,
		last_played_at TEXT,
		notes TEXT,
		file_path TEXT,
		lyrics_text TEXT,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		salt TEXT NOT NULL,
		subsonic_secret TEXT,
		role TEXT NOT NULL DEFAULT 'admin',
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS sessions (
		id TEXT PRIMARY KEY,
		user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		expires_at TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS starred_items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		item_type TEXT NOT NULL,
		item_id INTEGER NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		UNIQUE(user_id, item_type, item_id)
	);

	CREATE TABLE IF NOT EXISTS playlists (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		name TEXT NOT NULL,
		comment TEXT,
		is_public INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS playlist_tracks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
		track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
		track_order INTEGER NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE INDEX IF NOT EXISTS idx_tracks_album_id ON tracks(album_id);
	CREATE INDEX IF NOT EXISTS idx_tracks_format ON tracks(format);
	CREATE INDEX IF NOT EXISTS idx_tracks_censorship ON tracks(censorship);
	CREATE INDEX IF NOT EXISTS idx_tracks_lyrics ON tracks(lyrics);
	CREATE INDEX IF NOT EXISTS idx_tracks_needs_attention ON tracks(needs_attention);
	CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist);
	CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
	CREATE INDEX IF NOT EXISTS idx_starred_user ON starred_items(user_id);
	CREATE INDEX IF NOT EXISTS idx_starred_item ON starred_items(item_type, item_id);
	CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id);
	CREATE INDEX IF NOT EXISTS idx_playlist_tracks ON playlist_tracks(playlist_id);

	CREATE TABLE IF NOT EXISTS play_queues (
		user_id INTEGER PRIMARY KEY,
		current_track_id INTEGER,
		position INTEGER NOT NULL DEFAULT 0,
		track_ids TEXT NOT NULL DEFAULT '[]',
		changed_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS system_metadata (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL,
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
`);

// Idempotent column migrations for existing databases
function columnExists(table: string, column: string): boolean {
	const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
	return columns.some((c) => c.name === column);
}

if (!columnExists('albums', 'fixer_rules')) {
	db.exec(`ALTER TABLE albums ADD COLUMN fixer_rules TEXT;`);
}

if (!columnExists('tracks', 'manually_checked')) {
	db.exec(`ALTER TABLE tracks ADD COLUMN manually_checked INTEGER NOT NULL DEFAULT 0;`);
}

if (!columnExists('tracks', 'file_path')) {
	db.exec(`ALTER TABLE tracks ADD COLUMN file_path TEXT;`);
}

if (!columnExists('tracks', 'lyrics_text')) {
	db.exec(`ALTER TABLE tracks ADD COLUMN lyrics_text TEXT;`);
}

if (!columnExists('tracks', 'bitrate_kbps')) {
	db.exec(`ALTER TABLE tracks ADD COLUMN bitrate_kbps INTEGER;`);
}

if (!columnExists('tracks', 'sample_rate')) {
	db.exec(`ALTER TABLE tracks ADD COLUMN sample_rate INTEGER;`);
}

if (!columnExists('tracks', 'bits_per_sample')) {
	db.exec(`ALTER TABLE tracks ADD COLUMN bits_per_sample INTEGER;`);
}

if (!columnExists('tracks', 'play_count')) {
	db.exec(`ALTER TABLE tracks ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0;`);
}

if (!columnExists('tracks', 'last_played_at')) {
	db.exec(`ALTER TABLE tracks ADD COLUMN last_played_at TEXT;`);
}

if (!columnExists('users', 'subsonic_secret')) {
	db.exec(`ALTER TABLE users ADD COLUMN subsonic_secret TEXT;`);
}

db.exec(`CREATE INDEX IF NOT EXISTS idx_tracks_manually_checked ON tracks(manually_checked);`);

// System version tracking & user_version stamping
try {
	const currentDbVersion = db.pragma('user_version', { simple: true }) as number;
	if (currentDbVersion < CURRENT_SCHEMA_VERSION) {
		db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
	}

	const upsertMetadata = db.prepare(`
		INSERT INTO system_metadata (key, value, updated_at) 
		VALUES (?, ?, datetime('now')) 
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
	`);

	upsertMetadata.run('app_version', APP_VERSION);
	upsertMetadata.run('schema_version', CURRENT_SCHEMA_VERSION.toString());
	upsertMetadata.run('min_compatible_version', MIN_COMPATIBLE_VERSION);

	if (migratedFromLegacy) {
		upsertMetadata.run('migrated_from', '1.6.0');
		upsertMetadata.run('migrated_at', new Date().toISOString());
	}
} catch (metaErr) {
	console.warn('[DB] Metadata version stamp notice:', metaErr);
}

export function getSystemMetadata(): Record<string, string> {
	try {
		const rows = db.prepare('SELECT key, value FROM system_metadata').all() as Array<{ key: string; value: string }>;
		const metadata: Record<string, string> = {};
		for (const row of rows) {
			metadata[row.key] = row.value;
		}
		return metadata;
	} catch {
		return {};
	}
}

// Backfill missing file_path for existing imported tracks
try {
	const nullTracks = db.prepare(`
		SELECT t.id, t.notes as track_notes, a.notes as album_notes 
		FROM tracks t 
		JOIN albums a ON t.album_id = a.id 
		WHERE t.file_path IS NULL
	`).all() as Array<{ id: number; track_notes: string | null; album_notes: string | null }>;

	if (nullTracks.length > 0) {
		const updateTrackPath = db.prepare(`UPDATE tracks SET file_path = ? WHERE id = ?`);
		const musicDir = process.env.MUSIC_DIR ? path.resolve(process.env.MUSIC_DIR) : path.resolve('./music');

		for (const tr of nullTracks) {
			if (!tr.track_notes || !tr.album_notes) continue;
			if (!tr.track_notes.startsWith('Imported from: ') || !tr.album_notes.startsWith('Imported from local library folder: ')) continue;

			const filename = tr.track_notes.replace('Imported from: ', '').trim();
			const folderPath = tr.album_notes.replace('Imported from local library folder: ', '').trim();

			// Test candidate paths on host/container
			const candidates = [
				path.join(folderPath, filename),
				path.join(musicDir, folderPath.replace(/^\/music\/?/, ''), filename),
				path.join(musicDir, filename)
			];

			for (const cand of candidates) {
				if (fs.existsSync(cand)) {
					updateTrackPath.run(cand, tr.id);
					break;
				}
			}
		}
	}
} catch (err) {
	console.warn('Track path backfill notice:', err);
}

/**
 * Helper to determine if a track needs attention according to album or global fixer rules
 */
export function computeNeedsAttention(
	quality: QualityRating,
	censorship: CensorshipStatus,
	lyrics: LyricsStatus,
	format: AudioFormat = 'FLAC',
	rules?: FixerRules | null
): number {
	// Quality checks
	const badQuality = rules?.flag_bad_quality ?? true;
	const needsUpgrade = rules?.flag_needs_upgrade ?? true;
	if (badQuality && quality === 'bad') return 1;
	if (needsUpgrade && quality === 'needs_upgrade') return 1;

	// Format checks (e.g. if user decides .mp3 is too bad or wants lossless only)
	if (rules?.flag_lossy) {
		const isLossy = ['MP3_320', 'MP3_V0', 'MP3_192', 'MP3_128', 'AAC_256', 'OGG', 'OTHER'].includes(format);
		if (isLossy) return 1;
	}
	if (rules?.flag_mp3) {
		if (format.startsWith('MP3')) return 1;
	}

	// Censorship checks
	const flagCensored = rules?.flag_censored ?? true;
	if (flagCensored && censorship === 'censored') return 1;
	const flagClean = rules?.flag_clean ?? false;
	if (flagClean && censorship === 'clean_original') return 1;

	// Lyrics checks
	const flagMissing = rules?.flag_missing_lyrics ?? true;
	if (flagMissing && lyrics === 'missing') return 1;
	const flagUnsynced = rules?.flag_unsynced_lyrics ?? true;
	if (flagUnsynced && lyrics === 'unsynced_lrc') return 1;
	const flagPlain = rules?.flag_plain_lyrics ?? false;
	if (flagPlain && lyrics === 'plain_txt') return 1;

	return 0;
}

export function getAlbumFixerRules(albumId: number): FixerRules | null {
	const row = db.prepare('SELECT fixer_rules FROM albums WHERE id = ?').get(albumId) as { fixer_rules?: string } | undefined;
	if (row?.fixer_rules) {
		try {
			return JSON.parse(row.fixer_rules);
		} catch {
			return null;
		}
	}
	return null;
}

export function updateAlbumFixerRules(
	albumId: number,
	rules: FixerRules,
	applyToAll: boolean = false
): { album: Album; tracks: Track[] } | null {
	const existing = getAlbumById(albumId);
	if (!existing) {
		return null;
	}

	const rulesJson = JSON.stringify(rules);

	if (applyToAll) {
		const updateAlbumStmt = db.prepare("UPDATE albums SET fixer_rules = ?, updated_at = datetime('now')");
		const allTracks = db.prepare('SELECT * FROM tracks').all() as Track[];
		const updateTrackStmt = db.prepare("UPDATE tracks SET needs_attention = ?, updated_at = datetime('now') WHERE id = ?");
		const tx = db.transaction(() => {
			updateAlbumStmt.run(rulesJson);
			for (const t of allTracks) {
				const na = computeNeedsAttention(t.quality_rating, t.censorship, t.lyrics, t.format, rules);
				updateTrackStmt.run(na, t.id);
			}
		});
		tx();
	} else {
		const updateAlbumStmt = db.prepare("UPDATE albums SET fixer_rules = ?, updated_at = datetime('now') WHERE id = ?");
		const tracks = db.prepare('SELECT * FROM tracks WHERE album_id = ?').all(albumId) as Track[];
		const updateTrackStmt = db.prepare("UPDATE tracks SET needs_attention = ?, updated_at = datetime('now') WHERE id = ?");
		const tx = db.transaction(() => {
			updateAlbumStmt.run(rulesJson, albumId);
			for (const t of tracks) {
				const na = computeNeedsAttention(t.quality_rating, t.censorship, t.lyrics, t.format, rules);
				updateTrackStmt.run(na, t.id);
			}
		});
		tx();
	}

	return getAlbumById(albumId);
}

export function getStats(): CollectionStats {
	const albumCount = (db.prepare('SELECT COUNT(*) as count FROM albums').get() as { count: number }).count;
	const trackCount = (db.prepare('SELECT COUNT(*) as count FROM tracks').get() as { count: number }).count;

	if (trackCount === 0) {
		return {
			total_albums: albumCount,
			total_tracks: 0,
			flac_count: 0,
			mp3_count: 0,
			other_format_count: 0,
			bad_quality_count: 0,
			censored_count: 0,
			missing_lyrics_count: 0,
			synced_lyrics_count: 0,
			unsynced_lyrics_count: 0,
			plain_lyrics_count: 0,
			total_needs_attention: 0,
			health_score: 100
		};
	}

	const formatCounts = db.prepare(`
		SELECT 
			SUM(CASE WHEN format IN ('FLAC', 'ALAC', 'WAV', 'AIFF') THEN 1 ELSE 0 END) as flac_count,
			SUM(CASE WHEN format LIKE 'MP3%' THEN 1 ELSE 0 END) as mp3_count,
			SUM(CASE WHEN format NOT IN ('FLAC', 'ALAC', 'WAV', 'AIFF') AND format NOT LIKE 'MP3%' THEN 1 ELSE 0 END) as other_count
		FROM tracks
	`).get() as { flac_count: number; mp3_count: number; other_count: number };

	const issueCounts = db.prepare(`
		SELECT
			SUM(CASE WHEN quality_rating IN ('bad', 'needs_upgrade') THEN 1 ELSE 0 END) as bad_quality,
			SUM(CASE WHEN censorship = 'censored' THEN 1 ELSE 0 END) as censored,
			SUM(CASE WHEN lyrics = 'missing' THEN 1 ELSE 0 END) as missing_lyrics,
			SUM(CASE WHEN lyrics = 'synced_lrc' THEN 1 ELSE 0 END) as synced_lyrics,
			SUM(CASE WHEN lyrics = 'unsynced_lrc' THEN 1 ELSE 0 END) as unsynced_lyrics,
			SUM(CASE WHEN lyrics = 'plain_txt' THEN 1 ELSE 0 END) as plain_lyrics,
			SUM(CASE WHEN needs_attention = 1 THEN 1 ELSE 0 END) as needs_attention,
			SUM(CASE WHEN manually_checked = 1 THEN 1 ELSE 0 END) as checked_tracks
		FROM tracks
	`).get() as {
		bad_quality: number;
		censored: number;
		missing_lyrics: number;
		synced_lyrics: number;
		unsynced_lyrics: number;
		plain_lyrics: number;
		needs_attention: number;
		checked_tracks: number;
	};

	// Health score is percentage of tracks with NO issues
	const goodTracks = Math.max(0, trackCount - (issueCounts.needs_attention || 0));
	const healthScore = Math.round((goodTracks / trackCount) * 100);

	return {
		total_albums: albumCount,
		total_tracks: trackCount,
		flac_count: formatCounts.flac_count || 0,
		mp3_count: formatCounts.mp3_count || 0,
		other_format_count: formatCounts.other_count || 0,
		bad_quality_count: issueCounts.bad_quality || 0,
		censored_count: issueCounts.censored || 0,
		missing_lyrics_count: issueCounts.missing_lyrics || 0,
		synced_lyrics_count: issueCounts.synced_lyrics || 0,
		unsynced_lyrics_count: issueCounts.unsynced_lyrics || 0,
		plain_lyrics_count: issueCounts.plain_lyrics || 0,
		checked_tracks_count: issueCounts.checked_tracks || 0,
		total_needs_attention: issueCounts.needs_attention || 0,
		health_score: healthScore
	};
}

export function getAlbums(searchQuery?: string, filter?: string, options?: SearchFilters): Album[] {
	const parsed = parseSearchQuery(searchQuery || '');
	const effectiveFormat = options?.format || parsed.format;
	const effectiveNotFormat = options?.notFormat || parsed.notFormat;
	const effectiveCensorship = options?.censorship || parsed.censorship;
	const effectiveNotCensorship = options?.notCensorship || parsed.notCensorship;
	const effectiveLyrics = options?.lyrics || parsed.lyrics;
	const effectiveNotLyrics = options?.notLyrics || parsed.notLyrics;
	const effectiveQuality = options?.quality || parsed.quality;
	const effectiveChecked = options?.manuallyChecked !== undefined ? options.manuallyChecked : parsed.manuallyChecked;
	const effectiveText = options?.search !== undefined ? options.search : parsed.search;

	let sql = `
		SELECT 
			a.*,
			COUNT(t.id) as track_count,
			SUM(CASE WHEN t.quality_rating IN ('bad', 'needs_upgrade') THEN 1 ELSE 0 END) as bad_quality_count,
			SUM(CASE WHEN t.censorship = 'censored' THEN 1 ELSE 0 END) as censored_count,
			SUM(CASE WHEN t.lyrics = 'missing' THEN 1 ELSE 0 END) as missing_lyrics_count,
			SUM(CASE WHEN t.manually_checked = 1 THEN 1 ELSE 0 END) as checked_count
	`;

	const trackConditions: string[] = [];
	const trackParams: (string | number)[] = [];

	if (effectiveChecked !== undefined) {
		trackConditions.push("t2.manually_checked = ?");
		trackParams.push(effectiveChecked);
	}

	if (effectiveNotFormat) {
		if (effectiveNotFormat === 'FLAC') {
			trackConditions.push("t2.format != 'FLAC'");
		} else if (effectiveNotFormat === 'MP3') {
			trackConditions.push("t2.format NOT LIKE 'MP3%'");
		} else {
			trackConditions.push("t2.format != ?");
			trackParams.push(effectiveNotFormat);
		}
	}

	if (effectiveFormat) {
		if (effectiveFormat === 'MP3') {
			trackConditions.push("t2.format LIKE 'MP3%'");
		} else {
			trackConditions.push("t2.format = ?");
			trackParams.push(effectiveFormat);
		}
	}

	if (effectiveCensorship) {
		trackConditions.push("t2.censorship = ?");
		trackParams.push(effectiveCensorship);
	}
	if (effectiveNotCensorship) {
		trackConditions.push("t2.censorship != ?");
		trackParams.push(effectiveNotCensorship);
	}

	if (effectiveLyrics) {
		trackConditions.push("t2.lyrics = ?");
		trackParams.push(effectiveLyrics);
	}
	if (effectiveNotLyrics) {
		trackConditions.push("t2.lyrics != ?");
		trackParams.push(effectiveNotLyrics);
	}

	if (effectiveQuality) {
		if (effectiveQuality === 'bad') {
			trackConditions.push("t2.quality_rating IN ('bad', 'needs_upgrade')");
		} else if (effectiveQuality === 'good') {
			trackConditions.push("t2.quality_rating IN ('good', 'perfect')");
		} else {
			trackConditions.push("t2.quality_rating = ?");
			trackParams.push(effectiveQuality);
		}
	}

	const selectParams: (string | number)[] = [];
	const whereParams: (string | number)[] = [];

	if (trackConditions.length > 0) {
		sql += `, (SELECT COUNT(*) FROM tracks t2 WHERE t2.album_id = a.id AND ${trackConditions.join(' AND ')}) as matched_tracks_count`;
		selectParams.push(...trackParams);
	}

	sql += `
		FROM albums a
		LEFT JOIN tracks t ON t.album_id = a.id
	`;

	const conditions: string[] = [];

	if (trackConditions.length > 0) {
		const subConds = trackConditions.map((c) => c.replace(/t2\./g, ''));
		conditions.push(`a.id IN (SELECT album_id FROM tracks WHERE ${subConds.join(' AND ')})`);
		whereParams.push(...trackParams);
	}

	if (effectiveText && effectiveText.trim()) {
		conditions.push('(a.title LIKE ? OR a.artist LIKE ? OR a.genre LIKE ? OR a.id IN (SELECT album_id FROM tracks WHERE title LIKE ? OR artist LIKE ?))');
		const q = `%${effectiveText.trim()}%`;
		whereParams.push(q, q, q, q, q);
	}

	if (filter === 'needs_attention') {
		conditions.push(`a.id IN (SELECT album_id FROM tracks WHERE needs_attention = 1)`);
	} else if (filter === 'bad_quality') {
		conditions.push(`a.id IN (SELECT album_id FROM tracks WHERE quality_rating IN ('bad', 'needs_upgrade'))`);
	} else if (filter === 'censored') {
		conditions.push(`a.id IN (SELECT album_id FROM tracks WHERE censorship = 'censored')`);
	} else if (filter === 'missing_lyrics') {
		conditions.push(`a.id IN (SELECT album_id FROM tracks WHERE lyrics = 'missing')`);
	} else if (filter === 'unsynced_lyrics') {
		conditions.push(`a.id IN (SELECT album_id FROM tracks WHERE lyrics = 'unsynced_lrc')`);
	} else if (filter === 'all_good') {
		conditions.push(`a.id NOT IN (SELECT album_id FROM tracks WHERE needs_attention = 1) AND a.id IN (SELECT album_id FROM tracks)`);
	} else if (filter === 'unverified') {
		conditions.push(`a.id IN (SELECT album_id FROM tracks WHERE manually_checked = 0)`);
	} else if (filter === 'verified') {
		conditions.push(`a.id NOT IN (SELECT album_id FROM tracks WHERE manually_checked = 0) AND a.id IN (SELECT album_id FROM tracks)`);
	}

	if (conditions.length > 0) {
		sql += ` WHERE ` + conditions.join(' AND ');
	}

	sql += ` GROUP BY a.id ORDER BY a.artist COLLATE NOCASE ASC, a.release_year ASC, a.title COLLATE NOCASE ASC`;

	const finalParams = [...selectParams, ...whereParams];
	const albums = db.prepare(sql).all(...finalParams) as Album[];
	for (const alb of albums) {
		if (alb.fixer_rules) {
			try {
				alb.parsed_fixer_rules = JSON.parse(alb.fixer_rules);
			} catch {}
		}
	}
	return albums;
}

export function searchVaultTracks(
	searchQuery?: string,
	filters?: SearchFilters,
	limit: number = 150,
	offset: number = 0
): { tracks: Track[]; total: number } {
	const parsed = parseSearchQuery(searchQuery || '');
	const effectiveFormat = filters?.format || parsed.format;
	const effectiveNotFormat = filters?.notFormat || parsed.notFormat;
	const effectiveCensorship = filters?.censorship || parsed.censorship;
	const effectiveNotCensorship = filters?.notCensorship || parsed.notCensorship;
	const effectiveLyrics = filters?.lyrics || parsed.lyrics;
	const effectiveNotLyrics = filters?.notLyrics || parsed.notLyrics;
	const effectiveQuality = filters?.quality || parsed.quality;
	const effectiveChecked = filters?.manuallyChecked !== undefined ? filters.manuallyChecked : parsed.manuallyChecked;
	const effectiveText = filters?.search !== undefined ? filters.search : parsed.search;

	let sql = `
		SELECT 
			t.*,
			a.title as album_title,
			a.artist as album_artist,
			a.cover_url as album_cover_url,
			a.release_year as album_year
		FROM tracks t
		JOIN albums a ON a.id = t.album_id
	`;
	let countSql = `
		SELECT COUNT(*) as count
		FROM tracks t
		JOIN albums a ON a.id = t.album_id
	`;

	const conditions: string[] = [];
	const params: (string | number)[] = [];

	if (effectiveChecked !== undefined) {
		conditions.push("t.manually_checked = ?");
		params.push(effectiveChecked);
	}

	if (effectiveNotFormat) {
		if (effectiveNotFormat === 'FLAC') {
			conditions.push("t.format != 'FLAC'");
		} else if (effectiveNotFormat === 'MP3') {
			conditions.push("t.format NOT LIKE 'MP3%'");
		} else {
			conditions.push("t.format != ?");
			params.push(effectiveNotFormat);
		}
	}

	if (effectiveFormat) {
		if (effectiveFormat === 'MP3') {
			conditions.push("t.format LIKE 'MP3%'");
		} else {
			conditions.push("t.format = ?");
			params.push(effectiveFormat);
		}
	}

	if (effectiveCensorship) {
		conditions.push("t.censorship = ?");
		params.push(effectiveCensorship);
	}
	if (effectiveNotCensorship) {
		conditions.push("t.censorship != ?");
		params.push(effectiveNotCensorship);
	}

	if (effectiveLyrics) {
		conditions.push("t.lyrics = ?");
		params.push(effectiveLyrics);
	}
	if (effectiveNotLyrics) {
		conditions.push("t.lyrics != ?");
		params.push(effectiveNotLyrics);
	}

	if (effectiveQuality) {
		if (effectiveQuality === 'bad') {
			conditions.push("t.quality_rating IN ('bad', 'needs_upgrade')");
		} else if (effectiveQuality === 'good') {
			conditions.push("t.quality_rating IN ('good', 'perfect')");
		} else {
			conditions.push("t.quality_rating = ?");
			params.push(effectiveQuality);
		}
	}

	if (filters?.filter === 'needs_attention') {
		conditions.push('t.needs_attention = 1');
	}

	if (effectiveText && effectiveText.trim()) {
		conditions.push('(t.title LIKE ? OR t.artist LIKE ? OR a.title LIKE ? OR a.artist LIKE ?)');
		const q = `%${effectiveText.trim()}%`;
		params.push(q, q, q, q);
	}

	if (conditions.length > 0) {
		const whereClause = ' WHERE ' + conditions.join(' AND ');
		sql += whereClause;
		countSql += whereClause;
	}

	sql += ` ORDER BY t.needs_attention DESC, a.artist COLLATE NOCASE ASC, a.title COLLATE NOCASE ASC, t.disc_number ASC, t.track_number ASC`;

	const total = (db.prepare(countSql).get(...params) as { count: number }).count;

	if (limit) {
		sql += ` LIMIT ? OFFSET ?`;
		const tracks = db.prepare(sql).all(...params, limit, offset) as Track[];
		return { tracks, total };
	}

	const tracks = db.prepare(sql).all(...params) as Track[];
	return { tracks, total };
}

export function getAlbumById(id: number): { album: Album; tracks: Track[] } | null {
	const album = db.prepare(`
		SELECT 
			a.*,
			COUNT(t.id) as track_count,
			SUM(CASE WHEN t.quality_rating IN ('bad', 'needs_upgrade') THEN 1 ELSE 0 END) as bad_quality_count,
			SUM(CASE WHEN t.censorship = 'censored' THEN 1 ELSE 0 END) as censored_count,
			SUM(CASE WHEN t.lyrics = 'missing' THEN 1 ELSE 0 END) as missing_lyrics_count,
			SUM(CASE WHEN t.manually_checked = 1 THEN 1 ELSE 0 END) as checked_count
		FROM albums a
		LEFT JOIN tracks t ON t.album_id = a.id
		WHERE a.id = ?
		GROUP BY a.id
	`).get(id) as Album | undefined;

	if (!album) return null;

	if (album.fixer_rules) {
		try {
			album.parsed_fixer_rules = JSON.parse(album.fixer_rules);
		} catch {}
	}

	const tracks = db.prepare(`
		SELECT * FROM tracks
		WHERE album_id = ?
		ORDER BY disc_number ASC, track_number ASC
	`).all(id) as Track[];

	return { album, tracks };
}

export const getAlbumWithTracks = getAlbumById;

export function createAlbum(
	albumData: {
		title: string;
		artist: string;
		release_year?: number | null;
		genre?: string | null;
		cover_url?: string | null;
		media_type?: string | null;
		musicbrainz_id?: string | null;
		notes?: string | null;
	},
	tracksData: Array<{
		disc_number?: number;
		track_number: number;
		title: string;
		artist?: string | null;
		duration_ms?: number | null;
		format?: AudioFormat;
		bitrate_kbps?: number | null;
		sample_rate?: number | null;
		bits_per_sample?: number | null;
		quality_rating?: QualityRating;
		censorship?: CensorshipStatus;
		lyrics?: LyricsStatus;
		manually_checked?: number;
		notes?: string | null;
		file_path?: string | null;
		lyrics_text?: string | null;
	}> = []
): number {
	const insertAlbum = db.prepare(`
		INSERT INTO albums (musicbrainz_id, title, artist, release_year, genre, cover_url, media_type, notes)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`);

	const insertTrack = db.prepare(`
		INSERT INTO tracks (album_id, disc_number, track_number, title, artist, duration_ms, format, bitrate_kbps, sample_rate, bits_per_sample, quality_rating, censorship, lyrics, needs_attention, manually_checked, notes, file_path, lyrics_text)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);

	const transaction = db.transaction(() => {
		const result = insertAlbum.run(
			albumData.musicbrainz_id ?? null,
			albumData.title.trim(),
			albumData.artist.trim(),
			albumData.release_year ?? null,
			albumData.genre?.trim() ?? null,
			albumData.cover_url?.trim() ?? null,
			albumData.media_type?.trim() ?? 'Digital',
			albumData.notes?.trim() ?? null
		);

		const albumId = Number(result.lastInsertRowid);

		for (const t of tracksData) {
			const format = t.format || 'FLAC';
			const quality = t.quality_rating || 'good';
			const censorship = t.censorship || 'unknown';
			const lyrics = t.lyrics || 'missing';
			const needsAtt = computeNeedsAttention(quality, censorship, lyrics);

			insertTrack.run(
				albumId,
				t.disc_number || 1,
				t.track_number,
				t.title.trim(),
				t.artist?.trim() ?? null,
				t.duration_ms ?? null,
				format,
				t.bitrate_kbps ?? null,
				t.sample_rate ?? null,
				t.bits_per_sample ?? null,
				quality,
				censorship,
				lyrics,
				needsAtt,
				t.manually_checked || 0,
				t.notes?.trim() ?? null,
				t.file_path?.trim() ?? null,
				t.lyrics_text ?? null
			);
		}

		return albumId;
	});

	return transaction();
}

export function updateAlbum(
	id: number,
	data: Partial<{
		title: string;
		artist: string;
		release_year: number | null;
		genre: string | null;
		cover_url: string | null;
		media_type: string | null;
		notes: string | null;
	}>
): void {
	const updates: string[] = ['updated_at = datetime(\'now\')'];
	const params: (string | number | null)[] = [];

	if (data.title !== undefined) {
		updates.push('title = ?');
		params.push(data.title.trim());
	}
	if (data.artist !== undefined) {
		updates.push('artist = ?');
		params.push(data.artist.trim());
	}
	if (data.release_year !== undefined) {
		updates.push('release_year = ?');
		params.push(data.release_year);
	}
	if (data.genre !== undefined) {
		updates.push('genre = ?');
		params.push(data.genre?.trim() ?? null);
	}
	if (data.cover_url !== undefined) {
		updates.push('cover_url = ?');
		params.push(data.cover_url?.trim() ?? null);
	}
	if (data.media_type !== undefined) {
		updates.push('media_type = ?');
		params.push(data.media_type?.trim() ?? null);
	}
	if (data.notes !== undefined) {
		updates.push('notes = ?');
		params.push(data.notes?.trim() ?? null);
	}

	params.push(id);
	db.prepare(`UPDATE albums SET ${updates.join(', ')} WHERE id = ?`).run(...params);
}

export function deleteAlbum(id: number): void {
	db.prepare("DELETE FROM starred_items WHERE item_type = 'album' AND item_id = ?").run(id);
	db.prepare('DELETE FROM albums WHERE id = ?').run(id);
}

export function deleteAlbums(ids: number[]): void {
	if (!ids || ids.length === 0) return;
	const stmt = db.prepare('DELETE FROM albums WHERE id = ?');
	const starStmt = db.prepare("DELETE FROM starred_items WHERE item_type = 'album' AND item_id = ?");
	const tx = db.transaction(() => {
		for (const id of ids) {
			starStmt.run(id);
			stmt.run(id);
		}
	});
	tx();
}

export function updateTrack(
	id: number,
	data: Partial<{
		disc_number: number;
		track_number: number;
		title: string;
		artist: string | null;
		duration_ms: number | null;
		format: AudioFormat;
		bitrate_kbps: number | null;
		sample_rate: number | null;
		bits_per_sample: number | null;
		quality_rating: QualityRating;
		censorship: CensorshipStatus;
		lyrics: LyricsStatus;
		notes: string | null;
		file_path: string | null;
		lyrics_text: string | null;
		needs_attention: number;
		manually_checked: number;
	}>
): Track {
	const current = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id) as Track | undefined;
	if (!current) throw new Error(`Track with id ${id} not found`);

	const newFormat = data.format ?? current.format;
	const newQuality = data.quality_rating ?? current.quality_rating;
	const newCensorship = data.censorship ?? current.censorship;
	const newLyrics = data.lyrics ?? current.lyrics;
	const rules = getAlbumFixerRules(current.album_id);
	const autoNeedsAtt = computeNeedsAttention(newQuality, newCensorship, newLyrics, newFormat, rules);
	const needsAttention = data.needs_attention !== undefined ? data.needs_attention : autoNeedsAtt;

	db.prepare(`
		UPDATE tracks SET
			disc_number = COALESCE(?, disc_number),
			track_number = COALESCE(?, track_number),
			title = COALESCE(?, title),
			artist = CASE WHEN ? = 1 THEN ? ELSE artist END,
			duration_ms = CASE WHEN ? = 1 THEN ? ELSE duration_ms END,
			format = ?,
			bitrate_kbps = CASE WHEN ? = 1 THEN ? ELSE bitrate_kbps END,
			sample_rate = CASE WHEN ? = 1 THEN ? ELSE sample_rate END,
			bits_per_sample = CASE WHEN ? = 1 THEN ? ELSE bits_per_sample END,
			quality_rating = ?,
			censorship = ?,
			lyrics = ?,
			needs_attention = ?,
			manually_checked = CASE WHEN ? = 1 THEN ? ELSE manually_checked END,
			notes = CASE WHEN ? = 1 THEN ? ELSE notes END,
			file_path = CASE WHEN ? = 1 THEN ? ELSE file_path END,
			lyrics_text = CASE WHEN ? = 1 THEN ? ELSE lyrics_text END,
			updated_at = datetime('now')
		WHERE id = ?
	`).run(
		data.disc_number,
		data.track_number,
		data.title?.trim(),
		data.artist !== undefined ? 1 : 0,
		data.artist?.trim() ?? null,
		data.duration_ms !== undefined ? 1 : 0,
		data.duration_ms ?? null,
		newFormat,
		data.bitrate_kbps !== undefined ? 1 : 0,
		data.bitrate_kbps ?? null,
		data.sample_rate !== undefined ? 1 : 0,
		data.sample_rate ?? null,
		data.bits_per_sample !== undefined ? 1 : 0,
		data.bits_per_sample ?? null,
		newQuality,
		newCensorship,
		newLyrics,
		needsAttention,
		data.manually_checked !== undefined ? 1 : 0,
		data.manually_checked ?? 0,
		data.notes !== undefined ? 1 : 0,
		data.notes?.trim() ?? null,
		data.file_path !== undefined ? 1 : 0,
		data.file_path?.trim() ?? null,
		data.lyrics_text !== undefined ? 1 : 0,
		data.lyrics_text ?? null,
		id
	);

	return db.prepare('SELECT * FROM tracks WHERE id = ?').get(id) as Track;
}

export function batchUpdateAlbumTracks(
	albumId: number,
	updates: Partial<{
		format: AudioFormat;
		quality_rating: QualityRating;
		censorship: CensorshipStatus;
		lyrics: LyricsStatus;
		manually_checked: number;
	}>
): void {
	const tracks = db.prepare('SELECT * FROM tracks WHERE album_id = ?').all(albumId) as Track[];
	const rules = getAlbumFixerRules(albumId);
	const updateStmt = db.prepare(`
		UPDATE tracks SET
			format = ?,
			quality_rating = ?,
			censorship = ?,
			lyrics = ?,
			needs_attention = ?,
			manually_checked = CASE WHEN ? = 1 THEN ? ELSE manually_checked END,
			updated_at = datetime('now')
		WHERE id = ?
	`);

	const hasChecked = updates.manually_checked !== undefined ? 1 : 0;
	const checkedVal = updates.manually_checked ?? 0;

	const transaction = db.transaction(() => {
		for (const track of tracks) {
			const format = updates.format ?? track.format;
			const quality = updates.quality_rating ?? track.quality_rating;
			const censorship = updates.censorship ?? track.censorship;
			const lyrics = updates.lyrics ?? track.lyrics;
			const needsAtt = computeNeedsAttention(quality, censorship, lyrics, format, rules);

			updateStmt.run(format, quality, censorship, lyrics, needsAtt, hasChecked, checkedVal, track.id);
		}
	});

	transaction();
}

export function updateAlbumAndTracksFromMusicBrainz(
	albumId: number,
	albumData: {
		title?: string;
		artist?: string;
		release_year?: number | null;
		genre?: string | null;
		cover_url?: string | null;
		musicbrainz_id?: string | null;
	},
	trackUpdates: Array<{
		id: number;
		title: string;
		artist?: string | null;
		track_number: number;
		disc_number?: number;
	}>
): { album: Album; tracks: Track[] } | null {
	const albumRes = getAlbumWithTracks(albumId);
	if (!albumRes) return null;

	const rules = getAlbumFixerRules(albumId);

	const transaction = db.transaction(() => {
		// 1. Update album
		const albumSets: string[] = ["updated_at = datetime('now')"];
		const albumParams: any[] = [];
		if (albumData.title !== undefined) {
			albumSets.push('title = ?');
			albumParams.push(albumData.title.trim());
		}
		if (albumData.artist !== undefined) {
			albumSets.push('artist = ?');
			albumParams.push(albumData.artist.trim());
		}
		if (albumData.release_year !== undefined) {
			albumSets.push('release_year = ?');
			albumParams.push(albumData.release_year);
		}
		if (albumData.genre !== undefined) {
			albumSets.push('genre = ?');
			albumParams.push(albumData.genre?.trim() ?? null);
		}
		if (albumData.cover_url !== undefined) {
			albumSets.push('cover_url = ?');
			albumParams.push(albumData.cover_url?.trim() ?? null);
		}
		if (albumData.musicbrainz_id !== undefined) {
			albumSets.push('musicbrainz_id = ?');
			albumParams.push(albumData.musicbrainz_id?.trim() ?? null);
		}

		albumParams.push(albumId);
		db.prepare(`UPDATE albums SET ${albumSets.join(', ')} WHERE id = ?`).run(...albumParams);

		// 2. Update each track
		const updateTrackStmt = db.prepare(`
			UPDATE tracks SET
				title = ?,
				artist = ?,
				track_number = ?,
				disc_number = ?,
				manually_checked = 1,
				needs_attention = ?,
				updated_at = datetime('now')
			WHERE id = ? AND album_id = ?
		`);

		for (const t of trackUpdates) {
			const existing = db.prepare('SELECT * FROM tracks WHERE id = ? AND album_id = ?').get(t.id, albumId) as Track | undefined;
			if (!existing) continue;

			const discNumber = t.disc_number ?? existing.disc_number;
			const trackNumber = t.track_number ?? existing.track_number;
			const title = t.title.trim();
			const artist = t.artist?.trim() ?? existing.artist;
			const needsAtt = computeNeedsAttention(existing.quality_rating, existing.censorship, existing.lyrics, existing.format, rules);

			updateTrackStmt.run(title, artist, trackNumber, discNumber, needsAtt, t.id, albumId);
		}
	});

	transaction();
	return getAlbumWithTracks(albumId);
}

export function addTrackToAlbum(
	albumId: number,
	trackData: {
		disc_number?: number;
		track_number?: number;
		title: string;
		artist?: string | null;
		duration_ms?: number | null;
		format?: AudioFormat;
		bitrate_kbps?: number | null;
		sample_rate?: number | null;
		bits_per_sample?: number | null;
		quality_rating?: QualityRating;
		censorship?: CensorshipStatus;
		lyrics?: LyricsStatus;
		manually_checked?: number;
		notes?: string | null;
		file_path?: string | null;
		lyrics_text?: string | null;
	}
): number {
	let trackNumber = trackData.track_number;
	if (!trackNumber) {
		const maxRow = db.prepare(`
			SELECT MAX(track_number) as max_num FROM tracks WHERE album_id = ? AND disc_number = ?
		`).get(albumId, trackData.disc_number || 1) as { max_num: number | null };
		trackNumber = (maxRow?.max_num || 0) + 1;
	}

	const format = trackData.format || 'FLAC';
	const quality = trackData.quality_rating || 'good';
	const censorship = trackData.censorship || 'unknown';
	const lyrics = trackData.lyrics || 'missing';
	const rules = getAlbumFixerRules(albumId);
	const needsAtt = computeNeedsAttention(quality, censorship, lyrics, format, rules);

	const result = db.prepare(`
		INSERT INTO tracks (album_id, disc_number, track_number, title, artist, duration_ms, format, bitrate_kbps, sample_rate, bits_per_sample, quality_rating, censorship, lyrics, needs_attention, manually_checked, notes, file_path, lyrics_text)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).run(
		albumId,
		trackData.disc_number || 1,
		trackNumber,
		trackData.title.trim(),
		trackData.artist?.trim() ?? null,
		trackData.duration_ms ?? null,
		format,
		trackData.bitrate_kbps ?? null,
		trackData.sample_rate ?? null,
		trackData.bits_per_sample ?? null,
		quality,
		censorship,
		lyrics,
		needsAtt,
		trackData.manually_checked ?? 0,
		trackData.notes?.trim() ?? null,
		trackData.file_path?.trim() ?? null,
		trackData.lyrics_text ?? null
	);

	return Number(result.lastInsertRowid);
}

export function deleteTrack(trackId: number): void {
	db.prepare('DELETE FROM tracks WHERE id = ?').run(trackId);
}

/**
 * Retrieve a single track by ID with its parent album title, artist, and cover
 */
export function getTrackById(
	trackId: number
): (Track & { album_title: string; album_artist: string; album_cover_url?: string | null; album_year?: number | null }) | null {
	const track = db.prepare(`
		SELECT 
			t.*,
			a.title as album_title,
			a.artist as album_artist,
			a.cover_url as album_cover_url,
			a.release_year as album_year
		FROM tracks t
		JOIN albums a ON t.album_id = a.id
		WHERE t.id = ?
	`).get(trackId) as (Track & { album_title: string; album_artist: string; album_cover_url?: string | null; album_year?: number | null }) | undefined;

	return track || null;
}

/**
 * Save lyrics text directly to a track and update lyrics status
 */
export function saveTrackLyrics(
	trackId: number,
	lyricsText: string,
	status: LyricsStatus = 'synced_lrc'
): Track {
	const current = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId) as Track | undefined;
	if (!current) throw new Error(`Track with id ${trackId} not found`);

	const rules = getAlbumFixerRules(current.album_id);
	const needsAttention = computeNeedsAttention(
		current.quality_rating,
		current.censorship,
		status,
		current.format,
		rules
	);

	db.prepare(`
		UPDATE tracks SET
			lyrics = ?,
			lyrics_text = ?,
			needs_attention = ?,
			updated_at = datetime('now')
		WHERE id = ?
	`).run(status, lyricsText, needsAttention, trackId);

	return db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId) as Track;
}

export function getIssuesTracks(params?: {
	issueType?: string;
	format?: string;
	censorship?: string;
	lyrics?: string;
	search?: string;
	manuallyChecked?: number;
	limit?: number;
	offset?: number;
}): { tracks: Track[]; total: number } {
	let sql = `
		SELECT 
			t.*,
			a.title as album_title,
			a.artist as album_artist,
			a.cover_url as album_cover_url,
			a.release_year as album_year
		FROM tracks t
		JOIN albums a ON a.id = t.album_id
	`;

	let countSql = `
		SELECT COUNT(*) as count
		FROM tracks t
		JOIN albums a ON a.id = t.album_id
	`;

	const conditions: string[] = [];
	const queryParams: (string | number)[] = [];

	if (params?.issueType === 'bad_quality') {
		conditions.push("t.quality_rating IN ('bad', 'needs_upgrade')");
	} else if (params?.issueType === 'censored') {
		conditions.push("t.censorship = 'censored'");
	} else if (params?.issueType === 'missing_lyrics') {
		conditions.push("t.lyrics = 'missing'");
	} else if (params?.issueType === 'unsynced_lyrics') {
		conditions.push("t.lyrics = 'unsynced_lrc'");
	} else if (params?.issueType === 'all_issues') {
		conditions.push('t.needs_attention = 1');
	} else if (params?.issueType === 'good') {
		conditions.push('t.needs_attention = 0');
	} else if (params?.issueType === 'unverified') {
		conditions.push('t.manually_checked = 0');
	} else if (params?.issueType === 'verified') {
		conditions.push('t.manually_checked = 1');
	}

	if (params?.manuallyChecked !== undefined) {
		conditions.push('t.manually_checked = ?');
		queryParams.push(params.manuallyChecked);
	}

	if (params?.format) {
		conditions.push('t.format = ?');
		queryParams.push(params.format);
	}

	if (params?.censorship) {
		conditions.push('t.censorship = ?');
		queryParams.push(params.censorship);
	}

	if (params?.lyrics) {
		conditions.push('t.lyrics = ?');
		queryParams.push(params.lyrics);
	}

	if (params?.search && params.search.trim()) {
		conditions.push('(t.title LIKE ? OR t.artist LIKE ? OR a.title LIKE ? OR a.artist LIKE ?)');
		const q = `%${params.search.trim()}%`;
		queryParams.push(q, q, q, q);
	}

	if (conditions.length > 0) {
		const whereClause = ' WHERE ' + conditions.join(' AND ');
		sql += whereClause;
		countSql += whereClause;
	}

	sql += ` ORDER BY t.needs_attention DESC, a.artist COLLATE NOCASE ASC, a.title COLLATE NOCASE ASC, t.disc_number ASC, t.track_number ASC`;

	const total = (db.prepare(countSql).get(...queryParams) as { count: number }).count;

	if (params?.limit) {
		sql += ` LIMIT ? OFFSET ?`;
		const offset = params.offset || 0;
		const tracks = db.prepare(sql).all(...queryParams, params.limit, offset) as Track[];
		return { tracks, total };
	}

	const tracks = db.prepare(sql).all(...queryParams) as Track[];
	return { tracks, total };
}

/**
 * Subsonic & Music Server Helpers
 */

export function recordTrackPlay(trackId: number): void {
	db.prepare(`UPDATE tracks SET play_count = play_count + 1, last_played_at = datetime('now') WHERE id = ?`).run(trackId);
}

export function starItem(userId: number, itemType: 'album' | 'track' | 'artist', itemId: number): void {
	db.prepare(`
		INSERT INTO starred_items (user_id, item_type, item_id)
		VALUES (?, ?, ?)
		ON CONFLICT(user_id, item_type, item_id) DO NOTHING
	`).run(userId, itemType, itemId);
}

export function unstarItem(userId: number, itemType: 'album' | 'track' | 'artist', itemId: number): void {
	db.prepare(`DELETE FROM starred_items WHERE user_id = ? AND item_type = ? AND item_id = ?`).run(userId, itemType, itemId);
}

export function isItemStarred(userId: number, itemType: 'album' | 'track' | 'artist', itemId: number): boolean {
	const row = db.prepare(`SELECT 1 FROM starred_items WHERE user_id = ? AND item_type = ? AND item_id = ?`).get(userId, itemType, itemId);
	return !!row;
}

export function getStarredItems(userId: number): {
	albums: Album[];
	tracks: Track[];
	artistNames: string[];
} {
	const albumRows = db.prepare(`
		SELECT a.*, (SELECT COUNT(*) FROM tracks WHERE album_id = a.id) as track_count
		FROM starred_items s
		JOIN albums a ON s.item_id = a.id
		WHERE s.user_id = ? AND s.item_type = 'album'
		ORDER BY s.created_at DESC
	`).all(userId) as Album[];

	const trackRows = db.prepare(`
		SELECT t.*, a.title as album_title, a.artist as album_artist, a.cover_url as album_cover_url, a.release_year as album_year
		FROM starred_items s
		JOIN tracks t ON s.item_id = t.id
		JOIN albums a ON t.album_id = a.id
		WHERE s.user_id = ? AND s.item_type = 'track'
		ORDER BY s.created_at DESC
	`).all(userId) as Track[];

	const artistRows = db.prepare(`
		SELECT DISTINCT a.artist
		FROM starred_items s
		JOIN albums a ON s.item_id = a.id
		WHERE s.user_id = ? AND s.item_type = 'artist'
	`).all(userId) as Array<{ artist: string }>;

	return {
		albums: albumRows,
		tracks: trackRows,
		artistNames: artistRows.map(r => r.artist)
	};
}

export function getUserPlaylists(userId: number): Array<Playlist & { song_count: number; duration_ms: number; cover_url: string | null }> {
	return db.prepare(`
		SELECT p.*,
			COUNT(pt.id) as song_count,
			COALESCE(SUM(t.duration_ms), 0) as duration_ms,
			(
				SELECT a.cover_url
				FROM playlist_tracks pt2
				JOIN tracks t2 ON pt2.track_id = t2.id
				JOIN albums a ON t2.album_id = a.id
				WHERE pt2.playlist_id = p.id AND a.cover_url IS NOT NULL AND a.cover_url != ''
				ORDER BY pt2.track_order ASC
				LIMIT 1
			) as cover_url
		FROM playlists p
		LEFT JOIN playlist_tracks pt ON p.id = pt.playlist_id
		LEFT JOIN tracks t ON pt.track_id = t.id
		WHERE p.user_id = ? OR p.is_public = 1
		GROUP BY p.id
		ORDER BY p.name COLLATE NOCASE ASC
	`).all(userId) as any;
}

export function getPlaylistById(playlistId: number): (Playlist & { song_count: number; duration_ms: number; cover_url: string | null }) | null {
	const row = db.prepare(`
		SELECT p.*,
			COUNT(pt.id) as song_count,
			COALESCE(SUM(t.duration_ms), 0) as duration_ms,
			(
				SELECT a.cover_url
				FROM playlist_tracks pt2
				JOIN tracks t2 ON pt2.track_id = t2.id
				JOIN albums a ON t2.album_id = a.id
				WHERE pt2.playlist_id = p.id AND a.cover_url IS NOT NULL AND a.cover_url != ''
				ORDER BY pt2.track_order ASC
				LIMIT 1
			) as cover_url
		FROM playlists p
		LEFT JOIN playlist_tracks pt ON p.id = pt.playlist_id
		LEFT JOIN tracks t ON pt.track_id = t.id
		WHERE p.id = ?
		GROUP BY p.id
	`).get(playlistId) as any;
	return row || null;
}

export function getPlaylistTracks(playlistId: number): Track[] {
	return db.prepare(`
		SELECT t.*, a.title as album_title, a.artist as album_artist, a.cover_url as album_cover_url, a.release_year as album_year, pt.track_order
		FROM playlist_tracks pt
		JOIN tracks t ON pt.track_id = t.id
		JOIN albums a ON t.album_id = a.id
		WHERE pt.playlist_id = ?
		ORDER BY pt.track_order ASC
	`).all(playlistId) as Track[];
}

export function createPlaylist(
	userId: number,
	name: string,
	comment?: string,
	trackIds?: number[],
	isPublic: number = 0
): number {
	const res = db.prepare(`
		INSERT INTO playlists (user_id, name, comment, is_public)
		VALUES (?, ?, ?, ?)
	`).run(userId, name, comment || null, isPublic);

	const playlistId = Number(res.lastInsertRowid);

	if (trackIds && trackIds.length > 0) {
		const insertStmt = db.prepare(`
			INSERT INTO playlist_tracks (playlist_id, track_id, track_order)
			VALUES (?, ?, ?)
		`);
		const tx = db.transaction(() => {
			trackIds.forEach((tId, idx) => {
				insertStmt.run(playlistId, tId, idx + 1);
			});
		});
		tx();
	}

	return playlistId;
}

export function updatePlaylist(
	playlistId: number,
	name?: string,
	comment?: string,
	trackIdsToAdd?: number[],
	trackIndicesToRemove?: number[],
	isPublic?: number
): void {
	if (name !== undefined || comment !== undefined || isPublic !== undefined) {
		const updates: string[] = ["updated_at = datetime('now')"];
		const params: any[] = [];
		if (name !== undefined) {
			updates.push('name = ?');
			params.push(name);
		}
		if (comment !== undefined) {
			updates.push('comment = ?');
			params.push(comment);
		}
		if (isPublic !== undefined) {
			updates.push('is_public = ?');
			params.push(isPublic);
		}
		params.push(playlistId);
		db.prepare(`UPDATE playlists SET ${updates.join(', ')} WHERE id = ?`).run(...params);
	}

	if (trackIndicesToRemove && trackIndicesToRemove.length > 0) {
		const currentTracks = db.prepare(
			'SELECT id FROM playlist_tracks WHERE playlist_id = ? ORDER BY track_order ASC'
		).all(playlistId) as Array<{ id: number }>;

		// Subsonic indices are 0-based
		const idsToDelete = trackIndicesToRemove
			.map((idx) => currentTracks[idx]?.id)
			.filter(Boolean);

		if (idsToDelete.length > 0) {
			const placeholders = idsToDelete.map(() => '?').join(',');
			db.prepare(`DELETE FROM playlist_tracks WHERE id IN (${placeholders})`).run(...idsToDelete);
		}

		// Defragment track order
		const remaining = db.prepare(
			'SELECT id FROM playlist_tracks WHERE playlist_id = ? ORDER BY track_order ASC'
		).all(playlistId) as Array<{ id: number }>;
		const updateOrderStmt = db.prepare('UPDATE playlist_tracks SET track_order = ? WHERE id = ?');
		const tx = db.transaction(() => {
			remaining.forEach((item, idx) => {
				updateOrderStmt.run(idx + 1, item.id);
			});
		});
		tx();
	}

	if (trackIdsToAdd && trackIdsToAdd.length > 0) {
		const maxOrderRow = db.prepare(
			'SELECT COALESCE(MAX(track_order), 0) as max_order FROM playlist_tracks WHERE playlist_id = ?'
		).get(playlistId) as { max_order: number };
		let nextOrder = maxOrderRow.max_order + 1;

		const insertStmt = db.prepare(`
			INSERT INTO playlist_tracks (playlist_id, track_id, track_order)
			VALUES (?, ?, ?)
		`);
		const tx = db.transaction(() => {
			for (const tId of trackIdsToAdd) {
				insertStmt.run(playlistId, tId, nextOrder++);
			}
		});
		tx();
	}
}

export function replacePlaylistTracks(playlistId: number, trackIds: number[]): void {
	const tx = db.transaction(() => {
		db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(playlistId);
		if (trackIds.length > 0) {
			const insertStmt = db.prepare(`
				INSERT INTO playlist_tracks (playlist_id, track_id, track_order)
				VALUES (?, ?, ?)
			`);
			trackIds.forEach((tId, idx) => {
				insertStmt.run(playlistId, tId, idx + 1);
			});
		}
		db.prepare("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?").run(playlistId);
	});
	tx();
}

export function removePlaylistTrack(playlistId: number, trackId?: number, trackIndex?: number): void {
	if (trackIndex !== undefined) {
		const tracks = db.prepare(
			'SELECT id FROM playlist_tracks WHERE playlist_id = ? ORDER BY track_order ASC'
		).all(playlistId) as Array<{ id: number }>;
		if (tracks[trackIndex]) {
			db.prepare('DELETE FROM playlist_tracks WHERE id = ?').run(tracks[trackIndex].id);
		}
	} else if (trackId !== undefined) {
		// Delete the first occurrence of this track in the playlist
		const row = db.prepare(
			'SELECT id FROM playlist_tracks WHERE playlist_id = ? AND track_id = ? ORDER BY track_order ASC LIMIT 1'
		).get(playlistId, trackId) as { id: number } | undefined;
		if (row) {
			db.prepare('DELETE FROM playlist_tracks WHERE id = ?').run(row.id);
		}
	}

	// Defragment track_order
	const remaining = db.prepare(
		'SELECT id FROM playlist_tracks WHERE playlist_id = ? ORDER BY track_order ASC'
	).all(playlistId) as Array<{ id: number }>;
	const updateStmt = db.prepare('UPDATE playlist_tracks SET track_order = ? WHERE id = ?');
	const tx = db.transaction(() => {
		remaining.forEach((item, idx) => {
			updateStmt.run(idx + 1, item.id);
		});
		db.prepare("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?").run(playlistId);
	});
	tx();
}

export function deletePlaylist(playlistId: number): void {
	db.prepare('DELETE FROM playlists WHERE id = ?').run(playlistId);
}

export function getDistinctArtists(): Array<{ name: string; album_count: number }> {
	return db.prepare(`
		SELECT artist as name, COUNT(id) as album_count
		FROM albums
		WHERE artist IS NOT NULL AND TRIM(artist) != ''
		GROUP BY artist
		ORDER BY artist COLLATE NOCASE ASC
	`).all() as any;
}

export function getAlbumsByArtist(artist: string): Album[] {
	return db.prepare(`
		SELECT a.*, (SELECT COUNT(*) FROM tracks WHERE album_id = a.id) as track_count
		FROM albums a
		WHERE a.artist = ?
		ORDER BY a.release_year DESC, a.title COLLATE NOCASE ASC
	`).all(artist) as Album[];
}

export function getRandomTracks(limit: number, genre?: string): Track[] {
	let query = `
		SELECT t.*, a.title as album_title, a.artist as album_artist, a.cover_url as album_cover_url, a.release_year as album_year
		FROM tracks t
		JOIN albums a ON t.album_id = a.id
	`;
	const params: any[] = [];
	if (genre && genre.trim()) {
		query += ` WHERE a.genre = ? `;
		params.push(genre.trim());
	}
	query += ` ORDER BY RANDOM() LIMIT ? `;
	params.push(Math.min(limit, 500));
	return db.prepare(query).all(...params) as Track[];
}

export function getAlbumList(
	type: string,
	size: number,
	offset: number = 0,
	genre?: string
): Album[] {
	const limit = Math.min(Math.max(1, size), 500);
	let orderBy = 'a.title COLLATE NOCASE ASC';

	let whereClause = '';
	const params: any[] = [];

	switch (type) {
		case 'random':
			orderBy = 'RANDOM()';
			break;
		case 'newest':
			orderBy = 'a.created_at DESC, a.id DESC';
			break;
		case 'highest':
		case 'frequent':
			orderBy = '(SELECT COALESCE(SUM(play_count), 0) FROM tracks WHERE album_id = a.id) DESC, a.title COLLATE NOCASE ASC';
			break;
		case 'recent':
			orderBy = '(SELECT MAX(last_played_at) FROM tracks WHERE album_id = a.id) DESC, a.updated_at DESC';
			break;
		case 'byName':
		case 'alphabeticalByName':
			orderBy = 'a.title COLLATE NOCASE ASC';
			break;
		case 'byArtist':
		case 'alphabeticalByArtist':
			orderBy = 'a.artist COLLATE NOCASE ASC, a.release_year DESC';
			break;
		case 'starred':
			whereClause = "WHERE a.id IN (SELECT item_id FROM starred_items WHERE item_type = 'album')";
			orderBy = 'a.title COLLATE NOCASE ASC';
			break;
		case 'byYear':
			orderBy = 'a.release_year DESC, a.title COLLATE NOCASE ASC';
			break;
		case 'byGenre':
			orderBy = 'a.genre COLLATE NOCASE ASC, a.title COLLATE NOCASE ASC';
			break;
	}

	if (genre && genre.trim()) {
		whereClause = whereClause ? `${whereClause} AND a.genre = ?` : 'WHERE a.genre = ?';
		params.push(genre.trim());
	}

	const sql = `
		SELECT a.*, (SELECT COUNT(*) FROM tracks WHERE album_id = a.id) as track_count
		FROM albums a
		${whereClause}
		ORDER BY ${orderBy}
		LIMIT ? OFFSET ?
	`;
	params.push(limit, offset);

	return db.prepare(sql).all(...params) as Album[];
}

export function getAllGenres(): Array<{ genre: string; album_count: number; song_count: number }> {
	return db.prepare(`
		SELECT a.genre,
			COUNT(DISTINCT a.id) as album_count,
			COUNT(t.id) as song_count
		FROM albums a
		JOIN tracks t ON a.id = t.album_id
		WHERE a.genre IS NOT NULL AND TRIM(a.genre) != ''
		GROUP BY a.genre
		ORDER BY a.genre COLLATE NOCASE ASC
	`).all() as any;
}

export function getAllTracksPaged(offset: number = 0, limit: number = 500): Track[] {
	const cappedLimit = Math.min(Math.max(1, limit), 1000);
	return db.prepare(`
		SELECT t.*, a.title as album_title, a.artist as album_artist, a.cover_url as album_cover_url, a.release_year as album_year, a.genre as album_genre
		FROM tracks t
		JOIN albums a ON t.album_id = a.id
		ORDER BY t.album_id ASC, t.disc_number ASC, t.track_number ASC
		LIMIT ? OFFSET ?
	`).all(cappedLimit, Math.max(0, offset)) as Track[];
}

export function getTracksByGenre(genre: string, offset: number = 0, limit: number = 500): Track[] {
	const cappedLimit = Math.min(Math.max(1, limit), 1000);
	return db.prepare(`
		SELECT t.*, a.title as album_title, a.artist as album_artist, a.cover_url as album_cover_url, a.release_year as album_year, a.genre as album_genre
		FROM tracks t
		JOIN albums a ON t.album_id = a.id
		WHERE a.genre = ?
		ORDER BY a.title COLLATE NOCASE ASC, t.track_number ASC
		LIMIT ? OFFSET ?
	`).all(genre.trim(), cappedLimit, Math.max(0, offset)) as Track[];
}

export function getTopTracksByArtist(artist: string, limit: number = 20): Track[] {
	const cappedLimit = Math.min(Math.max(1, limit), 200);
	return db.prepare(`
		SELECT t.*, a.title as album_title, a.artist as album_artist, a.cover_url as album_cover_url, a.release_year as album_year, a.genre as album_genre
		FROM tracks t
		JOIN albums a ON t.album_id = a.id
		WHERE t.artist = ? OR t.artist LIKE ? OR a.artist = ?
		ORDER BY t.play_count DESC, t.id ASC
		LIMIT ?
	`).all(artist, `%${artist}%`, artist, cappedLimit) as Track[];
}

export function getPlayQueue(userId: number): { current: number | null; position: number; changed: string; trackIds: number[] } | null {
	const row = db.prepare('SELECT current_track_id, position, changed_at, track_ids FROM play_queues WHERE user_id = ?').get(userId) as any;
	if (!row) return null;
	let trackIds: number[] = [];
	try {
		trackIds = JSON.parse(row.track_ids || '[]');
	} catch {}
	return {
		current: row.current_track_id,
		position: row.position || 0,
		changed: row.changed_at,
		trackIds
	};
}

export function savePlayQueue(userId: number, currentTrackId: number | null, position: number, trackIds: number[]) {
	const now = new Date().toISOString();
	db.prepare(`
		INSERT INTO play_queues (user_id, current_track_id, position, track_ids, changed_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			current_track_id = excluded.current_track_id,
			position = excluded.position,
			track_ids = excluded.track_ids,
			changed_at = excluded.changed_at
	`).run(userId, currentTrackId, position, JSON.stringify(trackIds), now);
}

