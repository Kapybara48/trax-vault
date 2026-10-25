import fs from 'node:fs';
import path from 'node:path';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { scanLibraryDirectory, getMusicDirectory, syncLibraryFromDisk } from '$lib/server/scanner.js';

function isPathWithin(targetPath: string, rootPath: string): boolean {
	const relative = path.relative(rootPath, targetPath);
	return !relative.startsWith('..') && !path.isAbsolute(relative);
}

export const GET: RequestHandler = async ({ url }) => {
	const requestedPath = url.searchParams.get('path')?.trim() || undefined;
	const musicDir = getMusicDirectory();

	let canonicalMusicDir: string;
	try {
		canonicalMusicDir = fs.existsSync(musicDir) ? fs.realpathSync(musicDir) : path.resolve(musicDir);
	} catch {
		canonicalMusicDir = path.resolve(musicDir);
	}

	let targetPath = canonicalMusicDir;

	if (requestedPath) {
		const resolved = path.resolve(requestedPath);
		if (!fs.existsSync(resolved)) {
			return json(
				{
					error: `Directory not found: ${requestedPath}`,
					albums: [],
					totalFiles: 0,
					libraryPath: requestedPath,
					exists: false
				},
				{ status: 404 }
			);
		}

		let canonicalRequested: string;
		try {
			canonicalRequested = fs.realpathSync(resolved);
		} catch {
			canonicalRequested = resolved;
		}

		// Enforce boundary: must be inside or equal to configured music directory
		if (!isPathWithin(canonicalRequested, canonicalMusicDir) && canonicalRequested !== canonicalMusicDir) {
			return json(
				{
					error: 'Access denied: Scanning is strictly restricted to the configured music library directory.',
					albums: [],
					totalFiles: 0,
					libraryPath: requestedPath,
					exists: false
				},
				{ status: 403 }
			);
		}

		targetPath = canonicalRequested;
	}

	try {
		const result = await scanLibraryDirectory(targetPath);
		return json(result);
	} catch (err: any) {
		console.error('Library scan error:', err);
		return json(
			{
				error: err.message,
				albums: [],
				totalFiles: 0,
				libraryPath: targetPath,
				exists: false
			},
			{ status: 500 }
		);
	}
};

export const POST: RequestHandler = async () => {
	try {
		const result = await syncLibraryFromDisk();
		return json({ success: true, ...result });
	} catch (err: any) {
		console.error('Library sync error:', err);
		return json({ error: err.message }, { status: 500 });
	}
};
