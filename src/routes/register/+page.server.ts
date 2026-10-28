import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types.js';
import {
	hasAnyUser,
	isAuthDisabled,
	isRegistrationDisabled,
	createUser,
	createSession,
	getSessionCookieOptions,
	SESSION_COOKIE_NAME
} from '$lib/server/auth.js';

export const load: PageServerLoad = async ({ locals }) => {
	if (isAuthDisabled() || locals.user) {
		throw redirect(303, '/');
	}

	const usersExist = hasAnyUser();
	if (!usersExist) {
		throw redirect(303, '/setup');
	}

	return {
		registrationDisabled: isRegistrationDisabled()
	};
};

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		if (isRegistrationDisabled()) {
			return fail(403, {
				error: 'Public registration is currently disabled by the administrator.'
			});
		}

		const data = await request.formData();
		const username = data.get('username')?.toString().trim();
		const password = data.get('password')?.toString();
		const confirmPassword = data.get('confirmPassword')?.toString();

		if (!username || username.length < 3) {
			return fail(400, {
				error: 'Username must be at least 3 characters long',
				username
			});
		}

		if (!/^[a-z0-9_.-]+$/i.test(username)) {
			return fail(400, {
				error: 'Username can only contain letters, numbers, hyphens, periods, and underscores',
				username
			});
		}

		if (!password || password.length < 6) {
			return fail(400, {
				error: 'Password must be at least 6 characters long',
				username
			});
		}

		if (password !== confirmPassword) {
			return fail(400, {
				error: 'Passwords do not match',
				username
			});
		}

		const result = createUser(username, password, 'user');
		if (result.error || !result.user) {
			return fail(400, {
				error: result.error || 'Failed to create user account',
				username
			});
		}

		const sessionId = createSession(result.user.id);
		cookies.set(SESSION_COOKIE_NAME, sessionId, getSessionCookieOptions(url));

		throw redirect(303, '/');
	}
};
