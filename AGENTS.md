# Trax Vault - Agent Memory & Project Instructions

This document preserves persistent context, architectural conventions, recent changes, and operational guidelines across AI pair programming sessions.

---

## 1. Project Overview

- **Name:** Trax Vault
- **Repository:** `Kapybara48/trax-vault`
- **Stack:**
  - **Framework:** SvelteKit 5 (Svelte 5 Runes: `$state`, `$derived`, `$props`)
  - **Language:** TypeScript
  - **Database:** SQLite via `better-sqlite3` (WAL mode enabled, foreign keys ON)
  - **Styling:** TailwindCSS v4
  - **Metadata:** `music-metadata` for audio tags & format extraction
  - **Icons:** `@lucide/svelte`
  - **Container:** Docker + Docker Compose with `@sveltejs/adapter-node`

---

## 2. Architecture & Conventions

### Database & Migrations (`src/lib/server/db.ts`)
- Path defaults to `./data/traxvault.db` (with automated fallback to legacy `trackvault.db`) or `DATA_DIR` env variable.
- Uses `better-sqlite3` synchronously.
- **Migrations:** Always verify schema column existence with `PRAGMA table_info(table)` before running `ALTER TABLE ... ADD COLUMN` so that unexpected database errors (permission, disk space, lock) are not silently swallowed.
- **Indices:** Use `CREATE INDEX IF NOT EXISTS` natively without empty try/catch wrappers.

### Authentication & Sessions (`src/lib/server/auth.ts`)
- Cryptographic scrypt password hashing with unique 16-byte salts and `crypto.timingSafeEqual`.
- Sessions stored in SQLite `sessions` table (32-byte hex tokens, 30-day lifetime).
- Centralized cookie helper `getSessionCookieOptions(url)` in [`src/lib/server/auth.ts`](file:///mnt/data/Projects/track-vault/src/lib/server/auth.ts):
  - Cookie name: `SESSION_COOKIE_NAME = 'vault_session'`.
  - Flags: `httpOnly: true`, `sameSite: 'lax'`, `path: '/'`, `maxAge: 30 days`.
  - Dynamic `secure` flag: Enabled if `COOKIE_SECURE=true`, protocol is `https:`, or running in `production`.
- `AUTH_DISABLED=true` (or `DISABLE_AUTH=true`) assigns synthetic admin user `{ id: 1, username: 'admin', role: 'admin' }` and emits a high-visibility warning to the console on startup.

### Album & Track Fixer Rules
- Fixer rules (`FixerRules`) flag tracks for quality, audio format (lossy / mp3), censorship, and lyrics status.
- [`updateAlbumFixerRules(albumId, rules, applyToAll)`](file:///mnt/data/Projects/track-vault/src/lib/server/db.ts) returns `{ album, tracks } | null`. If the album ID does not exist, it returns `null`, and the API endpoint ([`src/routes/api/albums/[id]/fixer-rules/+server.ts`](file:///mnt/data/Projects/track-vault/src/routes/api/albums/[id]/fixer-rules/+server.ts)) responds with HTTP `404 Not Found`.

---

## 3. Session Memory & Change History

### Recent Fixes & Additions (2026-10-23)
1. **`updateAlbumFixerRules` return type**: Validated album existence before updating and updated return type to `{ album: Album; tracks: Track[] } | null`. Endpoint now returns 404 if album not found.
2. **Database migration safety**: Replaced empty `try/catch` migration statements with `PRAGMA table_info` checks.
3. **Session cookie unification**: Unified cookie handling across API endpoints (`/api/auth/login`, `/api/auth/setup`, `/api/auth/logout`) and form actions (`/login`, `/setup`) using `SESSION_COOKIE_NAME` and `getSessionCookieOptions(url)`.
4. **Auth disable logging**: Added loud console warning when authentication is bypassed via `AUTH_DISABLED=true`.
5. **Account Settings & Password Change**:
   - Added `/settings` page (`src/routes/settings/+page.svelte` & `+page.server.ts`) for managing account credentials and viewing system stats.
   - Added `changePassword` in `src/lib/server/auth.ts` with current password verification and 6+ character validation.
   - Added API endpoint `POST /api/auth/change-password`.
   - Added Settings link & user profile shortcut to desktop and mobile navigation in `src/lib/components/Navbar.svelte`.
6. **Defensive Password Verification (`verifyPassword`)**: Added length validation and try/catch around `crypto.timingSafeEqual` preventing `RangeError` crashes on malformed hashes.
7. **Production Auth Safeguard**: Blocked `AUTH_DISABLED=true` in production mode unless explicitly confirmed via `ALLOW_INSECURE_AUTH_BYPASS=true`.
8. **Parameterized Query in `getAlbums()`**: Replaced `${effectiveChecked}` string interpolation with parameterized binding `t2.manually_checked = ?`.
9. **Atomic Fixer Rule Batch Updates**: Enclosed both the album fixer rules update and track updates inside a single SQLite transaction.
10. **Lossless Audio Quality Refinement**: Differentiated Hi-Res lossless (24-bit / >48kHz -> `perfect`) from standard CD quality lossless (16-bit / 44.1kHz -> `good`).
11. **MusicBrainz Picard Integration (Containerized Web GUI)**:
    - Added `picard` service (`jlesage/musicbrainz-picard:latest`) to `docker-compose.yml` exposing browser Web GUI on port `5800`.
    - Configured shared `./music` volume mounted read-write (`:rw`) to Picard for writing tags, while Track Vault maintains `:ro` read-only access.
    - Added configurable `PICARD_URL` environment variable defaulting to `http://localhost:5800`.
    - Added deep UI shortcuts and links to Picard across Track Vault:
      - Desktop Navbar & Mobile Navigation bottom bar.
      - Library Scanner banner for untagged / unknown music files.
      - Album detail action bar ("Tag in Picard" shortcut).
      - Account Settings system information card with direct launch button.
12. **Interactive LRC Maker Studio (`/lrc-maker`)**:
    - Added database columns `file_path` and `lyrics_text` to `tracks` table with idempotent `PRAGMA table_info` migrations.
    - Added audio streaming endpoint `GET /api/tracks/[id]/audio` with HTTP 206 Partial Content (Range byte seeking).
    - Added lyrics endpoint `GET / POST /api/tracks/[id]/lyrics` supporting database persistence and companion `.lrc` file saving.
    - Added LRCLIB proxy endpoint `GET /api/lyrics/search` for 1-click lyric lookups from lrclib.net.
    - Integrated deep shortcuts across Track Vault: Navbar desktop & mobile, `TrackRow` row action button, and The Fixer issues table.
13. **Direct Song Folder Companion Lyrics Read & Write**:
    - Made `/music` volume mount read-write (`:rw`) in `docker-compose.yml`.
    - Added `findCompanionLyricsFile(filePath, title)` to `src/lib/server/scanner.ts` with multi-strategy discovery (exact matches, case insensitivity, zero-padded track numbers `001` vs `01`, and title-based matches).
    - Added startup database migration backfill resolving `file_path` and `lyrics_text` for existing library tracks without data loss.
    - Updated `GET /api/tracks/[id]/lyrics` to read companion `.lrc` and `.txt` files directly from disk as the source of truth, and `POST /api/tracks/[id]/lyrics` to write edits directly back into the song's folder on disk.
    - Added cross-environment `resolveTrackFilePath()` in `scanner.ts` reconciling host and Docker container `/music` path mount differences.
    - Added Quick Lyrics File Editor Modal in `src/routes/album/[id]/+page.svelte` and quick trigger in `TrackRow.svelte`.
14. **Playback Song Time Line Focus & Navbar Declutter**:
    - In `src/routes/lrc-maker/+page.svelte`, added reactive `currentPlaybackLineIndex` derived from audio `currentTime` and an auto-scroll effect smoothly centering the active singing line during playback.
    - Added visual active line highlighting (emerald pulsating badge, glowing ring, text elevation) and an `Auto-Follow: ON/OFF` toggle.
    - Redesigned `src/lib/components/Navbar.svelte`: consolidated secondary studio links into a clean `Tools` dropdown (`LRC Maker Studio` + `Picard Tagger`), removed duplicate settings tab on desktop, and streamlined mobile navigation to 5 clean, evenly-spaced tabs (`Vault`, `Fixer`, `Scan`, `LRC`, `Settings`).
15. **Instrumental Lyrics Option & Multi-Line Batch Time Shifting**:
    - Added `isInstrumentalLyrics(content)` in `src/lib/server/scanner.ts` detecting `[00:00.00]♪`, `[00:00.00][instrumental]`, `[au:Instrumental]`, etc., and updated `findCompanionLyricsFile()` and `detectLyrics()` to classify companion files as `type: 'instrumental'`.
    - Updated `POST /api/tracks/[id]/lyrics` to auto-detect instrumental content and ensure `.lrc` extension is retained when writing companion files to disk.
    - Added instrumental mode toggle & format selector (`♪ Musical Note` vs `Tag`) to LRC Maker header, LRCLIB modal, and Synchronizer mode.
    - Added multi-line selection (individual checkboxes, Shift+Click range select, select all, clear) and batch time shifting toolbar (`±1.0s`, `±0.5s`, `±0.1s`, custom seconds input, and bulk clear timestamps).
    - Added "Mark Instrumental" 1-click shortcut button in Album detail Quick Lyrics File Editor Modal.
16. **Spotify-Inspired Music Player Tab, Split Navbar, & LRC Input Fix**:
    - Split navbar tools into direct top-level links: `Vault`, `Player`, `Fixer`, `LRC Maker`, `Scan`, and `Picard`. Updated mobile bottom navigation to a clean 6-tab layout.
    - Fixed LRC Maker custom time shift input: expanded input width, eliminated native browser arrow spinners blocking the number, and added dedicated increment/decrement steppers with `±sec` formatting.
    - Added full-featured Spotify clone music player at `/player` (`src/routes/player/+page.svelte` & `+page.server.ts`):
      - 3-pane layout with 'Your Library' album search and filter chips (All, Verified, Lossless).
      - Spotify album hero with large artwork, metadata, and big green play button.
      - Full interactive tracklist table with active song equalizer animations and direct audio streaming (`/api/tracks/[id]/audio`).
      - Spotify Synced Lyrics drawer with real-time scrolling karaoke playback, instrumental track indicators, and timestamp click-to-seek.
      - Persistent bottom Spotify player bar with playback controls, shuffle, repeat (all/one), scrubber progress slider, volume controls, keyboard shortcuts, and MediaSession integration.
17. **Track Vault Audiophile Studio Player & Viewport Scroll Fix**:
    - Resolved full-page browser scrolling on `/player` by dynamically conditioning `src/routes/+layout.svelte` to apply `h-[100dvh] overflow-hidden` and omit the global footer when viewing `/player`.
    - Constrained scrolling strictly to inner containers (`overflow-y-auto min-h-0` on tracklist table, library drawer, and lyrics panel) so mouse wheel scrolling smoothly moves songs without shifting the page layout.
    - Redesigned player with a bespoke Track Vault audiophile studio aesthetic: obsidian glassmorphic panels (`bg-neutral-900/60 backdrop-blur-xl`), floating rounded studio bottom dock (`bg-neutral-900/85 backdrop-blur-2xl shadow-2xl`), vibrant gradient play button (`from-emerald-500 to-teal-400`), high-res vinyl album sleeve with ambient emerald glow, and studio teleprompter lyrics.
18. **Persistent Background Audio Across Tabs & Player Lyrics Refinement**:
    - Centralized audio playback into a singleton Svelte 5 store (`src/lib/services/player.svelte.ts`) and mounted a persistent `<audio>` element inside root `+layout.svelte`.
    - Enabled uninterrupted background music playback when navigating between any pages (`/`, `/issues`, `/lrc-maker`, `/scan`, `/settings`) and across browser tabs.
    - Added floating `GlobalMiniPlayer.svelte` dock on non-player pages with album art, track details, play/pause, skip, progress scrubber, volume, open studio player shortcut, and stop/close dismiss button.
    - Refined lyrics typography in `/player`: enlarged default inactive lines to `text-[15px] font-medium leading-relaxed` and active singing line to `text-[17px] font-bold leading-relaxed text-emerald-300 drop-shadow-[0_0_10px_rgba(16,185,129,0.35)] bg-emerald-950/20`, eliminating jarring 2x size jumps and layout shifts.
19. **Exact Audio Bitrate & Fidelity Extraction Across Track Vault**:
    - Added database columns `bitrate_kbps`, `sample_rate`, and `bits_per_sample` to the SQLite `tracks` table with idempotent `PRAGMA table_info` migrations.
    - Updated `createAlbum`, `addTrackToAlbum`, and `updateTrack` in `src/lib/server/db.ts` to persist exact bitrates and sample rates.
    - Implemented automated server boot backfill routine in `src/lib/server/scanner.ts` and `src/hooks.server.ts` extracting audio bitrates via `music-metadata` (and duration/size fallback) without blocking server startup.
    - Updated `getBitrateLabel(format, bitrate_kbps)` in `src/lib/utils.ts` to return precise formatted bitrates (e.g., `893 kbps`, `1,049 kbps`).
    - Exposed exact bitrates across all views:
      - `/player`: Bottom floating dock (`FLAC • 893 kbps • 16-bit / 48.0 kHz`), song rows table, and queue drawer.
      - `GlobalMiniPlayer.svelte`: Now-playing audio fidelity pill.
      - `/album/[id]` (`TrackRow.svelte`): Exact bitrate badge.
      - `/issues`: Track table badge.
      - `/lrc-maker`: Audio header source label.
    - Added API endpoint `GET /api/tracks/[id]` for retrieving track metadata and bitrates.
20. **Security & Code Review Remediation (Review Findings Fixes)**:
    - **Lyrics Overwrite Safety & Path Validation**: In `src/routes/api/tracks/[id]/lyrics/+server.ts`, enforced `save_to_disk` flag, added directory traversal boundary checks using `isPathWithin(dir, musicDir)`, and required explicit `overwrite: true` confirmation before modifying existing companion files on disk.
    - **Player Page Server Payload Optimization**: In `src/routes/player/+page.server.ts`, filtered out `lyrics_text`, `file_path`, and `notes`, and eliminated duplicate `allTracks` array from the payload, drastically reducing initial network response size.
    - **Instrumental Detection Fix**: Aligned the lyrics API response (`lyrics_status` and `status`) with `/player` and `lrc-maker`, ensuring tracks marked instrumental render musical note markers even if `lyrics_text` is empty.
    - **Multi-Timestamp LRC Support**: Updated LRC parsing in both `/player` and `/lrc-maker` to extract multiple timestamps on single lines (e.g. `[00:10.00][00:20.00]Chorus`) and sort timed lyrics chronologically.
    - **Audio Playback State Synchronization**: Updated `src/lib/services/player.svelte.ts` to strictly derive `isPlaying` from `HTMLAudioElement` events (`onplay`, `onplaying`, `onpause`, `onerror`, `onended`) and gracefully handle rejected `play()` promises.
    - **Format & Quality Classification Precision**: Refined `detectFormatAndQuality()` in `scanner.ts` to prevent false `MP3_V0` labels on arbitrary bitrates and avoid inferring Hi-Res without verified high bit depth and sample rate.
    - **Dynamic Picard URL**: Updated `+layout.server.ts` and `settings/+page.server.ts` to dynamically resolve the Picard Web GUI address from `url.hostname`, fixing broken links when accessing Track Vault across the LAN or mobile devices.
21. **Subsonic & OpenSubsonic API Server (Navidrome Alternative)**:
    - Implemented native Subsonic REST protocol routing at `/rest/[...endpoint]` (`src/routes/rest/[...endpoint]/+server.ts`) supporting both JSON (`f=json`, JSONP) and standard Subsonic XML serialization.
    - Added Subsonic cryptographic module (`src/lib/server/subsonic/crypto.ts`) storing AES-256-GCM encrypted passwords (`subsonic_secret`) in the `users` SQLite table with automatic server key generation (`data/subsonic.key`).
    - Implemented dual authentication: modern MD5 client token hashing (`token = MD5(password + salt)`) and legacy cleartext/hex-encoded password parameter decoding (`enc:hex`).
    - Added database migrations with `PRAGMA table_info` checks for `users.subsonic_secret`, `tracks.play_count`, `tracks.last_played_at`, `starred_items`, `playlists`, and `playlist_tracks`.
    - Added comprehensive Subsonic endpoints (`src/lib/server/subsonic/handlers.ts`):
      - System: `ping.view`, `getLicense.view`, `getMusicFolders.view`.
      - Browsing: `getArtists.view`, `getArtist.view`, `getArtistInfo.view`, `getAlbum.view`, `getSong.view`, `getAlbumList2.view`, `getRandomSongs.view`, `getGenres.view`.
      - Search: `search3.view`, `search2.view`.
      - Media: `stream.view` with HTTP 206 Partial Content byte-range seeking, `getCoverArt.view` with cached album/track covers.
      - User Data & Playlists: `star.view`, `unstar.view`, `getStarred2.view`, `scrobble.view`, `getPlaylists.view`, `getPlaylist.view`, `createPlaylist.view`, `updatePlaylist.view`, `deletePlaylist.view`.
    - Implemented OpenSubsonic extension `getLyricsBySongId.view` directly parsing Track Vault's synchronized companion `.lrc` lyrics into structured millisecond-timed karaoke lines for mobile apps like Symfonium.
    - Updated `src/hooks.server.ts` to allow `/rest` requests to bypass browser session cookie redirects.
    - Added Subsonic & OpenSubsonic integration card to `/settings` with one-click server URL copying, token authentication status, and instant activation form.
22. **Feishin Desktop Client Compatibility & Handshake**:
    - Resolved Feishin "Failed to log in" errors by implementing required Subsonic protocol handshake endpoints: `getUser.view`, `getUsers.view`, `getScanStatus.view`, `startScan.view`, `getNowPlaying.view`, and `getBookmarks.view`.
    - Enhanced route dispatcher in `src/routes/rest/[...endpoint]/+server.ts` to automatically strip redundant `/rest` segments when clients like Feishin append `/rest/` to custom URLs (e.g., `http://<ip>:3000/rest/rest/ping.view` -> `ping.view`).
    - Added authentication self-healing: both web logins (`authenticateUser` in `src/lib/server/auth.ts`) and legacy password parameter logins (`p=password` in `src/lib/server/subsonic/auth.ts`) automatically encrypt and persist `subsonic_secret`, enabling seamless MD5 token auth without manual setup.
23. **Feishin Subsonic Song Loading & Catalog Browsing Endpoints**:
    - Resolved Feishin empty library/song view by implementing core Subsonic catalog discovery endpoints in `src/lib/server/subsonic/handlers.ts`:
      - `getIndexes.view`: Alphabetical artist directory indexing with `lastModified` timestamps and article ignoring.
      - `getMusicDirectory.view`: Recursive folder/directory browsing resolving root folders (`id=0`, `id=root`), artist directories (`id=art_...`), and album directories (`id=al-...` / numeric IDs). Disambiguated album ID `1` from root folder `1`.
      - `getSongsByGenre.view`: Genre-filtered song lists with offset and limit pagination.
      - `getTopSongs.view`: Artist discography top tracks ranked by play count.
      - `getSimilarSongs.view` / `getSimilarSongs2.view`: Related tracks discovery for radio/smart playback.
      - `getAlbumInfo.view` / `getAlbumInfo2.view`: Rich album metadata and cover references.
      - `getPlayQueue.view` / `savePlayQueue.view`: Subsonic play queue synchronization backed by SQLite `play_queues` table.
      - `getSongs.view`: OpenSubsonic flat song list pagination.
    - Updated `search3.view` & `search2.view` to return full catalog when given empty queries (`query=""` or `query="*"`), enabling Feishin to instantly populate its Songs view.
    - Added required `size` (in bytes) and `format` fields to `trackToSubsonicSong` using filesystem stats (`fs.statSync`) and bitrate fallback.
    - Added automatic calculation of total album `duration` and `songCount` in `albumToSubsonicAlbum` so album lists and cards show full playback length.
    - Added database queries in `src/lib/server/db.ts`: `getAllTracksPaged`, `getTracksByGenre`, `getTopTracksByArtist`, `getPlayQueue`, and `savePlayQueue`.
    - Added structured Subsonic request logging and case-insensitive action dispatcher in `src/routes/rest/[...endpoint]/+server.ts`.

24. **Feishin Zod Schema Compliance, Pagination Loop Fix, & CSRF Exemption**:
    - **Feishin Infinite Pagination Loop Fix**: Resolved `search3` infinite loop in `getSongListCount` where Feishin tested out-of-bounds offsets (`songOffset: 50000`). `search3` now properly parses `artistOffset`, `artistCount`, `albumOffset`, `albumCount`, `songOffset`, and `songCount`, and returns empty arrays when queries exceed catalog size instead of repeating offset 0.
    - **Strict Zod Schema Compliance**: Aligned Subsonic JSON responses with Feishin's `@ts-rest/core` and Zod client validation schemas:
      - `song`: Added required `artists`, `albumArtists`, `discNumber`, `created`, `parent`, `isDir: false`, `isVideo: false`, and boolean `starred`.
      - `album`: Added required `album`, `title`, `artists`, `parent`, `isDir: true`, `isVideo: false`, and boolean `starred`.
      - `getScanStatus`: Added required `folderCount` to `scanStatusBody`.
      - `getIndexes`: Added required `child: []` and `shortcut: []` arrays to `indexes`.
      - `getArtists` & `getArtist`: Standardized `albumCount` as string (e.g. `"1"`) and added `roles: ['artist']`.
      - `getStarred`: Ensured `artist`, `album`, and `song` arrays are always present with valid schemas.
    - **CSRF & FormPost Handling**:
      - Removed `formPost` from `getOpenSubsonicExtensions` so desktop clients default to standard Subsonic `GET` requests for browsing.
      - Added `csrf: { trustedOrigins: ['*'] }` in `vite.config.ts` allowing external Subsonic clients to send `POST` requests without triggering SvelteKit's `Cross-site POST form submissions are forbidden`.
      - Enhanced `extractParams` in `src/routes/rest/[...endpoint]/+server.ts` to parse `application/x-www-form-urlencoded` POST bodies using `request.clone().text()` and `URLSearchParams`.

25. **Native MusicBrainz Tagger Studio (Picard Container Removal)**:
    - Completely removed the secondary `picard` Docker service (`jlesage/musicbrainz-picard:latest` on port 5800) and `PICARD_URL` environment configuration, reducing host footprint and resource consumption.
    - Added `@dantheman827/taglib-ts` for pure TypeScript cross-platform audio tag reading and writing (`.flac`, `.mp3`, `.m4a`, `.ogg`, `.wav`) without native compilation.
    - Implemented core tagger engine (`src/lib/server/tagger.ts`):
      - `alignTracks()`: Multi-factor fuzzy track alignment scoring position, normalized string similarity (Levenshtein & token Dice coefficient), and duration delta.
      - `writeTagsToAudioFile()`: Safe TagLib buffer mutation preserving audio streams while writing verified track, title, artist, album, and year tags.
      - `downloadAndSaveCover()`: Automatically downloads high-resolution front artwork from Cover Art Archive into the album folder (`cover.jpg`).
      - `applyAlbumTags()`: Orchestrates file tag writing, cover downloading, and SQLite database persistence.
    - Added serialized rate-limiting queue with 503 backoff in `src/lib/server/musicbrainz.ts` preventing MusicBrainz IP rate limit rejections.
    - Added SQLite database helper `updateAlbumAndTracksFromMusicBrainz` updating metadata, recomputing fixer rules, and marking songs as manually checked.
    - Added REST API endpoints:
      - `GET /api/tagger/search`: MusicBrainz release queries with artist/album parameters.
      - `GET /api/tagger/release/[mbid]`: Full release tracklist and Cover Art Archive thumbnails.
      - `GET / POST /api/tagger/albums/[id]/match`: Automatic candidate lookup and side-by-side track alignment diff with confidence scores.
      - `POST /api/tagger/albums/[id]/apply`: Batch file tagging and library synchronization.
    - Built native interactive Tagger Studio (`/tagger`, `src/routes/tagger/+page.svelte` & `+page.server.ts`):
      - Library album drawer with search and verification filters.
      - MusicBrainz candidate release grid with cover art, release date, format, and country.
      - Side-by-side interactive diff table with match pills (`100% Match`, `Title Diff`, `Duration Diff`) and dropdown remap selection.
      - Cover art and metadata toggle switches with live progress indicator.
    - Deep UI integrations:
      - Replaced Picard external links in Navbar desktop & 7-tab mobile navigation with direct `/tagger` links.
      - Updated album detail page (`/album/[id]`) with "Auto-Tag with MusicBrainz" shortcut.
      - Updated Scanner warning banner and Settings system cards to point to native `/tagger`.

26. **Album Cover Serving Endpoint & Tagger Cover Path Resolution**:
    - Created dedicated REST endpoint `GET /api/albums/[id]/cover` (`src/routes/api/albums/[id]/cover/+server.ts`) resolving album artwork from `cover_url`, track directory candidate search (`cover.jpg`, `cover.png`, `folder.jpg`, `front.jpg`), or external URL redirect.
    - Updated `applyAlbumTags` in `src/lib/server/tagger.ts` to map downloaded cover art into container-compatible `/api/library/cover?path=...` URLs.
    - Repaired database record for existing tagged albums to point to verified local cover images.

27. **Pre-Import MusicBrainz Tagger & Missing Track Detection**:
    - **Scanned Folders Mode in Tagger Studio**: Added dual-mode tab switcher to `/tagger` (`Vault Albums` vs `Scanned Folders`), allowing users to browse, search, and tag unimported audio folders before adding them to the database.
    - **1-Click Tagging from Library Scanner**: Added direct `Tag` button on every scanned album card in `/scan` linking to `/tagger?folderPath=...`.
    - **Missing Songs Alert Banner**: Automatically identifies when a MusicBrainz release contains tracks not present in the local directory, rendering an amber/rose alert banner with exact track numbers, titles, and durations so users can verify completeness.
    - **Real-Time Track Alignment & Re-mapping**: Aligns raw folder audio files (`.flac`, `.mp3`, etc.) using fuzzy title/artist distance, track numbers, and durations, with real-time missing songs updates when remapping.
    - **Direct Tag Writing & 1-Click Vault Import**: Added `applyFolderTags()` to write verified tags to files on disk, save `cover.jpg`, and optionally import the cleanly tagged album into SQLite with `manually_checked = 1`.
    - **API Endpoints**:
      - `GET /api/tagger/folders`: Scanned music folders directory index.
      - `GET / POST /api/tagger/folder/match`: Folder alignment with MusicBrainz candidates and missing track computation.
      - `POST /api/tagger/folder/apply`: Batch disk file tagging and optional Vault album creation.

28. **Playlist Creation, Reordering & Full Symfonium / Subsonic Protocol Compatibility**:
    - **Database & Data Model**:
      - Updated `Playlist` interface with optional `cover_url` dynamically resolved from the first song in the playlist.
      - Updated `getUserPlaylists` and `getPlaylistById` in `src/lib/server/db.ts` to compute `song_count`, total `duration_ms`, and `cover_url` via SQLite subqueries.
      - Added `createPlaylist` supporting `is_public` and tracklists.
      - Added `updatePlaylist` supporting `isPublic` flag toggling and `track_order` defragmentation.
      - Added `replacePlaylistTracks(playlistId, trackIds)` for atomic reordering/replacement in a single transaction.
      - Added `removePlaylistTrack(playlistId, trackId?, trackIndex?)`.
    - **Subsonic & OpenSubsonic Compatibility (Symfonium, Feishin, DSub)**:
      - `getPlaylists.view`: Guaranteed `playlist: []` array, supports `username` query, serves `coverArt: pl-${id}`.
      - `getPlaylist.view`: Full `entry: []` serialization containing artists, albumArtists, bitrates, file sizes, and paths.
      - `createPlaylist.view`: Added support for `params.playlistId` to replace and reorder tracks, matching Symfonium's native sync and reordering mechanism.
      - `updatePlaylist.view`: Supports `public` boolean parameter, `songIdToAdd`, and `songIndexToRemove`.
      - `deletePlaylist.view`: Accepts both `id` and `playlistId`.
      - `getCoverArt.view`: Added `pl-${id}` handler resolving the cover art image of the first song in the playlist.
    - **Web REST API Endpoints**:
      - `GET / POST /api/playlists`: Playlists list and creation.
      - `GET / PATCH / DELETE /api/playlists/[id]`: Playlist metadata and deletion.
      - `POST / PUT / DELETE /api/playlists/[id]/tracks`: Track addition, atomic reordering, and removal.
    - **Player Service**:
      - Added `player.playPlaylist(playlist, tracks, startIndex)` supporting persistent background playback across routes with synthetic album queue representations.
    - **Web UI & Navigation**:
      - Built interactive Playlists Hub at `/playlists` with grid view, hover play overlays, dynamic cover art, search filtering, and "+ Create Playlist" modal.
      - Built Playlist Detail view at `/playlist/[id]` with Play All, Shuffle Play, Edit Details, Delete, track numbers, duration, format badges, up/down track reordering, and track removal.
      - Added reusable popover `AddToPlaylistModal.svelte` with search, 1-click add, and inline playlist creation.
      - Integrated "Add to Playlist" across Track Vault: Album detail hero action bar (`/album/[id]`), individual song rows (`TrackRow.svelte`), and Audiophile Player studio (`/player` hero and track rows).
      - Added `Playlists` navigation link to desktop navbar and 8-tab mobile bottom bar.

28. **Unified Audiophile Player Studio with Integrated Playlists**:
    - **User-Requested UX Consolidation**: Eliminated separate "Playlists" navigation tab to avoid clutter and unified library browsing into the Audiophile Player Studio (`/player`).
    - **Navbar Streamlining**:
      - Reverted desktop navigation to 6 clean links: `Vault`, `Player`, `Fixer`, `Tagger`, `LRC Maker`, `Scan`.
      - Reverted mobile bottom navigation to 7 clean tabs: `Vault`, `Player`, `Fixer`, `Tagger`, `LRC`, `Scan`, `Settings`.
    - **Player Studio Library Drawer (`/player`)**:
      - Added Spotify-style segmented switcher: `[ 💿 Albums (X) ]  [ 📋 Playlists (Y) ]` with instant "+ Playlist" creation trigger.
      - Integrated interactive playlists list showing cover art previews, track counts, formatted duration, public/private indicators, and hover play.
      - Added dedicated Playlist Hero banner displaying dynamic artwork, track count, total playback time, Play All, Shuffle Play, Edit Details, and Delete buttons.
      - Integrated in-player playlist track table with active equalizer indicators, exact bitrate badges, dragless Move Up / Move Down song reordering, and 1-click track removal.
      - Built inline modal dialogs for "Create Playlist", "Edit Playlist", and "Delete Playlist" directly inside `/player`.
      - Connected `AddToPlaylistModal` callback refreshing local playlist state without page reloads.
    - **Legacy URL Redirection**:
      - Added HTTP 303 redirects in `src/hooks.server.ts` routing `/playlists` -> `/player?view=playlists` and `/playlist/:id` -> `/player?playlistId=:id`.
      - Removed legacy route folders `src/routes/playlists` and `src/routes/playlist`.

29. **Automated Forgejo Actions Docker CI & Clone-Free Server Deployment**:
    - **CI/CD Workflow (`.forgejo/workflows/docker-publish.yml`)**:
      - Automated build and push on every `git push` to `main`, version tags (`v*`), or via manual `workflow_dispatch`.
      - Runs on self-hosted Forgejo runner (`runs-on: docker`) with native Docker daemon execution.
      - Automated publication to Forgejo Container Registry: `git.kapyhub.cz/kapybara/trax-vault:latest` (with sha and semver tag variants).
    - **Clone-Free Server Deployment (`docker-compose.server.yml`)**:
      - Standalone, ready-to-run Docker Compose definition referencing `git.kapyhub.cz/kapybara/trax-vault:latest`.
      - Enables headless server deployments without cloning the Git repository, installing Node.js, or compiling C++ dependencies on the target host.
      - 1-command upgrade workflow: `docker compose pull && docker compose up -d`.

30. **Project Renamed to Trax Vault (`trax-vault`)**:
    - Renamed application branding across all pages, titles, navbar logo, and footer to **Trax Vault** (`trax-vault`).
    - Updated git remote origin to `git@github.com:Kapybara48/trax-vault.git`.
    - Implemented database backward compatibility in `src/lib/server/db.ts`: `resolveDatabasePath()` checks for `traxvault.db` and seamlessly falls back to legacy `trackvault.db` without data loss.
    - Preserved active user sessions (`SESSION_COOKIE_NAME = 'vault_session'`).
    - Migrated audio player storage keys to `traxvault_player_*` with fallback to `trackvault_player_*`.
    - Updated Subsonic protocol `SERVER_TYPE = 'traxvault'` and root music folder to `Trax Vault Music`.
    - Updated container names and images to `trax-vault` and `ghcr.io/kapybara48/trax-vault:latest`.

31. **Version Lifecycle & N-1 Stepping-Stone Upgrade Architecture (`v1.6 -> v1.7 -> v2.0`)**:
    - Declared centralized version configuration in `src/lib/version.ts`:
      - `APP_VERSION = '1.7.0'`, `CURRENT_SCHEMA_VERSION = 170`, `MIN_COMPATIBLE_VERSION = '1.6.0'`, `MIN_COMPATIBLE_SCHEMA_VERSION = 160`.
    - **v1.7 Migration Engine (`prepareDatabase()` in `src/lib/server/db.ts`)**:
      - Auto-detects legacy `trackvault.db` (v1.6).
      - Flushes SQLite write-ahead log (`PRAGMA wal_checkpoint(TRUNCATE)`) to prevent data loss.
      - Safely copies database to `traxvault.db`.
      - Archives original file as timestamped backup (`trackvault.db.v1.6.<timestamp>.bak`) alongside `-wal` and `-shm`.
      - Stamps `PRAGMA user_version = 170` and records detailed migration audit history in SQLite `system_metadata` table (`app_version`, `schema_version`, `migrated_from = '1.6.0'`, `migrated_at`).
    - **N-1 Stepping-Stone Guard for v2.0+**:
      - If `MIN_COMPATIBLE_SCHEMA_VERSION > 160` (as in v2.0) and a user attempts to boot with only a raw v1.6 database (`trackvault.db`), the server aborts startup immediately with a clear, actionable fatal error message instructing them to upgrade to v1.7 first.
    - **Global Version Synchronization**:
      - Synchronized `package.json` to `1.7.0`.
      - Updated Subsonic `SERVER_VERSION = APP_VERSION` (`1.7.0`) in `format.ts`.
      - Updated User-Agent headers across MusicBrainz, Tagger, and Lyrics endpoints to `TraxVault/1.7.0`.
      - Added Application Version (`v1.7.0 schema 170`) and Migration Bridge status pill to `/settings`.
      - Updated layout footer to `Trax Vault v1.7`.

32. **Player Studio Lyrics Center Stage & Songs Right Dock Layout**:
    - Reconfigured layout ordering in `src/routes/player/+page.svelte` when opening live synced lyrics:
      - **Left (`order-1 w-72 lg:w-80`)**: Your Library (Albums & Playlists).
      - **Middle (`order-2 flex-1`)**: Live Synced Lyrics Studio taking center stage with spacious karaoke lines, smooth auto-follow vertical scrolling, instrumental track indicators, and top-right close action.
      - **Right (`order-3 flex-1 min-w-[320px] lg:min-w-[380px] lg:max-w-[480px] xl:max-w-[540px]`)**: Songs & Hero dock displaying album/playlist details, playback controls, and tracklist table.
    - Added responsive hero banner compaction (slimmer cover and action bar) and column decluttering:
      - Completely removes "Quality" and "Lyrics" columns from the song list table when lyrics are open, providing maximum space for song titles and artists in the right dock.
      - Automatically adjusts multi-disc divider `colspan` between 4 and 6 columns.
    - When lyrics are closed, the songs panel seamlessly transitions back to full center stage (`order-2 flex-1 min-w-0`), restoring full Quality and Lyrics columns.
    - Dedicated Play Queue drawer retained on the right (`order-3 w-80 lg:w-96`) when opened independently.

33. **Multi-Disc Separators & CD Management in Audiophile Player Studio**:
    - **Multi-Disc Detection**: Added reactive derived state in `src/routes/player/+page.svelte` (`albumDiscCount` and `albumHasMultipleDiscs`) detecting multi-disc albums (e.g. Eminem - *Encore* with Disc 1 tracks 1–20 and Disc 2 tracks 1–3). Single-disc albums omit disc divider clutter.
    - **Sticky Disc / CD Dividers**:
      - Inserted sticky divider rows (`sticky top-8 z-[5] bg-neutral-900/95 backdrop-blur-md`) in the tracklist table between discs.
      - Renders disc number badge, disc track count, and disc playback duration (`Disc X • Y tracks (duration)`).
      - Added 1-click "Play Disc" button starting playback immediately from track 1 of that disc while preserving the entire album in the queue.
    - **Album Hero Metadata**: Updated track count pill in the album hero banner to reflect CD count when multi-disc (e.g. `23 tracks (2 CDs)`).
    - **Disc Context Across UI**:
      - Added amber `CD X` badges in the Play Queue drawer (`Now Playing` and `Next Up` tracks) for tracks on non-primary discs (`disc_number > 1`).
      - Added `CD X` badge to the persistent bottom floating audio dock and `GlobalMiniPlayer.svelte` fidelity bar.

34. **Automated Library Disk Synchronization & Symfonium Subsonic Compatibility**:
    - **Automated Library Sync Engine (`src/lib/server/scanner.ts`)**:
      - Implemented `syncLibraryFromDisk()`: automatically scans `./music`, imports unimported albums into the database without requiring manual web UI interactions, and checks existing vault albums for new tracks on disk adding them via `addTrackToAlbum()`.
      - Added `getLibraryScanStatus()` tracking live scanning execution state (`scanning: boolean`, `lastScan: number`).
    - **Startup Auto-Sync (`src/hooks.server.ts`)**:
      - Connected non-blocking background `syncLibraryFromDisk()` on server startup, ensuring any albums or tracks added while the server was offline or during updates are imported immediately.
    - **Subsonic `startScan.view` & `getScanStatus.view` Endpoints (`src/lib/server/subsonic/handlers.ts`)**:
      - Connected `startScan.view` to launch `syncLibraryFromDisk()` in the background and immediately report `scanning: true`.
      - Updated `getScanStatus.view` to return live scanning state (`scanning: true/false`), updated `count` of tracks, `folderCount`, and `lastScan` UTC timestamp.
    - **Symfonium Strict ISO-8601 UTC Date Compliance**:
      - Created `formatIsoDate(dateStr)` converting SQLite `YYYY-MM-DD HH:MM:SS` UTC dates into strict ISO-8601 strings (`YYYY-MM-DDTHH:mm:ss.sssZ`).
      - Resolved Symfonium Android Kotlin crashes where `Instant.parse` failed on raw SQLite timestamps.
      - Applied strict ISO dates to `trackToSubsonicSong` (`created`), `albumToSubsonicAlbum` (`created`), and `getIndexes` (`lastModified`).
    - **Subsonic ID Prefix Resilience & Routing**:
      - Defensively stripped prefixes (`al-`, `tr-`, `art-`) across `getAlbum`, `getSong`, `getArtist`, `getSimilarSongs`, `getSimilarSongs2`, `scrobble`, `getLyricsBySongId`, `stream`, and `getCoverArt`.
      - Disambiguated root directory `id=0` and `id=root` in `getMusicDirectory` from numeric album ID `1`.
      - Fixed doubled artist cover art prefix (`art-art_...` -> clean `art_...`).
    - **Scan API Sync Endpoint**:
35. **Migration to Self-Hosted Forgejo & Forgejo Actions Runner**:
    - **Forgejo Remote Configuration**:
      - Configured repository remote to Forgejo SSH alias: `origin` -> `forgejo:kapybara/trax-vault.git`.
    - **Forgejo Actions CI/CD (`.forgejo/workflows/docker-publish.yml`)**:
      - Migrated workflow from `.github/workflows` to `.forgejo/workflows`.
      - Configured runner target: `runs-on: docker` to match registered self-hosted runner `sam`.
      - Added automatic fallback verification for Docker CLI inside runner environment.
      - Automated authentication against Forgejo Container Registry (`git.kapyhub.cz`) using `${{ secrets.GITHUB_TOKEN }}` and actor.
      - Published Docker image: `git.kapyhub.cz/kapybara/trax-vault:latest` and tagged commits.
    - **Server Deployment Definition**:
      - Updated `docker-compose.server.yml` and `docker-compose.yml` to pull from `git.kapyhub.cz/kapybara/trax-vault:latest`.

36. **Symfonium Subsonic Library Sync Fixes & Auto-Sync Configuration**:
    - **OpenSubsonic Public Handshake**:
      - Made `getOpenSubsonicExtensions.view` accessible without authentication credentials per OpenSubsonic specification, allowing Symfonium to probe extensions before authentication without receiving error code 10.
      - Made unauthenticated `ping.view` return 200 OK so reachability probes succeed.
    - **Integer `albumCount` Schema Alignment**:
      - Restored `albumCount` as an integer (`xs:int`) across `getArtists`, `getArtist`, `getIndexes`, `search3`, `getStarred`, and `getStarred2` (was string `"10"`), resolving Android Kotlin/Moshi deserialization crashes (`Expected BEGIN_NUMBER but was STRING`) in Symfonium.
    - **Music Folder Mapping (`id: 1`) & Directory Collision Fix**:
      - Standardized `getMusicFolders.view` to return `[{ id: 1, name: 'Trax Vault Music' }]` and aligned `getUser` / `getUsers` to `folder: [1]`.
      - In `getMusicDirectory.view`, disambiguated root folder IDs (`id=1`, `id=0`, `id=root`, `id=folder-1`) from album ID 1. Prefixed child albums in artist directory with `al-${a.id}` so clicking an album never collides with root folder `1`.
    - **Query Type Support in `getAlbumList`**:
      - Added support for `byName`, `byArtist`, and `starred` in `getAlbumList` in `src/lib/server/db.ts`.
    - **Extended Audio Format & Disc Folder Recognition**:
      - Expanded `AUDIO_EXTENSIONS` in `src/lib/server/scanner.ts` to include `.aif`, `.ape`, `.wv`, `.dsf`, `.dff`, `.m4b`, and `.mpc`.
      - Enhanced multi-disc folder regex to recognize `CD1 - Title`, `Disc 01`, `Bonus Disc`, and `Extra CD`.
    - **Startup Library Auto-Sync Toggle**:
      - Added `AUTO_SYNC_LIBRARY` environment variable in `src/hooks.server.ts` and `docker-compose.yml` allowing users to disable automated disk-to-vault synchronization if they prefer manual curation via `/scan`.

37. **Symfonium Moshi `starred` Deserialization Fix, Vault Deletion & Opt-In Auto-Sync**:
    - **`starred` Attribute ISO-8601 Serialization Bug (Root Cause of Symfonium 0 Songs)**:
      - In `src/lib/server/subsonic/handlers.ts`, `trackToSubsonicSong` (line 134) and `albumToSubsonicAlbum` (line 181) were returning boolean `song.starred = true` / `alb.starred = true`.
      - In Subsonic XSD schema (`subsonic-rest-api.xsd`), `starred` is defined as `xs:dateTime`. Feishin (TypeScript / Zod) accepted boolean `true`, but Symfonium (Android Kotlin / Moshi) parsed `starred` as a Date/String and crashed with `JsonDataException: Expected a string but was true`, silently discarding songs/albums and resulting in 0 songs.
      - Fixed `song.starred` and `alb.starred` to serialize strictly as ISO-8601 UTC date strings (`formatIsoDate(...) || new Date().toISOString()`).
      - Stripped wrapping quotes from `search3.view?query=""` empty sync queries.
      - Removed unrecognized proprietary `lyrics` entry from `getOpenSubsonicExtensions` (retaining standard `songLyrics` and `topSongsByArtistId`).
      - Standardized root music folder ID to `0` and disambiguated root directory browsing from album ID `1`.
    - **Opt-In Startup Sync (Preventing Unwanted Auto-Import)**:
      - Changed `shouldAutoSync` in `src/hooks.server.ts` to strictly opt-in (`process.env.AUTO_SYNC_LIBRARY === 'true'`).
      - Defaulted `AUTO_SYNC_LIBRARY=false` in `docker-compose.yml` so users can curate, preview, and tag albums in `/scan` before importing without them being automatically shoved into the Vault on reboot.
    - **1-Click Album & Song Removal from Vault back to Scanner**:
      - Added `existing_album_id` to `ScannedAlbum` in `src/lib/types/index.ts` and populated it in `scanLibraryDirectory`.
      - On `/scan` (`src/routes/scan/+page.svelte`):
        - Added `In Vault` filter pill to isolate tracked albums.
        - Replaced static `Already Tracked` label with an `In Vault` badge and a prominent `Remove from Vault` button (calls `DELETE /api/albums/{id}`, returns album to unvaulted state with checkboxes, and preserves audio files on disk).
        - Added `Remove All Filtered from Vault` batch action when filtered to `In Vault`.
      - On main Vault page (`/` and `src/lib/components/AlbumCard.svelte`):
        - Added a hover trash action button on the top-left of each album card allowing instant unvaulting with confirmation.
        - Connected `onAlbumDeleted` callback calling `invalidateAll()`.
        - Added quick delete action for individual songs in the `tracks` table view.
      - Clarified confirmation dialogs across `/album/[id]` and `TrackRow.svelte` assuring users that audio files on disk in `./music` remain completely untouched.

38. **CI/CD Path Filtering & Allow-List**:
    - Replaced permissive path filters with a strict `paths:` allow-list in `.forgejo/workflows/docker-publish.yml` targeting only application source and container files (`src/**`, `static/**`, `Dockerfile`, `.dockerignore`, `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `docker-compose.yml`).
    - Skips Docker container image builds and registry pushes when updating documentation, README files, or non-app configuration files, preserving runner resources and build time.

39. **Multi-Album Selection & Batch Deletion in Vault**:
    - **Database Batch Removal**:
      - Added `deleteAlbums(ids: number[])` to `src/lib/server/db.ts` deleting album records and corresponding `starred_items` in a single SQLite transaction with cascading foreign keys to `tracks`.
      - Updated `deleteAlbum(id: number)` to also clean up associated `starred_items`.
    - **REST API Endpoint**:
      - Added `DELETE /api/albums` (`src/routes/api/albums/+server.ts`) accepting `{ ids: number[] }` and invoking `deleteAlbums(albumIds)`.
    - **AlbumCard Multi-Select Checkbox**:
      - Added `selected`, `selectionMode`, and `onToggleSelect` props to `src/lib/components/AlbumCard.svelte`.
      - Embedded `CustomCheckbox` at top-left of album artwork, visible on hover, when selected, or when selection mode is active.
      - Added distinct selected styles: emerald border, glowing ring (`ring-2 ring-emerald-500/70`), and elevation.
      - Clicking cards in selection mode toggles selection; clicking without selection navigates to `/album/[id]`.
    - **Vault Multi-Select UI & Actions**:
      - On main Vault page (`src/routes/+page.svelte`), added batch selection header above album grid with "Select All / Deselect All", count badge, clear button, and red "Remove Selected (N)" trash can action.
      - Added floating batch actions dock with count pill and "Remove from Vault" button positioned dynamically to prevent overlapping the persistent mini-player.
      - Guaranteed audio files on disk in `./music` remain completely untouched when removing albums from the Vault.

40. **LRCGET-Style Multi-Candidate LRCLIB Search & Preview Selector**:
    - **Multi-Candidate Search Backend**:
      - Upgraded `GET /api/lyrics/search` (`src/routes/api/lyrics/search/+server.ts`) to query both exact `/api/get` and query-based `/api/search` endpoints on `lrclib.net`.
      - Deduplicates results by ID, flags exact matches (`isExactMatch: true`), and returns an array of candidates (`candidates: LrcLibCandidate[]`) alongside backwards-compatible legacy fields.
      - Added `LrcLibCandidate` interface in `src/lib/types/index.ts`.
    - **Reusable Candidate Selector Modal (`src/lib/components/LrcLibModal.svelte`)**:
      - 2-pane responsive modal inspired by LRCGET:
        - Left pane: Live search bar with instant re-query, candidate cards showing track name, artist, album, track duration, and duration delta compared to target audio (color-coded $\le \pm 2\text{s}$ green, $\le \pm 8\text{s}$ amber, $> 8\text{s}$ rose), and badge indicators (`Synced LRC`, `Plain TXT`, `Instrumental`).
        - Right pane: Full lyrics preview with tabs to toggle between synced lyrics (with formatted millisecond timestamps) and plain text, empty state, and 1-click action buttons: "Use Synced LRC", "Use Plain Text", and "Apply as Instrumental".
    - **Integration Across Studio & Album Views**:
      - Integrated `<LrcLibModal>` in LRC Maker Studio (`src/routes/lrc-maker/+page.svelte`), replacing the legacy 1-result picker with full candidate search, preview, and application into editor lines.
      - Integrated "Fetch LRCLIB" button into Quick Lyrics File Editor toolbar in Album Detail view (`src/routes/album/[id]/+page.svelte`), allowing users to search and import lyrics into companion files directly from the album page.

41. **LRC Maker Audio Volume Slider, Mute Toggle & Persistence**:
    - Added interactive volume controls to the Audio Player Toolbar in LRC Maker Studio (`src/routes/lrc-maker/+page.svelte`):
      - Dynamic mute toggle button with state icons (`VolumeX` for muted, `Volume1` for <50%, `Volume2` for >=50%) and `KeyM` keyboard shortcut.
      - Smooth range slider (`accent-emerald-500`) with mouse wheel adjustment (scroll up/down over control adjusts volume by ±5%).
      - Tabular percentage readout (`70%`, `0%` when muted).
      - Defaulted initial volume safely to 70% instead of 100% full blast, with persistent localStorage sync (`traxvault_lrc_volume`, `traxvault_player_volume`, `traxvault_lrc_muted`).
      - Added reactive `$effect` and `onloadedmetadata` ensuring HTML5 audio element's volume and muted properties stay strictly synchronized with state.
      - Added `pause()` method to `GlobalPlayer` (`src/lib/services/player.svelte.ts`) and automatically pause background playback from the global player when audio playback starts in LRC Maker.

42. **Library Scanner Performance & Preloading Architecture**:
    - Resolved 2-second navigation lag when accessing the `/scan` tab:
      - **16-Worker Concurrency Pool**: Replaced sequential `for...of` audio file parsing in `scanLibraryDirectory()` (`src/lib/server/scanner.ts`) with bounded parallel processing (`asyncPool(16, ...)`), cutting cold disk parsing time by over 80%.
      - **Shared Directory Listing & Cover Art Cache**: Introduced `dirFilesCache` populated during directory traversal and shared across `findCompanionLyricsFile` and `findLocalCoverArt`, eliminating hundreds of redundant `fs.readdirSync` and `fs.existsSync` calls.
      - **O(1) In-Memory Vault Album Lookup**: Replaced per-album repeated SQLite `db.prepare()` queries with a single startup query into in-memory MBID and title/artist lookup maps.
      - **In-Memory Scan Cache & In-Flight Coalescing**: Added a 60-second TTL cache (`scanCache`) and in-flight promise deduplication (`inFlightScans`), making repeat visits to `/scan` instantaneous (< 1ms) while preventing duplicate disk scans.
      - **Automatic Cache Invalidation**: Exposed `invalidateScanCache()`, invoked on album import (`importScannedAlbum`), album deletion (`deleteAlbum`, `deleteAlbums`), and manual rescan (`GET /api/library/scan?force=true`).
      - **Server Boot Warm-Up**: Added background warm-up of `scanLibraryDirectory()` in `src/hooks.server.ts` priming the cache 2 seconds after container boot.
      - **Client-Side Idle Preload**: Added background preloading in `src/lib/components/Navbar.svelte` via SvelteKit `preloadData('/scan')` after 1.2s of idle time and `data-sveltekit-preload-data="hover"` on navigation links, eliminating page transition delays.

---



## 4. Workflows & Verification

### Code Quality Check
Before committing changes, always verify:
```bash
npm run check    # svelte-check TypeScript & Svelte validation
npm run build    # Vite production build
```

### Docker Deployments (Mandatory)
Local development rebuild:
```bash
docker compose up -d --build
```
Production server update (pulling automated CI/CD image):
```bash
docker compose pull && docker compose up -d
```
Verify the container is healthy:
```bash
docker compose ps
docker logs trax-vault --tail 20
```

### Git Workflow & Commits
- **Remote:** `origin` (`forgejo:kapybara/trax-vault.git`)
- **Default branch:** `main`
- When instructed to commit and push:
  1. Check git status: `git status`
  2. Stage files: `git add <files>`
  3. Commit with a clear, concise message: `git commit -m "..."`
  4. Push to remote: `git push origin main`

