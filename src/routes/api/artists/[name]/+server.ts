import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
	getOrFetchArtistInfo,
	fetchAndApplyArtistByExternalId,
	updateManualArtistMetadata
} from '$lib/server/subsonic/artist.js';
import { getArtistMetadata } from '$lib/server/db.js';

export const GET: RequestHandler = async ({ params }) => {
	const name = (params.name || '').trim();
	if (!name) {
		return json({ error: 'Artist name required' }, { status: 400 });
	}

	try {
		const info = await getOrFetchArtistInfo(name);
		const metadata = getArtistMetadata(name);
		return json({ success: true, artist: info, metadata });
	} catch (err: any) {
		return json({ error: err.message || 'Failed to get artist metadata' }, { status: 500 });
	}
};

/**
 * POST /api/artists/[name]
 * Fetches and applies artist portrait & metadata by pasting an external ID or URL
 * (MusicBrainz MBID/URL, Deezer Artist ID/URL, TheAudioDB ID/URL, or direct Image URL).
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const name = (params.name || '').trim();
	if (!name) {
		return json({ error: 'Artist name required' }, { status: 400 });
	}

	try {
		const body = await request.json().catch(() => ({}));
		const externalIdOrUrl = String(body.externalIdOrUrl || body.id || body.url || '').trim();
		const saveToFolder = Boolean(body.saveToFolder);

		if (!externalIdOrUrl) {
			return json({ error: 'Please provide an external artist ID or URL' }, { status: 400 });
		}

		const result = await fetchAndApplyArtistByExternalId(name, externalIdOrUrl, { saveToFolder });
		if (!result.success) {
			return json({ error: result.error || 'Failed to apply external artist ID' }, { status: 400 });
		}

		return json(result);
	} catch (err: any) {
		console.error('[API] Failed to apply external artist ID:', err);
		return json({ error: err.message || 'Failed to apply external artist ID' }, { status: 500 });
	}
};

/**
 * PUT /api/artists/[name]
 * Manually updates artist metadata (biography, disambiguation, MBID, Last.fm URL, custom image URL).
 */
export const PUT: RequestHandler = async ({ params, request }) => {
	const name = (params.name || '').trim();
	if (!name) {
		return json({ error: 'Artist name required' }, { status: 400 });
	}

	try {
		const body = await request.json().catch(() => ({}));
		const result = await updateManualArtistMetadata(name, {
			biography: body.biography,
			disambiguation: body.disambiguation,
			musicbrainz_id: body.musicbrainz_id,
			lastfm_url: body.lastfm_url,
			image_url: body.image_url,
			saveToFolder: Boolean(body.saveToFolder)
		});

		if (!result.success) {
			return json({ error: result.error || 'Failed to save manual artist metadata' }, { status: 400 });
		}

		return json(result);
	} catch (err: any) {
		console.error('[API] Failed to save manual artist metadata:', err);
		return json({ error: err.message || 'Failed to save manual artist metadata' }, { status: 500 });
	}
};
