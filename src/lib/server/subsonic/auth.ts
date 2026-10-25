import { db } from '$lib/server/db.js';
import { isAuthDisabled, verifyPassword, type User } from '$lib/server/auth.js';
import {
	decryptSubsonicPassword,
	verifySubsonicToken,
	decodeSubsonicPasswordParam,
	persistUserSubsonicSecret
} from './crypto.js';
import { SubsonicErrorCode, type SubsonicError } from './types.js';

export interface SubsonicAuthResult {
	user?: User;
	error?: SubsonicError;
}

export function authenticateSubsonicRequest(params: {
	u?: string | null;
	p?: string | null;
	t?: string | null;
	s?: string | null;
}): SubsonicAuthResult {
	if (isAuthDisabled()) {
		return {
			user: {
				id: 1,
				username: 'admin',
				role: 'admin'
			}
		};
	}

	const username = params.u?.trim().toLowerCase();
	if (!username) {
		return {
			error: {
				code: SubsonicErrorCode.REQUIRED_PARAM_MISSING,
				message: "Required parameter 'u' (username) is missing."
			}
		};
	}

	const row = db.prepare(
		'SELECT id, username, password_hash, salt, role, subsonic_secret FROM users WHERE username = ?'
	).get(username) as any;

	if (!row) {
		return {
			error: {
				code: SubsonicErrorCode.WRONG_CREDENTIALS,
				message: 'Wrong username or password.'
			}
		};
	}

	const user: User = {
		id: row.id,
		username: row.username,
		role: row.role
	};

	// 1. Token + salt authentication (standard in modern Subsonic clients)
	if (params.t && params.s) {
		if (!row.subsonic_secret) {
			return {
				error: {
					code: SubsonicErrorCode.WRONG_CREDENTIALS,
					message: 'Subsonic token auth is not yet initialized for this user. Please log in once to Trax Vault web or set a Subsonic password in Settings.'
				}
			};
		}

		const cleartextPassword = decryptSubsonicPassword(row.subsonic_secret);
		if (!cleartextPassword) {
			return {
				error: {
					code: SubsonicErrorCode.GENERIC,
					message: 'Failed to decrypt stored credentials.'
				}
			};
		}

		const isValid = verifySubsonicToken(params.t, params.s, cleartextPassword);
		if (!isValid) {
			return {
				error: {
					code: SubsonicErrorCode.WRONG_CREDENTIALS,
					message: 'Wrong username or password.'
				}
			};
		}

		return { user };
	}

	// 2. Legacy cleartext / hex-encoded password parameter (p)
	if (params.p !== undefined && params.p !== null) {
		const cleartextPassword = decodeSubsonicPasswordParam(params.p);
		const isValid = verifyPassword(cleartextPassword, row.password_hash, row.salt);
		if (!isValid) {
			return {
				error: {
					code: SubsonicErrorCode.WRONG_CREDENTIALS,
					message: 'Wrong username or password.'
				}
			};
		}

		// Auto-sync subsonic_secret upon successful password authentication
		try {
			persistUserSubsonicSecret(row.id, cleartextPassword);
		} catch (err) {
			console.error('Failed to auto-persist Subsonic secret:', err);
		}

		return { user };
	}

	return {
		error: {
			code: SubsonicErrorCode.REQUIRED_PARAM_MISSING,
			message: "Required authentication parameter 't' and 's', or 'p' is missing."
		}
	};
}
