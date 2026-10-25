import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

const USER_AGENT = 'TraxVault/1.0 (https://github.com/Kapybara48/trax-vault)';

export const GET: RequestHandler = async ({ url, fetch }) => {
	const trackName = url.searchParams.get('track') || url.searchParams.get('track_name') || '';
	const artistName = url.searchParams.get('artist') || url.searchParams.get('artist_name') || '';
	const albumName = url.searchParams.get('album') || url.searchParams.get('album_name') || '';
	const duration = url.searchParams.get('duration');

	if (!trackName.trim()) {
		return json({ error: 'Track name is required' }, { status: 400 });
	}

	try {
		// 1. Try exact get endpoint
		const getParams = new URLSearchParams();
		getParams.set('track_name', trackName.trim());
		if (artistName.trim()) getParams.set('artist_name', artistName.trim());
		if (albumName.trim()) getParams.set('album_name', albumName.trim());
		if (duration && !isNaN(parseFloat(duration))) {
			getParams.set('duration', Math.round(parseFloat(duration)).toString());
		}

		const getRes = await fetch(`https://lrclib.net/api/get?${getParams.toString()}`, {
			headers: { 'User-Agent': USER_AGENT }
		});

		if (getRes.ok) {
			const data = await getRes.json();
			return json({
				success: true,
				plainLyrics: data.plainLyrics || null,
				syncedLyrics: data.syncedLyrics || null,
				instrumental: !!data.instrumental,
				trackName: data.trackName || trackName,
				artistName: data.artistName || artistName,
				albumName: data.albumName || albumName,
				duration: data.duration
			});
		}

		// 2. Fallback to search query
		const query = [artistName, trackName].filter(Boolean).join(' ').trim();
		const searchRes = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, {
			headers: { 'User-Agent': USER_AGENT }
		});

		if (searchRes.ok) {
			const results = await searchRes.json();
			if (Array.isArray(results) && results.length > 0) {
				const best = results[0];
				return json({
					success: true,
					plainLyrics: best.plainLyrics || null,
					syncedLyrics: best.syncedLyrics || null,
					instrumental: !!best.instrumental,
					trackName: best.trackName || trackName,
					artistName: best.artistName || artistName,
					albumName: best.albumName || albumName,
					duration: best.duration
				});
			}
		}

		return json({ success: false, notFound: true, message: 'No lyrics found on LRCLIB' });
	} catch (err: any) {
		console.error('LRCLIB fetch error:', err);
		return json({ success: false, error: err.message || 'Failed to query LRCLIB' }, { status: 502 });
	}
};
