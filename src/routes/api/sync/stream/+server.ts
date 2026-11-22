import { error, type RequestEvent } from '@sveltejs/kit';
import { registerDeviceStream } from '$lib/server/sync.js';

export const GET = async ({ url, locals, request }: RequestEvent) => {
	const user = locals.user;
	if (!user) {
		throw error(401, 'Unauthorized');
	}

	const deviceId = (url.searchParams.get('deviceId') || '').trim();
	if (!deviceId) {
		throw error(400, 'Missing deviceId parameter');
	}

	const deviceName = (url.searchParams.get('deviceName') || '').trim() || `${user.username}'s Device`;
	const roomCode = url.searchParams.get('roomCode');

	let cleanupFn: (() => void) | null = null;
	let cleanedUp = false;

	const runCleanup = () => {
		if (cleanedUp) return;
		cleanedUp = true;
		if (cleanupFn) {
			try {
				cleanupFn();
			} catch {
				// Ignore cleanup errors
			}
			cleanupFn = null;
		}
	};

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			cleanupFn = registerDeviceStream({
				deviceId,
				deviceName,
				userId: user.id,
				username: user.username,
				roomCode,
				controller
			});

			request.signal.addEventListener('abort', runCleanup, { once: true });
		},
		cancel() {
			runCleanup();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
