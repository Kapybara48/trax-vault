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

	// 2. Form data if POST
	if (request.method === 'POST') {
		const contentType = request.headers.get('content-type') || '';
		if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
			try {
				const formData = await request.formData();
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
			} catch {}
		}
	}

	return params;
}

async function handleSubsonic(endpoint: string, request: Request, url: URL): Promise<Response> {
	// Normalize action: remove leading/trailing slashes, .view, and leading rest/ segment
	let action = (endpoint || '').replace(/^\/+/, '').replace(/\.view$/, '').replace(/\/+$/, '');
	if (action.startsWith('rest/')) {
		action = action.substring(5);
	}
	const params = await extractParams(request, url);

	const format = params.f || 'xml';
	const jsonpCallback = params.callback;

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

	// Authenticate for data endpoints
	const auth = authenticateSubsonicRequest(params);
	if (auth.error) {
		return buildSubsonicError(auth.error.code, auth.error.message, format, jsonpCallback);
	}

	const handler = subsonicHandlers[action];
	if (!handler) {
		return buildSubsonicError(
			SubsonicErrorCode.GENERIC,
			`Action '${action}' is not supported by this server.`,
			format,
			jsonpCallback
		);
	}

	try {
		const result = await handler(params, auth.user!);
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
