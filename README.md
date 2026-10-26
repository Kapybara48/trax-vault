# 💽 Trax Vault

**Trax Vault** is a modern, self-hosted web application, audiophile player studio, and Subsonic/OpenSubsonic streaming server built for music collectors. Audit audio fidelity, track censorship, create synchronized lyrics, tag files directly with MusicBrainz, and stream your lossless music library anywhere.

---

## 🚀 Key Features

### 🎧 Audiophile Player Studio (`/player`)
* **Spotify-Inspired Studio Experience**: Beautiful obsidian glassmorphic interface with reactive library drawer, album/playlist switcher, and responsive desktop/mobile views.
* **Persistent Background Audio**: Centralized singleton audio engine mounted at the root layout. Music continues playing seamlessly as you navigate between pages (`/`, `/issues`, `/tagger`, `/scan`, `/settings`) or browse other tabs.
* **Floating Global Mini-Player Dock**: Compact dock on non-player pages with vinyl artwork, title, playback controls, scrubber, volume, and fidelity indicators.
* **Real-Time Synced Karaoke Lyrics**: Studio teleprompter panel with smooth vertical auto-scroll, glowing active line focus, and timestamp click-to-seek.
* **Exact Bitrate & Audio Fidelity Extraction**: Differentiates standard CD lossless (16-bit / 44.1kHz) from Studio Hi-Res lossless (24-bit / 48–96kHz+). Displays exact bitrate extraction (e.g. `FLAC • 893 kbps • 16-bit / 48.0 kHz`).
* **Multi-Disc Separators & CD Management**: Automatic multi-disc detection with sticky headers (`Disc 1`, `Disc 2`) and 1-click "Play Disc" shortcuts.
* **Integrated Playlists Hub**: Create, edit, reorder, and delete playlists directly inside the player without navigating away.
* **Keyboard Shortcuts & OS Integration**: Control playback with hotkeys (`Space`, `J`, `K`, `M`, arrow keys) and native MediaSession OS lockscreen integration.

---

### 📡 Subsonic & OpenSubsonic REST API Server
Turn Trax Vault into a full-featured alternative to Navidrome, Airsonic, or Gonic! Trax Vault implements the native Subsonic REST protocol at `/rest/...`.

* **100% Client Compatibility**:
  * **Symfonium** (Android): Fast library sync via `search3` pagination, structured millisecond karaoke lyrics via OpenSubsonic `getLyricsBySongId`, offline caching, and playlist synchronization.
  * **Feishin** (Desktop): Full schema compliance with `@ts-rest/core` and Zod client validation.
  * **DSub**, **Ultrasonic**, **Audinaut**, **Ampr**, and other Subsonic clients.
* **Modern Cryptographic Security**: MD5 token authentication (`token = MD5(password + salt)`) and legacy cleartext/hex parameter support with automatic password encryption and persistent AES-256 server secrets.
* **Full Protocol Coverage**: Browsing (`getArtists`, `getIndexes`, `getMusicDirectory`, `getAlbum`, `getSong`), streaming with HTTP 206 Partial Content byte-range seeking, scrobbling, favorites/starring sync, and full playlist management.
* **Instant Activation**: Connect mobile and desktop clients directly using your standard Trax Vault credentials.

---

### 🏷️ Native MusicBrainz Tagger Studio (`/tagger`)
* **Zero Container Footprint**: Pure TypeScript tagger powered by `@dantheman827/taglib-ts` embedded directly in the web app—no secondary Picard Docker containers, extra ports, or native compilation required.
* **Dual-Mode Tagging**:
  * **Vault Albums**: Inspect and re-tag albums already imported into the database.
  * **Scanned Folders**: Browse, search, and tag raw music folders on disk before adding them to your vault.
* **Fuzzy Track Alignment**: Multi-factor scoring aligns local tracks against official MusicBrainz releases by track position, fuzzy string distance (Levenshtein & Dice coefficient), and duration delta.
* **Missing Songs Detection**: Automatically detects when a MusicBrainz release contains tracks not present in your local folder and highlights missing tracks in an alert banner.
* **Direct File Tag Writing**: Writes verified ID3v2, Vorbis, and MP4 tags directly into `.flac`, `.mp3`, `.m4a`, `.ogg`, and `.wav` files on disk.
* **Cover Art Archive Integration**: Automatically downloads high-resolution front artwork into the album directory (`cover.jpg`).

---

### ✍️ Interactive LRC Maker Studio (`/lrc-maker`)
* **Companion Lyrics Read & Write on Disk**: Automatically detects companion `.lrc` and `.txt` files in the exact same directory as your audio files and writes edits directly back to disk.
* **1-Click LRCLIB Integration**: Query `lrclib.net` to instantly pull down plain lyrics or ready-to-use synced timestamps.
* **Line-by-Line Synchronization**: Tap `Space` or `Enter` to record timestamps in real-time as the song plays.
* **Live Singing Line Auto-Focus**: Reactive playback tracking highlights the active line with an emerald pulsating glow and smoothly auto-scrolls the view.
* **Multi-Line Batch Time Shifting**: Select multiple lines (with Shift+Click range select) and shift timestamps by `±1.0s`, `±0.5s`, `±0.1s`, or custom offsets.
* **Instrumental Track Support**: Mark instrumental tracks (`♪ Musical Note` or tag) with 1 click across the LRC Maker and Album editor.

---

### 🛡️ Audio Quality, Censorship & The Fixer
* **Format & Fidelity Auditing**: Classify tracks as lossless (**FLAC**, **ALAC**, **WAV**, **AIFF**) or lossy (**MP3 320**, **MP3 V0**, **MP3 128**, **AAC**, **OGG**).
* **Encode Quality Ratings**: Grade encodes as *Perfect (Studio Lossless)*, *Good (Clean / 320)*, *Acceptable*, *Bad / Distorted*, or *Needs Upgrade*.
* **Censorship Tracking**: Tag tracks as **Explicit / Uncensored Original**, **Clean Original**, **Censored / Radio Edit**, or **Instrumental**.
* **The Fixer Dashboard (`/issues`)**: High-level **Vault Health Score** highlighting low-bitrate rips, censored edits, and missing lyrics with 1-click batch upgrades.

---

### 🔍 Library Scanner & Curation (`/scan`)
* **Flexible Audio Format Support**: Automatically indexes `.flac`, `.mp3`, `.m4a`, `.ogg`, `.wav`, `.ape`, `.wv`, `.dsf`, `.dff`, `.m4b`, `.mpc`, and `.aif`.
* **Safe, Non-Destructive Curation**: Pick and choose exactly which albums or songs to import into the Vault.
* **Opt-In Startup Sync**: Auto-import on boot is strictly opt-in (`AUTO_SYNC_LIBRARY=false` by default) so unwanted albums are never forcibly re-added.
* **1-Click Unvault / Remove**: Remove any album or track from the Vault back to the Scanner with a single click. Audio files on disk in `./music` remain completely untouched!
* **Filter Pills**: Filter discovered albums by *All*, *In Vault*, *Not In Vault*, *Censored*, *Missing Lyrics*, *Unsynced LRC*, or *Bad Quality*.

---

## 🐳 Self-Hosting with Docker

Trax Vault publishes automated Docker container images to the Forgejo Container Registry (`git.kapyhub.cz/kapybara/trax-vault:latest`) on every push to `main`.

### Quick Start (No Git Clone Required)

On your server, you do not need to clone the repository or install Node.js. All you need is a single `docker-compose.yml` file:

```bash
# 1. Create a directory for Trax Vault
mkdir -p trax-vault && cd trax-vault

# 2. Download the ready-to-run compose file
curl -fsSL https://git.kapyhub.cz/kapybara/trax-vault/raw/branch/main/docker-compose.server.yml -o docker-compose.yml

# 3. Edit paths if your music is stored outside ./music (optional)
# MUSIC_PATH=/path/to/your/music docker compose up -d

# 4. Start Trax Vault
docker compose up -d
```

### Updating to the Latest Version

To update your server when a new version is published:

```bash
cd trax-vault
docker compose pull
docker compose up -d
```

---

### Alternative: Build from Source with Docker

To build directly from source using HTTPS:

```bash
# Clone the repository via HTTPS
git clone https://git.kapyhub.cz/kapybara/trax-vault.git
cd trax-vault

# Build and start container
docker compose up -d --build
```

---

## 📱 Subsonic Mobile & Desktop Setup

Connect your favorite music player to Trax Vault using the Subsonic / OpenSubsonic protocol:

| Setting | Value |
| :--- | :--- |
| **Server URL** | `http://<your-server-ip>:3000` (or `https://your-domain.com`) |
| **Username** | Your Trax Vault username (e.g. `kapybara` or `admin`) |
| **Password** | Your Trax Vault password |

### Client Highlights:
* **Symfonium (Android)**:
  1. Add provider → select **Subsonic / OpenSubsonic**.
  2. Enter your server URL and credentials.
  3. Symfonium performs an efficient fast sync and pulls structured karaoke lyrics for offline playback.
* **Feishin (Desktop - Linux / macOS / Windows)**:
  1. Add server → select **Subsonic / OpenSubsonic**.
  2. Enter server URL, username, and password.
  3. Enjoy high-fidelity desktop playback and playlist synchronization.

---

## ⚙️ Configuration & Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port on which Trax Vault listens |
| `DATA_DIR` | `/app/data` (or `./data`) | Directory storing SQLite database (`traxvault.db`) and secrets |
| `MUSIC_DIR` | `/music` (or `./music`) | Directory containing your music library (read-write for tagger & lyrics) |
| `AUTO_SYNC_LIBRARY` | `false` | When set to `true`, automatically imports all albums found in `/music` on boot |
| `ORIGIN` | `http://localhost:3000` | Public URL or IP address for CSRF form handling |
| `AUTH_DISABLED` | `false` | Set to `true` to bypass login on private local networks (warns on startup) |
| `COOKIE_SECURE` | Auto (`production`/HTTPS) | Enforces HTTPS-only session cookies when behind a reverse proxy |

---

## 🛠️ Local Development (Without Docker)

### Prerequisites
* **Node.js**: v20+, v22+, or v24+
* **npm**: v10+

### Setup & Run
```bash
# 1. Clone repository via HTTPS
git clone https://git.kapyhub.cz/kapybara/trax-vault.git
cd trax-vault

# 2. Install dependencies
npm install

# 3. Start development server with live reload
npm run dev

# 4. Type-check & Production build
npm run check
npm run build
PORT=3000 MUSIC_DIR=/path/to/music node build
```

---

## 🔄 Version Lifecycle & Upgrades

Trax Vault uses an **N-1 Stepping-Stone Upgrade Policy** to ensure zero data loss across major architectural transitions:

* **v1.6 (Legacy `trackvault.db`)**: Legacy database format.
* **v1.7 (Bridge Release - Current)**:
  * Automatically detects legacy `trackvault.db` and migrates to `traxvault.db`.
  * Performs WAL checkpointing (`PRAGMA wal_checkpoint(TRUNCATE)`), creates a timestamped safety backup (`trackvault.db.v1.6.<timestamp>.bak`), and stamps schema version `170`.
* **v2.0+ (Future Releases)**:
  * Direct upgrades from v1.6 are rejected with an informative fatal error to protect against data corruption.
  * Users running v1.6 must upgrade to v1.7 first before upgrading to v2.0.

---

## 🗄️ Tech Stack

* **Framework**: [SvelteKit 5](https://svelte.dev) (Runes: `$state`, `$derived`, `$props`)
* **Language**: TypeScript
* **Styling**: [Tailwind CSS 4](https://tailwindcss.com)
* **Database**: [SQLite](https://sqlite.org) via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (WAL mode enabled)
* **Audio Tagging**: [@dantheman827/taglib-ts](https://github.com/dantheman827/taglib-ts) (Pure TypeScript TagLib)
* **Metadata Extraction**: [music-metadata](https://github.com/Borewit/music-metadata)
* **Metadata API**: [MusicBrainz API](https://musicbrainz.org) & [Cover Art Archive](https://coverartarchive.org)
* **Icons**: [@lucide/svelte](https://lucide.dev)
* **Container**: Docker + Docker Compose with `@sveltejs/adapter-node`
