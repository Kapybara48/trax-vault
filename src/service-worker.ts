/// <reference types="@sveltejs/kit" />
import { immutable, assets, prerendered } from '$app/manifest';
import { version } from '$app/env';

const CACHE_NAME = `traxvault-cache-${version}`;

// Assets to pre-cache on service worker install
const ASSETS = [
	...immutable,
	...assets,
	...prerendered
];

const PRECACHE_ROUTES = ['/player', '/'];

self.addEventListener('install', (event: any) => {
	event.waitUntil(
		caches
			.open(CACHE_NAME)
			.then(async (cache) => {
				await cache.addAll(ASSETS);
				// Pre-cache application shell routes
				for (const route of PRECACHE_ROUTES) {
					try {
						const res = await fetch(route);
						if (res && res.status === 200) {
							await cache.put(route, res);
						}
					} catch {}
				}
			})
			.then(() => (self as any).skipWaiting())
	);
});

self.addEventListener('activate', (event: any) => {
	event.waitUntil(
		caches.keys().then(async (keys) => {
			for (const key of keys) {
				if (key !== CACHE_NAME) {
					await caches.delete(key);
				}
			}
			await (self as any).clients.claim();
		})
	);
});

self.addEventListener('fetch', (event: any) => {
	const url = new URL(event.request.url);

	// Bypass caching for audio streams and non-GET requests (IndexedDB handles offline audio blobs)
	if (event.request.method !== 'GET') return;
	if (url.pathname.includes('/api/tracks/') && url.pathname.includes('/audio')) return;
	if (url.pathname.startsWith('/rest/')) return;
	if (url.pathname.startsWith('/api/sync/events')) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE_NAME);

			// 1. Try matching pre-cached static assets (JS bundles, CSS, icons)
			const cachedResponse = await cache.match(event.request);
			if (cachedResponse) {
				// For immutable build chunks, return immediately without network overhead
				if (url.pathname.includes('/_app/immutable/')) {
					return cachedResponse;
				}
				// For other assets, revalidate in background when online
				fetch(event.request)
					.then((networkResponse) => {
						if (networkResponse && networkResponse.status === 200) {
							cache.put(event.request, networkResponse.clone());
						}
					})
					.catch(() => {});
				return cachedResponse;
			}

			// 2. Network-first for dynamic navigation and API calls
			try {
				const response = await fetch(event.request);
				if (response.status === 200) {
					// Cache player page and navigation responses for offline opening
					if (event.request.mode === 'navigate' || url.pathname === '/player') {
						cache.put('/player', response.clone());
						cache.put(event.request, response.clone());
					}
				}
				return response;
			} catch (err) {
				// 3. Offline fallback for document navigation
				if (event.request.mode === 'navigate' || url.pathname === '/player') {
					const offlinePlayer =
						(await cache.match(event.request, { ignoreSearch: true })) ||
						(await cache.match('/player', { ignoreSearch: true })) ||
						(await cache.match('/', { ignoreSearch: true }));
					if (offlinePlayer) {
						return offlinePlayer;
					}
				}
				throw err;
			}
		})()
	);
});
