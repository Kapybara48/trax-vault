import crypto from 'node:crypto';
import { db } from '$lib/server/db.js';
import { persistUserSubsonicSecret } from './subsonic/crypto.js';

export interface User {
	id: number;
	username: string;
	role: string;
	created_at?: string;
}

export const SESSION_COOKIE_NAME = 'vault_session';

let authDisabledWarned = false;

export function isAuthDisabled(): boolean {
	const val = process.env.AUTH_DISABLED || process.env.DISABLE_AUTH;
	const disabled = val === 'true' || val === '1';
	if (disabled) {
		if (process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_AUTH_BYPASS !== 'true') {
			console.error(
				'🚨 CRITICAL SECURITY ERROR: Authentication bypass (AUTH_DISABLED=true) is blocked in production mode. Set ALLOW_INSECURE_AUTH_BYPASS=true if this instance is running on an isolated, strictly private network.'
			);
			return false;
		}
		if (!authDisabledWarned) {
			authDisabledWarned = true;
			console.warn(
				'⚠️  SECURITY WARNING: Authentication is globally disabled (AUTH_DISABLED=true). All requests are granted administrator privileges.'
			);
		}
	}
	return disabled;
}

/**
 * Determine whether session cookies should be marked secure
 */
export function isCookieSecure(url?: URL): boolean {
	if (process.env.COOKIE_SECURE !== undefined) {
		return process.env.COOKIE_SECURE === 'true' || process.env.COOKIE_SECURE === '1';
	}
	if (url?.protocol === 'https:') {
		return true;
	}
	return process.env.NODE_ENV === 'production';
}

/**
 * Centralized session cookie configuration
 */
export function getSessionCookieOptions(url?: URL): {
	path: string;
	httpOnly: boolean;
	sameSite: 'lax';
	secure: boolean;
	maxAge: number;
} {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: isCookieSecure(url),
		maxAge: 30 * 24 * 60 * 60 // 30 days
	};
}

/**
 * Hash password using Node's built-in scrypt
 */
export function hashPassword(password: string): { hash: string; salt: string } {
	const salt = crypto.randomBytes(16).toString('hex');
	const hash = crypto.scryptSync(password, salt, 64).toString('hex');
	return { hash, salt };
}

/**
 * Verify password against stored hash and salt defensively
 */
export function verifyPassword(password: string, storedHash: string, salt: string): boolean {
	if (!password || !storedHash || !salt) {
		return false;
	}
	try {
		const hash = crypto.scryptSync(password, salt, 64).toString('hex');
		const hashBuf = Buffer.from(hash, 'hex');
		const storedBuf = Buffer.from(storedHash, 'hex');

		if (hashBuf.length !== storedBuf.length) {
			return false;
		}

		return crypto.timingSafeEqual(hashBuf, storedBuf);
	} catch {
		return false;
	}
}

/**
 * Check if at least one user exists in the SQLite database
 */
export function hasAnyUser(): boolean {
	if (isAuthDisabled()) return true;
	try {
		const row = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
		return (row?.count || 0) > 0;
	} catch {
		return false;
	}
}

/**
 * Create initial admin user on first run
 */
export function createInitialAdmin(username: string, password: string): User {
	const trimmedUser = username.trim().toLowerCase();
	const { hash, salt } = hashPassword(password);

	const result = db.prepare(`
		INSERT INTO users (username, password_hash, salt, role)
		VALUES (?, ?, ?, 'admin')
	`).run(trimmedUser, hash, salt);

	const user: User = {
		id: Number(result.lastInsertRowid),
		username: trimmedUser,
		role: 'admin'
	};

	try {
		persistUserSubsonicSecret(user.id, password);
	} catch (e) {
		console.error('Failed to auto-persist Subsonic secret for admin:', e);
	}

	return user;
}

/**
 * Authenticate user with username and password
 */
export function authenticateUser(username: string, password: string): User | null {
	const trimmedUser = username.trim().toLowerCase();
	const row = db.prepare(
		'SELECT id, username, password_hash, salt, role, subsonic_secret FROM users WHERE username = ?'
	).get(trimmedUser) as any;

	if (!row) {
		return null;
	}

	const isValid = verifyPassword(password, row.password_hash, row.salt);
	if (!isValid) {
		return null;
	}

	// Auto sync subsonic secret on successful login
	try {
		persistUserSubsonicSecret(row.id, password);
	} catch (e) {
		console.error('Failed to auto-persist Subsonic secret on login:', e);
	}

	return {
		id: row.id,
		username: row.username,
		role: row.role
	};
}

/**
 * Create a new session for a user (valid for 30 days)
 */
export function createSession(userId: number): string {
	const sessionId = crypto.randomBytes(32).toString('hex');
	const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

	db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(
		sessionId,
		userId,
		expiresAt
	);

	return sessionId;
}

/**
 * Validate session token and return user if valid
 */
export function validateSession(sessionId: string): User | null {
	if (!sessionId) return null;

	const now = new Date().toISOString();
	const row = db.prepare(`
		SELECT u.id, u.username, u.role, s.expires_at
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.id = ? AND s.expires_at > ?
	`).get(sessionId, now) as any;

	if (!row) {
		return null;
	}

	return {
		id: row.id,
		username: row.username,
		role: row.role
	};
}

/**
 * Invalidate a session (logout)
 */
export function deleteSession(sessionId: string): void {
	if (!sessionId) return;
	db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

/**
 * Retrieve user by ID
 */
export function getUserById(id: number): User | null {
	const row = db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(id) as any;
	if (!row) return null;
	return {
		id: row.id,
		username: row.username,
		role: row.role,
		created_at: row.created_at
	};
}

/**
 * Change password for a user after validating their current password
 */
export function changePassword(
	userId: number,
	currentPassword: string,
	newPassword: string
): { success: boolean; error?: string } {
	if (!newPassword || newPassword.length < 6) {
		return { success: false, error: 'New password must be at least 6 characters long' };
	}

	const row = db.prepare(
		'SELECT id, username, password_hash, salt FROM users WHERE id = ?'
	).get(userId) as { id: number; username: string; password_hash: string; salt: string } | undefined;

	if (!row) {
		return { success: false, error: 'User account not found' };
	}

	const isValid = verifyPassword(currentPassword, row.password_hash, row.salt);
	if (!isValid) {
		return { success: false, error: 'Current password is incorrect' };
	}

	const { hash, salt } = hashPassword(newPassword);
	db.prepare(
		"UPDATE users SET password_hash = ?, salt = ?, updated_at = datetime('now') WHERE id = ?"
	).run(hash, salt, userId);

	try {
		persistUserSubsonicSecret(userId, newPassword);
	} catch (e) {
		console.error('Failed to update Subsonic secret on password change:', e);
	}

	return { success: true };
}
