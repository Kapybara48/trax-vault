import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getAlbums, createAlbum, deleteAlbums } from '$lib/server/db.js';

export const GET: RequestHandler = async ({ url }) => {
	const search = url.searchParams.get('q') || undefined;
	const filter = url.searchParams.get('filter') || undefined;

	try {
		const albums = getAlbums(search, filter);
		return json(albums);
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { album, tracks } = body;

		if (!album || !album.title || !album.artist) {
			return json({ error: 'Album title and artist are required' }, { status: 400 });
		}

		const albumId = createAlbum(album, tracks || []);
		return json({ success: true, id: albumId });
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json().catch(() => ({}));
		const { ids } = body;

		if (!Array.isArray(ids) || ids.length === 0) {
			return json({ error: 'Array of album IDs is required' }, { status: 400 });
		}

		const albumIds = ids
			.map((id: any) => parseInt(id, 10))
			.filter((id: number) => !isNaN(id) && id > 0);

		if (albumIds.length === 0) {
			return json({ error: 'No valid album IDs provided' }, { status: 400 });
		}

		deleteAlbums(albumIds);
		return json({ success: true, count: albumIds.length });
	} catch (err: any) {
		return json({ error: err.message }, { status: 500 });
	}
};
