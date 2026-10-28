import type { PageServerLoad } from './$types.js';
import { scanLibraryDirectory, getMusicDirectory } from '$lib/server/scanner.js';

export const load: PageServerLoad = async ({ url }) => {
	const customPath = url.searchParams.get('path') || undefined;

	try {
		const result = await scanLibraryDirectory(customPath, { force: false });
		return {
			albums: result.albums,
			totalFiles: result.totalFiles,
			libraryPath: result.libraryPath,
			exists: result.exists,
			scannedAt: result.scannedAt || null
		};
	} catch (err: any) {
		console.error('Initial library scan failed:', err);
		return {
			albums: [],
			totalFiles: 0,
			libraryPath: customPath || getMusicDirectory(),
			exists: false,
			scannedAt: null
		};
	}
};
