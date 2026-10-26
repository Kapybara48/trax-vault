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

