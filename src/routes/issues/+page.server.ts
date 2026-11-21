import type { PageServerLoad } from './$types.js';
import { getIssuesTracks, getStats, getGlobalFixerRules } from '$lib/server/db.js';

export const load: PageServerLoad = async ({ url }) => {
	const issueType = url.searchParams.get('type') || 'all_issues';
	const format = url.searchParams.get('format') || undefined;
	const search = url.searchParams.get('q') || undefined;

	const { tracks, total } = getIssuesTracks({
		issueType,
		format,
		search,
		limit: 500
	});

	const stats = getStats();
	const fixerRules = getGlobalFixerRules();

	return {
		tracks,
		total,
		stats,
		fixerRules,
		activeType: issueType,
		searchQuery: search || '',
		formatFilter: format || ''
	};
};
