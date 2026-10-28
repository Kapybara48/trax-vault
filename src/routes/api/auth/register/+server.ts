import { json, type RequestHandler } from '@sveltejs/kit';
import {
	isRegistrationDisabled,
	hasAnyUser,
	createUser,
	createSession,
	getSessionCookieOptions,
	SESSION_COOKIE_NAME
} from '$lib/server/auth.js';

export const POST: RequestHandler = async ({ request, cookies, url }) => {
	// First-run guard
	if (!hasAnyUser()) {
		return json({ error: 'System uninitialized. Please visit /setup.' }, { status: 400 });
	}

	// Environment variable disable check
	if (isRegistrationDisabled()) {
		return json(
			{ error: 'Public account registration is disabled. Please contact your system administrator.' },
			{ status: 403 }
		);
	}

	let body: any = {};
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON request' }, { status: 400 });
	}

	const username = body.username?.toString().trim();
	const password = body.password?.toString();
	const confirmPassword = body.confirmPassword?.toString();

	if (!username || username.length < 3) {
		return json({ error: 'Username must be at least 3 characters long' }, { status: 400 });
	}

	if (!password || password.length < 6) {
		return json({ error: 'Password must be at least 6 characters long' }, { status: 400 });
	}

	if (confirmPassword !== undefined && password !== confirmPassword) {
		return json({ error: 'Passwords do not match' }, { status: 400 });
	}

	try {
		const result = createUser(username, password, 'user');
		if (result.error || !result.user) {
			return json({ error: result.error || 'Failed to create user account' }, { status: 400 });
		}

		const sessionId = createSession(result.user.id);
		cookies.set(SESSION_COOKIE_NAME, sessionId, getSessionCookieOptions(url));

		return json({
			success: true,
			user: {
				id: result.user.id,
				username: result.user.username,
				role: result.user.role
			},
			redirect: '/'
		});
	} catch (err: any) {
		console.error('Registration failed:', err);
		return json({ error: err.message || 'Internal registration error' }, { status: 500 });
	}
};
