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
43. **Censored Synced Lyrics Tracking (`censored_lrc`) & Fixer Rules Integration**:
    - **LyricsStatus & FixerRules Extensions**:
      - Added `'censored_lrc'` to `LyricsStatus` union in `src/lib/types/index.ts` for time-synchronized `.lrc` files that contain clean radio edit / censored lyrics (e.g. `f***`, `sh*t`, `[censored]`, bleeps, asterisks).
      - Added `flag_censored_lyrics?: boolean` (defaults to `true`) to `FixerRules`, automatically flagging tracks with `lyrics === 'censored_lrc'` as `needs_attention = 1` in `computeNeedsAttention()`.
      - Added `censored_lyrics_count` tracking to `CollectionStats` and `getStats()`.
    - **Isomorphic Lyrics Detection**:
      - Implemented `isCensoredLyrics(content: string): boolean` in `src/lib/utils.ts` detecting explicit bleep tags (`[censored]`, `[bleep]`, `[muted]`, `[ __ ]`) and masked profanity patterns (`f***`, `b****`, `sh*t`, `a**`, `****`).
      - Re-exported isomorphic `isInstrumentalLyrics` and `isCensoredLyrics` for cross-environment use across server routines and client components.
      - Updated `findCompanionLyricsFile` and `detectLyrics` in `src/lib/server/scanner.ts` to automatically classify companion `.lrc` and embedded lyrics as `'censored_lrc'` when censored patterns are matched.
      - Updated `GET / POST /api/tracks/[id]/lyrics` and library import endpoint to support `censored_lrc` and write companion `.lrc` files to disk.
    - **Full UI & Workflow Integration**:
      - **Main Vault View (`/+page.svelte`)**: Added `Censored LRC` filter dropdown option and distinctive orange badge in track row view.
      - **The Fixer (`/issues`)**: Added top issue category tab `Censored LRC ({count})`, direct `censored_lrc` lyrics filter option, and quick-fix dropdown options.
      - **Album Details (`/album/[id]`)**: Added `Flag censored lyrics` toggle in Fixer Rules modal, `Mark Censored` shortcut button in Quick Lyrics File Editor modal, and support in batch track updates.
      - **Audiophile Player (`/player`)**: Rendered `Censored LRC` button in tracklist and prominent `CENSORED` status tag in Live Synced Lyrics header, while retaining real-time karaoke scrolling and timestamp seek capabilities.
      - **LRC Maker Studio (`/lrc-maker`)**: Added direct `Flag Censored` / `Censored LRC` toggle button in studio top bar, auto-detection from existing track lyrics, and status persistence on save.
      - **LRCLIB Candidate Modal (`LrcLibModal.svelte`)**: Auto-detected censored text on LRCLIB candidate cards with an orange `Censored` badge and provided a 1-click `Use Censored LRC` application button.
      - **Search Parser (`src/lib/search.ts`)**: Supported queries like `censored_lrc`, `lyrics:censored`, and `lyrics:censored_lrc`.
44. **Clean LRC Formatting & Subsonic Bracket Header Stripping**:
    - **Root Cause Resolution**:
      - Resolved issue where third-party Subsonic clients (**Symfonium** and **Feishin**) displayed metadata headers (e.g. `[ti:...]`, `[by:Trax Vault]`, `[]`) as singing lyrics at timestamp 0:00.
      - Trax Vault's `generateLrcContent()` previously prepended `[ti:...]`, `[ar:...]`, `[al:...]`, `[length:...]`, `[by:Trax Vault]`, and `[au:Instrumental]` to `.lrc` outputs, and Subsonic handlers pushed non-timestamped lines into `timedLines` with `{ start: 0, value: line }`.
    - **Isomorphic `stripLrcMetadataHeaders(content: string): string`**:
      - Added in `src/lib/utils.ts` and re-exported in `src/lib/server/scanner.ts`.
      - Strips metadata header tags (`[ti:...]`, `[ar:...]`, `[al:...]`, `[by:...]`, `[length:...]`, `[au:...]`, `[re:...]`, `[ve:...]`, `[offset:...]`) and empty bracket tags (`[]`, `[ ]`) while strictly preserving timestamps (`[00:12.34]`), section markers (`[Chorus]`, `[Verse 1]`), instrumental markers (`[00:00.00]♪`), and lyrics lines.
      - Automatically trims leading and trailing empty lines.
    - **LRC Maker Studio Generation & Editing (`src/routes/lrc-maker/+page.svelte`)**:
      - Updated `generateLrcContent()` to output pure, clean synced lyrics without legacy `[...]` headers.
      - Applied `stripLrcMetadataHeaders` to existing lyrics on mount, when switching from Text to Sync mode, when importing from LRCLIB, and when saving from text mode.
    - **Subsonic API Handlers (`src/lib/server/subsonic/handlers.ts`)**:
      - **OpenSubsonic `getLyricsBySongId.view`**:
        - Applied `stripLrcMetadataHeaders` to disk companion and database lyrics.
        - Returns empty `structuredLyrics: []` for instrumental tracks so clients do not display fake singing lines.
        - For synced files (`isSynced === true`), only lines with valid timestamps are pushed into `timedLines`; untimed or header lines are never assigned `start: 0`.
      - **Subsonic `getLyrics.view`**:
        - Resolves folder companion files on disk if available and runs `stripLrcMetadataHeaders` before responding.
    - **REST API Endpoint (`src/routes/api/tracks/[id]/lyrics/+server.ts`)**:
      - Sanitizes `lyrics_text` with `stripLrcMetadataHeaders` in both `GET` and `POST` handlers before persisting to companion `.lrc` files on disk and SQLite.
    - **Database Migration & Backfill (`src/lib/server/db.ts`)**:
      - Added automated startup routine querying tracks with legacy `[ti:%`, `[ar:%`, `[by:%`, etc., and sanitizing `tracks.lyrics_text` in an atomic transaction.

34. **Batch Synced Lyrics Downloader, Missing Album Songs, & Navic Compatibility**:
    - **Navic / Navidrome Subsonic Protocol Compatibility**:
      - Added SQLite table `internet_radio_stations` (`id`, `name`, `stream_url`, `home_page_url`, `created_at`).
      - Implemented Subsonic endpoints in `src/lib/server/subsonic/handlers.ts`:
        - `getInternetRadioStations.view`: Resolves radio stations list (eliminates Navic initial connect error `action "getInternetRadioStations" is not supported by this server`).
        - `createInternetRadioStation.view`, `updateInternetRadioStation.view`, `deleteInternetRadioStation.view`.
        - `getPodcasts.view`, `getNewestPodcasts.view`, `getShares.view`, `getChatMessages.view`, `addChatMessage.view`.
    - **Missing Songs Tracking & Vault UI**:
      - Added database column `is_missing` (INTEGER DEFAULT 0) to `tracks` table with index `idx_tracks_is_missing`.
      - Updated `applyAlbumTags` and `applyFolderTags` in `src/lib/server/tagger.ts` to detect untracked release tracks from MusicBrainz and insert them with `is_missing = 1`, `file_path = NULL`, and `needs_attention = 1`.
      - Updated `src/lib/server/scanner.ts`: When new audio files appear on disk, auto-match against existing missing tracks and link them (`is_missing = 0`) instead of duplicating entries.
      - Updated `computeNeedsAttention(..., isMissing)` to mark missing songs as needing attention.
      - Updated `getAlbums()`, `getAlbumById()`, and `getStats()` in `db.ts` to calculate `missing_tracks_count`.
      - Updated `TrackRow.svelte`: Added rose `Missing Song` badge on Line 1, `Missing File` badge on right side, disabled verify checkbox, and styled row with rose border.
      - Updated `AlbumCard.svelte`: Added `{album.missing_tracks_count} missing song(s)` badge.
      - Updated `src/routes/album/[id]/+page.svelte`: Added hero breakdown badge and alert banner guiding the user to copy missing files to the folder or review in Tagger.
      - Updated `src/routes/player/+page.svelte` & `+page.server.ts`: Included `t.is_missing` in server track queries, displayed `Missing` badge in tracklist, and disabled playback/streaming for missing files.
      - Updated `src/routes/issues/+page.svelte`: Added `Missing Songs` tab filtering by `is_missing = 1`.
    - **Batch Synced Lyrics Downloader Studio (`/lrc-maker` & `/album/[id]`)**:
      - Added endpoint `GET /api/lyrics/batch-status` returning library-wide and album-specific counts of songs needing synced lyrics (`lyrics NOT IN ('synced_lrc', 'instrumental')`).
      - Added Server-Sent Events (SSE) streaming endpoint `POST /api/lyrics/batch-download`:
        - Supports album-scoped or library-wide execution.
        - Queries LRCLIB (`/api/get` exact match with fallback to `/api/search`).
        - Sanitizes lyrics with `stripLrcMetadataHeaders` and classifies as `synced_lrc`, `censored_lrc`, or `instrumental`.
        - Writes companion `.lrc` files directly into song folders on disk with directory traversal protection (`isPathWithin`).
        - Updates SQLite database and fixer rules atomically.
        - Streams live progress events (`progress`, `start`, `complete`) with polite 120ms rate limiting.
      - Created `src/lib/components/BatchLyricsModal.svelte`:
        - Scope selector: "Current Album only" vs "Entire Vault Library".
        - Preference checkboxes: "Only save Synced Lyrics" and "Save companion .lrc files to disk".
        - Live animated progress bar, percentage, and real-time metric counters (`Synced`, `Instrumental`, `Not Found`, `Errors`).
        - Auto-scrolling live terminal log box with color-coded status badges.
        - Stop/Cancel and Done buttons with automated view invalidation.
      - Integrated "Batch Download" action button into LRC Maker Studio header toolbar and Album Detail hero action bar.
43. **Forgejo Runner Migration (`runs-on: pve1`) & Tagger Manual Check Decoupling**:
    - Updated `.forgejo/workflows/docker-publish.yml` runner target to `runs-on: pve1` and removed `DOCKER_HOST` environment variable to connect directly to the native Docker socket.
    - Decoupled Tagger from `manually_checked`: tagging an album (either existing library album in `updateAlbumAndTracksFromMusicBrainz` or folder import in `applyAlbumTagsToFolder`) now preserves each track's existing `manually_checked` state and does not automatically toggle it to 1.
    - Added `.forgejo/**` path filter in `docker-publish.yml` to ensure workflow edits trigger CI/CD builds.

44. **Obsidian Custom Confirmation Modals, Subsonic Missing Track Isolation, and Tagger Re-Tagging Fixes**:
    - **Global Custom Confirmation & Alert Dialogs (`src/lib/services/dialog.svelte.ts` & `src/lib/components/ConfirmModal.svelte`)**:
      - Completely replaced native browser `confirm()` and `alert()` popups across the application (album deletion, batch unvaulting, track deletion, playlist removal, batch lyrics stop).
      - Dark obsidian modal with glowing icon containers (danger rose/trash, warning amber, info emerald), keyboard shortcuts (`Enter` confirm, `Escape` cancel), smooth backdrop blur, and accessible focus management.
      - Mounted globally in `src/routes/+layout.svelte`.
    - **Subsonic Missing Tracks Filtering (Symfonium & Navic Infinite Loading Fix)**:
      - Filtered out missing songs (`is_missing !== 1 && !!file_path`) across all Subsonic endpoints: `albumToSubsonicAlbum`, `getAlbum.view`, `getMusicDirectory.view`, `getSong.view`, `search3.view`, `search2.view`, `getRandomSongs.view`, `getSongsByGenre.view`, `getTopSongs.view`, `getSimilarSongs.view`, `getSongs.view`, and `getStarred.view`.
      - Recalculated total album `duration` and `songCount` in Subsonic responses to strictly count playable local audio files.
      - Updated `stream.view` in `src/lib/server/subsonic/media.ts` to return HTTP 404 immediately if a requested track is missing or has no physical file path, preventing infinite buffering loops.
    - **Tagger Re-Tagging Missing Track Preservation**:
      - In `src/routes/api/tagger/albums/[id]/match/+server.ts`, filtered out missing tracks (`is_missing !== 1 && !!file_path`) before running `alignTracks()`, preventing placeholder rows from matching against MusicBrainz release tracks.
      - In `src/lib/server/tagger.ts` (`applyAlbumTags`), restricted confirmed matches strictly to real local audio files, ensuring missing release tracks continue to be recognized and preserved as `is_missing = 1`.
      - In `src/lib/server/db.ts` (`updateAlbumAndTracksFromMusicBrainz`), guarded `is_missing = CASE WHEN file_path IS NOT NULL THEN 0 ELSE is_missing END`, preventing missing placeholder tracks from losing their missing status or becoming 'OTHER'.
      - Added automated self-healing database migration ensuring existing tracks with `file_path IS NULL` are accurately restored to `is_missing = 1`.
45. **Player Shuffle/Repeat Active State, Global Fixer Standards Header, & Instant Scan Loading**:
    - **Player Shuffle & Repeat Active State Visual Indicators (`src/routes/player/+page.svelte`)**:
      - Fixed class collision in Tailwind where `text-neutral-400` conflicted with `text-emerald-400`.
      - Replaced with dynamic high-contrast styling: emerald background pill (`bg-emerald-500/15 ring-1 ring-emerald-500/30 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.25)]`) and glowing emerald active dot indicator (`<span class="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981]"></span>`).
      - Updated album header and playlist header shuffle buttons to reflect active shuffle state with emerald highlights.
    - **Global Fixer Rules & Quality Standards Header (`src/routes/issues/+page.svelte`)**:
      - Added dedicated obsidian banner at the top of The Fixer detailing the 4 core pillars of Trax Vault quality standards:
        1. **Audio Fidelity**: Lossless FLAC / ALAC (16/24-bit) preferred or MP3 320/V0; flags <192kbps and bad quality.
        2. **Lyrics & Karaoke**: Synchronized `.lrc` with millisecond timestamps or ♪ Instrumental; flags missing, unsynced, or censored lyrics.
        3. **Authenticity / Censorship**: Explicit uncensored audio recording; flags radio edits and censored lines.
        4. **Release Completeness**: 100% of official MusicBrainz release tracks present; flags missing album tracks.
      - Added collapsible "Detailed Rules Specification & Overrides" guide explaining default detection flags and per-album custom overrides.
    - **Instant Scan Tab Loading via Persistent Disk Snapshot & On-Demand Rescan (`src/lib/server/scanner.ts`, `scan/+page.server.ts`, `scan/+page.svelte`)**:
      - Implemented disk-backed persistent scan cache (`${DATA_DIR}/scan_snapshot_${hash}.json`) storing scanned audio file metadata.
      - Added `reconcileScanAlbumsWithVault()`: fast single-query SQLite reconciliation updating `already_in_vault` and `existing_album_id` in <1ms without re-scanning disk files.
      - Updated `scan/+page.server.ts` to load the existing snapshot with `{ force: false }`, dropping scan tab page load times from 3–10 seconds down to 0–2ms (Navidrome-style instant loading).
      - Added snapshot metadata badge in `/scan` header: `Snapshot: [relative time] ([total] files)` with active status indicator.
      - Updated "Full Scan / Rescan Library" button to explicitly trigger `POST /api/library/scan?force=true` with an animated progress banner while crawling the filesystem and updating the snapshot.
46. **Multi-User Experience, Configurable Registration, & Responsive CSS Breakpoints**:
    - **Multi-User Backend & Role Architecture (`src/lib/server/auth.ts`)**:
      - Implemented `isRegistrationDisabled(): boolean` checking `DISABLE_REGISTRATION`, `DISABLE_ACCOUNT_CREATION`, and `ALLOW_REGISTRATION`.
      - Added `createUser(username, password, role)` with 3–32 char alphanumeric validation, length enforcement, collision checking, scrypt password hashing, and automated Subsonic secret encryption (`persistUserSubsonicSecret`).
      - Added `getAllUsers()` joining user accounts with playlist count and starred count.
      - Added `deleteUser(targetUserId, requestingAdminId)` preventing self-deletion and last-admin deletion, with cascading cleanup.
      - Added `updateUserRole(targetUserId, newRole, requestingAdminId)` preventing demoting oneself or the last admin.
      - Added `adminResetPassword(targetUserId, newPassword)` updating hash, salt, Subsonic secret, and invalidating existing sessions.
    - **Public Registration & Login Routes (`src/routes/register` & `src/routes/login`)**:
      - Added `/register` page and `POST /api/auth/register` API endpoint with registration disable guard.
      - Updated `/login` page to conditionally render "Create an account" link based on registration policy.
      - Updated `src/hooks.server.ts` allowing unauthenticated access to `/register` and `/api/auth/register` while redirecting authenticated users to `/`.
    - **Admin User Management Center (`src/routes/settings`)**:
      - Added User Accounts management card in Settings for administrators displaying total users, public registration status indicator, and a sleek user list.
      - Added responsive Add User modal with username, password, and role selection (`admin` vs `user`).
      - Added Reset Password modal with instant Subsonic sync.
      - Integrated role toggle ("Make Admin" / "Make User") and delete user action with custom obsidian dialogs.
    - **Responsive Mobile Breakpoints (Phone <640px, Tablet 640px–1024px, Desktop >1024px)**:
      - **Studio Audiophile Player (`/player`)**:
        - Added mobile segmented view switcher on `< md` (`[ Library ] [ Tracks ] [ Lyrics ] [ Queue ]`).
        - Automatically navigates from Library to Tracks when tapping an album or playlist on phone.
        - Suppressed multi-column flex squashing by rendering each view at 100% width on phone while maintaining side-by-side desktop view.
        - Optimized floating audio dock: responsive artwork sizing (`w-10 h-10` on mobile, `w-12 h-12` on desktop), condensed track information, tightened button gaps, and hidden desktop-only volume slider on small screens.
      - **Desktop & Mobile Navbar (`src/lib/components/Navbar.svelte`)**:
        - Refined 7-tab mobile bottom bar (`px-0.5 py-1 text-[9px] xs:text-[10px]` with truncated labels) preventing text clipping or overflow on narrow screens down to 320px.
        - Condensed header action button text (`Add` on mobile, `Add Album` on desktop).
        - Centered album detail cover artwork on mobile screens (`mx-auto md:mx-0`).
43. **Admin Web UI Song Management (Upload, Replace, Delete, Download, and Rescan)**:
    - **Multi-File Album Upload (`POST /api/albums/[id]/tracks/upload`)**: Drag-and-drop or select multiple audio files. Trax Vault automatically saves them into the album's folder on disk, extracts high-fidelity metadata (bitrate, sample rate, bit depth, format, lyrics), and automatically links and fulfills missing track rows (`is_missing = 1`) before inserting any remainder.
    - **Track Replacement (`POST /api/tracks/[id]/replace`)**: Replaces an existing track's audio file on disk, safely removing the previous file if named differently, scanning new audio tags and fidelity, and re-evaluating fixer rules.
    - **Protected Deletion (`DELETE /api/tracks/[id]`)**: Gives admins a clear choice in `DeleteTrackModal.svelte`: Remove from Vault only (keeps physical audio file on disk) or Delete Audio File from Disk & Vault (permanently unlinks audio file and companion `.lrc` from storage).
    - **Direct Audio Download (`GET /api/tracks/[id]/audio?download=true`)**: Direct audio attachment download with `Content-Disposition`.
    - **Fidelity & Metadata Re-scan (`POST /api/tracks/[id]/rescan`)**: 1-click refresh of track tags and exact bitrates from storage.
    - **UI Integration**: Added "Upload Tracks" button to album detail header, interactive `UploadTracksModal.svelte`, dedicated "+ Upload Audio" button directly on missing songs in `TrackRow.svelte`, and action buttons for replacement, rescanning, downloading, and custom deletion.
44. **Unlimited Audio Upload Payload & Sequential Resilient Upload**:
    - Resolved SvelteKit `adapter-node` default 512KB limit (`413 Payload Too Large: Content-length exceeds limit of 524288 bytes`) by setting `BODY_SIZE_LIMIT=Infinity` across `Dockerfile`, `docker-compose.yml`, `.env.example`, `src/hooks.server.ts`, and `vite.config.ts`.
    - Added `scripts/postbuild.js` which automatically generates `build/env-defaults.js` and injects it into `build/index.js`, ensuring standalone Node deployments default to `BODY_SIZE_LIMIT=Infinity` without requiring external env configurations.
    - Enhanced `UploadTracksModal.svelte` to upload staged songs sequentially one-by-one with an animated progress bar, percentage counter, and per-file status badges (idle, uploading, success, error), enabling seamless uploads of high-resolution tracks (100MB+ each) and multi-gigabyte albums (2GB+) without reverse proxy timeouts or memory spikes.
45. **Git Tag Versioning, Forgejo Runner (`ubuntu-latest`), Tagger Scanned Folders 500 Fix, & Album Merge / Quality Upgrade (`v1.7.1`)**:
    - **Forgejo Runner & Git Tag Versioning (`.forgejo/workflows/docker-publish.yml`, `Dockerfile`, `vite.config.ts`, `src/lib/version.ts`)**:
      - Updated `.forgejo/workflows/docker-publish.yml` to run on `ubuntu-latest` (matching available Forgejo runner labels `ubuntu-latest`, `debian`, `node`).
      - Replaced `paths:` with `paths-ignore` so pushing `v*` Git tags reliably triggers Docker image builds and publishes both `:vX.Y.Z` and `:X.Y.Z` tags alongside `:latest`.
      - Injected `APP_VERSION` at build time via `vite.config.ts` (`__APP_VERSION__` resolved from `APP_VERSION` env, `git describe --tags`, or `package.json`) and `Dockerfile` `ARG APP_VERSION`.
    - **Tagger Scanned Folders 500 Internal Error Fix (`src/routes/tagger/+page.svelte`, `src/routes/tagger/+page.server.ts`, `src/lib/server/scanner.ts`, `src/lib/server/tagger.ts`)**:
      - Fixed Svelte 5 `each_key_duplicate` SSR/client crash (`500 Internal Error`) when switching to `Scanned Folders` in `/tagger` caused by multiple `ScannedAlbum` groups sharing the same `folder_path` on disk.
      - Deduplicated `folders` by `folder_path` in `src/routes/tagger/+page.server.ts`, `src/routes/api/tagger/folders/+server.ts`, and `src/routes/tagger/+page.svelte`.
      - Added `resolveMusicFolderPath()` in `scanner.ts` to safely resolve host vs container `/music` paths in `scanFolderForTagger()`.
    - **Album Merging & Quality Upgrade (`src/lib/server/db.ts`, `src/lib/server/scanner.ts`, `src/routes/api/library/merge/+server.ts`, `src/routes/scan/+page.svelte`, `src/routes/+page.svelte`)**:
      - Prevented `scanLibraryDirectory()` from splitting a single album folder into 2 albums when tracks are replaced with higher-quality files lacking or having different `musicbrainz_album_id` tags or edition suffixes, and auto-coalesced split entries in cached snapshots via `reconcileScanAlbumsWithVault()`.
      - Implemented `mergeScannedTracksIntoVaultAlbum()`, `mergeVaultAlbums()`, and `mergeScannedAlbumsInCache()` + `POST /api/library/merge` so replaced/upgraded files upgrade existing Vault tracks in-place while preserving track IDs, `play_count`, `playlists`, `starred_items`, and `manually_checked`.
      - Added interactive **Merge & Quality Upgrade Modal** and duplicate detection banner in `/scan`, plus batch **Merge Selected** action in Vault (`/`).
42. **Fix Tagger Cover Download & Artist Metadata Persistence (v1.7.2)**:
    - **Cover Art Archive & Archive.org IPv6 Timeout Remediation**:
      - Disabled Node.js Happy Eyeballs autoSelectFamily (`net.setDefaultAutoSelectFamily(false)`) and prioritized IPv4 DNS order in `src/hooks.server.ts`, `src/lib/server/tagger.ts`, and `src/lib/server/musicbrainz.ts`.
      - Added `NODE_OPTIONS="--no-network-family-autoselection"` to `Dockerfile`, `docker-compose.yml`, and `docker-compose.server.yml` preventing `AggregateError [ETIMEDOUT]` crashes on servers without IPv6 routing.
    - **Fast Direct Archive.org Image Resolution**:
      - Enhanced `downloadAndSaveCover()` to fetch `https://archive.org/download/mbid-${mbid}/index.json` and immediately download direct images (`mbid-${mbid}-${imgId}_thumb500.jpg`, `mbid-${mbid}-${imgId}.jpg`) directly from Archive.org CDN, bypassing slow or timed-out CAA redirect gateways.
      - Saved `cover.jpg` directly into all folders containing tracks (including subfolders and canonical album target).
    - **Audio File Tag Writing & Multi-Tag Properties**:
      - Rewrote `writeTagsToAudioFile()` using `@dantheman827/taglib-ts/fileRef.js` with `PropertyMap` to write `ALBUMARTIST`, `ARTIST`, `TITLE`, `ALBUM`, `DATE`, `YEAR`, `TRACKNUMBER`, and `DISCNUMBER` tags directly to physical files on disk with fallback to `writeTags`.
      - Ensured `ALBUMARTIST` is persisted so `music-metadata` and `scanAudioFile` identify the release artist without falling back to "Unknown Artist".
    - **Scan Cache & UI Reactive Synchronization**:
      - Added `updateAlbumInScanCache()` and proper cache deletion in `invalidateScanCache()`, ensuring both in-memory cache and persistent disk snapshots reflect new artists and cover URLs immediately upon tagging.
      - Updated `scanFolderForTagger()` to filter out 'Unknown Artist' when resolving album artist from scanned tracks.
      - Updated `POST /api/tagger/folder/apply` response and `src/routes/tagger/+page.svelte` to update `currentFolderData` and `folders` state reactively without requiring full page reloads.
43. **Fix NetworkError in Fetch Calls, Queue Deadlock & Cover Art Download (v1.7.3)**:
    - **MusicBrainz Queue Timeout & Auto-Recovery**:
      - Protected `rateLimitedFetch()` in `src/lib/server/musicbrainz.ts` with strict 8-second `AbortController` timeouts so hanging external API requests never deadlock `requestQueue`.
      - Sanitized `searchMusicBrainz(query, artist)` so queries with `artist = "Unknown Artist"` or empty strings search title-only, preventing zero-result failures when matching untagged tracks like "MADARA".
      - Fixed `formatArtistCredit` to properly include `a.joinphrase` (e.g. "Ez Mil" + " & " + "Eminem" -> "Ez Mil & Eminem").
    - **Cover Art Archive Fast Direct Download**:
      - Removed failing `archive.org/download/.../index.json` path (which returned 500 errors after 10+ seconds) in `downloadAndSaveCover()`.
      - Reordered `applyFolderTags()` and `applyAlbumTags()` so physical audio tags are written to disk FIRST, and cover art download runs second in a non-fatal block, ensuring files are always tagged even if the remote cover server is slow or unavailable.
    - **Postbuild IPv4 Network Defaults**:
      - Injected `net.setDefaultAutoSelectFamily(false)` and `dns.setDefaultResultOrder('ipv4first')` into `build/env-defaults.js` via `scripts/postbuild.js`, running before all application code on container boot.
    - **Resilient UI Error Reporting**:
      - Added `formatErrorMessage()` in `src/routes/tagger/+page.svelte` transforming raw browser `NetworkError when attempting to fetch resource` into informative guidance.
44. **Cover Art Archive Multi-Hop Timeout Fix & Direct Storage Fallback (v1.7.4)**:
    - **Root Cause Resolution**:
      - Identified that multi-hop redirects on Cover Art Archive / Archive.org (`coverartarchive.org` -> `archive.org/download/...` -> `dn720005.ca.archive.org/...`) naturally take ~10 seconds under real-world connection latencies.
      - Fixed aggressive 6-second timeout (`timeoutMs = 6000`) in `fetchImageBuffer()`, increasing to 25 seconds (`timeoutMs = 25000`) so images download completely without premature abortion.
    - **Direct Front & Full-Res Priority**:
      - Prioritized `https://coverartarchive.org/release/${extractedMbid}/front` (original direct image, 183KB) ahead of thumbnailers.
    - **Archive.org Metadata Storage Direct Download Strategy**:
      - Added Strategy 2 querying `https://archive.org/metadata/mbid-${extractedMbid}` to discover exact backend storage server cluster (e.g. `ia600503.us.archive.org`) and download files directly without intermediate redirect hops.
    - **Frontend Cover URL Propagation**:
      - Passed `coverUrl` directly from the frontend `releaseDetail.cover_url` in `/api/tagger/folder/apply` and `/api/tagger/albums/[id]/apply`, giving the tagger an immediate verified candidate URL.
45. **Proactive File Permission Checks & Explicit Access Denied Error Reporting (v1.7.5)**:
    - **Proactive Filesystem Permission Checks**:
      - Updated `scanFolderForTagger()` and `scanAlbumDirectory()` in `src/lib/server/tagger.ts` using `fs.accessSync(..., fs.constants.W_OK)` to test write permissions on directories and individual audio files before applying tags.
      - Propagated `is_writable`, `permission_error`, `permission_path`, and `unwritable_files` via match endpoints (`/api/tagger/folder/match` and `/api/tagger/albums/[id]/match`).
    - **Actionable Permission Banner & UI Diagnostics**:
      - Added a persistent amber alert banner in `src/routes/tagger/+page.svelte` when a folder or album is detected as read-only, displaying the path, reason, and a 1-click copyable shell command: `chmod -R u+rw "<folder>"`.
    - **HTTP 403 Response & Elimination of Swallowed Errors**:
      - Stopped silently swallowing `EACCES`, `EPERM`, and `EROFS` errors in `writeTagsToAudioFile()` and `downloadAndSaveCover()`.
      - Tag apply endpoints (`/api/tagger/folder/apply` and `/api/tagger/albums/[id]/apply`) now return HTTP 403 Forbidden when permission errors prevent updating files or saving covers, returning granular details on affected files.
      - Status toast in `/tagger` explicitly shows failure reasons and copyable fix commands instead of false positive successes.
46. **Scanner Real-Time Synchronization, Coalescing by Folder, & Invalidation Fix (v1.7.6)**:
    - **Auto-Sync Scanner Cache on Tagging (`refreshAlbumInScanCache`)**:
      - Added `refreshAlbumInScanCache()` in `src/lib/server/scanner.ts` automatically re-scanning the album folder on disk immediately upon tagging, parsing fresh audio tags, updating in-memory `scanCache`, and updating persistent disk snapshots (`scan_snapshot_*.json`).
      - Both `applyAlbumTags()` and `applyFolderTags()` in `src/lib/server/tagger.ts` now call `refreshAlbumInScanCache()`, eliminating the need to manually click "Rescan Library".
    - **Single-Folder Album Coalescing**:
      - Updated `reconcileScanAlbumsWithVault()` to coalesce albums strictly by `folder_path` for dedicated album directories, preventing a single physical folder from being split into two duplicate albums if tracks have differing or renamed album tags.
    - **Path-Based Vault Reconciliation (`vaultRelFolderMap`)**:
      - Added relative folder path mapping in `reconcileScanAlbumsWithVault()` resolving Vault albums by matching audio file paths, ensuring albums renamed to longer MusicBrainz release titles immediately remain recognized as `already_in_vault = true`.
    - **Full Disk Snapshot Invalidation**:
      - Updated `invalidateScanCache()` to remove all `scan_snapshot_*.json` files on disk when cleared globally or for parent/child paths, preventing stale snapshots from resurrecting on server restart or page loads.
47. **Tagger MusicBrainz ID (MBID) Lookup & Exact Release Resolution (v1.7.7)**:
    - **MBID & URL Extraction (`extractMusicBrainzId`)**:
      - Added `extractMusicBrainzId()` in `src/lib/utils.ts` parsing plain 36-char UUIDs, prefixed identifiers (`mbid:...`, `reid:...`, `release:...`), and full `musicbrainz.org/release/<uuid>` URLs.
    - **Direct MBID API Resolution**:
      - Enhanced `searchMusicBrainz()` in `src/lib/server/musicbrainz.ts` to detect MBIDs/URLs and directly resolve releases via `getMusicBrainzRelease(mbid)` and Lucene `reid:<mbid>` without relying on fuzzy text queries.
      - Updated `/api/tagger/search`, `/api/tagger/albums/[id]/match`, and `/api/tagger/folder/match` to ensure exact MBID releases are automatically prepended to the candidate releases selector.
    - **Interactive MBID Lookup Modal & Quick Fill**:
      - Added dedicated **"Lookup MBID"** button and modal dialog in `src/routes/tagger/+page.svelte` allowing users to paste any MusicBrainz release ID or URL with instant validation, track alignment, and error feedback.
      - Enabled auto-detection in the main search input: pasting an MBID or URL immediately triggers exact release lookup.
      - Added clickable MBID pills with external links to `musicbrainz.org/release/<id>` across active release details and candidate cards.
48. **Single Track Artist Resolution & Interactive Album Artwork Preview (v1.7.8)**:
    - **Smart Filename & Folder Artist Inference (`parseTrackDetailsFromFilename`)**:
      - Added `parseTrackDetailsFromFilename()` in `src/lib/server/scanner.ts` parsing track numbers, artist credits, and titles from common patterns (`Artist - Title`, `01 - Artist - Title`, `01. Artist - Title`, `Artist - Album - Title`), while cleaning YouTube/web tags (`[Official Audio]`, `[Visualizer]`, etc.).
      - Updated `scanAudioFile()` to use parsed artist/title whenever ID3 tags are missing or set to generic `'Unknown Artist'`, and cleaned titles where full filenames were previously retained.
      - Updated `scanFolderForTagger()` in `src/lib/server/tagger.ts` to inspect the folder base name and single-track metadata when artist resolves to `'Unknown Artist'`, correctly attributing single tracks (e.g. `Ez Mil & Eminem - MADARA`) to their respective artists.
      - Updated `alignTracks()` to automatically pair single local tracks with single MusicBrainz release tracks with high confidence.
      - Enhanced `/api/tagger/albums/[id]/match` to ignore `'Unknown Artist'` as a restrictive artist filter.
    - **Prominent Matched Artist & Collaboration Display in Tagger UI**:
      - Updated hero header in `src/routes/tagger/+page.svelte` to prominently display matched target release title and full artist credit (`releaseDetail.artist`, e.g. `Ez Mil & Eminem`) with a `[Single Track]` badge when matching 1-track releases.
      - Added visual source diff indicator clearly demonstrating before-and-after resolution: `Source: MADARA by Unknown Artist ➔ will update to Ez Mil & Eminem`.
      - Updated Target MusicBrainz Track column (Column 4) in the diff table to render the full artist credit alongside track titles, making track collaborations immediately visible.
    - **Interactive Album Cover Art Preview & Comparison**:
      - Added Artwork Preview Strip directly in the active Tagger hero: displays side-by-side comparison cards for **Current Local Cover** (`cover.jpg`) and **MusicBrainz Cover** (`Cover Art Archive 500px`) with transition indicators.
      - Added hover zoom actions on candidate release thumbnails in the candidate selector grid for quick artwork inspection.
      - Added dedicated **Full-Size Album Artwork Preview Modal**:
        - High-resolution modal with natural aspect ratio, source attribution, and direct external link to uncompressed original.
        - Segmented before-and-after tab toggle (`[ Target MusicBrainz Cover (CAA) ]` vs `[ Current Local Cover (cover.jpg) ]`) enabling instant side-by-side comparison before writing tags or downloading artwork.
        - Added `[Preview Artwork]` action button in the hero header.
49. **Interactive Album Merge Studio & Non-Colliding Track Allocation (v1.7.9)**:
    - **Track Matching & Collision Prevention Bug Fix (`areTracksSameSong`)**:
      - Fixed core bug in `mergeVaultAlbums()` and `mergeScannedTracksIntoVaultAlbum()` where tracks were matched purely by `track_number === track_number` regardless of title, causing distinct songs (e.g. Track 1 "The Ringer" vs Track 1 "Venom") to collide and overwrite each other when merging split albums.
      - Added string similarity utilities (`normalizeString`, `levenshteinDistance`, `tokenSimilarity`, `computeStringSimilarity`) to `src/lib/utils.ts`.
      - Implemented `areTracksSameSong(t1, t2)` in `src/lib/server/db.ts`: matches tracks by exact file path, identical normalized titles, or high fuzzy similarity (>= 85%). If song titles differ, tracks are recognized as distinct songs even if they share the same track number.
      - Dynamic Track Number Allocation: When merging new tracks into a target album (e.g. split track 13 "Venom" or secondary track 1 "Venom"), non-colliding track numbers are computed automatically (`usedNumbers` set scanning 1..N), preventing track number collisions and preserving all songs from both albums.
    - **Interactive Album Merge Preview API (`previewVaultAlbumsMerge`)**:
      - Added `previewVaultAlbumsMerge(targetAlbumId, sourceAlbumId)` in `src/lib/server/db.ts` calculating exact merge operations without modifying the database.
      - Classifies every song into clear action categories:
        - `keep`: Existing primary album track retained.
        - `upgrade`: Duplicate song matched with higher audio fidelity (e.g. FLAC replacing MP3, higher bitrate, or missing local file replacement).
        - `add`: Brand-new song from secondary album allocated into next available track slot.
        - `duplicate_skip`: Duplicate song from secondary album with equal or lower fidelity, excluded from the final merged album.
      - Added `GET /api/library/merge?targetId=X&sourceId=Y` returning structured preview data and summary counters.
      - Updated `POST /api/library/merge` supporting custom track mappings (`customTracks`) and metadata preference (`keepMetadataFrom: 'primary' | 'secondary'`).
    - **Interactive Merge Albums Studio Modal (`MergeAlbumsModal.svelte`)**:
      - Created comprehensive modal dialog with step-by-step workflow:
        1. **Album Selection & Direction**: Visual cards for Primary (Keeper) and Secondary (Merged & Removed) albums with a 1-click **Swap Direction** button. Suggested candidate dropdown highlights matching albums by artist and title.
        2. **Interactive Preview Table**: Side-by-side view with track numbers, song titles, audio format/bitrate badges, action pills (`+ Add Song`, `↑ Upgrade Quality`, `Keep Existing`, `Duplicate (Skip)`), and source badges.
        3. **Customization & Renumbering**: Allows individual track number adjustments, custom song toggling (include/exclude), and a 1-click **"Renumber 1..N"** button for clean sequential ordering.
        4. **Safety & Confirmation**: Live counter chips (`Keeping X`, `Adding Y`, `Upgrading Z`, `Skipping W`) and a confirmation alert reminding the user that the secondary album will be merged and safely removed.
    - **Deep UI Integration**:
      - Added **"Merge Album"** action button to Album Detail page (`src/routes/album/[id]/+page.svelte`).
      - Upgraded Library Batch Merge on `src/routes/+page.svelte`: selecting two albums and clicking "Merge Selected" opens the Interactive Merge Studio pre-populated with both albums.
50. **Automatic Audio & Companion Lyrics File Renaming on Tagging (v1.7.10)**:
    - **Safe Standardized Naming Scheme (`formatStandardTrackFilename`)**:
      - Single-Disc: `01. Artist - Title.ext` (e.g. `01. Eminem - The Ringer.flac`).
      - Multi-Disc: `1-01. Artist - Title.ext` (e.g. `1-01. The Notorious B.I.G. - Hypnotize.mp3`).
      - Implemented `sanitizeFilename()` in `src/lib/server/tagger.ts` cleaning forbidden filesystem characters (`/ \ : * ? " < > |`) into safe dashes while preserving valid acronyms (`The Notorious B.I.G.`) and stripping trailing dots/spaces from the base filename before extension.
    - **Companion Lyrics (.lrc / .txt) Synchronous Renaming (`renameAudioAndCompanionFiles`)**:
      - Automatically finds any companion `.lrc` or `.txt` lyrics file matching the old audio file name in the song's directory (including loose track-number padding matches) and renames it synchronously (e.g. `01. Eminem - The Ringer.lrc`), ensuring synchronized lyrics are never lost or orphaned.
      - Safe collision detection: If a target filename already exists on disk (and is not the same file), appends a unique numeric suffix (`(1)`) to avoid overwriting distinct audio files.
    - **Database & Player Continuity**:
      - Extended `updateAlbumAndTracksFromMusicBrainz()` in `src/lib/server/db.ts` to accept and persist `file_path` on track updates.
      - When physical files are renamed on disk, `tracks.file_path` in SQLite is updated synchronously and scan cache is refreshed, preserving uninterrupted playback, lyric streaming, and Subsonic API compatibility.
    - **Interactive Tagger Studio UI (`src/routes/tagger/+page.svelte`)**:
      - Added **"Rename Files on Disk"** checkbox toggle to the tagger options toolbar (default: enabled).
      - Added real-time filename diff preview pills under each track in the alignment table displaying the exact planned rename: `📁 Rename: raw_track.mp3 ➔ 01. Artist - Title.mp3 (with .lrc)`.
      - Updated action buttons and success notifications to display the exact number of files and companion lyrics renamed on disk.

51. **Player UX Refinements & Natural Acoustic Controls (v1.7.11)**:
    - **Perceptual Logarithmic / Exponential Volume Curve**:
      - Replaced raw linear HTML5 audio volume with a natural psychoacoustic volume curve (`Math.pow(volume, 2.2)`) via `getEffectiveGain()` in `src/lib/services/player.svelte.ts`.
      - Provides human-ear proportional loudness scaling (`loud > less loud > even less loud > quiet`) across the entire slider range, eliminating artificial loudness cliffs where volume remained high until near zero.
    - **Lyrics Manual Scroll-Lock & Interactive Sync Pill**:
      - Distinguishes manual user scrolling (`onwheel`, `ontouchmove`, `onpointerdown`) from programmatic playback tracking in `src/routes/player/+page.svelte`.
      - Freezes auto-scroll when user browses lyrics so viewport is no longer forcefully yanked back to the current singing line.
      - Displays a floating glassmorphic **"Sync with song"** pill with smooth animations. Clicking it (or clicking any lyric line or changing tracks) immediately resumes auto-scroll and smoothly re-centers the current vocal line.
    - **Global Spacebar Play / Pause Shortcut**:
      - Registered global `window.onkeydown` handler in root `src/routes/+layout.svelte` ensuring Spacebar immediately pauses/plays audio across any page without causing default browser page-down scrolling.
      - Robust focus safeguarding: exempts `input`, `textarea`, `select`, `contentEditable`, `role="textbox"`, and open dialog modals (`dialog, [role="dialog"]`).
      - Coordinated with `/player` local keyboard dispatcher to prevent duplicate toggling.
    - **Compact & Modern Slider Thumb Styling**:
      - Added `.slider-compact` styling in `src/routes/layout.css` for both WebKit and Firefox (`::-webkit-slider-thumb` and `::-moz-range-thumb`).
      - Replaced oversized browser default 20px slider thumbs with sleek 10px circular thumbs with 1.25x hover scaling, emerald green accent, white border, and subtle drop shadow across player scrubbers and volume faders.

52. **Picard-Style Drag & Drop Track Alignment & Zero-Overflow Layout (v1.7.12)**:
    - **Zero-Overflow Responsive Layout**:
      - Added `min-w-0` to `<div class="lg:col-span-8 min-w-0 space-y-6">` in `src/routes/tagger/+page.svelte`, resolving CSS grid column expansion.
      - Replaced rigid min-width table cells with flexible, responsive flexbox rows where all song titles, artist labels, and disk rename previews use `min-w-0 flex-1 truncate` with native `title="..."` tooltips.
      - Completely eliminated forced horizontal scrollbars on long track titles.
    - **MusicBrainz Picard-Inspired Paired Tracklist**:
      - Grouped release tracks by Disc (`Disc 1`, `Disc 2`) mirroring official release structure.
      - Paired view: Local files (what you have on disk) on the left, match confidence badges & controls in center, target MusicBrainz release tracks on the right.
      - Missing release tracks appear directly within the tracklist as styled, dashed drop slots (`Drop local track here to assign`).
    - **Interactive Drag & Drop Track Remapping**:
      - Native HTML5 drag and drop (`draggable="true"`, `handleDragStart`, `handleDropOnMbTrack`, `handleDropOnUnmatched`):
        - Drag unassigned local files directly onto missing track slots to pair them.
        - Drag matched files onto other slots to instantly **swap** their targets (Picard behavior).
        - Drag matched tracks to the Unassigned shelf or click the unpair button (`X`) to reset to unmatched.
      - Active drop targets render glowing emerald ring highlights (`ring-2 ring-emerald-500 bg-emerald-950/60 border-emerald-400`).
      - Compact dropdown selector retained on each row for keyboard and click-based reassignments.
    - **Unassigned Local Files Shelf**:
      - Draggable badge pool at top displaying all local files not yet matched to release tracks with instant drop re-pairing.

53. **Full-Screen 1-Line Picard Tagger with 2-Column Architecture (v1.7.13)**:
    - **Full-Screen Canvas & Collapsible Library Sidebar**:
      - Removed `max-w-7xl` constraint from `src/routes/tagger/+page.svelte`, expanding the tagger workspace across 100% of the screen width (`w-full px-4 sm:px-6 lg:px-8`).
      - Added collapsible library sidebar toggle (`[ < Hide Library ]` / `[ > Show Library ]` with `PanelLeftClose`/`PanelLeftOpen` icons). When collapsed, the main tagger studio expands to full 12-column width.
    - **Strict 1-Line-Per-Song Density**:
      - Condensed all track rows to a single horizontal line (`h-9` or `h-10`, ~36-40px high). An entire album of 12-16 songs fits completely within the screen height without vertical scrolling.
      - Inline rename preview: Replaced multi-line rename text with an inline `FileText` badge with full tooltip (`title="Renames on disk: ... ➔ ..."`).
    - **2-Column Tagger Architecture**:
      - **Column 1 (Storage Files)**: Left panel displaying all local files in storage with track #, title, format, duration, slot status pill (`➔ 01` or `Free`), and drag handle. Acts as a drop zone to unpair any track.
      - **Column 2 (Album Tag Alignment)**: Right panel displaying the MusicBrainz release structured into two synchronized subcolumns:
        - **Subcolumn 1**: Local storage file currently assigned to this track slot (1-line: drag handle, track #, title, duration, rename badge, unpair `X` button, or `[ Drop file here ]`).
        - **Subcolumn 2**: Official MusicBrainz album track (1-line: write checkbox, official #, title, artist, duration, match score pill, and quick reassign dropdown).
        - **1-to-1 Horizontal Alignment**: Subcolumn 1 directly corresponds horizontally on the exact same line with Subcolumn 2.
    - **Fluid Cross-Column Drag & Drop**:
      - Drag from Column 1 into Subcolumn 1 of any row in Column 2 to pair.
      - Drag between rows in Column 2 to swap.
      - Drag back onto Column 1 or click `X` to unpair.

54. **Full-Screen Ultra-Compact 28px Minimal-Text Matching Studio (v1.7.14)**:
    - **Near-100% Screen Height Utilization**:
      - Eliminated multi-card hero section, large cover cards, redundant instruction boxes, and verbose paragraphs that previously consumed >650px of vertical space before reaching the tracklist.
      - Built a sleek ~48px top action bar integrating: mini 36x36px cover thumbnail, title & artist, match score badge, missing tracks counter, release candidate `<select>` dropdown, options pills (`Rename`, `Cover`, `Import`), and "Write Tags" action button.
      - Added an optional expand toggle (`[ 👁️ ]`) to reveal full candidate cards and MBID search only when explicitly requested.
    - **Ultra-Compact 28px (`h-7`) Row Height**:
      - Reduced row height from 40px down to ~28px (`h-7` with `py-0.5 px-1.5` and `text-[11px]` typography).
      - Reduced vertical row spacing to `space-y-0.5`. An entire album of 15-20 tracks fits effortlessly within the viewport without vertical scrolling.
    - **Zero Clutter & Minimal Text**:
      - Streamlined labels: `1. Files in Storage` -> `Storage ({matches.length})`, `2. Album Tag Alignment` -> `Alignment`, `Subcolumn 1: Storage File (Assigned)` -> `Storage File`, `Subcolumn 2: MusicBrainz Track (Target)` -> `MusicBrainz Track`.
      - Removed instructional hint boxes ("💡 Drag files from here to pair / Drop here to unpair") and missing tracks alert banners.
      - Retained all rich Picard drag-and-drop mechanics, quick-swap dropdowns, and file rename indications in compact inline form.

55. **Multi-Step Tagger Studio Wizard (v1.7.15)**:
    - **Step 1: Album & MusicBrainz Release Picker**:
      - Comfortable library sidebar navigation (Vault Albums vs Scanned Folders) with search and filters.
      - Full album hero with local artwork preview, query search bar, MBID direct lookup, and high-visibility release candidate cards grid.
      - Prominent primary CTA: `Next: Connect Songs ({count} tracks) ➔`.
    - **Step 2: Full-Screen Song Connector**:
      - 100% full-screen workspace with library sidebar, search inputs, and release candidates hidden.
      - Sleek ~42px top bar with `← Change Release` return button, mini artwork, match confidence score, options pills (`Rename`, `Cover`, `Import`), and `Write Tags ({count})` button.
      - 2-column layout (Column 1: Storage files, Column 2: Dual-subcolumn alignment) with ultra-compact 28px (`h-7`) rows fitting all songs on screen.

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

