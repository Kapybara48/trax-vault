import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
	startBulkArtistEnrichment,
	getEnrichmentStatus,
	cancelBulkArtistEnrichment
} from '$lib/server/subsonic/artist.js';

export const GET: RequestHandler = async () => {
	const status = getEnrichmentStatus();
	return json(status);
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json().catch(() => ({}));
		const forceRefresh = Boolean(body.forceRefresh);

		const result = startBulkArtistEnrichment({ forceRefresh });
		return json(result);
	} catch (err: any) {
		console.error('[API] Failed to start bulk enrichment:', err);
		return json({ error: err.message || 'Failed to start bulk enrichment' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async () => {
	cancelBulkArtistEnrichment();
	return json({ success: true, message: 'Enrichment cancelled' });
};
