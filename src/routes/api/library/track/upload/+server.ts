import fs from 'node:fs';
import path from 'node:path';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getAlbumById } from '$lib/server/db.js';
import {
	AUDIO_EXTENSIONS,
	getMusicDirectory,
	isPathWithin,
	resolveTrackFilePath,
	resolveMusicFolderPath,
	scanAudioFile
} from '$lib/server/scanner.js';

function sanitizePathSegment(name: string): string {
	return name.replace(/[/\\?%*:|"<>]/g, '_').trim();
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const formData = await request.formData();
		const file = formData.get('file') as File | null;
		if (!file || !file.name) {
			return json({ error: 'No audio file provided' }, { status: 400 });
		}

		const ext = path.extname(file.name).toLowerCase();
		if (!AUDIO_EXTENSIONS.has(ext)) {
			return json({ error: `Unsupported audio format ${ext}` }, { status: 400 });
		}

		const folderPath = formData.get('folderPath')?.toString();
		const rawAlbumId = formData.get('albumId')?.toString();
		const albumId = rawAlbumId ? parseInt(rawAlbumId, 10) : undefined;

		const musicDir = getMusicDirectory();
		let canonicalMusicDir: string;
		try {
			canonicalMusicDir = fs.existsSync(musicDir) ? fs.realpathSync(musicDir) : path.resolve(musicDir);
		} catch {
			canonicalMusicDir = path.resolve(musicDir);
		}

		// Resolve target directory
		let targetDir: string | null = null;
		if (folderPath) {
			const resolvedFld = resolveMusicFolderPath(folderPath);
			if (resolvedFld && fs.existsSync(resolvedFld)) {
				targetDir = resolvedFld;
			}
		} else if (albumId) {
			const albRes = getAlbumById(albumId);
			if (albRes) {
				for (const t of albRes.tracks) {
					const r = resolveTrackFilePath(t);
					if (r && fs.existsSync(r)) {
						targetDir = path.dirname(r);
						break;
					}
				}
				if (!targetDir) {
					targetDir = path.join(
						canonicalMusicDir,
						sanitizePathSegment(albRes.album.artist || 'Unknown Artist'),
						sanitizePathSegment(albRes.album.title || 'Unknown Album')
					);
				}
			}
		}

		if (!targetDir) {
			return json({ error: 'Target music directory could not be resolved' }, { status: 400 });
		}

		let canonicalTargetDir: string;
		try {
			if (!fs.existsSync(targetDir)) {
				fs.mkdirSync(targetDir, { recursive: true });
			}
			canonicalTargetDir = fs.realpathSync(targetDir);
		} catch (err: any) {
			return json({ error: `Failed to resolve target directory: ${err.message}` }, { status: 500 });
		}

		if (!isPathWithin(canonicalTargetDir, canonicalMusicDir) && canonicalTargetDir !== canonicalMusicDir) {
			return json({ error: 'Access denied: Target folder outside music directory' }, { status: 403 });
		}

		const cleanFilename = sanitizePathSegment(file.name);
		const targetFilePath = path.join(canonicalTargetDir, cleanFilename);

		const buffer = Buffer.from(await file.arrayBuffer());
		fs.writeFileSync(targetFilePath, buffer);

		let scanned;
		try {
			scanned = await scanAudioFile(targetFilePath);
		} catch (e) {
			console.warn('Scan error on uploaded file:', e);
		}

		return json({
			success: true,
			filePath: targetFilePath,
			filename: cleanFilename,
			duration_ms: scanned?.duration_ms || null,
			title: scanned?.title || path.basename(cleanFilename, ext),
			artist: scanned?.artist || undefined
		});
	} catch (err: any) {
		console.error('Audio upload error:', err);
		return json({ error: err.message || 'Audio upload failed' }, { status: 500 });
	}
};
