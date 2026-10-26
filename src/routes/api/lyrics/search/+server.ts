import { json } from '@sveltejs/kit';
import { APP_VERSION } from '$lib/version.js';
import type { RequestHandler } from './$types.js';
import type { LrcLibCandidate } from '$lib/types/index.js';

const USER_AGENT = `TraxVault/${APP_VERSION} (https://github.com/Kapybara48/trax-vault)`;

export const GET: RequestHandler = async ({ url, fetch }) => {
	const rawQuery = url.searchParams.get('q') || '';
	const trackName = url.searchParams.get('track') || url.searchParams.get('track_name') || '';
	const artistName = url.searchParams.get('artist') || url.searchParams.get('artist_name') || '';
	const albumName = url.searchParams.get('album') || url.searchParams.get('album_name') || '';
	const duration = url.searchParams.get('duration');

	const effectiveQuery = rawQuery.trim() || [artistName, trackName].filter(Boolean).join(' ').trim();

	if (!effectiveQuery && !trackName.trim()) {
		return json({ error: 'Search query or track name is required' }, { status: 400 });
	}

	try {
		const candidates: LrcLibCandidate[] = [];
		const seenIds = new Set<number>();

		// 1. Try exact get endpoint if specific track details are provided
		if (trackName.trim()) {
			const getParams = new URLSearchParams();
			getParams.set('track_name', trackName.trim());
			if (artistName.trim()) getParams.set('artist_name', artistName.trim());
			if (albumName.trim()) getParams.set('album_name', albumName.trim());
			if (duration && !isNaN(parseFloat(duration))) {
				getParams.set('duration', Math.round(parseFloat(duration)).toString());
			}

			try {
				const getRes = await fetch(`https://lrclib.net/api/get?${getParams.toString()}`, {
					headers: { 'User-Agent': USER_AGENT }
				});

				if (getRes.ok) {
					const exactData = await getRes.json();
					if (exactData && exactData.id) {
						seenIds.add(exactData.id);
						candidates.push({
							id: exactData.id,
							name: exactData.name || `${exactData.artistName || artistName} - ${exactData.trackName || trackName}`,
							trackName: exactData.trackName || trackName,
							artistName: exactData.artistName || artistName,
							albumName: exactData.albumName || albumName || null,
							duration: exactData.duration || 0,
							instrumental: !!exactData.instrumental,
							hasSynced: !!exactData.syncedLyrics,
							hasPlain: !!exactData.plainLyrics,
							syncedLyrics: exactData.syncedLyrics || null,
							plainLyrics: exactData.plainLyrics || null,
							isExactMatch: true
						});
					}
				}
			} catch (exactErr) {
				console.warn('LRCLIB exact match query failed:', exactErr);
			}
		}

		// 2. Query search endpoint
		const searchUrl = rawQuery.trim()
			? `https://lrclib.net/api/search?q=${encodeURIComponent(rawQuery.trim())}`
			: `https://lrclib.net/api/search?q=${encodeURIComponent(effectiveQuery)}`;

		const searchRes = await fetch(searchUrl, {
			headers: { 'User-Agent': USER_AGENT }
		});

		if (searchRes.ok) {
			const searchResults = await searchRes.json();
			if (Array.isArray(searchResults)) {
				for (const item of searchResults) {
					if (item && item.id && !seenIds.has(item.id)) {
						seenIds.add(item.id);
						candidates.push({
							id: item.id,
							name: item.name || `${item.artistName} - ${item.trackName}`,
							trackName: item.trackName || '',
							artistName: item.artistName || '',
							albumName: item.albumName || null,
							duration: item.duration || 0,
							instrumental: !!item.instrumental,
							hasSynced: !!item.syncedLyrics,
							hasPlain: !!item.plainLyrics,
							syncedLyrics: item.syncedLyrics || null,
							plainLyrics: item.plainLyrics || null,
							isExactMatch: false
						});
					}
				}
			}
		}

		if (candidates.length === 0) {
			return json({
				success: false,
				notFound: true,
				count: 0,
				results: [],
				message: 'No lyrics found on LRCLIB'
			});
		}

		const best = candidates[0];
		return json({
			success: true,
			count: candidates.length,
			results: candidates,
			// Backwards compatibility for existing single-result consumers
			plainLyrics: best.plainLyrics || null,
			syncedLyrics: best.syncedLyrics || null,
			instrumental: !!best.instrumental,
			trackName: best.trackName || trackName,
			artistName: best.artistName || artistName,
			albumName: best.albumName || albumName,
			duration: best.duration
		});
	} catch (err: any) {
		console.error('LRCLIB fetch error:', err);
		return json({ success: false, error: err.message || 'Failed to query LRCLIB' }, { status: 502 });
	}
};
