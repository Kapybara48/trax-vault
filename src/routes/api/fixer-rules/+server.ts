import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getGlobalFixerRules, updateGlobalFixerRules, getStats } from '$lib/server/db.js';
import type { FixerRules } from '$lib/types/index.js';

export const GET: RequestHandler = async () => {
	const rules = getGlobalFixerRules();
	const stats = getStats();
	return json({ rules, stats });
};

const handleUpdate: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json().catch(() => ({}));
		const incoming: Partial<FixerRules> = body.rules ? body.rules : body;
		const updatedRules = updateGlobalFixerRules(incoming);
		const stats = getStats();
		return json({
			success: true,
			rules: updatedRules,
			stats
		});
	} catch (err: any) {
		console.error('[API] Failed to update global fixer rules:', err);
		return json({ error: err.message || 'Failed to update global fixer rules' }, { status: 500 });
	}
};

export const POST = handleUpdate;
export const PUT = handleUpdate;
