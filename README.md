# 💽 Trax Vault

[![License: Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](LICENSE.md)

**Trax Vault** is a modern, self-hosted web application, audiophile player studio, and Subsonic/OpenSubsonic streaming server built for music collectors. Audit audio fidelity, track censorship, create synchronized lyrics, tag files directly with MusicBrainz, sync playback across devices in real time, and stream your lossless music library anywhere.

---

## 🚀 Key Features

### 🎧 Audiophile Player Studio (`/player`)
* **Spotify-Inspired Studio Experience**: Beautiful obsidian glassmorphic interface with reactive library drawer, album/artist/playlist switcher, and responsive desktop/mobile views.
* **Persistent Background Audio**: Centralized singleton audio engine mounted at the root layout. Music continues playing seamlessly as you navigate between pages (`/`, `/issues`, `/tagger`, `/scan`, `/settings`) or browse other tabs.
* **Floating Global Mini-Player Dock**: Compact dock on non-player pages with vinyl artwork, title, playback controls, scrubber, volume, and fidelity indicators.
* **Real-Time Synced Karaoke Lyrics**: Studio teleprompter panel with smooth vertical auto-scroll, glowing active line focus, and timestamp click-to-seek.
* **Exact Bitrate & Audio Fidelity Extraction**: Differentiates standard CD lossless (16-bit / 44.1kHz) from Studio Hi-Res lossless (24-bit / 48–96kHz+). Displays exact bitrate extraction (e.g. `FLAC • 893 kbps • 16-bit / 48.0 kHz`).
* **Persistent Session & Exact-Second Resume**: Refreshing your browser or opening a new tab automatically restores your exact song, queue, and playback second without unexpected auto-play jumpscares.
* **Multi-Disc Separators & CD Management**: Automatic multi-disc detection with sticky headers (`Disc 1`, `Disc 2`) and 1-click "Play Disc" shortcuts.
* **Integrated Playlists Hub**: Create, edit, reorder, and delete playlists directly inside the player without navigating away.
* **Keyboard Shortcuts & OS Integration**: Control playback with hotkeys (`Space`, `J`, `K`, `M`, arrow keys) and native MediaSession OS lockscreen integration.

---

### 📻 Real-Time Multi-Device Playback Sync & "Listen Together" Jam Sessions
* **Server-Sent Events (SSE) Sync Engine**: Real-time server-coordinated playback across all your open phones, tablets, laptops, and desktop browsers.
* **Independent Playback by Default**: Each device plays its own music independently on its own by default without unexpected interruptions or hijacking.
* **1-Click Live Device Sync**:
  * **Companion Display & Synced Lyrics Remote (Muted Here)**: Mutes local audio while displaying live album art, track progress, and real-time synchronized karaoke lyrics, acting as a remote control for an active speaker.
  * **Play Here Only (Transfer Audio)**: Seamlessly transfers exclusive sound output to your current device.
  * **Play on Multiple (Simultaneous Audio)**: Plays synchronized audio across multiple devices simultaneously with sub-second clock drift correction.
* **Cross-Account "Listen Together" Rooms**: Create private or public 6-character room codes (e.g., `VAULT7`), copy shareable invite links, and listen to music simultaneously with friends across different user accounts on your server.

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

### 🛡️ Audio Quality, Censorship & Global Fixer Rules (`/issues`)
* **Global Fixer Rules Studio**: Configure vault-wide audit rules for minimum bitrates, allowed audio formats (lossless vs lossy), acceptable quality grades, lyrics presence, and censorship tolerances with 1-click presets (`Balanced Default`, `High-Bitrate ≥ 256k`, `Strict Lossless Only`, `Relaxed`).
* **Format & Fidelity Auditing**: Classify tracks as lossless (**FLAC**, **ALAC**, **WAV**, **AIFF**) or lossy (**MP3 320**, **MP3 V0**, **MP3 128**, **AAC**, **OGG**).
* **Encode Quality Ratings**: Grade encodes as *Perfect (Studio Lossless)*, *Good (Clean / 320)*, *Acceptable*, *Bad / Distorted*, or *Needs Upgrade*.
* **Censorship Tracking**: Tag tracks as **Explicit / Uncensored Original**, **Clean Original**, **Censored / Radio Edit**, or **Instrumental**.
* **The Fixer Dashboard**: High-level **Vault Health Score** highlighting low-bitrate rips, censored edits, and missing lyrics with 1-click batch upgrades.

---

### 🔍 Library Scanner & Curation (`/scan`)
* **Flexible Audio Format Support**: Automatically indexes `.flac`, `.mp3`, `.m4a`, `.ogg`, `.wav`, `.ape`, `.wv`, `.dsf`, `.dff`, `.m4b`, `.mpc`, and `.aif`.
* **Safe, Non-Destructive Curation**: Pick and choose exactly which albums or songs to import into the Vault.
* **Opt-In Startup Sync**: Auto-import on boot is strictly opt-in (`AUTO_SYNC_LIBRARY=false` by default) so unwanted albums are never forcibly re-added.
* **1-Click Unvault / Remove**: Remove any album or track from the Vault back to the Scanner with a single click. Audio files on disk in `./music` remain completely untouched!
* **Filter Pills**: Filter discovered albums by *All*, *In Vault*, *Not In Vault*, *Censored*, *Missing Lyrics*, *Unsynced LRC*, or *Bad Quality*.

---

### 👥 Multi-User Architecture & Mobile Design
* **Multi-User Architecture**: Independent user accounts with custom roles (`admin` vs `user`), personal playlists, favorites, and Subsonic streaming credentials.
* **Configurable Registration Policy**: Public account registration enabled by default (`/register`), or toggleable via `DISABLE_REGISTRATION=true` so only administrators can provision accounts.
* **Admin Management Console**: Dedicated User Management hub in `/settings` for administrators to create, edit, change roles, update passwords, and delete accounts.
* **Responsive 3-Tier Layout**: Fluid breakpoints tailored for Phone (`< 640px`), Tablet (`640px – 1024px`), and Desktop (`> 1024px`), featuring compact touch-friendly navigation and zero horizontal scrolling.

---

### 🚀 Admin Web UI Song Management (Upload, Replace, Delete & Download)
* **Multi-File Drag-and-Drop Upload**: Select or drag-and-drop multiple audio files (`.flac`, `.mp3`, `.m4a`, `.ogg`, `.wav`, etc.) directly into an album from your web browser.
* **Smart Missing Track Auto-Linking**: Uploaded files automatically match and fulfill missing songs (`is_missing = 1`), populating their audio fidelity, bitrates, and duration without creating duplicates.
* **1-Click Audio Replacement**: Replace low-quality or corrupt audio files with high-resolution rips directly from the song row with automatic fixer re-evaluation.
* **Safe Deletion with Disk Option**: Clear confirmation modal allows administrators to choose between removing a song from Trax Vault only or permanently unlinking the audio file and companion `.lrc` from storage.
* **Direct Download & Re-scan**: Download original audio tracks with 1 click or re-scan metadata and exact bitrates from storage on demand.

---

## 📦 Installation & Deployment

### Method 1: Docker Compose with Forgejo Image (Recommended & Fastest)

Trax Vault publishes automated, production-ready multi-arch Docker container images to the Forgejo Container Registry:
`forgejo.kapyhub.cz/kapybara/trax-vault:latest`

**You do NOT need to clone the git repository or install Node.js.** You only need a single directory and a `docker-compose.yml` file.

#### 1. Create a project directory:
```bash
mkdir -p trax-vault && cd trax-vault
```

#### 2. Create `docker-compose.yml`:
Create `docker-compose.yml` with the following contents (or run `curl -fsSL https://forgejo.kapyhub.cz/kapybara/trax-vault/raw/branch/main/docker-compose.server.yml -o docker-compose.yml`):

```yaml
services:
  trax-vault:
    image: forgejo.kapyhub.cz/kapybara/trax-vault:latest
    container_name: trax-vault
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - DATA_DIR=/app/data
      - MUSIC_DIR=/music
      - NODE_OPTIONS=--no-network-family-autoselection
      # Set to your server URL or IP address (used for SvelteKit CSRF form validation)
      - ORIGIN=http://localhost:3000
      # Set to true to automatically import all albums found in /music on boot (default: false)
      # - AUTO_SYNC_LIBRARY=false
      # Set to true to disable public account signups (admin creates accounts in /settings)
      # - DISABLE_REGISTRATION=false
    volumes:
      # Persistent SQLite database & album covers
      - ./data:/app/data
      # Path to your music library (must be read-write :rw for lyrics editing & tagger)
      - /path/to/your/music:/music:rw
```

> [!IMPORTANT]
> Change `/path/to/your/music` to the actual directory where your music collection is stored on the host. Ensure the volume is mounted read-write (`:rw`) so Trax Vault can save companion `.lrc` lyrics files and write audio tags.

#### 3. Start Trax Vault:
```bash
docker compose up -d
```
Access the web interface at `http://<your-server-ip>:3000`. On the first launch, you will be prompted to create your primary administrator account.

#### 4. Updating to the Latest Version:
To update Trax Vault when a new version is released:
```bash
cd trax-vault
docker compose pull
docker compose up -d
```

---

### Method 2: Clone Repository & Build with Docker Compose

If you prefer to build the container directly from source:

```bash
# 1. Clone repository via HTTPS
git clone https://forgejo.kapyhub.cz/kapybara/trax-vault.git
cd trax-vault

# 2. Configure music path (defaults to ./music)
# Edit docker-compose.yml or set MUSIC_PATH:
export MUSIC_PATH="/path/to/your/music"

# 3. Build and launch container
docker compose up -d --build
```

---

### Method 3: Bare Metal / Local Development (Node.js)

To run Trax Vault natively on Linux, macOS, or Windows without Docker:

#### Prerequisites
* **Node.js**: v20+, v22+, or v24+
* **npm**: v10+

```bash
# 1. Clone repository via HTTPS
git clone https://forgejo.kapyhub.cz/kapybara/trax-vault.git
cd trax-vault

# 2. Install dependencies
npm install

# 3. Run development server with live reload
npm run dev

# 4. Or build and run production server:
npm run check
npm run build

PORT=3000 \
DATA_DIR=./data \
MUSIC_DIR=/path/to/your/music \
ORIGIN=http://localhost:3000 \
node build
```

---

## ⚙️ Configuration & Environment Variables

Trax Vault is configured entirely through standard environment variables. You can provide these in your `docker-compose.yml`, a `.env` file, or your shell environment:

| Variable | Default | Required | Description |
| :--- | :--- | :---: | :--- |
| `PORT` | `3000` | No | Port on which the Trax Vault HTTP server listens. |
| `DATA_DIR` | `/app/data` (Docker)<br>`./data` (Local) | No | Filesystem directory storing the SQLite database (`traxvault.db`), session keys, artist avatars, and cache files. |
| `MUSIC_DIR`<br>*(or `MUSIC_PATH`)* | `/music` (Docker)<br>`./music` (Local) | Yes | Filesystem path to your music collection. Must be mounted read-write (`:rw`) to allow writing companion `.lrc` lyrics files and updating audio tags. |
| `ORIGIN` | `http://localhost:3000` | Recommended | The public web URL or IP address of your Trax Vault instance (e.g. `http://192.168.1.50:3000` or `https://music.example.com`). Required by SvelteKit to validate CSRF tokens for web form actions. |
| `NODE_ENV` | `production` | No | Runtime environment (`production` or `development`). In production, security safeguards like secure cookies and authentication bypass protection are active. |
| `AUTO_SYNC_LIBRARY` | `false` | No | When set to `true`, Trax Vault automatically scans and imports all detected music folders in `MUSIC_DIR` into the Vault database on server startup. When `false`, discovered albums appear in `/scan` for manual, curated import. |
| `DISABLE_REGISTRATION`<br>*(or `DISABLE_ACCOUNT_CREATION`)* | `false` | No | When set to `true`, disables the public `/register` form. Only logged-in administrators can create new user accounts in the `/settings` user management panel. |
| `ALLOW_REGISTRATION`<br>*(or `ALLOW_ACCOUNT_CREATION`)* | `true` | No | Explicit override to allow public self-registration if enabled. |
| `AUTH_DISABLED`<br>*(or `DISABLE_AUTH`)* | `false` | No | When set to `true`, bypasses all authentication and automatically logs in as a synthetic administrator (useful for isolated local networks). **Safety:** In `NODE_ENV=production`, this is blocked unless `ALLOW_INSECURE_AUTH_BYPASS=true` is also specified. |
| `ALLOW_INSECURE_AUTH_BYPASS` | `false` | No | Confirms and allows `AUTH_DISABLED=true` to function even when running in `production` mode. |
| `COOKIE_SECURE` | Auto (`production` / HTTPS) | No | Controls the `Secure` flag on the `vault_session` cookie (`true` or `false`). Set to `false` if accessing your server over plain HTTP on a local network while in production mode. |
| `SUBSONIC_SECRET_KEY` | Auto-generated | No | Custom secret passphrase used to derive AES-256-GCM encryption for Subsonic passwords in SQLite. If omitted, Trax Vault automatically generates and securely persists a key in `${DATA_DIR}/subsonic.key`. |
| `BODY_SIZE_LIMIT` | `Infinity` | No | Maximum allowed HTTP request body size for uploads (audio files and album covers). Default is set to `Infinity` by Trax Vault postbuild. |
| `NODE_OPTIONS` | None | No | Node.js CLI runtime flags (e.g. `--no-network-family-autoselection` to prevent dual-stack IPv6 DNS delays inside Docker containers). |

---

## 📱 Subsonic & OpenSubsonic Mobile Setup

Connect your favorite mobile or desktop music player to Trax Vault using the Subsonic / OpenSubsonic protocol:

| Setting | Recommended Value |
| :--- | :--- |
| **Server URL** | `http://<your-server-ip>:3000` (or `https://your-domain.com`) |
| **Username** | Your Trax Vault username (e.g. `kapybara` or `admin`) |
| **Password** | Your Trax Vault password |

### Tested Clients:
* **Symfonium (Android)**:
  1. Add provider → select **Subsonic / OpenSubsonic**.
  2. Enter server URL, username, and password.
  3. Symfonium performs fast catalog sync via `search3` and downloads structured millisecond karaoke lyrics via OpenSubsonic `getLyricsBySongId`.
* **Feishin (Desktop - Linux / macOS / Windows)**:
  1. Add server → select **Subsonic / OpenSubsonic**.
  2. Enter server URL, username, and password.
  3. Enjoy high-fidelity desktop streaming, schema-validated browsing, and playlist synchronization.
* **DSub / Ultrasonic / Audinaut**:
  Connect using standard Subsonic credentials for streaming and caching on older Android devices.

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

---

## 📄 License

This project is licensed under **The Unlicense** (Public Domain). You are free to copy, modify, publish, use, compile, sell, or distribute this software for any purpose, commercial or non-commercial, and by any means.

See [LICENSE.md](LICENSE.md) for full license details.
