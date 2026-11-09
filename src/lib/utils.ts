import type { AudioFormat, QualityRating, CensorshipStatus, LyricsStatus } from '$lib/types/index.js';

export function formatDuration(ms: number | null): string {
	if (!ms || ms <= 0) return '--:--';
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

export const FORMAT_OPTIONS: { value: AudioFormat; label: string; isLossless: boolean }[] = [
	{ value: 'FLAC', label: 'FLAC', isLossless: true },
	{ value: 'ALAC', label: 'ALAC', isLossless: true },
	{ value: 'WAV', label: 'WAV', isLossless: true },
	{ value: 'MP3_320', label: 'MP3 320k', isLossless: false },
	{ value: 'MP3_V0', label: 'MP3 V0', isLossless: false },
	{ value: 'MP3_192', label: 'MP3 192k', isLossless: false },
	{ value: 'MP3_128', label: 'MP3 128k', isLossless: false },
	{ value: 'AAC_256', label: 'AAC 256k', isLossless: false },
	{ value: 'OGG', label: 'OGG', isLossless: false },
	{ value: 'OTHER', label: 'Other', isLossless: false }
];

export const QUALITY_OPTIONS: { value: QualityRating; label: string; color: string }[] = [
	{ value: 'perfect', label: 'Perfect', color: 'text-emerald-400 bg-emerald-950/60 border-emerald-800' },
	{ value: 'good', label: 'Good', color: 'text-cyan-400 bg-cyan-950/60 border-cyan-800' },
	{ value: 'acceptable', label: 'Acceptable', color: 'text-amber-300 bg-amber-950/60 border-amber-800' },
	{ value: 'bad', label: 'Bad', color: 'text-rose-400 bg-rose-950/60 border-rose-800' },
	{ value: 'needs_upgrade', label: 'Needs Upgrade', color: 'text-red-400 bg-red-950/80 border-red-700 font-bold' }
];

export const CENSORSHIP_OPTIONS: { value: CensorshipStatus; label: string; shortLabel: string; color: string }[] = [
	{ value: 'explicit', label: 'Explicit', shortLabel: 'Explicit', color: 'text-amber-300 bg-amber-950/60 border-amber-800' },
	{ value: 'clean_original', label: 'Clean Original', shortLabel: 'Clean', color: 'text-neutral-300 bg-neutral-800/80 border-neutral-700' },
	{ value: 'censored', label: 'Censored', shortLabel: 'Censored', color: 'text-rose-300 bg-rose-950/80 border-rose-600 font-semibold' },
	{ value: 'instrumental', label: 'Instrumental', shortLabel: 'Inst.', color: 'text-neutral-400 bg-neutral-900 border-neutral-800' },
	{ value: 'unknown', label: 'Unverified / Unknown', shortLabel: 'Unknown', color: 'text-neutral-400 bg-neutral-900/60 border-neutral-800' }
];

export const LYRICS_OPTIONS: { value: LyricsStatus; label: string; shortLabel: string; color: string }[] = [
	{ value: 'synced_lrc', label: 'Synced LRC', shortLabel: 'Synced LRC', color: 'text-emerald-300 bg-emerald-950/60 border-emerald-700' },
	{ value: 'censored_lrc', label: 'Censored LRC', shortLabel: 'Censored LRC', color: 'text-orange-300 bg-orange-950/70 border-orange-700/80 font-medium' },
	{ value: 'unsynced_lrc', label: 'Unsynced LRC', shortLabel: 'Unsynced LRC', color: 'text-amber-300 bg-amber-950/70 border-amber-700/80 font-medium' },
	{ value: 'plain_txt', label: 'Plain TXT', shortLabel: 'Plain TXT', color: 'text-sky-300 bg-sky-950/60 border-sky-800' },
	{ value: 'missing', label: 'No Lyrics', shortLabel: 'Missing', color: 'text-rose-400 bg-rose-950/80 border-rose-700' },
	{ value: 'instrumental', label: 'Instrumental', shortLabel: 'Inst.', color: 'text-neutral-400 bg-neutral-900 border-neutral-800' }
];

export function getBitrateLabel(format: AudioFormat, bitrateKbps?: number | null): string {
	if (bitrateKbps && bitrateKbps > 0) {
		return `${bitrateKbps.toLocaleString()} kbps`;
	}
	switch (format) {
		case 'FLAC':
		case 'ALAC':
		case 'WAV':
		case 'AIFF':
			return 'Lossless';
		case 'MP3_320':
			return '320 kbps';
		case 'MP3_V0':
			return '~245 kbps (V0)';
		case 'MP3_192':
			return '192 kbps';
		case 'MP3_128':
			return '128 kbps';
		case 'AAC_256':
			return '256 kbps';
		case 'OGG':
			return '~256 kbps';
		default:
			return 'Lossy';
	}
}

export function getFormatBadgeClass(format: AudioFormat): string {
	switch (format) {
		case 'FLAC':
		case 'ALAC':
		case 'WAV':
		case 'AIFF':
			return 'text-blue-300 bg-blue-950/70 border-blue-700';
		case 'MP3_320':
			return 'text-emerald-300 bg-emerald-950/60 border-emerald-800';
		case 'MP3_V0':
			return 'text-teal-300 bg-teal-950/60 border-teal-800';
		case 'MP3_192':
		case 'AAC_256':
		case 'OGG':
			return 'text-amber-300 bg-amber-950/60 border-amber-800';
		case 'MP3_128':
		case 'OTHER':
		default:
			return 'text-rose-300 bg-rose-950/70 border-rose-700';
	}
}

/**
 * Detects whether lyrics text represents an instrumental track
 * (e.g. [00:00.00]♪, [00:00.00][instrumental], [au:Instrumental], etc.)
 */
export function isInstrumentalLyrics(content: string): boolean {
	if (!content || !content.trim()) return false;
	const trimmed = content.trim();

	// 1. Explicit [au:Instrumental] metadata tag
	if (/^\[au:\s*instrumental\]/im.test(trimmed)) {
		return true;
	}

	// 2. Timestamped instrumental indicator, e.g. [00:00.00]♪ or [00:00.00][instrumental]
	if (/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*(♪|♫|\[instrumental\]|\(instrumental\)|instrumental)/i.test(trimmed)) {
		return true;
	}

	// 3. File containing only non-vocal indicator line(s)
	const nonHeaderLines = trimmed
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l && !/^\[(ti|ar|al|length|by|offset|re|ve):/i.test(l));

	if (nonHeaderLines.length === 1) {
		const lineClean = nonHeaderLines[0]
			.replace(/^\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/, '')
			.trim()
			.toLowerCase();
		if (
			lineClean === '♪' ||
			lineClean === '♫' ||
			lineClean === '[instrumental]' ||
			lineClean === '(instrumental)' ||
			lineClean === 'instrumental'
		) {
			return true;
		}
	}

	return false;
}

/**
 * Detects whether lyrics text contains censored words, bleeps, or asterisk masks
 * (e.g. "f***", "b****", "sh*t", "a**", "[censored]", "[bleep]", "[ __ ]")
 */
export function isCensoredLyrics(content: string): boolean {
	if (!content || !content.trim()) return false;

	// Strip metadata headers like [ti:...], [ar:...], and timestamps [00:12.34]
	const cleanLines = content
		.split('\n')
		.map((l) => l.replace(/^\[[a-zA-Z0-9_]+:[^\]]*\]/, '').replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim())
		.filter((l) => l.length > 0)
		.join('\n');

	if (!cleanLines) return false;

	// 1. Explicit tags / bleep indicators
	if (/\[(?:censored|bleep|beep|muted|\s*_{2,}\s*)\]|\((?:censored|bleep|beep|muted)\)/i.test(cleanLines)) {
		return true;
	}

	// 2. Censored profanity masking patterns (e.g., f***, f**k, sh*t, b****, b***h, a**, n****, p***y)
	const censoredMaskRegex = /\b[a-zA-Z]{1,3}[\*#@$%]{1,5}[a-zA-Z0-9]*\b/i;
	if (censoredMaskRegex.test(cleanLines)) {
		return true;
	}

	// 3. Isolated asterisk/mask tokens replacing a word: e.g. "what the **** is that"
	if (/(?:^|\s)[\*#@$%]{3,}(?:\s|[.,!?;]|$)/.test(cleanLines)) {
		return true;
	}

	return false;
}

/**
 * Strips metadata header tags (e.g. [ti:...], [ar:...], [al:...], [by:...], [length:...], [au:...])
 * and empty brackets [] from lyrics content, while strictly preserving timestamps,
 * section markers ([Chorus]), instrumental indicators, and singing lyrics.
 */
export function stripLrcMetadataHeaders(content: string): string {
	if (!content || !content.trim()) return '';

	const lines = content.split(/\r?\n/);
	const cleanLines: string[] = [];

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) {
			cleanLines.push('');
			continue;
		}

		// Check if line contains only LRC metadata tags like [ti:...], [by:...], [offset:...], or empty brackets []
		const withoutMeta = line
			.replace(/\[[a-zA-Z_]{1,15}:[^\]]*\]/gi, '')
			.replace(/\[\s*\]/g, '')
			.trim();

		// If the line had content, but removing metadata tags left it completely empty, skip this header line
		if (!withoutMeta) {
			continue;
		}

		// If a line has both an inline metadata tag and lyrics, clean the tag out
		if (withoutMeta !== line) {
			const cleaned = line.replace(/\[[a-zA-Z_]{1,15}:[^\]]*\]/gi, '').replace(/\[\s*\]/g, '').trim();
			cleanLines.push(cleaned);
		} else {
			cleanLines.push(rawLine);
		}
	}

	// Remove leading empty lines
	while (cleanLines.length > 0 && cleanLines[0].trim() === '') {
		cleanLines.shift();
	}
	// Remove trailing empty lines
	while (cleanLines.length > 0 && cleanLines[cleanLines.length - 1].trim() === '') {
		cleanLines.pop();
	}

	return cleanLines.join('\n');
}

export interface LrcMetadataHeaders {
	title?: string;
	artist?: string;
	album?: string;
	author?: string;
	length?: string;
	by?: string;
	offset?: number;
}

export interface LyricWord {
	time: number; // Seconds (e.g. 12.34)
	text: string;
}

export interface EnhancedLyricLine {
	id: string;
	time: number | null; // Line start seconds
	endTime?: number | null; // Line end seconds
	text: string; // Clean text without tags
	words?: LyricWord[]; // Word-by-word timestamps
	raw?: string;
}

export function formatLrcTime(seconds: number): string {
	if (isNaN(seconds) || seconds < 0) return '00:00.00';
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	const ms = Math.floor((seconds % 1) * 100);
	return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

export function parseLrcTimestamp(ts: string): number | null {
	const match = ts.match(/\[?<?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?>?\]?/);
	if (!match) return null;
	const m = parseInt(match[1], 10);
	const s = parseInt(match[2], 10);
	const msStr = match[3] || '0';
	const ms = parseFloat(`0.${msStr}`);
	return m * 60 + s + ms;
}

/**
 * Robust parser for standard and Enhanced LRC files.
 * Handles:
 * - Standard ID metadata headers: [ti:], [ar:], [al:], [au:], [length:], [by:], [offset:]
 * - Line start & end timestamps: [00:10.00][00:14.00]Text or [00:10.00]Text[00:14.00]
 * - Multi-timestamp line repetitions: [00:10.00][01:25.00]Chorus
 * - Enhanced LRC word-by-word karaoke timestamps: <00:10.00>word
 */
export function parseLrcEnhanced(content: string): {
	metadata: LrcMetadataHeaders;
	lines: EnhancedLyricLine[];
} {
	const metadata: LrcMetadataHeaders = {};
	const rawLines = (content || '').split(/\r?\n/);
	const lines: EnhancedLyricLine[] = [];

	for (const rawLine of rawLines) {
		const line = rawLine.trim();
		if (!line) continue;

		// 1. Metadata header tags [ti:], [ar:], [al:], [au:], [length:], [by:], [offset:]
		const metaMatch = line.match(/^\[(ti|ar|al|au|length|by|offset):([^\]]*)\]/i);
		if (metaMatch) {
			const tag = metaMatch[1].toLowerCase();
			const val = metaMatch[2].trim();
			if (tag === 'ti') metadata.title = val;
			else if (tag === 'ar') metadata.artist = val;
			else if (tag === 'al') metadata.album = val;
			else if (tag === 'au') metadata.author = val;
			else if (tag === 'length') metadata.length = val;
			else if (tag === 'by') metadata.by = val;
			else if (tag === 'offset') {
				const num = parseInt(val, 10);
				if (!isNaN(num)) metadata.offset = num;
			}
			continue;
		}

		// 2. Extract line bracket timestamps [mm:ss.xx]
		const bracketRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
		const bracketMatches = [...line.matchAll(bracketRegex)];
		const bracketTimes = bracketMatches
			.map((m) => parseLrcTimestamp(m[0]))
			.filter((t): t is number => t !== null);

		// Extract text stripped of bracket timestamps
		const textWithoutBrackets = line.replace(bracketRegex, '').trim();

		// 3. Extract word timestamps <mm:ss.xx> if present
		const wordRegex = /<(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?>([^<]*)/g;
		const wordMatches = [...textWithoutBrackets.matchAll(wordRegex)];
		let words: LyricWord[] | undefined = undefined;
		let cleanText = textWithoutBrackets;

		if (wordMatches.length > 0) {
			words = wordMatches
				.map((wm) => {
					const t = parseLrcTimestamp(wm[0]);
					return t !== null ? { time: t, text: wm[4] } : null;
				})
				.filter((w): w is LyricWord => w !== null);
			cleanText = words.map((w) => w.text).join('').trim();
		}

		if (bracketTimes.length === 0) {
			// Untimed text line
			lines.push({
				id: Math.random().toString(36).slice(2, 9),
				time: null,
				endTime: null,
				text: cleanText,
				raw: line
			});
		} else if (bracketTimes.length === 2 && bracketTimes[1] > bracketTimes[0] && bracketTimes[1] - bracketTimes[0] <= 25) {
			// Start and End timestamps on a single line
			lines.push({
				id: Math.random().toString(36).slice(2, 9),
				time: bracketTimes[0],
				endTime: bracketTimes[1],
				text: cleanText,
				words: words && words.length > 0 ? words : undefined,
				raw: line
			});
		} else {
			// Either single timestamp or repeated chorus timestamps (e.g. [00:10.00][01:30.00]Chorus)
			for (const t of bracketTimes) {
				lines.push({
					id: Math.random().toString(36).slice(2, 9),
					time: t,
					endTime: null,
					text: cleanText,
					words: words && words.length > 0 ? words : undefined,
					raw: line
				});
			}
		}
	}

	// Sort chronologically by start time
	lines.sort((a, b) => {
		if (a.time === null && b.time === null) return 0;
		if (a.time === null) return 1;
		if (b.time === null) return -1;
		return a.time - b.time;
	});

	return { metadata, lines };
}

/**
 * Generates valid standard or Enhanced LRC file content including header metadata.
 */
export function generateLrcEnhanced(
	metadata: LrcMetadataHeaders,
	lines: EnhancedLyricLine[],
	options: { includeHeaders?: boolean } = { includeHeaders: true }
): string {
	const out: string[] = [];

	if (options.includeHeaders !== false) {
		if (metadata.title) out.push(`[ti:${metadata.title}]`);
		if (metadata.artist) out.push(`[ar:${metadata.artist}]`);
		if (metadata.album) out.push(`[al:${metadata.album}]`);
		if (metadata.author) out.push(`[au:${metadata.author}]`);
		if (metadata.length) out.push(`[length:${metadata.length}]`);
		if (metadata.by) out.push(`[by:${metadata.by}]`);
		if (typeof metadata.offset === 'number' && metadata.offset !== 0) out.push(`[offset:${metadata.offset}]`);
	}

	for (const line of lines) {
		if (line.time !== null) {
			let lineStr = `[${formatLrcTime(line.time)}]`;
			if (line.endTime !== null && line.endTime !== undefined && line.endTime > line.time) {
				lineStr += `[${formatLrcTime(line.endTime)}]`;
			}
			if (line.words && line.words.length > 0) {
				const wordStr = line.words.map((w) => `<${formatLrcTime(w.time)}>${w.text}`).join('');
				lineStr += ` ${wordStr}`;
			} else {
				lineStr += ` ${line.text}`;
			}
			out.push(lineStr);
		} else {
			out.push(line.text);
		}
	}

	return out.join('\n');
}

/**
 * Extract MusicBrainz ID from plain UUID string, prefixed format (e.g. mbid:... or reid:...),
 * or full musicbrainz.org URL.
 */
export function extractMusicBrainzId(
	input: string | null | undefined
): { type: 'release' | 'release-group' | 'artist'; mbid: string } | null {
	if (!input) return null;
	const trimmed = String(input).trim();

	// Check for MusicBrainz URL patterns: https://musicbrainz.org/release/UUID or /release-group/UUID or /artist/UUID
	const urlMatch = trimmed.match(
		/musicbrainz\.org\/(release|release-group|artist)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
	);
	if (urlMatch) {
		return { type: urlMatch[1].toLowerCase() as any, mbid: urlMatch[2].toLowerCase() };
	}

	// Check for explicit prefix e.g. reid:, rgid:, arid:, mbid:, release:
	const prefixMatch = trimmed.match(
		/^(?:reid|mbid|release):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
	);
	if (prefixMatch) {
		return { type: 'release', mbid: prefixMatch[1].toLowerCase() };
	}

	const rgPrefixMatch = trimmed.match(
		/^rgid:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
	);
	if (rgPrefixMatch) {
		return { type: 'release-group', mbid: rgPrefixMatch[1].toLowerCase() };
	}

	const artistPrefixMatch = trimmed.match(
		/^arid:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
	);
	if (artistPrefixMatch) {
		return { type: 'artist', mbid: artistPrefixMatch[1].toLowerCase() };
	}

	// Standalone UUID format: 31d3ab1e-49dc-434b-bf0b-b43dc0f1d626
	const rawUuidMatch = trimmed.match(
		/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
	);
	if (rawUuidMatch) {
		return { type: 'release', mbid: rawUuidMatch[1].toLowerCase() };
	}

	return null;
}

/**
 * Normalizes title/artist text for fuzzy track and album comparisons
 */
export function normalizeString(str: string | null | undefined): string {
	if (!str) return '';
	return String(str)
		.toLowerCase()
		.replace(/[‘’]/g, "'")
		.replace(/[“”]/g, '"')
		.replace(/[–—]/g, '-')
		.replace(/^\d{1,3}[\s.\-_]+/, '') // strip leading track numbers like "01 - " or "1. "
		.replace(/\s*[\(\[\{]?(?:feat\.?|ft\.?|featuring|with)\s+[^)\]\}]+[\)\]\}]?/gi, '') // strip featured artists
		.replace(/\s*[\(\[\{]?(?:explicit|clean|remaster(?:ed)?|bonus track|deluxe(?: edition)?|anniversary edition)[\)\]\}]?/gi, '') // strip tags
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Calculates standard Levenshtein edit distance between two strings
 */
export function levenshteinDistance(a: string, b: string): number {
	if (a === b) return 0;
	if (!a.length) return b.length;
	if (!b.length) return a.length;
	const v0 = new Array(b.length + 1);
	const v1 = new Array(b.length + 1);
	for (let i = 0; i <= b.length; i++) v0[i] = i;
	for (let i = 0; i < a.length; i++) {
		v1[0] = i + 1;
		for (let j = 0; j < b.length; j++) {
			const cost = a[i] === b[j] ? 0 : 1;
			v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
		}
		for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
	}
	return v0[b.length];
}

/**
 * Word token similarity (Dice coefficient over unique word tokens)
 */
export function tokenSimilarity(a: string, b: string): number {
	const setA = new Set(a.split(' ').filter(Boolean));
	const setB = new Set(b.split(' ').filter(Boolean));
	if (setA.size === 0 && setB.size === 0) return 1;
	if (setA.size === 0 || setB.size === 0) return 0;
	let intersection = 0;
	for (const item of setA) {
		if (setB.has(item)) intersection++;
	}
	return (2 * intersection) / (setA.size + setB.size);
}

/**
 * Returns string similarity ratio between 0.0 and 1.0
 */
export function computeStringSimilarity(strA: string, strB: string): number {
	const normA = normalizeString(strA);
	const normB = normalizeString(strB);
	if (normA === normB) return 1.0;
	if (!normA || !normB) return 0.0;
	const maxLen = Math.max(normA.length, normB.length);
	const levRatio = 1 - levenshteinDistance(normA, normB) / maxLen;
	const tokRatio = tokenSimilarity(normA, normB);
	return Math.max(0, Math.max(levRatio, tokRatio));
}


