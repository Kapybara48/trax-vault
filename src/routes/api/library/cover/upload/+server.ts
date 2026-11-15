import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { saveUploadedCoverImage } from '$lib/server/tagger.js';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const formData = await request.formData();
		const file = formData.get('file') as File | null;
		if (!file) {
			return json({ error: 'No image file provided' }, { status: 400 });
		}

		const folderPath = formData.get('folderPath')?.toString() || undefined;
		const rawAlbumId = formData.get('albumId')?.toString();
		const albumId = rawAlbumId ? parseInt(rawAlbumId, 10) : undefined;

		const arrayBuffer = await file.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);

		const result = await saveUploadedCoverImage(buffer, {
			folderPath,
			albumId: isNaN(albumId!) ? undefined : albumId,
			filename: file.name,
			mimeType: file.type
		});

		if (!result.success) {
			return json(
				{
					error: result.error || 'Failed to save cover image',
					isPermissionDenied: result.isPermissionDenied
				},
				{ status: result.isPermissionDenied ? 403 : 500 }
			);
		}

		return json({
			success: true,
			coverUrl: result.coverUrl,
			coverPath: result.coverPath
		});
	} catch (err: any) {
		console.error('Cover upload endpoint error:', err);
		return json({ error: err.message || 'Internal server error uploading cover' }, { status: 500 });
	}
};
