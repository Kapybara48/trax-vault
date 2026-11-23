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

self.addEventListener('install', (event: any) => {
	event.waitUntil(
		caches
			.open(CACHE_NAME)
			.then((cache) => cache.addAll(ASSETS))
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

			// 1. Try matching pre-cached assets (JS bundles, CSS, images)
			const cachedResponse = await cache.match(event.request);
			if (cachedResponse) {
				// Return cached asset immediately, but update in background if online
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
					// Cache successful navigation pages for offline opening
					if (event.request.mode === 'navigate') {
						cache.put(event.request, response.clone());
					}
				}
				return response;
			} catch (err) {
				// 3. Offline fallback
				if (event.request.mode === 'navigate') {
					// Return cached player page if available
					const offlinePlayer = (await cache.match('/player')) || (await cache.match('/'));
					if (offlinePlayer) {
						return offlinePlayer;
					}
				}
				throw err;
			}
		})()
	);
});
