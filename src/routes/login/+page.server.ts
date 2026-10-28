import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types.js';
import {
	hasAnyUser,
	authenticateUser,
	createSession,
	isAuthDisabled,
	isRegistrationDisabled,
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
		registrationAllowed: !isRegistrationDisabled()
	};
};

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const data = await request.formData();
		const username = data.get('username')?.toString().trim();
		const password = data.get('password')?.toString();
		const redirectTo = url.searchParams.get('redirect') || '/';

		if (!username || !password) {
			return fail(400, {
				error: 'Username and password are required',
				username
			});
		}

		const user = authenticateUser(username, password);
		if (!user) {
			return fail(400, {
				error: 'Invalid username or password',
				username
			});
		}

		const sessionId = createSession(user.id);
		cookies.set(SESSION_COOKIE_NAME, sessionId, getSessionCookieOptions(url));

		throw redirect(303, redirectTo);
	}
};
