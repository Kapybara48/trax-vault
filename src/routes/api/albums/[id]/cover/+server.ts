import fs from 'node:fs';
import path from 'node:path';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getAlbumById } from '$lib/server/db.js';
import { getMusicDirectory, resolveTrackFilePath } from '$lib/server/scanner.js';
import { saveUploadedCoverImage } from '$lib/server/tagger.js';

const IMAGE_MIME_MAP: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.gif': 'image/gif'
};

const COVER_FILENAMES = [
	'cover.jpg',
	'cover.jpeg',
	'cover.png',
	'cover.webp',
	'folder.jpg',
	'folder.png',
	'front.jpg',
	'front.jpeg',
	'front.png'
];

export const GET: RequestHandler = async ({ params }) => {
	const albumId = parseInt(params.id, 10);
	if (isNaN(albumId)) {
		return new Response('Invalid album ID', { status: 400 });
	}

	const albumRes = getAlbumById(albumId);
	if (!albumRes) {
		return new Response('Album not found', { status: 404 });
	}

	const { album, tracks } = albumRes;
	const musicDir = getMusicDirectory();

	let foundPath: string | null = null;

	// 1. If album.cover_url has a path parameter (e.g. /api/library/cover?path=...)
	if (album.cover_url && album.cover_url.includes('path=')) {
		try {
			const u = new URL(album.cover_url, 'http://localhost');
			const p = u.searchParams.get('path');
			if (p && fs.existsSync(p)) {
				foundPath = p;
			} else if (p) {
				const candidate = path.join(musicDir, p.replace(/^\/music\/?/, ''));
				if (fs.existsSync(candidate)) {
					foundPath = candidate;
				}
			}
		} catch {}
	}

	// 2. If not found yet, inspect album folder on disk from tracks
	if (!foundPath && tracks.length > 0) {
		for (const track of tracks) {
			const resolvedTrack = resolveTrackFilePath(track);
			if (resolvedTrack) {
				const albumDir = path.dirname(resolvedTrack);
				for (const name of COVER_FILENAMES) {
					const candidate = path.join(albumDir, name);
					if (fs.existsSync(candidate)) {
						foundPath = candidate;
						break;
					}
				}
				if (foundPath) break;
			}
		}
	}

	// 3. If external HTTP/HTTPS cover URL, redirect
	if (!foundPath && album.cover_url && (album.cover_url.startsWith('http://') || album.cover_url.startsWith('https://'))) {
		return Response.redirect(album.cover_url, 302);
	}

	if (!foundPath || !fs.existsSync(foundPath)) {
		return new Response('Cover art not found', { status: 404 });
	}

	try {
		const ext = path.extname(foundPath).toLowerCase();
		const contentType = IMAGE_MIME_MAP[ext] || 'image/jpeg';
		const stat = fs.statSync(foundPath);
		const buffer = fs.readFileSync(foundPath);

		return new Response(buffer, {
			headers: {
				'Content-Type': contentType,
				'Content-Length': stat.size.toString(),
				'Cache-Control': 'public, max-age=86400',
				'X-Content-Type-Options': 'nosniff'
			}
		});
	} catch (err: any) {
		console.error(`Failed to serve album ${albumId} cover:`, err);
		return new Response('Failed to read cover image', { status: 500 });
	}
};

export const POST: RequestHandler = async ({ params, request }) => {
	const albumId = parseInt(params.id, 10);
	if (isNaN(albumId)) {
		return json({ error: 'Invalid album ID' }, { status: 400 });
	}

	try {
		const formData = await request.formData();
		const file = formData.get('file') as File | null;
		if (!file) {
			return json({ error: 'No image file provided' }, { status: 400 });
		}

		const arrayBuffer = await file.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);

		const result = await saveUploadedCoverImage(buffer, {
			albumId,
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
		console.error(`Error uploading cover for album ${albumId}:`, err);
		return json({ error: err.message || 'Failed to upload cover' }, { status: 500 });
	}
};
