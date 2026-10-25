# 💽 Track Vault

**Track Vault** is a modern, self-hosted web application for music collectors and audiophiles to track and audit their music library's audio quality, format status, lyrics coverage, and censorship state.

![Track Vault](https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/disc-3.svg)

---

## 🚀 Key Features

- **Audio Quality & Format Auditing**:
  - Track whether you have lossless **FLAC / ALAC / WAV** or lossy encodes (**MP3 320**, **MP3 V0**, **MP3 128**, **AAC**, **OGG**).
  - Rate audio encode quality (*Perfect*, *Good*, *Acceptable*, *Bad / Distorted*, *Needs Upgrade*).
- **Censorship & Clean Edits Tracking**:
  - Mark tracks as **Explicit / Uncensored Original**, **Clean Original**, or **Censored / Radio Edit**.
  - Highlights censored tracks so you know which ones need replacing with their original uncensored releases.
- **Lyrics Coverage Tracking & Studio**:
  - Track whether songs have synchronized time-coded **Synced (.lrc)** lyrics, **Plain text (.txt)**, or are **Missing lyrics**.
  - Flag instrumental tracks where vocals aren't needed.
  - **Read & Write Directly in Song Folders**:
    - Automatically discovers companion `.lrc` and `.txt` files in the exact same folder as the audio file.
    - Quick Lyrics File Editor directly on the Album page for instant view and edits without navigating away.
    - Non-destructive: audio files remain untouched, only companion lyric files are written.
  - **Interactive LRC Maker Studio (`/lrc-maker`)**:
    - Built-in audio player with Range-seeking server streaming or local drag-and-drop audio file loading.
    - 1-click **LRCLIB.net** integration to fetch plain lyrics or ready-to-use synced lyrics.
    - **Active Song Time Auto-Focus & Auto-Scroll**: Highlights the active line matching current song playback time with a pulsating indicator and smoothly centers the view as the song plays.
    - Synchronize lyrics line-by-line using keyboard hotkeys (`Space` / `Enter`).
    - Millisecond fine-tuning (`+/- 0.1s`), step-back navigation, and real-time live karaoke preview.
    - Save `.lrc` companion files directly to server disk in the song's folder, persist in SQLite database, download `.lrc`, or copy to clipboard.
- **Native MusicBrainz Tagger Studio (`/tagger`)**:
  - Direct built-in MusicBrainz tagger embedded directly inside the Track Vault web interface (no external Docker containers or extra ports needed!).
  - Search releases worldwide by artist or album with automated match candidate scoring.
  - Interactive side-by-side diff table: preview local tags vs official MusicBrainz tags with match confidence pill badges.
  - Write verified ID3/Vorbis tags directly into audio files (`.flac`, `.mp3`, `.m4a`, `.ogg`, `.wav`) on disk.
  - Automatically download high-resolution front cover artwork from the Cover Art Archive.
  - 1-click apply to write audio tags to disk, download cover art, and persist clean metadata into SQLite.
- **Sleek, Responsive Navigation**:
  - Clean primary desktop tabs: **Vault**, **Player**, **Fixer**, **Tagger**, **LRC Maker**, and **Scan**.
  - User Profile pill with direct access to Account Settings, Subsonic credentials, and Password Change.
  - Streamlined mobile bottom bar with instant access across devices.
- **Local Music Library Scanner**:
  - Point Track Vault to your server's music library directory.
  - Automatically reads audio metadata (**FLAC, MP3, M4A, OGG, WAV, etc.**).
  - **Reads embedded MusicBrainz tags** (`musicbrainz_albumid`, `musicbrainz_trackid`, etc.) already present in your files!
  - Automatically detects companion **`.lrc`** or **`.txt`** lyrics files right next to your audio files.
  - **Choose what songs to add and what not**: Select/unselect individual tracks or whole albums before adding to your vault.
- **Online MusicBrainz Search & Import**:
  - Search releases worldwide by artist or album.
  - Pulls complete tracklists, track durations, discs, release year, media format, and official album covers from the Cover Art Archive.
- **Fast Batch Operations**:
  - Bulk update all tracks on an album with 1 click (e.g. set all to FLAC or all to Synced LRC).
- **The Fixer / Issues Dashboard**:
  - High-level **Vault Health Score** (% of pristine tracks).
  - Filter and tackle low-bitrate rips, censored radio edits, and missing lyrics with instant 1-click upgrades.

---

## 🐳 Self-Hosting with Docker

The easiest way to run Track Vault on your server is with Docker Compose.

### 1. Clone repository
```bash
git clone https://github.com/Kapybara48/track-vault.git
cd track-vault
```

### 2. Configure Your Music Directory
Edit `docker-compose.yml` (or create a `.env` file from `.env.example`):

```yaml
services:
  track-vault:
    build: .
    container_name: track-vault
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - DATA_DIR=/app/data
      - MUSIC_DIR=/music
      - ORIGIN=http://localhost:3000
      # Optional: set to true if you want to bypass login on a local network
      # - AUTH_DISABLED=false
    volumes:
      # Persistent SQLite database & album covers
      - ./data:/app/data
      # Mount your music collection (read-write for companion lyrics and tagger)
      - ${MUSIC_PATH:-./music}:/music
```

### 3. Start Container
```bash
docker compose up -d --build
```

Access Track Vault in your browser:
- **Track Vault**: `http://localhost:3000` (library scanner, music player, issues fixer, tagger studio, lyrics maker)

On your first visit to Track Vault, you will be greeted with a **First-Run Admin Setup** screen to create your admin credentials. After setup, standard login is enforced unless `AUTH_DISABLED=true` is set in your environment. You can access the **Tagger Studio** at any time from the Navbar, the Library Scanner, album pages, or Settings.

---

## 🛠️ Local Development (Without Docker)

### Prerequisites
- Node.js 20+ or 22+ (v24 supported)
- npm

### Installation & Run
```bash
# 1. Install dependencies
npm install

# 2. Start development server
npm run dev

# 3. Or create production build
npm run build
PORT=3000 MUSIC_DIR=/path/to/music node build
```

---

## 🗄️ Tech Stack

- **Framework**: [SvelteKit 5](https://svelte.dev) + TypeScript
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com)
- **Database**: [SQLite](https://sqlite.org) via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) with WAL mode enabled
- **Metadata Parsing**: [music-metadata](https://github.com/Borewit/music-metadata) (FLAC, ID3v2, Vorbis, MP4)
- **Metadata Database**: [MusicBrainz API](https://musicbrainz.org) & [Cover Art Archive](https://coverartarchive.org)
- **Icons**: [@lucide/svelte](https://lucide.dev)
