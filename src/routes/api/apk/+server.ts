import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fs from 'node:fs';
import path from 'node:path';

export const GET: RequestHandler = async () => {
	const candidates = [
		path.resolve(process.cwd(), 'trax-vault.apk'),
		path.resolve(process.cwd(), 'data', 'trax-vault.apk'),
		path.resolve(process.cwd(), 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
		path.resolve(process.cwd(), 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release-unsigned.apk')
	];

	for (const file of candidates) {
		if (fs.existsSync(file)) {
			try {
				const stat = fs.statSync(file);
				const buffer = fs.readFileSync(file);
				return new Response(buffer, {
					headers: {
						'Content-Type': 'application/vnd.android.package-archive',
						'Content-Length': stat.size.toString(),
						'Content-Disposition': 'attachment; filename="trax-vault.apk"',
						'Cache-Control': 'no-cache'
					}
				});
			} catch (err) {
				console.error('[APK Server] Error reading APK file:', err);
			}
		}
	}

	throw error(404, 'APK not found on server. Build the APK with Forgejo CI or scripts/build-apk.sh.');
};
