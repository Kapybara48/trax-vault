import type { RequestHandler } from './$types.js';
import { authenticateSubsonicRequest } from '$lib/server/subsonic/auth.js';
import { buildSubsonicError, buildSubsonicResponse } from '$lib/server/subsonic/format.js';
import { subsonicHandlers } from '$lib/server/subsonic/handlers.js';
import { handleSubsonicStream, handleSubsonicCoverArt } from '$lib/server/subsonic/media.js';
import { SubsonicErrorCode } from '$lib/server/subsonic/types.js';

export const OPTIONS: RequestHandler = async () => {
	return new Response(null, {
		status: 204,
		headers: {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': '*'
		}
	});
};

async function extractParams(request: Request, url: URL): Promise<Record<string, any>> {
	const params: Record<string, any> = {};

	// 1. URL Query parameters
	for (const [key, value] of url.searchParams.entries()) {
		if (params[key] !== undefined) {
			if (Array.isArray(params[key])) {
				params[key].push(value);
			} else {
				params[key] = [params[key], value];
			}
		} else {
			params[key] = value;
		}
	}

	// 2. Body if POST
	if (request.method === 'POST') {
		const contentType = request.headers.get('content-type') || '';
		try {
			if (contentType.includes('application/x-www-form-urlencoded')) {
				const text = await request.clone().text();
				const bodyParams = new URLSearchParams(text);
				for (const [key, value] of bodyParams.entries()) {
					if (params[key] !== undefined) {
						if (Array.isArray(params[key])) {
							params[key].push(value);
						} else {
							params[key] = [params[key], value];
						}
					} else {
						params[key] = value;
					}
				}
			} else if (contentType.includes('multipart/form-data')) {
				const formData = await request.clone().formData();
				for (const [key, value] of formData.entries()) {
					if (typeof value === 'string') {
						if (params[key] !== undefined) {
							if (Array.isArray(params[key])) {
								params[key].push(value);
							} else {
								params[key] = [params[key], value];
							}
						} else {
							params[key] = value;
						}
					}
				}
			}
		} catch {}
	}

	return params;
}

async function handleSubsonic(endpoint: string, request: Request, url: URL): Promise<Response> {
	// Normalize action: remove leading/trailing slashes, .view, and leading rest/ segment
	let action = (endpoint || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
	action = action.replace(/\.view$/i, '').replace(/\/+$/, '');
	while (action.startsWith('rest/')) {
		action = action.substring(5).replace(/^\/+/, '');
	}
	action = action.replace(/\.view$/i, '');
	const params = await extractParams(request, url);

	const format = params.f || 'xml';
	const jsonpCallback = params.callback;

	// Sanitize params for logging (redact secrets)
	const safeParams = { ...params };
	delete safeParams.p;
	delete safeParams.t;
	delete safeParams.s;
	const paramStr = Object.entries(safeParams).map(([k, v]) => `${k}=${v}`).join(' ');
	console.log(`[Subsonic] ${request.method} ${action} ${paramStr}`);

	// Media streams and cover art
	if (action === 'stream') {
		const auth = authenticateSubsonicRequest(params);
		if (auth.error) {
			return buildSubsonicError(auth.error.code, auth.error.message, format, jsonpCallback);
		}
		return handleSubsonicStream(params, request.headers);
	}

	if (action === 'getCoverArt') {
		const auth = authenticateSubsonicRequest(params);
		if (auth.error) {
			return buildSubsonicError(auth.error.code, auth.error.message, format, jsonpCallback);
		}
		return handleSubsonicCoverArt(params);
	}

	// OpenSubsonic specification mandates that getOpenSubsonicExtensions must be publicly accessible without auth.
	// Similarly, unauthenticated probe ping.view should succeed so clients can verify server reachability.
	const isPublicAction =
		action.toLowerCase() === 'getopensubsonicextensions' ||
		(action.toLowerCase() === 'ping' && !params.u);

	let user: any = null;
	if (!isPublicAction) {
		const auth = authenticateSubsonicRequest(params);
		if (auth.error) {
			return buildSubsonicError(auth.error.code, auth.error.message, format, jsonpCallback);
		}
		user = auth.user;
	} else if (params.u) {
		const auth = authenticateSubsonicRequest(params);
		if (!auth.error) {
			user = auth.user;
		}
	}

	let handler = subsonicHandlers[action];
	if (!handler) {
		const lowerAction = action.toLowerCase();
		const matchedKey = Object.keys(subsonicHandlers).find((k) => k.toLowerCase() === lowerAction);
		if (matchedKey) {
			handler = subsonicHandlers[matchedKey];
		}
	}

	if (!handler) {
		console.warn(`[Subsonic] Unsupported action requested: ${action}`);
		return buildSubsonicError(
			SubsonicErrorCode.GENERIC,
			`Action '${action}' is not supported by this server.`,
			format,
			jsonpCallback
		);
	}

	try {
		const result = await handler(params, user || { id: 1, username: 'guest', role: 'guest' });
		if (result.error) {
			return buildSubsonicError(result.error.code, result.error.message, format, jsonpCallback);
		}
		return buildSubsonicResponse(result.data, format, undefined, jsonpCallback);
	} catch (err: any) {
		console.error(`Error handling Subsonic action '${action}':`, err);
		return buildSubsonicError(
			SubsonicErrorCode.GENERIC,
			err.message || 'Internal server error processing Subsonic request',
			format,
			jsonpCallback
		);
	}
}

export const GET: RequestHandler = async ({ params, request, url }) => {
	return handleSubsonic(params.endpoint, request, url);
};

export const POST: RequestHandler = async ({ params, request, url }) => {
	return handleSubsonic(params.endpoint, request, url);
};
