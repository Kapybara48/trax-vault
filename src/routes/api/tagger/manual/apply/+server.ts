import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { applyManualTags, type ApplyManualTagsOptions } from '$lib/server/tagger.js';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const payload = (await request.json()) as ApplyManualTagsOptions;

		if (!payload.albumMetadata?.title?.trim()) {
			return json({ error: 'Album title is required' }, { status: 400 });
		}
		if (!payload.albumMetadata?.artist?.trim()) {
			return json({ error: 'Artist name is required' }, { status: 400 });
		}
		if (!Array.isArray(payload.tracks) || payload.tracks.length === 0) {
			return json({ error: 'At least one track is required' }, { status: 400 });
		}

		const result = await applyManualTags(payload);

		if (!result.success && result.hasPermissionErrors) {
			return json(
				{
					error: result.error || 'Permission Denied: Unable to write tags to audio files.',
					hasPermissionErrors: true,
					fileErrors: result.fileErrors
				},
				{ status: 403 }
			);
		}

		return json(result);
	} catch (err: any) {
		console.error('Manual tagger apply error:', err);
		return json({ error: err.message || 'Internal server error applying manual tags' }, { status: 500 });
	}
};
