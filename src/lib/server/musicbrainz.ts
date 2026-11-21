import dns from 'node:dns';
import net from 'node:net';
import type {
	MusicBrainzReleaseItem,
	MusicBrainzReleaseDetail,
	MusicBrainzReleaseTrack
} from '$lib/types/index.js';
import { extractMusicBrainzId, isGenericArtist, normalizeArtistName } from '$lib/utils.js';
import { APP_VERSION } from '$lib/version.js';

try {
	if (typeof (net as any).setDefaultAutoSelectFamily === 'function') {
		(net as any).setDefaultAutoSelectFamily(false);
	}
	dns.setDefaultResultOrder('ipv4first');
} catch {}

const USER_AGENT = `TraxVault/${APP_VERSION} ( mailto:daniel.krejci44@gmail.com )`;
let lastRequestEndTime = 0;
let requestQueue: Promise<any> = Promise.resolve();

/**
 * Throttle requests to respect MusicBrainz rate limit (1 request/sec) with serialized queue and 503 retry.
 * Protected with an AbortController timeout (8s) so stalled connections never deadlock the queue.
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

				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), 8000);
				let res: Response;
				try {
					res = await fetch(url, {
						signal: controller.signal,
						headers: {
							'User-Agent': USER_AGENT,
							Accept: 'application/json'
						}
					});
				} finally {
					clearTimeout(timeoutId);
				}

				if (res.status === 503 && retries > 0) {
					console.warn(`MusicBrainz 503 rate limit hit, backing off 1.5s (retries left: ${retries})...`);
					await new Promise((r) => setTimeout(r, 1500));
					const retryCtrl = new AbortController();
					const retryTimeout = setTimeout(() => retryCtrl.abort(), 8000);
					try {
						res = await fetch(url, {
							signal: retryCtrl.signal,
							headers: {
								'User-Agent': USER_AGENT,
								Accept: 'application/json'
							}
						});
					} finally {
						clearTimeout(retryTimeout);
					}
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
	return String(str || '').replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1');
}

/**
 * Helper to format MusicBrainz artist-credit array into a complete string with join phrases (e.g. 'Ez Mil & Eminem')
 */
function formatArtistCredit(credit: any): string {
	if (!credit || !Array.isArray(credit)) return 'Unknown Artist';
	const formatted = credit
		.map((a: any) => (typeof a === 'string' ? a : (a.name || '') + (a.joinphrase || '')))
		.join('')
		.trim();
	return formatted || 'Unknown Artist';
}

/**
 * Search MusicBrainz for releases matching a query and optional artist
 */
export async function searchMusicBrainz(query: string, artist?: string): Promise<MusicBrainzReleaseItem[]> {
	if ((!query || !query.trim()) && (!artist || !artist.trim())) return [];

	let luceneQuery = '';
	const cleanQuery = query?.trim() || '';
	const rawArtist = artist?.trim() || '';
	const cleanArtist = !/^(unknown(\s+artist)?|various(\s+artists)?)$/i.test(rawArtist) ? rawArtist : '';

	// 1. Direct MBID or MusicBrainz URL lookup
	const extractedId = extractMusicBrainzId(cleanQuery);
	if (extractedId) {
		if (extractedId.type === 'release') {
			try {
				const directRelease = await getMusicBrainzRelease(extractedId.mbid);
				if (directRelease) {
					return [
						{
							id: directRelease.id,
							title: directRelease.title,
							artist: directRelease.artist,
							year: directRelease.release_year,
							track_count: directRelease.tracks.length,
							media_format: directRelease.media_type || 'Digital',
							cover_url: directRelease.cover_url || null,
							barcode: directRelease.barcode || null
						}
					];
				}
			} catch (err) {
				console.warn(`Direct MBID lookup failed for ${extractedId.mbid}:`, err);
			}
			luceneQuery = `reid:${extractedId.mbid}`;
		} else if (extractedId.type === 'release-group') {
			luceneQuery = `rgid:${extractedId.mbid}`;
		} else if (extractedId.type === 'artist') {
			luceneQuery = `arid:${extractedId.mbid}`;
		}
	} else if (cleanQuery && cleanArtist) {
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
			const artist = formatArtistCredit(rel['artist-credit']);

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

	const url = `https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings+artists+media+labels+release-groups&fmt=json`;

	try {
		const res = await rateLimitedFetch(url);
		if (!res.ok) {
			console.error(`MusicBrainz release fetch error: ${res.status} ${res.statusText}`);
			return null;
		}

		const rel = await res.json();
		const artist = formatArtistCredit(rel['artist-credit']);

		const year = rel.date ? parseInt(rel.date.substring(0, 4), 10) : null;
		const mediaType = rel.media?.[0]?.format || 'Digital';

		const tracks: MusicBrainzReleaseTrack[] = [];

		if (rel.media && Array.isArray(rel.media)) {
			let discIdx = 1;
			for (const media of rel.media) {
				const discNumber = media.position || discIdx++;
				if (media.tracks && Array.isArray(media.tracks)) {
					for (const tr of media.tracks) {
						const trArtist = tr['artist-credit'] ? formatArtistCredit(tr['artist-credit']) : artist;

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

		// Check if cover art exists from Cover Art Archive (release front, or release-group fallback)
		const rgId = rel['release-group']?.id;
		const hasCover = rel['cover-art-archive']?.front || rel['cover-art-archive']?.artwork;
		const hasRgCover = rel['release-group']?.['cover-art-archive']?.front || rel['release-group']?.['cover-art-archive']?.artwork;

		let coverUrl: string | null = null;
		if (hasCover) {
			coverUrl = `https://coverartarchive.org/release/${rel.id}/front-500`;
		} else if (hasRgCover && rgId) {
			coverUrl = `https://coverartarchive.org/release-group/${rgId}/front-500`;
		} else {
			// Even if boolean flags are absent in initial payload, single releases or newly added releases
			// often have artwork at either the release or release-group front endpoint
			coverUrl = `https://coverartarchive.org/release/${rel.id}/front-500`;
		}

		return {
			id: rel.id,
			title: rel.title,
			artist,
			release_year: isNaN(year!) ? null : year,
			cover_url: coverUrl,
			media_type: mediaType,
			barcode: rel.barcode || null,
			release_group_id: rgId || null,
			tracks
		};
	} catch (err) {
		console.error(`Failed to get MusicBrainz release ${releaseId}:`, err);
		return null;
	}
}

export interface MusicBrainzArtistSearchItem {
	id: string;
	name: string;
	type?: string;
	country?: string;
	disambiguation?: string;
	score?: number;
}

export interface MusicBrainzArtistDetail {
	id: string;
	name: string;
	type?: string;
	country?: string;
	disambiguation?: string;
	imageUrl?: string;
	wikidataId?: string;
	wikipediaUrl?: string;
	lastfmUrl?: string;
	deezerId?: string;
	artistRelations: Array<{ type: string; name: string; mbid?: string }>;
	tags: string[];
}

export async function searchMusicBrainzArtistList(query: string, limit: number = 8): Promise<MusicBrainzArtistSearchItem[]> {
	const trimmed = (query || '').trim();
	if (!trimmed || isGenericArtist(trimmed)) return [];
	try {
		const url = `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(trimmed)}&limit=${limit}&fmt=json`;
		const res = await rateLimitedFetch(url);
		if (!res.ok) return [];
		const data = await res.json();
		const artists = data.artists || [];
		return artists.slice(0, limit).map((a: any) => ({
			id: a.id,
			name: a.name,
			type: a.type,
			country: a.country,
			disambiguation: a.disambiguation,
			score: a.score ? parseInt(a.score, 10) : undefined
		}));
	} catch (err) {
		console.warn(`[MusicBrainz] Error searching artist list for "${query}":`, err);
		return [];
	}
}

export async function searchMusicBrainzArtist(name: string): Promise<MusicBrainzArtistSearchItem | null> {
	if (isGenericArtist(name)) {
		return null;
	}

	try {
		const url = `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(name)}&fmt=json`;
		const res = await rateLimitedFetch(url);
		if (!res.ok) return null;
		const data = await res.json();
		const artists = data.artists || [];
		if (artists.length === 0) return null;

		const nameLower = name.trim().toLowerCase();
		const nameNorm = normalizeArtistName(name);

		// Match exact case-insensitive first
		const exact = artists.find((a: any) => (a.name || '').trim().toLowerCase() === nameLower);

		// Match normalized (accents / punctuation stripped)
		const normalized = exact || artists.find((a: any) => normalizeArtistName(a.name || '') === nameNorm);

		// Only accept a candidate if exact/normalized, or score is >= 95 with identical normalized prefix
		const chosen = normalized || artists.find((a: any) => {
			const score = a.score ? parseInt(a.score, 10) : 0;
			if (score < 95) return false;
			const aNorm = normalizeArtistName(a.name || '');
			return aNorm === nameNorm || aNorm.startsWith(nameNorm) || nameNorm.startsWith(aNorm);
		});

		if (!chosen) {
			return null;
		}

		return {
			id: chosen.id,
			name: chosen.name,
			type: chosen.type,
			country: chosen.country,
			disambiguation: chosen.disambiguation,
			score: chosen.score ? parseInt(chosen.score, 10) : undefined
		};
	} catch (err) {
		console.warn(`[MusicBrainz] Error searching artist "${name}":`, err);
		return null;
	}
}

export async function getMusicBrainzArtistDetail(mbid: string): Promise<MusicBrainzArtistDetail | null> {
	try {
		const url = `https://musicbrainz.org/ws/2/artist/${mbid}?inc=url-rels+artist-rels+genres+tags&fmt=json`;
		const res = await rateLimitedFetch(url);
		if (!res.ok) return null;
		const data = await res.json();

		let imageUrl: string | undefined;
		let wikidataId: string | undefined;
		let wikipediaUrl: string | undefined;
		let lastfmUrl: string | undefined;
		let deezerId: string | undefined;
		const artistRelations: Array<{ type: string; name: string; mbid?: string }> = [];

		if (Array.isArray(data.relations)) {
			for (const rel of data.relations) {
				const relType = (rel.type || '').toLowerCase();
				const targetType = (rel['target-type'] || '').toLowerCase();
				const resource = rel.url?.resource;

				if (targetType === 'url' && resource) {
					const dzMatch = String(resource).match(/deezer\.com\/(?:[a-z]{2}\/)?artist\/(\d+)/i);
					if (dzMatch) {
						deezerId = dzMatch[1];
					}
					if (relType === 'image') {
						imageUrl = resource;
					} else if (relType === 'wikidata') {
						const match = resource.match(/Q\d+/);
						if (match) wikidataId = match[0];
					} else if (relType === 'wikipedia') {
						wikipediaUrl = resource;
					} else if (relType === 'last.fm') {
						lastfmUrl = resource;
					}
				} else if (targetType === 'artist' && rel.artist) {
					artistRelations.push({
						type: rel.type || 'related',
						name: rel.artist.name,
						mbid: rel.artist.id
					});
				}
			}
		}

		const tags: string[] = [];
		if (Array.isArray(data.tags)) {
			tags.push(...data.tags.map((t: any) => t.name).filter(Boolean));
		}
		if (Array.isArray(data.genres)) {
			tags.push(...data.genres.map((g: any) => g.name).filter(Boolean));
		}

		return {
			id: data.id,
			name: data.name,
			type: data.type,
			country: data.country,
			disambiguation: data.disambiguation,
			imageUrl,
			wikidataId,
			wikipediaUrl,
			lastfmUrl,
			deezerId,
			artistRelations,
			tags: Array.from(new Set(tags))
		};
	} catch (err) {
		console.warn(`[MusicBrainz] Error fetching artist detail for ${mbid}:`, err);
		return null;
	}
}

/**
 * Resolves Wikimedia high-resolution image and Wikipedia clean biography
 */
export async function resolveWikimediaAndWikipedia(
	artistName: string,
	wikidataId?: string,
	wikipediaUrl?: string,
	directImageUrl?: string
): Promise<{ biography?: string; imageUrl?: string }> {
	if (isGenericArtist(artistName)) {
		return {};
	}

	let resolvedImageUrl: string | undefined;
	let wikiTitle: string | undefined;

	// 1. If direct Wikimedia Commons file URL is present in MusicBrainz
	if (directImageUrl && directImageUrl.includes('commons.wikimedia.org/wiki/File:')) {
		const filename = directImageUrl.split('File:').pop();
		if (filename) {
			resolvedImageUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(decodeURIComponent(filename))}?width=1200`;
		}
	}

	// 2. If Wikidata ID is known, resolve sitelinks (Wikipedia title) and claims (P18 official image)
	if (wikidataId) {
		try {
			const wdUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidataId}&props=sitelinks|claims&sitefilter=enwiki&format=json`;
			const wdCtrl = new AbortController();
			const wdTimer = setTimeout(() => wdCtrl.abort(), 6000);
			try {
				const wdRes = await fetch(wdUrl, {
					signal: wdCtrl.signal,
					headers: { 'User-Agent': USER_AGENT }
				});
				if (wdRes.ok) {
					const wdData = await wdRes.json();
					const entity = wdData.entities?.[wikidataId];

					// Check Wikipedia title
					if (entity?.sitelinks?.enwiki?.title) {
						wikiTitle = entity.sitelinks.enwiki.title;
					}

					// Check image claim (P18) if not already resolved
					if (!resolvedImageUrl && entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value) {
						const p18File = entity.claims.P18[0].mainsnak.datavalue.value;
						resolvedImageUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(p18File)}?width=1200`;
					}
				}
			} finally {
				clearTimeout(wdTimer);
			}
		} catch (err) {
			console.warn(`[Wikidata] Error resolving ${wikidataId}:`, err);
		}
	}

	// 3. Fallback Wikipedia title from URL if not obtained from Wikidata
	if (!wikiTitle && wikipediaUrl) {
		const parts = wikipediaUrl.split('/wiki/');
		if (parts.length > 1) {
			wikiTitle = decodeURIComponent(parts[1].replace(/#.*$/, ''));
		}
	}

	// Default fallback to artist name
	if (!wikiTitle) {
		wikiTitle = artistName;
	}

	let biography: string | undefined;

	// 4. Fetch Wikipedia clean summary extract
	try {
		const wpUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`;
		const wpCtrl = new AbortController();
		const wpTimer = setTimeout(() => wpCtrl.abort(), 6000);
		try {
			const wpRes = await fetch(wpUrl, {
				signal: wpCtrl.signal,
				headers: { 'User-Agent': USER_AGENT }
			});
			if (wpRes.ok) {
				const wpData = await wpRes.json();
				if (wpData.extract) {
					biography = wpData.extract;
				}
				if (!resolvedImageUrl && wpData.thumbnail?.source) {
					resolvedImageUrl = wpData.thumbnail.source;
				}
			}
		} finally {
			clearTimeout(wpTimer);
		}
	} catch (err) {
		console.warn(`[Wikipedia] Error fetching biography for "${wikiTitle}":`, err);
	}

	return {
		biography,
		imageUrl: resolvedImageUrl
	};
}
