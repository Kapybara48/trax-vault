import { json, type RequestHandler } from '@sveltejs/kit';
import { updateUserRole, adminResetPassword, deleteUser } from '$lib/server/auth.js';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Forbidden: Administrator privileges required' }, { status: 403 });
	}

	const targetId = parseInt(params.id || '', 10);
	if (isNaN(targetId)) {
		return json({ error: 'Invalid user ID' }, { status: 400 });
	}

	let body: any = {};
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON request' }, { status: 400 });
	}

	// 1. Role update
	if (body.role !== undefined) {
		const newRole = body.role === 'admin' ? 'admin' : 'user';
		const roleResult = updateUserRole(targetId, newRole, locals.user.id);
		if (!roleResult.success) {
			return json({ error: roleResult.error }, { status: 400 });
		}
	}

	// 2. Password reset
	if (body.newPassword !== undefined) {
		const pwResult = adminResetPassword(targetId, body.newPassword.toString());
		if (!pwResult.success) {
			return json({ error: pwResult.error }, { status: 400 });
		}
	}

	return json({ success: true });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Forbidden: Administrator privileges required' }, { status: 403 });
	}

	const targetId = parseInt(params.id || '', 10);
	if (isNaN(targetId)) {
		return json({ error: 'Invalid user ID' }, { status: 400 });
	}

	const result = deleteUser(targetId, locals.user.id);
	if (!result.success) {
		return json({ error: result.error || 'Failed to delete user' }, { status: 400 });
	}

	return json({ success: true });
};
