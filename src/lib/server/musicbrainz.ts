import type {
	MusicBrainzReleaseItem,
	MusicBrainzReleaseDetail,
	MusicBrainzReleaseTrack
} from '$lib/types/index.js';

const USER_AGENT = 'TrackVault/1.0.0 ( mailto:daniel.krejci44@gmail.com )';
let lastRequestEndTime = 0;
let requestQueue: Promise<any> = Promise.resolve();

/**
 * Throttle requests to respect MusicBrainz rate limit (1 request/sec) with serialized queue and 503 retry
 */
async function rateLimitedFetch(url: string, retries = 2): Promise<Response> {
	return new Promise((resolve, reject) => {
		requestQueue = requestQueue.then(async () => {
			try {
				const now = Date.now();
				const elapsed = now - lastRequestEndTime;
				if (elapsed < 1200) {
					await new Promise((r) => setTimeout(r, 1200 - elapsed));
				}

				let res = await fetch(url, {
					headers: {
						'User-Agent': USER_AGENT,
						Accept: 'application/json'
					}
				});

				if (res.status === 503 && retries > 0) {
					console.warn(`MusicBrainz 503 rate limit hit, backing off 1.5s (retries left: ${retries})...`);
					await new Promise((r) => setTimeout(r, 1500));
					res = await fetch(url, {
						headers: {
							'User-Agent': USER_AGENT,
							Accept: 'application/json'
						}
					});
				}

				lastRequestEndTime = Date.now();
				resolve(res);
			} catch (err) {
				lastRequestEndTime = Date.now();
				reject(err);
			}
		});
	});
}

/**
/**
 * Helper to escape characters for MusicBrainz Lucene query syntax
 */
function escapeLucene(str: string): string {
	// Escape Lucene special characters: + - && || ! ( ) { } [ ] ^ " ~ * ? : \ /
	return str.replace(/([+\-!(){}[\]^"~*?:\\])/g, '\\$1');
}

/**
 * Search MusicBrainz for releases matching a query and optional artist
 */
export async function searchMusicBrainz(query: string, artist?: string): Promise<MusicBrainzReleaseItem[]> {
	if ((!query || !query.trim()) && (!artist || !artist.trim())) return [];

	let luceneQuery = '';
	const cleanQuery = query?.trim() || '';
	const cleanArtist = artist?.trim() || '';

	if (cleanQuery && cleanArtist) {
		// Both album title and artist specified
		luceneQuery = `release:"${escapeLucene(cleanQuery)}" AND (artist:"${escapeLucene(cleanArtist)}" OR artistname:"${escapeLucene(cleanArtist)}")`;
	} else if (cleanArtist && !cleanQuery) {
		// Only artist specified
		luceneQuery = `artist:"${escapeLucene(cleanArtist)}" OR artistname:"${escapeLucene(cleanArtist)}"`;
	} else {
		// Single query string specified
		// Check if user already typed Lucene field syntax (e.g. release: or artist:)
		if (cleanQuery.includes(':') || cleanQuery.includes(' AND ') || cleanQuery.includes(' OR ')) {
			luceneQuery = cleanQuery;
		} else if (cleanQuery.includes(' - ')) {
			// e.g. "Kamikaze - Eminem" or "Eminem - Kamikaze"
			const parts = cleanQuery.split(' - ').map((s) => s.trim()).filter(Boolean);
			if (parts.length >= 2) {
				luceneQuery = `(release:"${escapeLucene(parts[0])}" AND artist:"${escapeLucene(parts[1])}") OR (release:"${escapeLucene(parts[1])}" AND artist:"${escapeLucene(parts[0])}")`;
			} else {
				luceneQuery = cleanQuery;
			}
		} else if (/\s+by\s+/i.test(cleanQuery)) {
			// e.g. "Kamikaze by Eminem"
			const parts = cleanQuery.split(/\s+by\s+/i).map((s) => s.trim()).filter(Boolean);
			if (parts.length >= 2) {
				luceneQuery = `release:"${escapeLucene(parts[0])}" AND (artist:"${escapeLucene(parts[1])}" OR artistname:"${escapeLucene(parts[1])}")`;
			} else {
				luceneQuery = cleanQuery;
			}
		} else {
			// Free text: e.g. "Kamikaze Eminem"
			const words = cleanQuery.split(/\s+/).filter(Boolean);
			if (words.length >= 2) {
				const firstPart = words.slice(0, -1).join(' ');
				const lastWord = words[words.length - 1];
				const firstWord = words[0];
				const restWords = words.slice(1).join(' ');
				luceneQuery = `release:"${escapeLucene(cleanQuery)}" OR (release:"${escapeLucene(firstPart)}" AND artist:"${escapeLucene(lastWord)}") OR (release:"${escapeLucene(restWords)}" AND artist:"${escapeLucene(firstWord)}") OR (${cleanQuery})`;
			} else {
				luceneQuery = `release:"${escapeLucene(cleanQuery)}" OR artist:"${escapeLucene(cleanQuery)}" OR (${cleanQuery})`;
			}
		}
	}

	const encoded = encodeURIComponent(luceneQuery);
	const url = `https://musicbrainz.org/ws/2/release/?query=${encoded}&fmt=json&limit=30`;

	try {
		const res = await rateLimitedFetch(url);
		if (!res.ok) {
			console.error(`MusicBrainz search error: ${res.status} ${res.statusText}`);
			return [];
		}

		const data = await res.json();
		if (!data.releases || !Array.isArray(data.releases)) {
			return [];
		}

		return data.releases.map((rel: any): MusicBrainzReleaseItem => {
			const artist = rel['artist-credit']
				? rel['artist-credit'].map((a: any) => (typeof a === 'string' ? a : a.name)).join('')
				: 'Unknown Artist';

			const year = rel.date ? parseInt(rel.date.substring(0, 4), 10) : null;
			const mediaFormat = rel.media?.[0]?.format || 'Digital';
			const trackCount = rel['track-count'] || rel.media?.reduce((acc: number, m: any) => acc + (m['track-count'] || 0), 0) || 0;

			// If front cover is flagged in cover-art-archive, direct link works
			const hasCover = rel['cover-art-archive']?.front || rel['cover-art-archive']?.artwork;
			const coverUrl = hasCover ? `https://coverartarchive.org/release/${rel.id}/front-250` : null;

			return {
				id: rel.id,
				title: rel.title,
				artist,
				date: rel.date,
				year: isNaN(year!) ? null : year,
				country: rel.country,
				track_count: trackCount,
				media_format: mediaFormat,
				cover_url: coverUrl,
				barcode: rel.barcode || null,
				disambiguation: rel.disambiguation
			};
		});
	} catch (err) {
		console.error('Failed to search MusicBrainz:', err);
		return [];
	}
}

/**
 * Fetch full release tracklist and details from MusicBrainz
 */
export async function getMusicBrainzRelease(releaseId: string): Promise<MusicBrainzReleaseDetail | null> {
	if (!releaseId) return null;

	const url = `https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings+artists+media+labels&fmt=json`;

	try {
		const res = await rateLimitedFetch(url);
		if (!res.ok) {
			console.error(`MusicBrainz release fetch error: ${res.status} ${res.statusText}`);
			return null;
		}

		const rel = await res.json();
		const artist = rel['artist-credit']
			? rel['artist-credit'].map((a: any) => (typeof a === 'string' ? a : a.name)).join('')
			: 'Unknown Artist';

		const year = rel.date ? parseInt(rel.date.substring(0, 4), 10) : null;
		const mediaType = rel.media?.[0]?.format || 'Digital';

		const tracks: MusicBrainzReleaseTrack[] = [];

		if (rel.media && Array.isArray(rel.media)) {
			let discIdx = 1;
			for (const media of rel.media) {
				const discNumber = media.position || discIdx++;
				if (media.tracks && Array.isArray(media.tracks)) {
					for (const tr of media.tracks) {
						const trArtist = tr['artist-credit']
							? tr['artist-credit'].map((a: any) => (typeof a === 'string' ? a : a.name)).join('')
							: artist;

						const trackNum = parseInt(tr.number || `${tr.position}`, 10) || tr.position || tracks.length + 1;

						tracks.push({
							id: tr.id || `${discNumber}-${trackNum}`,
							disc_number: discNumber,
							track_number: trackNum,
							title: tr.title || tr.recording?.title || `Track ${trackNum}`,
							artist: trArtist !== artist ? trArtist : artist,
							duration_ms: tr.length || tr.recording?.length || null
						});
					}
				}
			}
		}

		// Check if cover art exists from Cover Art Archive
		const hasCover = rel['cover-art-archive']?.front || rel['cover-art-archive']?.artwork;
		const coverUrl = hasCover ? `https://coverartarchive.org/release/${rel.id}/front-500` : null;

		return {
			id: rel.id,
			title: rel.title,
			artist,
			release_year: isNaN(year!) ? null : year,
			cover_url: coverUrl,
			media_type: mediaType,
			barcode: rel.barcode || null,
			tracks
		};
	} catch (err) {
		console.error(`Failed to get MusicBrainz release ${releaseId}:`, err);
		return null;
	}
}
