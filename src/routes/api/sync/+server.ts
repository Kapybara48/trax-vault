import { json, type RequestEvent } from '@sveltejs/kit';
import {
	getSyncSnapshotForDevice,
	listPublicRooms,
	updateRoomPlaybackState,
	setDeviceAudioMode,
	setDeviceStandaloneMode,
	syncWithTargetDevice,
	renameDevice,
	createSharedRoom,
	joinSharedRoom,
	leaveSharedRoom,
	updateSharedRoomSettings
} from '$lib/server/sync.js';

export const GET = async ({ url, locals }: RequestEvent) => {
	const user = locals.user;
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const deviceId = (url.searchParams.get('deviceId') || '').trim();
	if (!deviceId) {
		return json({
			serverNowMs: Date.now(),
			publicRooms: listPublicRooms()
		});
	}

	return json(getSyncSnapshotForDevice(deviceId, user.id, user.username));
};

export const POST = async ({ request, locals }: RequestEvent) => {
	const user = locals.user;
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON request body' }, { status: 400 });
	}

	const action = String(body?.action || '').trim();
	const deviceId = String(body?.deviceId || '').trim();
	const deviceName = typeof body?.deviceName === 'string' ? body.deviceName.trim() : undefined;

	if (!deviceId) {
		return json({ error: 'Missing deviceId' }, { status: 400 });
	}

	switch (action) {
		case 'update_state': {
			const res = updateRoomPlaybackState({
				deviceId,
				deviceName,
				userId: user.id,
				username: user.username,
				partialState: body.state || {},
				activateLocalAudioIfNone: body.activateLocalAudioIfNone
			});
			if (!res.ok) {
				return json({ error: res.error, ...res }, { status: 403 });
			}
			return json({ ...res, serverNowMs: Date.now() });
		}

		case 'set_device_audio': {
			const res = setDeviceAudioMode({
				deviceId,
				targetDeviceId: typeof body.targetDeviceId === 'string' ? body.targetDeviceId : undefined,
				userId: user.id,
				username: user.username,
				isAudioOutput: Boolean(body.isAudioOutput),
				exclusive: Boolean(body.exclusive)
			});
			return json({ ...res, serverNowMs: Date.now() });
		}

		case 'set_device_standalone': {
			const res = setDeviceStandaloneMode({
				deviceId,
				targetDeviceId: typeof body.targetDeviceId === 'string' ? body.targetDeviceId : undefined,
				userId: user.id,
				username: user.username,
				isStandalone: Boolean(body.isStandalone)
			});
			return json({ ...res, serverNowMs: Date.now() });
		}

		case 'sync_with_device': {
			const targetDeviceId = String(body.targetDeviceId || '').trim();
			if (!targetDeviceId) {
				return json({ error: 'Missing targetDeviceId' }, { status: 400 });
			}
			const res = syncWithTargetDevice({
				deviceId,
				targetDeviceId,
				userId: user.id,
				username: user.username,
				audioOutputOnCaller:
					typeof body.audioOutputOnCaller === 'boolean' ? body.audioOutputOnCaller : undefined
			});
			return json({ ...res, serverNowMs: Date.now() });
		}

		case 'rename_device': {
			const res = renameDevice({
				deviceId,
				deviceName: String(body.deviceName || ''),
				userId: user.id,
				username: user.username
			});
			return json({ ...res, serverNowMs: Date.now() });
		}

		case 'create_room': {
			const res = createSharedRoom({
				deviceId,
				deviceName,
				userId: user.id,
				username: user.username,
				roomName: typeof body.roomName === 'string' ? body.roomName : undefined,
				isPublic: body.isPublic !== undefined ? Boolean(body.isPublic) : true,
				allowGuestControl:
					body.allowGuestControl !== undefined ? Boolean(body.allowGuestControl) : true,
				initialState: body.initialState
			});
			return json({ ...res, serverNowMs: Date.now(), publicRooms: listPublicRooms() });
		}

		case 'join_room': {
			const roomCode = String(body.roomCode || '').trim();
			if (!roomCode) {
				return json({ error: 'Please enter a 6-character room code.' }, { status: 400 });
			}
			const res = joinSharedRoom({
				deviceId,
				deviceName,
				userId: user.id,
				username: user.username,
				roomCode
			});
			if (!res.ok) {
				return json({ error: res.error }, { status: 404 });
			}
			return json({ ...res, serverNowMs: Date.now(), publicRooms: listPublicRooms() });
		}

		case 'leave_room': {
			const res = leaveSharedRoom({
				deviceId,
				userId: user.id,
				username: user.username
			});
			return json({ ...res, serverNowMs: Date.now(), publicRooms: listPublicRooms() });
		}

		case 'update_room_settings': {
			const res = updateSharedRoomSettings({
				deviceId,
				userId: user.id,
				username: user.username,
				isPublic: typeof body.isPublic === 'boolean' ? body.isPublic : undefined,
				allowGuestControl:
					typeof body.allowGuestControl === 'boolean' ? body.allowGuestControl : undefined,
				name: typeof body.name === 'string' ? body.name : undefined
			});
			if (!res.ok) {
				return json({ error: res.error }, { status: 403 });
			}
			return json({ ...res, serverNowMs: Date.now(), publicRooms: listPublicRooms() });
		}

		default:
			return json({ error: `Unknown sync action: "${action}"` }, { status: 400 });
	}
};
