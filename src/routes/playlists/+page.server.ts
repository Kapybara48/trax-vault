import type { PageServerLoad } from './$types.js';
import { getUserPlaylists } from '$lib/server/db.js';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user?.id || 1;
	const playlists = getUserPlaylists(userId);

	return {
		playlists
	};
};
