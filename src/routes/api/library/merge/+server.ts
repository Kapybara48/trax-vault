import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { mergeScannedTracksIntoVaultAlbum, mergeVaultAlbums, previewVaultAlbumsMerge } from '$lib/server/db.js';
import { mergeScannedAlbumsInCache, invalidateScanCache, scanLibraryDirectory } from '$lib/server/scanner.js';
import type { ScannedTrack } from '$lib/types/index.js';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const targetAlbumId = url.searchParams.get('targetAlbumId');
		const sourceAlbumId = url.searchParams.get('sourceAlbumId');

		if (!targetAlbumId || !sourceAlbumId) {
			return json({ error: 'targetAlbumId and sourceAlbumId are required' }, { status: 400 });
		}

		const preview = previewVaultAlbumsMerge(Number(targetAlbumId), Number(sourceAlbumId));
		if (!preview) {
			return json({ error: 'Could not load preview. Ensure both albums exist and are distinct.' }, { status: 404 });
		}

		return json({
			success: true,
			preview
		});
	} catch (err: any) {
		console.error('Merge preview error:', err);
		return json({ error: err.message || 'Failed to preview merge' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { type, action } = body;

		// Preview action
		if (action === 'preview' || type === 'preview') {
			const { targetAlbumId, sourceAlbumId } = body;
			if (!targetAlbumId || !sourceAlbumId) {
				return json({ error: 'targetAlbumId and sourceAlbumId are required' }, { status: 400 });
			}
			const preview = previewVaultAlbumsMerge(Number(targetAlbumId), Number(sourceAlbumId));
			if (!preview) {
				return json({ error: 'Could not load preview. Ensure both albums exist and are distinct.' }, { status: 404 });
			}
			return json({ success: true, preview });
		}

		if (type === 'into_vault') {
			const { targetAlbumId, tracks, scannedAlbumKey, overwriteTags, sourceAlbumId, coverUrl, musicbrainzId } = body;
			if (!targetAlbumId) {
				return json({ error: 'targetAlbumId is required' }, { status: 400 });
			}

			let tracksToMerge: ScannedTrack[] = tracks || [];

			if (tracksToMerge.length === 0 && scannedAlbumKey) {
				const scanResult = await scanLibraryDirectory();
				const scannedAlbum = scanResult.albums.find((a) => a.album_key === scannedAlbumKey);
				if (scannedAlbum) {
					tracksToMerge = scannedAlbum.tracks;
				}
			}

			if (tracksToMerge.length === 0) {
				return json({ error: 'No tracks provided or found for merge' }, { status: 400 });
			}

			const result = mergeScannedTracksIntoVaultAlbum(Number(targetAlbumId), tracksToMerge, {
				overwriteTags: !!overwriteTags,
				sourceAlbumId: sourceAlbumId ? Number(sourceAlbumId) : null,
				coverUrl: coverUrl || null,
				musicbrainzId: musicbrainzId || null
			});
			if (!result) {
				return json({ error: 'Target album not found in Vault' }, { status: 404 });
			}

			invalidateScanCache();
			return json({
				success: true,
				albumId: Number(targetAlbumId),
				upgradedCount: result.upgradedCount,
				addedCount: result.addedCount,
				message: `Successfully merged ${result.upgradedCount} upgraded and ${result.addedCount} new tracks into "${result.album.title}".`
			});
		}

		if (type === 'scanned_albums') {
			const { sourceAlbumKey, targetAlbumKey } = body;
			if (!sourceAlbumKey || !targetAlbumKey) {
				return json({ error: 'sourceAlbumKey and targetAlbumKey are required' }, { status: 400 });
			}

			const merged = mergeScannedAlbumsInCache(sourceAlbumKey, targetAlbumKey);
			if (!merged) {
				return json({ error: 'Could not find one or both scanned albums in cache' }, { status: 404 });
			}

			return json({
				success: true,
				mergedAlbum: merged,
				message: `Successfully merged scanned albums into "${merged.title}".`
			});
		}

		if (type === 'vault_albums') {
			const { targetAlbumId, sourceAlbumId, options, customTracks } = body;
			if (!targetAlbumId || !sourceAlbumId) {
				return json({ error: 'targetAlbumId and sourceAlbumId are required' }, { status: 400 });
			}

			const result = mergeVaultAlbums(Number(targetAlbumId), Number(sourceAlbumId), {
				keepMetadataFrom: options?.keepMetadataFrom || 'primary',
				customTracks
			});
			if (!result) {
				return json({ error: 'Could not find one or both albums in Vault' }, { status: 404 });
			}

			invalidateScanCache();
			return json({
				success: true,
				albumId: Number(targetAlbumId),
				mergedCount: result.mergedCount,
				addedCount: result.addedCount,
				upgradedCount: result.upgradedCount,
				message: `Successfully merged albums into "${result.album.title}". Added ${result.addedCount} new tracks and upgraded ${result.upgradedCount} tracks.`
			});
		}

		return json({ error: 'Invalid merge type. Must be "into_vault", "scanned_albums", or "vault_albums"' }, { status: 400 });
	} catch (err: any) {
		console.error('Merge error:', err);
		return json({ error: err.message || 'Failed to merge albums' }, { status: 500 });
	}
};
