import type { LayoutServerLoad } from './$types.js';
import { getStats } from '$lib/server/db.js';

export const load: LayoutServerLoad = async ({ locals }) => {
	const stats = getStats();
	return {
		stats,
		user: locals.user || null,
		authDisabled: locals.authDisabled || false
	};
};
