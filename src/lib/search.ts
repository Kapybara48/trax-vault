import type { Track, SearchFilters, AudioFormat } from './types/index.js';

/**
 * Parses user search query string into structured SearchFilters.
 * Handles tokens like `!flac`, `format:!flac`, `censored`, `!missing`, `synced_lrc`, etc.
 */
export function parseSearchQuery(query: string): SearchFilters {
	const filters: SearchFilters = {};
	if (!query || !query.trim()) return filters;

	const tokens = query.trim().split(/\s+/);
	const textWords: string[] = [];

	for (const rawToken of tokens) {
		const token = rawToken.toLowerCase();

		// Format matches
		if (token === '!flac' || token === 'format:!flac' || token === '!lossless') {
			filters.notFormat = 'FLAC';
		} else if (token === '!mp3' || token === 'format:!mp3') {
			filters.notFormat = 'MP3';
		} else if (token === 'flac' || token === 'format:flac' || token === 'lossless') {
			filters.format = 'FLAC';
		} else if (token === 'mp3' || token === 'format:mp3') {
			filters.format = 'MP3';
		} else if (token === 'format:mp3_320' || token === 'mp3_320' || token === '320k') {
			filters.format = 'MP3_320';
		} else if (token === 'format:mp3_v0' || token === 'mp3_v0' || token === 'v0') {
			filters.format = 'MP3_V0';
		} else if (token === 'format:mp3_128' || token === 'mp3_128' || token === '128k') {
			filters.format = 'MP3_128';
		} else if (token === 'format:aac' || token === 'aac' || token === 'm4a') {
			filters.format = 'AAC_256';
		} else if (token === 'format:wav' || token === 'wav') {
			filters.format = 'WAV';
		} else if (token === 'format:alac' || token === 'alac') {
			filters.format = 'ALAC';
		} else if (token === 'format:ogg' || token === 'ogg') {
			filters.format = 'OGG';
		}
		// Censorship matches
		else if (token === 'censored' || token === 'censor:censored') {
			filters.censorship = 'censored';
		} else if (token === '!censored' || token === 'censor:!censored' || token === 'uncensored') {
			filters.notCensorship = 'censored';
		} else if (token === 'explicit' || token === 'censor:explicit') {
			filters.censorship = 'explicit';
		} else if (token === 'clean' || token === 'censor:clean') {
			filters.censorship = 'clean_original';
		} else if (token === '!clean' || token === 'censor:!clean') {
			filters.notCensorship = 'clean_original';
		}
		// Lyrics matches
		else if (token === 'missing' || token === 'lyrics:missing' || token === 'nolyrics') {
			filters.lyrics = 'missing';
		} else if (token === '!missing' || token === 'lyrics:!missing' || token === 'haslyrics') {
			filters.notLyrics = 'missing';
		} else if (token === 'synced' || token === 'synced_lrc' || token === 'lyrics:synced' || token === 'lyrics:synced_lrc') {
			filters.lyrics = 'synced_lrc';
		} else if (token === 'unsynced' || token === 'unsynced_lrc' || token === 'lyrics:unsynced' || token === 'lyrics:unsynced_lrc') {
			filters.lyrics = 'unsynced_lrc';
		} else if (token === 'plain' || token === 'plain_txt' || token === 'lyrics:plain') {
			filters.lyrics = 'plain_txt';
		} else if (token === 'censored_lrc' || token === 'lyrics:censored' || token === 'lyrics:censored_lrc') {
			filters.lyrics = 'censored_lrc';
		}
		// Quality matches
		else if (token === 'bad' || token === 'quality:bad') {
			filters.quality = 'bad';
		} else if (token === 'good' || token === 'quality:good') {
			filters.quality = 'good';
		} else if (token === 'perfect' || token === 'quality:perfect') {
			filters.quality = 'perfect';
		}
		// Manually checked / verified matches
		else if (token === 'checked' || token === 'verified' || token === 'is:checked' || token === 'is:verified') {
			filters.manuallyChecked = 1;
		} else if (token === '!checked' || token === '!verified' || token === 'unverified' || token === 'unchecked' || token === 'is:!checked') {
			filters.manuallyChecked = 0;
		}
		// Normal search query word
		else {
			textWords.push(rawToken);
		}
	}

	if (textWords.length > 0) {
		filters.search = textWords.join(' ');
	}

	return filters;
}

/**
 * Checks if a track matches the given search filters.
 */
export function matchesTrackFilters(track: Track, filters: SearchFilters): boolean {
	// Format filter
	if (filters.notFormat) {
		if (filters.notFormat === 'FLAC' && track.format === 'FLAC') return false;
		if (filters.notFormat === 'MP3' && track.format.startsWith('MP3')) return false;
		if (track.format === filters.notFormat) return false;
	}

	if (filters.format) {
		if (filters.format === 'MP3') {
			if (!track.format.startsWith('MP3')) return false;
		} else if (track.format !== filters.format) {
			return false;
		}
	}

	// Censorship filter
	if (filters.notCensorship && track.censorship === filters.notCensorship) {
		return false;
	}
	if (filters.censorship && track.censorship !== filters.censorship) {
		return false;
	}

	// Lyrics filter
	if (filters.notLyrics && track.lyrics === filters.notLyrics) {
		return false;
	}
	if (filters.lyrics && track.lyrics !== filters.lyrics) {
		return false;
	}

	// Quality filter
	if (filters.quality) {
		if (filters.quality === 'bad') {
			if (track.quality_rating !== 'bad' && track.quality_rating !== 'needs_upgrade') return false;
		} else if (track.quality_rating !== filters.quality) {
			return false;
		}
	}

	// Text query filter
	if (filters.search && filters.search.trim()) {
		const q = filters.search.trim().toLowerCase();
		const titleMatch = track.title.toLowerCase().includes(q);
		const artistMatch = (track.artist || '').toLowerCase().includes(q);
		const albumMatch = (track.album_title || '').toLowerCase().includes(q);
		const albumArtistMatch = (track.album_artist || '').toLowerCase().includes(q);
		if (!titleMatch && !artistMatch && !albumMatch && !albumArtistMatch) {
			return false;
		}
	}

	// Manually checked filter
	if (filters.manuallyChecked !== undefined) {
		if ((track.manually_checked || 0) !== filters.manuallyChecked) {
			return false;
		}
	}

	return true;
}
