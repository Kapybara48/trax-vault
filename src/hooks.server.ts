import { redirect, json, type RequestEvent } from '@sveltejs/kit';
import { isAuthDisabled, hasAnyUser, validateSession, SESSION_COOKIE_NAME } from '$lib/server/auth.js';
import { backfillTrackBitrates } from '$lib/server/scanner.js';

// Trigger non-blocking bitrate backfill for imported tracks on startup
backfillTrackBitrates().catch((err) => console.warn('Bitrate backfill error:', err));

export async function handle({
	event,
	resolve
}: {
	event: RequestEvent;
	resolve: (event: RequestEvent) => Promise<Response>;
}): Promise<Response> {
	const authDisabled = isAuthDisabled();
	event.locals.authDisabled = authDisabled;

	const path = event.url.pathname;

	// Allow static assets, favicon, and system files
	if (path.startsWith('/_app') || path.startsWith('/favicon') || path === '/robots.txt') {
		return resolve(event);
	}

	// Redirect legacy playlists paths into the unified Audiophile Studio Player
	if (path === '/playlists' || path === '/playlists/') {
		throw redirect(303, '/player?view=playlists');
	}
	const playlistMatch = path.match(/^\/playlist\/(\d+)\/?$/);
	if (playlistMatch) {
		throw redirect(303, `/player?playlistId=${playlistMatch[1]}`);
	}

	// Allow Subsonic REST API (authenticates via Subsonic protocol params u/t/s/p)
	if (path.startsWith('/rest')) {
		return resolve(event);
	}

	// If auth is globally disabled via environment variable
	if (authDisabled) {
		event.locals.user = { id: 1, username: 'admin', role: 'admin' };
		if (path === '/login' || path === '/setup') {
			throw redirect(303, '/');
		}
		return resolve(event);
	}

	// Check if any admin/user exists
	const usersExist = hasAnyUser();
	if (!usersExist) {
		// First-run: redirect to /setup if not already there
		if (path !== '/setup' && !path.startsWith('/api/auth/setup')) {
			if (path.startsWith('/api/')) {
				return json({ error: 'System uninitialized. Please visit /setup.' }, { status: 403 });
			}
			throw redirect(303, '/setup');
		}
		event.locals.user = null;
		return resolve(event);
	}

	// Normal auth check with session cookie
	const sessionId = event.cookies.get(SESSION_COOKIE_NAME);
	const user = sessionId ? validateSession(sessionId) : null;
	event.locals.user = user;

	// If user is logged in
	if (user) {
		if (path === '/login' || path === '/setup') {
			throw redirect(303, '/');
		}
		return resolve(event);
	}

	// If user is NOT logged in
	const isAuthRoute =
		path === '/login' ||
		path.startsWith('/api/auth/login') ||
		path.startsWith('/api/auth/logout');

	if (!isAuthRoute) {
		if (path.startsWith('/api/')) {
			return json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
		}
		throw redirect(303, `/login?redirect=${encodeURIComponent(path)}`);
	}

	return resolve(event);
}
