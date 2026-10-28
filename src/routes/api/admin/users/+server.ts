import { json, type RequestHandler } from '@sveltejs/kit';
import { getAllUsers, createUser } from '$lib/server/auth.js';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Forbidden: Administrator privileges required' }, { status: 403 });
	}

	const users = getAllUsers();
	return json({ users });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Forbidden: Administrator privileges required' }, { status: 403 });
	}

	let body: any = {};
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON request' }, { status: 400 });
	}

	const username = body.username?.toString().trim();
	const password = body.password?.toString();
	const role = body.role === 'admin' ? 'admin' : 'user';

	if (!username || username.length < 3) {
		return json({ error: 'Username must be at least 3 characters long' }, { status: 400 });
	}

	if (!password || password.length < 6) {
		return json({ error: 'Password must be at least 6 characters long' }, { status: 400 });
	}

	const result = createUser(username, password, role);
	if (result.error || !result.user) {
		return json({ error: result.error || 'Failed to create user account' }, { status: 400 });
	}

	return json({
		success: true,
		user: {
			id: result.user.id,
			username: result.user.username,
			role: result.user.role
		}
	});
};
