import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types.js';
import { getUserById, changePassword, verifyPassword } from '$lib/server/auth.js';
import { persistUserSubsonicSecret } from '$lib/server/subsonic/crypto.js';
import { db } from '$lib/server/db.js';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		throw redirect(303, '/login?redirect=/settings');
	}

	const userDetails = locals.user.id ? getUserById(locals.user.id) : null;
	const activeSessionsCount = locals.user.id
		? (db.prepare('SELECT COUNT(*) as count FROM sessions WHERE user_id = ?').get(locals.user.id) as { count: number })?.count || 1
		: 0;

	const userRow = locals.user.id
		? (db.prepare('SELECT subsonic_secret FROM users WHERE id = ?').get(locals.user.id) as { subsonic_secret?: string })
		: null;

	const totalUsers = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number })?.count || 0;
	const defaultPicardUrl = `http://${url.hostname || 'localhost'}:5800`;
	const subsonicUrl = `${url.protocol}//${url.host}/rest`;
	const serverBaseUrl = `${url.protocol}//${url.host}`;

	return {
		account: userDetails || locals.user,
		activeSessionsCount,
		totalUsers,
		hasSubsonicSecret: !!userRow?.subsonic_secret,
		subsonicUrl,
		serverBaseUrl,
		authDisabled: locals.authDisabled,
		env: {
			dataDir: process.env.DATA_DIR || './data',
			musicDir: process.env.MUSIC_DIR || process.env.MUSIC_PATH || './music',
			nodeEnv: process.env.NODE_ENV || 'development',
			picardUrl: process.env.PICARD_URL || defaultPicardUrl
		}
	};
};

export const actions: Actions = {
	changePassword: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(303, '/login?redirect=/settings');
		}

		if (locals.authDisabled) {
			return fail(400, { error: 'Authentication is globally disabled via environment variable (AUTH_DISABLED=true).' });
		}

		const data = await request.formData();
		const currentPassword = data.get('currentPassword')?.toString() || '';
		const newPassword = data.get('newPassword')?.toString() || '';
		const confirmPassword = data.get('confirmPassword')?.toString() || '';

		if (!currentPassword) {
			return fail(400, { error: 'Current password is required' });
		}

		if (!newPassword || newPassword.length < 6) {
			return fail(400, { error: 'New password must be at least 6 characters long' });
		}

		if (newPassword !== confirmPassword) {
			return fail(400, { error: 'New passwords do not match' });
		}

		const result = changePassword(locals.user.id, currentPassword, newPassword);
		if (!result.success) {
			return fail(400, { error: result.error || 'Failed to update password' });
		}

		return { success: true, message: 'Password successfully updated!' };
	},

	syncSubsonicPassword: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(303, '/login?redirect=/settings');
		}

		if (locals.authDisabled) {
			return { success: true, message: 'Authentication is globally disabled. No Subsonic password required.' };
		}

		const data = await request.formData();
		const password = data.get('password')?.toString() || '';

		if (!password) {
			return fail(400, { error: 'Password is required to initialize Subsonic client access' });
		}

		const userRow = db.prepare('SELECT password_hash, salt FROM users WHERE id = ?').get(locals.user.id) as any;
		if (!userRow || !verifyPassword(password, userRow.password_hash, userRow.salt)) {
			return fail(400, { error: 'Incorrect password entered' });
		}

		persistUserSubsonicSecret(locals.user.id, password);
		return { success: true, message: 'Subsonic client authentication successfully activated!' };
	}
};
