export type AudioFormat =
	| 'FLAC'
	| 'ALAC'
	| 'WAV'
	| 'AIFF'
	| 'MP3_320'
	| 'MP3_V0'
	| 'MP3_192'
	| 'MP3_128'
	| 'AAC_256'
	| 'OGG'
	| 'OTHER';

export type QualityRating =
	| 'perfect'      // Studio / lossless original
	| 'good'         // High quality encode (e.g. 320/V0 or clean lossless)
	| 'acceptable'   // Listen-able but could be better
	| 'bad'          // Transcode, bad rip, audible distortion
	| 'needs_upgrade';// Explicitly flagged for replacement

export type CensorshipStatus =
	| 'explicit'       // Original explicit version
	| 'clean_original' // Track is inherently clean (not censored)
	| 'censored'       // Radio edit / bleeped - wants uncensored replacement
	| 'instrumental'   // No vocals
	| 'unknown';       // Unverified / no advisory tags present

export type LyricsStatus =
	| 'synced_lrc'    // Synced time-coded .lrc
	| 'unsynced_lrc'  // Unsynced .lrc (timestamps shifted / out of sync)
	| 'plain_txt'     // Plain unsynced text
	| 'missing'       // Missing lyrics
	| 'instrumental'; // No lyrics needed

export interface FixerRules {
	flag_lossy?: boolean; // Flag any lossy format (MP3, AAC, OGG, WMA, OPUS)
	flag_mp3?: boolean; // Specific flag for all MP3 files
	flag_bad_quality?: boolean; // default true
	flag_needs_upgrade?: boolean; // default true
	flag_censored?: boolean; // default true
	flag_clean?: boolean; // default false (require explicit)
	flag_missing_lyrics?: boolean; // default true
	flag_unsynced_lyrics?: boolean; // default true
	flag_plain_lyrics?: boolean; // default false (require synced LRC)
}

export interface SearchFilters {
	search?: string;
	format?: string;
	notFormat?: string;
	censorship?: string;
	notCensorship?: string;
	lyrics?: string;
	notLyrics?: string;
	quality?: string;
	notQuality?: string;
	filter?: string;
	manuallyChecked?: number; // 1 for checked, 0 for unchecked
}

export interface Album {
	id: number;
	musicbrainz_id: string | null;
	title: string;
	artist: string;
	release_year: number | null;
	genre: string | null;
	cover_url: string | null;
	media_type: string | null;
	notes: string | null;
	fixer_rules?: string | null;
	created_at: string;
	updated_at: string;
	// Computed / joined fields
	track_count?: number;
	bad_quality_count?: number;
	censored_count?: number;
	missing_lyrics_count?: number;
	checked_count?: number;
	matched_tracks_count?: number;
	parsed_fixer_rules?: FixerRules;
}

export interface Track {
	id: number;
	album_id: number;
	disc_number: number;
	track_number: number;
	title: string;
	artist: string | null;
	duration_ms: number | null;
	format: AudioFormat;
	quality_rating: QualityRating;
	censorship: CensorshipStatus;
	lyrics: LyricsStatus;
	needs_attention: number; // 0 or 1
	manually_checked: number; // 0 or 1 (100% verified by user)
	notes: string | null;
	file_path?: string | null;
	lyrics_text?: string | null;
	bitrate_kbps?: number | null;
	sample_rate?: number | null;
	bits_per_sample?: number | null;
	play_count?: number;
	last_played_at?: string | null;
	created_at: string;
	updated_at: string;
	// Joined album info
	album_title?: string;
	album_artist?: string;
	album_cover_url?: string | null;
	album_year?: number | null;
}

export interface Playlist {
	id: number;
	user_id: number;
	name: string;
	comment?: string | null;
	is_public: number;
	created_at: string;
	updated_at: string;
	song_count?: number;
	duration_ms?: number;
	cover_url?: string | null;
}

export interface CollectionStats {
	total_albums: number;
	total_tracks: number;
	flac_count: number;
	mp3_count: number;
	other_format_count: number;
	bad_quality_count: number;
	censored_count: number;
	missing_lyrics_count: number;
	synced_lyrics_count: number;
	unsynced_lyrics_count: number;
	plain_lyrics_count: number;
	checked_tracks_count?: number;
	total_needs_attention: number;
	health_score: number; // 0 - 100%
}

export interface MusicBrainzReleaseItem {
	id: string;
	title: string;
	artist: string;
	date?: string;
	year?: number | null;
	country?: string;
	track_count?: number;
	media_format?: string;
	cover_url?: string | null;
	barcode?: string | null;
	disambiguation?: string;
}

export interface MusicBrainzReleaseTrack {
	id: string;
	disc_number: number;
	track_number: number;
	title: string;
	artist: string;
	duration_ms: number | null;
}

export interface MusicBrainzReleaseDetail {
	id: string;
	title: string;
	artist: string;
	release_year: number | null;
	genre?: string | null;
	cover_url: string | null;
	media_type: string | null;
	barcode?: string | null;
	tracks: MusicBrainzReleaseTrack[];
}

export interface TrackMatch {
	local_track: Track;
	mb_track: MusicBrainzReleaseTrack | null;
	score: number;
	match_type: 'exact' | 'high' | 'medium' | 'low' | 'unmatched';
	title_diff: boolean;
	artist_diff: boolean;
	number_diff: boolean;
	duration_diff: boolean;
}

export interface AlbumMatchResult {
	album: Album;
	release: MusicBrainzReleaseDetail;
	matches: TrackMatch[];
	missing_tracks?: MusicBrainzReleaseTrack[];
	overall_score: number;
}

export interface FolderMatchResult {
	folder_path: string;
	folder_name: string;
	folder_title: string;
	folder_artist: string;
	folder_year: number | null;
	already_in_vault: boolean;
	existing_album_id: number | null;
	release: MusicBrainzReleaseDetail | null;
	candidates: MusicBrainzReleaseItem[];
	matches: TrackMatch[];
	missing_tracks: MusicBrainzReleaseTrack[];
	overall_score: number;
	message?: string;
}

export interface ScannedFolderItem {
	album_key: string;
	folder_path: string;
	title: string;
	artist: string;
	year: number | null;
	track_count: number;
	already_in_vault: boolean;
	cover_url: string | null;
}

export interface ScannedTrack {
	file_path: string;
	file_name: string;
	title: string;
	artist: string;
	album_artist?: string;
	album: string;
	year: number | null;
	track_number: number;
	disc_number: number;
	duration_ms: number | null;
	format: AudioFormat;
	bitrate_kbps: number | null;
	sample_rate: number | null;
	bits_per_sample: number | null;
	quality_rating: QualityRating;
	censorship: CensorshipStatus;
	lyrics: LyricsStatus;
	has_lrc_file: boolean;
	has_txt_file: boolean;
	has_embedded_lyrics?: boolean;
	lyrics_content?: string | null;
	musicbrainz_album_id: string | null;
	musicbrainz_track_id: string | null;
	musicbrainz_artist_id: string | null;
	musicbrainz_releasegroup_id: string | null;
	selected: boolean;
}

export interface ScannedAlbum {
	album_key: string;
	title: string;
	artist: string;
	year: number | null;
	folder_path: string;
	musicbrainz_id: string | null;
	cover_url: string | null;
	track_count: number;
	has_flac: boolean;
	has_lrc: boolean;
	already_in_vault: boolean;
	tracks: ScannedTrack[];
	selected: boolean;
}

