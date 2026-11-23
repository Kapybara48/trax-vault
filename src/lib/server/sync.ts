import crypto from 'node:crypto';
import type { Track } from '$lib/types/index.js';

export interface SyncAlbumMeta {
	id?: number;
	title: string;
	artist: string;
	cover_url: string | null;
}

export interface SyncPlaybackState {
	currentTrack: Track | null;
	currentAlbum: SyncAlbumMeta | null;
	activeQueue: Track[];
	queueIndex: number;
	isPlaying: boolean;
	positionSec: number;
	durationSec: number;
	shuffleEnabled: boolean;
	repeatMode: 'off' | 'all' | 'one';
	updatedAtServerMs: number;
	updatedByDeviceId: string | null;
	updatedByUsername: string | null;
}

export interface SyncDeviceInfo {
	deviceId: string;
	deviceName: string;
	userId: number;
	username: string;
	isAudioOutput: boolean;
	isStandalone: boolean;
	standaloneTrackTitle: string | null;
	standaloneTrackArtist: string | null;
	standaloneIsPlaying: boolean;
	connectedAtMs: number;
	lastSeenMs: number;
}

export interface SyncRoomSummary {
	id: string;
	type: 'personal' | 'shared';
	code: string | null;
	name: string;
	hostUserId: number;
	hostUsername: string;
	isPublic: boolean;
	allowGuestControl: boolean;
	listenerCount: number;
	currentTrackTitle: string | null;
	currentTrackArtist: string | null;
	currentCoverUrl: string | null;
	isPlaying: boolean;
}

interface SseConnection {
	connectionId: string;
	deviceId: string;
	userId: number;
	username: string;
	controller: ReadableStreamDefaultController<Uint8Array>;
}

interface SyncRoom {
	id: string;
	type: 'personal' | 'shared';
	code: string | null;
	name: string;
	hostUserId: number;
	hostUsername: string;
	isPublic: boolean;
	allowGuestControl: boolean;
	createdAtMs: number;
	lastActivityMs: number;
	state: SyncPlaybackState;
	devices: Map<string, SyncDeviceInfo>;
	deviceAudioPrefs: Map<string, boolean>;
	deviceStandalonePrefs: Map<string, boolean>;
	deviceLastStates: Map<string, SyncPlaybackState>;
	connections: Map<string, SseConnection>;
}

const encoder = new TextEncoder();

// Active rooms indexed by room.id ("user:<id>" or "room:<CODE>")
const rooms = new Map<string, SyncRoom>();

// Shared room code lookup ("VAULT7" -> "room:VAULT7")
const roomCodeIndex = new Map<string, string>();

// Maps deviceId -> current roomId (if assigned to a shared room)
const deviceRoomAssignments = new Map<string, string>();

// Maps deviceId -> user-configured friendly device name
const deviceNameRegistry = new Map<string, string>();

function createEmptyPlaybackState(): SyncPlaybackState {
	return {
		currentTrack: null,
		currentAlbum: null,
		activeQueue: [],
		queueIndex: -1,
		isPlaying: false,
		positionSec: 0,
		durationSec: 0,
		shuffleEnabled: false,
		repeatMode: 'off',
		updatedAtServerMs: Date.now(),
		updatedByDeviceId: null,
		updatedByUsername: null
	};
}

/**
 * Computes the live playback position of a playback state accounting for elapsed time while playing.
 */
export function getEffectivePositionSec(state: SyncPlaybackState, nowMs = Date.now()): number {
	if (!state.currentTrack) return 0;
	if (!state.isPlaying) return Math.max(0, state.positionSec);
	const elapsedSec = Math.max(0, (nowMs - state.updatedAtServerMs) / 1000);
	const nextPos = state.positionSec + elapsedSec;
	if (state.durationSec > 0) {
		return Math.min(state.durationSec, nextPos);
	}
	return nextPos;
}

function generateRoomCode(): string {
	const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	for (let attempt = 0; attempt < 25; attempt++) {
		let code = '';
		const bytes = crypto.randomBytes(6);
		for (let i = 0; i < 6; i++) {
			code += alphabet[bytes[i] % alphabet.length];
		}
		if (!roomCodeIndex.has(code)) {
			return code;
		}
	}
	return crypto.randomBytes(3).toString('hex').toUpperCase();
}

export function getOrCreatePersonalRoom(userId: number, username: string): SyncRoom {
	const roomId = `user:${userId}`;
	let room = rooms.get(roomId);
	if (!room) {
		room = {
			id: roomId,
			type: 'personal',
			code: null,
			name: `${username}'s Devices`,
			hostUserId: userId,
			hostUsername: username,
			isPublic: false,
			allowGuestControl: true,
			createdAtMs: Date.now(),
			lastActivityMs: Date.now(),
			state: createEmptyPlaybackState(),
			devices: new Map(),
			deviceAudioPrefs: new Map(),
			deviceStandalonePrefs: new Map(),
			deviceLastStates: new Map(),
			connections: new Map()
		};
		rooms.set(roomId, room);
	}
	return room;
}

export function getActiveRoomForDevice(deviceId: string, userId: number, username: string): SyncRoom {
	const assignedRoomId = deviceRoomAssignments.get(deviceId);
	if (assignedRoomId) {
		const sharedRoom = rooms.get(assignedRoomId);
		if (sharedRoom) {
			return sharedRoom;
		}
		deviceRoomAssignments.delete(deviceId);
	}
	return getOrCreatePersonalRoom(userId, username);
}

export function serializeRoomSummary(room: SyncRoom): SyncRoomSummary {
	return {
		id: room.id,
		type: room.type,
		code: room.code,
		name: room.name,
		hostUserId: room.hostUserId,
		hostUsername: room.hostUsername,
		isPublic: room.isPublic,
		allowGuestControl: room.allowGuestControl,
		listenerCount: room.devices.size,
		currentTrackTitle: room.state.currentTrack?.title ?? null,
		currentTrackArtist:
			room.state.currentTrack?.artist ?? room.state.currentAlbum?.artist ?? null,
		currentCoverUrl: room.state.currentAlbum?.cover_url ?? null,
		isPlaying: room.state.isPlaying
	};
}

export function serializeDevices(room: SyncRoom): SyncDeviceInfo[] {
	return Array.from(room.devices.values()).sort((a, b) => a.connectedAtMs - b.connectedAtMs);
}

export function listPublicRooms(): SyncRoomSummary[] {
	const list: SyncRoomSummary[] = [];
	for (const room of rooms.values()) {
		if (room.type === 'shared' && room.isPublic) {
			list.push(serializeRoomSummary(room));
		}
	}
	return list.sort((a, b) => b.listenerCount - a.listenerCount);
}

function sendSseEvent(
	controller: ReadableStreamDefaultController<Uint8Array>,
	event: string,
	data: unknown
): boolean {
	try {
		const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
		controller.enqueue(encoder.encode(payload));
		return true;
	} catch {
		return false;
	}
}

function broadcastToRoom(
	room: SyncRoom,
	event: string,
	data: unknown,
	options?: { skipStandaloneDevices?: boolean }
): void {
	const nowMs = Date.now();
	const deadConnectionIds: string[] = [];

	for (const [connId, conn] of room.connections.entries()) {
		if (options?.skipStandaloneDevices) {
			const dev = room.devices.get(conn.deviceId);
			if (dev?.isStandalone) {
				continue;
			}
		}

		const payload = {
			...(typeof data === 'object' && data !== null ? data : { value: data }),
			serverNowMs: nowMs
		};
		const ok = sendSseEvent(conn.controller, event, payload);
		if (!ok) {
			deadConnectionIds.push(connId);
		}
	}

	for (const connId of deadConnectionIds) {
		removeConnectionFromRoom(room, connId);
	}
}

function broadcastLobbyUpdateToAll(): void {
	const publicRooms = listPublicRooms();
	const nowMs = Date.now();
	for (const room of rooms.values()) {
		for (const conn of room.connections.values()) {
			sendSseEvent(conn.controller, 'lobby_updated', {
				publicRooms,
				serverNowMs: nowMs
			});
		}
	}
}

function sendWelcomeToConnection(room: SyncRoom, conn: SseConnection): void {
	const device = room.devices.get(conn.deviceId);
	const isStandalone = device ? device.isStandalone : false;
	sendSseEvent(conn.controller, 'welcome', {
		serverNowMs: Date.now(),
		room: serializeRoomSummary(room),
		state: isStandalone ? null : room.state,
		devices: serializeDevices(room),
		myDeviceId: conn.deviceId,
		myAudioOutput: device ? device.isAudioOutput : true,
		myStandalone: isStandalone,
		publicRooms: listPublicRooms()
	});
}

function determineDefaultAudioOutput(room: SyncRoom, deviceId: string, isStandalone: boolean): boolean {
	if (isStandalone) {
		return true;
	}
	if (room.deviceAudioPrefs.has(deviceId)) {
		return room.deviceAudioPrefs.get(deviceId)!;
	}
	// When joining a shared "Listen Together" room, default to playing audio together
	if (room.type === 'shared') {
		return true;
	}
	// In a personal room, if another connected non-standalone device is already acting as an active speaker
	// with a loaded/playing track, default this secondary device to Companion / Lyrics Remote mode.
	let anotherSyncedDeviceHasAudio = false;
	for (const [otherId, dev] of room.devices.entries()) {
		if (otherId !== deviceId && !dev.isStandalone && dev.isAudioOutput) {
			anotherSyncedDeviceHasAudio = true;
			break;
		}
	}
	if (anotherSyncedDeviceHasAudio && room.state.currentTrack !== null) {
		return false;
	}
	return true;
}

function ensureDeviceInRoom(
	room: SyncRoom,
	deviceId: string,
	deviceName: string,
	userId: number,
	username: string,
	initialStandalone?: boolean
): SyncDeviceInfo {
	const cleanName =
		deviceName.trim() || deviceNameRegistry.get(deviceId) || `${username}'s Device`;
	deviceNameRegistry.set(deviceId, cleanName);

	if (typeof initialStandalone === 'boolean' && !room.deviceStandalonePrefs.has(deviceId)) {
		room.deviceStandalonePrefs.set(deviceId, initialStandalone);
	}

	const isStandalone =
		room.type === 'shared' ? false : (room.deviceStandalonePrefs.get(deviceId) ?? false);

	const nowMs = Date.now();
	let device = room.devices.get(deviceId);
	if (!device) {
		const isAudioOutput = determineDefaultAudioOutput(room, deviceId, isStandalone);
		room.deviceAudioPrefs.set(deviceId, isAudioOutput);
		const lastDevState = room.deviceLastStates.get(deviceId);
		device = {
			deviceId,
			deviceName: cleanName,
			userId,
			username,
			isAudioOutput,
			isStandalone,
			standaloneTrackTitle: lastDevState?.currentTrack?.title ?? null,
			standaloneTrackArtist:
				lastDevState?.currentTrack?.artist ?? lastDevState?.currentAlbum?.artist ?? null,
			standaloneIsPlaying: lastDevState?.isPlaying ?? false,
			connectedAtMs: nowMs,
			lastSeenMs: nowMs
		};
		room.devices.set(deviceId, device);
	} else {
		device.deviceName = cleanName;
		device.userId = userId;
		device.username = username;
		device.isStandalone = isStandalone;
		device.lastSeenMs = nowMs;
	}
	return device;
}

function removeConnectionFromRoom(room: SyncRoom, connectionId: string): void {
	const conn = room.connections.get(connectionId);
	if (!conn) return;
	room.connections.delete(connectionId);

	// Check if there are any other open SSE connections for the same deviceId in this room
	let hasOtherConnForDevice = false;
	for (const other of room.connections.values()) {
		if (other.deviceId === conn.deviceId) {
			hasOtherConnForDevice = true;
			break;
		}
	}

	if (!hasOtherConnForDevice) {
		room.devices.delete(conn.deviceId);
		broadcastToRoom(room, 'devices_updated', {
			room: serializeRoomSummary(room),
			devices: serializeDevices(room)
		});
		if (room.type === 'shared' && room.isPublic) {
			broadcastLobbyUpdateToAll();
		}
	}
}

export function registerDeviceStream(params: {
	deviceId: string;
	deviceName: string;
	userId: number;
	username: string;
	roomCode?: string | null;
	standalone?: boolean;
	controller: ReadableStreamDefaultController<Uint8Array>;
}): () => void {
	const { deviceId, deviceName, userId, username, roomCode, standalone, controller } = params;

	if (roomCode) {
		const normalizedCode = roomCode.trim().toUpperCase();
		const targetRoomId = roomCodeIndex.get(normalizedCode);
		if (targetRoomId && rooms.has(targetRoomId)) {
			deviceRoomAssignments.set(deviceId, targetRoomId);
		}
	}

	const room = getActiveRoomForDevice(deviceId, userId, username);
	ensureDeviceInRoom(room, deviceId, deviceName, userId, username, standalone);

	const connectionId = crypto.randomUUID();
	const conn: SseConnection = {
		connectionId,
		deviceId,
		userId,
		username,
		controller
	};
	room.connections.set(connectionId, conn);
	room.lastActivityMs = Date.now();

	// Send initial welcome snapshot to this connection
	sendWelcomeToConnection(room, conn);

	// Notify other devices in the room
	broadcastToRoom(room, 'devices_updated', {
		room: serializeRoomSummary(room),
		devices: serializeDevices(room)
	});

	if (room.type === 'shared' && room.isPublic) {
		broadcastLobbyUpdateToAll();
	}

	return () => {
		const currentRoom = getActiveRoomForDevice(deviceId, userId, username);
		removeConnectionFromRoom(currentRoom, connectionId);
		if (currentRoom.id !== room.id) {
			removeConnectionFromRoom(room, connectionId);
		}
	};
}

function moveDeviceToRoom(
	deviceId: string,
	userId: number,
	username: string,
	oldRoom: SyncRoom,
	newRoom: SyncRoom,
	defaultAudioOutput?: boolean
): void {
	const existingDevice = oldRoom.devices.get(deviceId);
	const deviceName =
		existingDevice?.deviceName || deviceNameRegistry.get(deviceId) || `${username}'s Device`;

	// Collect all active connections for this deviceId in oldRoom
	const movingConnections: SseConnection[] = [];
	for (const [connId, conn] of oldRoom.connections.entries()) {
		if (conn.deviceId === deviceId) {
			movingConnections.push(conn);
			oldRoom.connections.delete(connId);
		}
	}
	oldRoom.devices.delete(deviceId);

	// Notify remaining devices in oldRoom
	broadcastToRoom(oldRoom, 'devices_updated', {
		room: serializeRoomSummary(oldRoom),
		devices: serializeDevices(oldRoom)
	});

	if (typeof defaultAudioOutput === 'boolean') {
		newRoom.deviceAudioPrefs.set(deviceId, defaultAudioOutput);
	}
	if (newRoom.type === 'shared') {
		newRoom.deviceStandalonePrefs.set(deviceId, false);
	}

	ensureDeviceInRoom(newRoom, deviceId, deviceName, userId, username);
	for (const conn of movingConnections) {
		newRoom.connections.set(conn.connectionId, conn);
		sendWelcomeToConnection(newRoom, conn);
	}

	broadcastToRoom(newRoom, 'devices_updated', {
		room: serializeRoomSummary(newRoom),
		devices: serializeDevices(newRoom)
	});

	broadcastLobbyUpdateToAll();
}

export function updateRoomPlaybackState(params: {
	deviceId: string;
	deviceName?: string;
	userId: number;
	username: string;
	partialState: Partial<SyncPlaybackState>;
	activateLocalAudioIfNone?: boolean;
}): {
	ok: boolean;
	error?: string;
	room: SyncRoomSummary;
	state: SyncPlaybackState;
	devices: SyncDeviceInfo[];
} {
	const { deviceId, deviceName, userId, username, partialState, activateLocalAudioIfNone } =
		params;
	const room = getActiveRoomForDevice(deviceId, userId, username);

	const dev = ensureDeviceInRoom(
		room,
		deviceId,
		deviceName || deviceNameRegistry.get(deviceId) || `${username}'s Device`,
		userId,
		username
	);

	const nowMs = Date.now();
	const prevDevState = room.deviceLastStates.get(deviceId) || room.state;

	let devPositionSec =
		typeof partialState.positionSec === 'number'
			? Math.max(0, partialState.positionSec)
			: getEffectivePositionSec(prevDevState, nowMs);

	if (
		partialState.currentTrack !== undefined &&
		partialState.currentTrack?.id !== prevDevState.currentTrack?.id &&
		typeof partialState.positionSec !== 'number'
	) {
		devPositionSec = 0;
	}

	const nextDevState: SyncPlaybackState = {
		currentTrack:
			partialState.currentTrack !== undefined
				? partialState.currentTrack
				: prevDevState.currentTrack,
		currentAlbum:
			partialState.currentAlbum !== undefined
				? partialState.currentAlbum
				: prevDevState.currentAlbum,
		activeQueue:
			partialState.activeQueue !== undefined ? partialState.activeQueue : prevDevState.activeQueue,
		queueIndex:
			typeof partialState.queueIndex === 'number'
				? partialState.queueIndex
				: prevDevState.queueIndex,
		isPlaying:
			typeof partialState.isPlaying === 'boolean'
				? partialState.isPlaying
				: prevDevState.isPlaying,
		positionSec: devPositionSec,
		durationSec:
			typeof partialState.durationSec === 'number'
				? partialState.durationSec
				: prevDevState.durationSec,
		shuffleEnabled:
			typeof partialState.shuffleEnabled === 'boolean'
				? partialState.shuffleEnabled
				: prevDevState.shuffleEnabled,
		repeatMode:
			partialState.repeatMode !== undefined ? partialState.repeatMode : prevDevState.repeatMode,
		updatedAtServerMs: nowMs,
		updatedByDeviceId: deviceId,
		updatedByUsername: username
	};

	room.deviceLastStates.set(deviceId, nextDevState);

	const prevTrackTitle = dev.standaloneTrackTitle;
	const prevIsPlaying = dev.standaloneIsPlaying;
	dev.standaloneTrackTitle = nextDevState.currentTrack?.title ?? null;
	dev.standaloneTrackArtist =
		nextDevState.currentTrack?.artist ?? nextDevState.currentAlbum?.artist ?? null;
	dev.standaloneIsPlaying = nextDevState.isPlaying;

	// If this device is in Standalone ("On Its Own") mode, do NOT overwrite room.state
	// or broadcast playback state to other synced devices!
	if (dev.isStandalone) {
		if (prevTrackTitle !== dev.standaloneTrackTitle || prevIsPlaying !== dev.standaloneIsPlaying) {
			broadcastToRoom(room, 'devices_updated', {
				room: serializeRoomSummary(room),
				devices: serializeDevices(room)
			});
		}
		return {
			ok: true,
			room: serializeRoomSummary(room),
			state: nextDevState,
			devices: serializeDevices(room)
		};
	}

	if (room.type === 'shared' && !room.allowGuestControl && room.hostUserId !== userId) {
		return {
			ok: false,
			error: 'Only the session host can control playback in this room.',
			room: serializeRoomSummary(room),
			state: room.state,
			devices: serializeDevices(room)
		};
	}

	const prevState = room.state;

	let nextPositionSec =
		typeof partialState.positionSec === 'number'
			? Math.max(0, partialState.positionSec)
			: getEffectivePositionSec(prevState, nowMs);

	if (
		partialState.currentTrack !== undefined &&
		partialState.currentTrack?.id !== prevState.currentTrack?.id &&
		typeof partialState.positionSec !== 'number'
	) {
		nextPositionSec = 0;
	}

	room.state = {
		currentTrack:
			partialState.currentTrack !== undefined ? partialState.currentTrack : prevState.currentTrack,
		currentAlbum:
			partialState.currentAlbum !== undefined ? partialState.currentAlbum : prevState.currentAlbum,
		activeQueue:
			partialState.activeQueue !== undefined ? partialState.activeQueue : prevState.activeQueue,
		queueIndex:
			typeof partialState.queueIndex === 'number' ? partialState.queueIndex : prevState.queueIndex,
		isPlaying:
			typeof partialState.isPlaying === 'boolean' ? partialState.isPlaying : prevState.isPlaying,
		positionSec: nextPositionSec,
		durationSec:
			typeof partialState.durationSec === 'number'
				? partialState.durationSec
				: prevState.durationSec,
		shuffleEnabled:
			typeof partialState.shuffleEnabled === 'boolean'
				? partialState.shuffleEnabled
				: prevState.shuffleEnabled,
		repeatMode:
			partialState.repeatMode !== undefined ? partialState.repeatMode : prevState.repeatMode,
		updatedAtServerMs: nowMs,
		updatedByDeviceId: deviceId,
		updatedByUsername: username
	};
	room.lastActivityMs = nowMs;

	// If playback starts in the synced group and NO synced device has isAudioOutput=true,
	// enable audio output on the device that triggered playback so music is audible.
	if (room.state.isPlaying && activateLocalAudioIfNone !== false) {
		let anySyncedAudioOutput = false;
		for (const d of room.devices.values()) {
			if (!d.isStandalone && d.isAudioOutput) {
				anySyncedAudioOutput = true;
				break;
			}
		}
		if (!anySyncedAudioOutput) {
			dev.isAudioOutput = true;
			room.deviceAudioPrefs.set(deviceId, true);
			broadcastToRoom(room, 'devices_updated', {
				room: serializeRoomSummary(room),
				devices: serializeDevices(room)
			});
		}
	}

	broadcastToRoom(
		room,
		'state_updated',
		{
			room: serializeRoomSummary(room),
			state: room.state
		},
		{ skipStandaloneDevices: true }
	);

	if (room.type === 'shared' && room.isPublic) {
		broadcastLobbyUpdateToAll();
	}

	return {
		ok: true,
		room: serializeRoomSummary(room),
		state: room.state,
		devices: serializeDevices(room)
	};
}

export function setDeviceAudioMode(params: {
	deviceId: string;
	targetDeviceId?: string;
	userId: number;
	username: string;
	isAudioOutput: boolean;
	exclusive?: boolean;
}): {
	ok: boolean;
	error?: string;
	room: SyncRoomSummary;
	devices: SyncDeviceInfo[];
	state: SyncPlaybackState;
} {
	const { deviceId, targetDeviceId, userId, username, isAudioOutput, exclusive } = params;
	const room = getActiveRoomForDevice(deviceId, userId, username);
	const effectiveTargetId = targetDeviceId || deviceId;

	// Selecting a synced audio mode (Companion, Transfer Here, or Play on Multiple)
	// ensures this device is in the Synced Group (isStandalone = false).
	// If targeting another device, ensure the target does NOT have Live Sync turned off!
	const targetDev = room.devices.get(effectiveTargetId);
	if (effectiveTargetId !== deviceId && targetDev?.isStandalone) {
		return {
			ok: false,
			error: 'Target device has Live Sync turned off.',
			room: serializeRoomSummary(room),
			devices: serializeDevices(room),
			state: room.state
		};
	}

	const wasStandalone = targetDev?.isStandalone ?? false;
	if (effectiveTargetId === deviceId) {
		if (targetDev) {
			targetDev.isStandalone = false;
		}
		room.deviceStandalonePrefs.set(effectiveTargetId, false);
	}

	// If the synced room had no active track yet, or if the user transferred playback to a device
	// that was playing its own standalone track, adopt its track if room is empty
	if (wasStandalone && !room.state.currentTrack) {
		const devState = room.deviceLastStates.get(effectiveTargetId);
		if (devState && devState.currentTrack) {
			room.state = {
				...devState,
				positionSec: getEffectivePositionSec(devState),
				updatedAtServerMs: Date.now()
			};
		}
	}

	if (exclusive && isAudioOutput) {
		// Transfer playback exclusively to effectiveTargetId among non-standalone devices
		for (const [id, dev] of room.devices.entries()) {
			if (dev.isStandalone) continue;
			if (room.type === 'personal' || dev.userId === userId) {
				const shouldPlay = id === effectiveTargetId;
				dev.isAudioOutput = shouldPlay;
				room.deviceAudioPrefs.set(id, shouldPlay);
			}
		}
	} else {
		if (targetDev) {
			targetDev.isAudioOutput = isAudioOutput;
		}
		room.deviceAudioPrefs.set(effectiveTargetId, isAudioOutput);
	}

	const freshState: SyncPlaybackState = {
		...room.state,
		positionSec: getEffectivePositionSec(room.state),
		updatedAtServerMs: Date.now()
	};
	room.state = freshState;

	broadcastToRoom(room, 'devices_updated', {
		room: serializeRoomSummary(room),
		devices: serializeDevices(room),
		state: freshState
	});

	return {
		ok: true,
		room: serializeRoomSummary(room),
		devices: serializeDevices(room),
		state: freshState
	};
}

export function setDeviceStandaloneMode(params: {
	deviceId: string;
	targetDeviceId?: string;
	userId: number;
	username: string;
	isStandalone: boolean;
}): {
	ok: boolean;
	error?: string;
	room: SyncRoomSummary;
	devices: SyncDeviceInfo[];
	state: SyncPlaybackState;
} {
	const { deviceId, targetDeviceId, userId, username, isStandalone } = params;
	const room = getActiveRoomForDevice(deviceId, userId, username);
	const effectiveTargetId = targetDeviceId || deviceId;

	if (targetDeviceId && targetDeviceId !== deviceId) {
		return {
			ok: false,
			error: 'A device cannot remotely change the Live Sync state of another device.',
			room: serializeRoomSummary(room),
			devices: serializeDevices(room),
			state: room.state
		};
	}

	room.deviceStandalonePrefs.set(effectiveTargetId, isStandalone);
	const targetDev = room.devices.get(effectiveTargetId);
	if (targetDev) {
		targetDev.isStandalone = isStandalone;
		if (isStandalone) {
			// When a device is on its own (Standalone), its local audio is always enabled
			targetDev.isAudioOutput = true;
			room.deviceAudioPrefs.set(effectiveTargetId, true);
		}
	}

	const freshState: SyncPlaybackState = {
		...room.state,
		positionSec: getEffectivePositionSec(room.state),
		updatedAtServerMs: Date.now()
	};
	room.state = freshState;

	// If bringing the device back into sync and room.state has no track, seed from device's last state
	if (!isStandalone && !room.state.currentTrack) {
		const devState = room.deviceLastStates.get(effectiveTargetId);
		if (devState && devState.currentTrack) {
			room.state = {
				...devState,
				positionSec: getEffectivePositionSec(devState),
				updatedAtServerMs: Date.now()
			};
		}
	}

	broadcastToRoom(room, 'devices_updated', {
		room: serializeRoomSummary(room),
		devices: serializeDevices(room),
		state: room.state
	});

	if (!isStandalone) {
		broadcastToRoom(
			room,
			'state_updated',
			{
				room: serializeRoomSummary(room),
				state: room.state
			},
			{ skipStandaloneDevices: true }
		);
	}

	return {
		ok: true,
		room: serializeRoomSummary(room),
		devices: serializeDevices(room),
		state: room.state
	};
}

export function syncWithTargetDevice(params: {
	deviceId: string;
	targetDeviceId: string;
	userId: number;
	username: string;
	audioOutputOnCaller?: boolean;
}): {
	ok: boolean;
	room: SyncRoomSummary;
	devices: SyncDeviceInfo[];
	state: SyncPlaybackState;
} {
	const { deviceId, targetDeviceId, userId, username, audioOutputOnCaller } = params;
	const room = getActiveRoomForDevice(deviceId, userId, username);
	const nowMs = Date.now();

	// Turn on sync for the CALLER device (deviceId)
	room.deviceStandalonePrefs.set(deviceId, false);
	const callerDev = room.devices.get(deviceId);
	if (callerDev) {
		callerDev.isStandalone = false;
	}

	// Target device: If targetDeviceId has Live Sync turned off (isStandalone),
	// DO NOT force it into sync! The target device remains in its own mode undisturbed.
	const targetDev = room.devices.get(targetDeviceId);
	if (targetDev && !targetDev.isStandalone) {
		targetDev.isAudioOutput = true;
		room.deviceAudioPrefs.set(targetDeviceId, true);
	}

	// Configure caller device audio mode (if specified)
	if (typeof audioOutputOnCaller === 'boolean' && deviceId !== targetDeviceId) {
		const callerDev = room.devices.get(deviceId);
		if (callerDev) {
			callerDev.isAudioOutput = audioOutputOnCaller;
		}
		room.deviceAudioPrefs.set(deviceId, audioOutputOnCaller);
	}

	// Adopt targetDeviceId's active playback state as the room's synced playback state
	const targetState = room.deviceLastStates.get(targetDeviceId);
	if (targetState && targetState.currentTrack) {
		room.state = {
			...targetState,
			positionSec: getEffectivePositionSec(targetState, nowMs),
			updatedAtServerMs: nowMs,
			updatedByDeviceId: targetDeviceId
		};
	} else {
		room.state = {
			...room.state,
			positionSec: getEffectivePositionSec(room.state, nowMs),
			updatedAtServerMs: nowMs
		};
	}

	broadcastToRoom(room, 'devices_updated', {
		room: serializeRoomSummary(room),
		devices: serializeDevices(room),
		state: room.state
	});

	broadcastToRoom(
		room,
		'state_updated',
		{
			room: serializeRoomSummary(room),
			state: room.state
		},
		{ skipStandaloneDevices: true }
	);

	return {
		ok: true,
		room: serializeRoomSummary(room),
		devices: serializeDevices(room),
		state: room.state
	};
}

export function renameDevice(params: {
	deviceId: string;
	deviceName: string;
	userId: number;
	username: string;
}): {
	ok: boolean;
	devices: SyncDeviceInfo[];
} {
	const { deviceId, deviceName, userId, username } = params;
	const clean = deviceName.trim().slice(0, 50) || `${username}'s Device`;
	deviceNameRegistry.set(deviceId, clean);

	const room = getActiveRoomForDevice(deviceId, userId, username);
	const dev = room.devices.get(deviceId);
	if (dev) {
		dev.deviceName = clean;
	}

	broadcastToRoom(room, 'devices_updated', {
		room: serializeRoomSummary(room),
		devices: serializeDevices(room)
	});

	return {
		ok: true,
		devices: serializeDevices(room)
	};
}

export function createSharedRoom(params: {
	deviceId: string;
	deviceName?: string;
	userId: number;
	username: string;
	roomName?: string;
	isPublic?: boolean;
	allowGuestControl?: boolean;
	initialState?: Partial<SyncPlaybackState>;
}): {
	ok: boolean;
	room: SyncRoomSummary;
	state: SyncPlaybackState;
	devices: SyncDeviceInfo[];
} {
	const {
		deviceId,
		deviceName,
		userId,
		username,
		roomName,
		isPublic = true,
		allowGuestControl = true,
		initialState
	} = params;

	const oldRoom = getActiveRoomForDevice(deviceId, userId, username);
	const code = generateRoomCode();
	const roomId = `room:${code}`;
	const nowMs = Date.now();

	const baseState = oldRoom.state.currentTrack ? { ...oldRoom.state } : createEmptyPlaybackState();
	const state: SyncPlaybackState = {
		currentTrack:
			initialState?.currentTrack !== undefined
				? initialState.currentTrack
				: baseState.currentTrack,
		currentAlbum:
			initialState?.currentAlbum !== undefined
				? initialState.currentAlbum
				: baseState.currentAlbum,
		activeQueue:
			initialState?.activeQueue !== undefined ? initialState.activeQueue : baseState.activeQueue,
		queueIndex:
			typeof initialState?.queueIndex === 'number'
				? initialState.queueIndex
				: baseState.queueIndex,
		isPlaying:
			typeof initialState?.isPlaying === 'boolean' ? initialState.isPlaying : baseState.isPlaying,
		positionSec:
			typeof initialState?.positionSec === 'number'
				? initialState.positionSec
				: getEffectivePositionSec(baseState, nowMs),
		durationSec:
			typeof initialState?.durationSec === 'number'
				? initialState.durationSec
				: baseState.durationSec,
		shuffleEnabled:
			typeof initialState?.shuffleEnabled === 'boolean'
				? initialState.shuffleEnabled
				: baseState.shuffleEnabled,
		repeatMode:
			initialState?.repeatMode !== undefined ? initialState.repeatMode : baseState.repeatMode,
		updatedAtServerMs: nowMs,
		updatedByDeviceId: deviceId,
		updatedByUsername: username
	};

	const newRoom: SyncRoom = {
		id: roomId,
		type: 'shared',
		code,
		name: (roomName || '').trim().slice(0, 60) || `${username}'s Jam Session`,
		hostUserId: userId,
		hostUsername: username,
		isPublic: Boolean(isPublic),
		allowGuestControl: Boolean(allowGuestControl),
		createdAtMs: nowMs,
		lastActivityMs: nowMs,
		state,
		devices: new Map(),
		deviceAudioPrefs: new Map(),
		deviceStandalonePrefs: new Map(),
		deviceLastStates: new Map(),
		connections: new Map()
	};

	rooms.set(roomId, newRoom);
	roomCodeIndex.set(code, roomId);
	deviceRoomAssignments.set(deviceId, roomId);

	if (deviceName) {
		deviceNameRegistry.set(deviceId, deviceName.trim());
	}

	moveDeviceToRoom(deviceId, userId, username, oldRoom, newRoom, true);

	return {
		ok: true,
		room: serializeRoomSummary(newRoom),
		state: newRoom.state,
		devices: serializeDevices(newRoom)
	};
}

export function joinSharedRoom(params: {
	deviceId: string;
	deviceName?: string;
	userId: number;
	username: string;
	roomCode: string;
}): {
	ok: boolean;
	error?: string;
	room?: SyncRoomSummary;
	state?: SyncPlaybackState;
	devices?: SyncDeviceInfo[];
} {
	const { deviceId, deviceName, userId, username, roomCode } = params;
	const cleanCode = roomCode.trim().toUpperCase();
	const targetRoomId = roomCodeIndex.get(cleanCode);
	if (!targetRoomId) {
		return { ok: false, error: `No active listening room found with code "${cleanCode}".` };
	}

	const targetRoom = rooms.get(targetRoomId);
	if (!targetRoom) {
		roomCodeIndex.delete(cleanCode);
		return { ok: false, error: `Listening room "${cleanCode}" is no longer active.` };
	}

	if (deviceName) {
		deviceNameRegistry.set(deviceId, deviceName.trim());
	}

	const oldRoom = getActiveRoomForDevice(deviceId, userId, username);
	deviceRoomAssignments.set(deviceId, targetRoom.id);

	targetRoom.state = {
		...targetRoom.state,
		positionSec: getEffectivePositionSec(targetRoom.state),
		updatedAtServerMs: Date.now()
	};

	if (oldRoom.id !== targetRoom.id) {
		moveDeviceToRoom(deviceId, userId, username, oldRoom, targetRoom, true);
	} else {
		targetRoom.deviceStandalonePrefs.set(deviceId, false);
		const d = ensureDeviceInRoom(
			targetRoom,
			deviceId,
			deviceName || `${username}'s Device`,
			userId,
			username,
			false
		);
		d.isStandalone = false;
	}

	return {
		ok: true,
		room: serializeRoomSummary(targetRoom),
		state: targetRoom.state,
		devices: serializeDevices(targetRoom)
	};
}

export function leaveSharedRoom(params: {
	deviceId: string;
	userId: number;
	username: string;
}): {
	ok: boolean;
	room: SyncRoomSummary;
	state: SyncPlaybackState;
	devices: SyncDeviceInfo[];
} {
	const { deviceId, userId, username } = params;
	const oldRoom = getActiveRoomForDevice(deviceId, userId, username);
	deviceRoomAssignments.delete(deviceId);

	const personalRoom = getOrCreatePersonalRoom(userId, username);
	if (oldRoom.id !== personalRoom.id) {
		moveDeviceToRoom(deviceId, userId, username, oldRoom, personalRoom, true);

		if (oldRoom.type === 'shared' && oldRoom.devices.size === 0) {
			if (oldRoom.code) roomCodeIndex.delete(oldRoom.code);
			rooms.delete(oldRoom.id);
			broadcastLobbyUpdateToAll();
		}
	}

	return {
		ok: true,
		room: serializeRoomSummary(personalRoom),
		state: personalRoom.state,
		devices: serializeDevices(personalRoom)
	};
}

export function updateSharedRoomSettings(params: {
	deviceId: string;
	userId: number;
	username: string;
	isPublic?: boolean;
	allowGuestControl?: boolean;
	name?: string;
}): {
	ok: boolean;
	error?: string;
	room: SyncRoomSummary;
} {
	const { deviceId, userId, username, isPublic, allowGuestControl, name } = params;
	const room = getActiveRoomForDevice(deviceId, userId, username);

	if (room.type !== 'shared') {
		return {
			ok: false,
			error: 'Cannot change shared room settings on a personal channel.',
			room: serializeRoomSummary(room)
		};
	}

	if (room.hostUserId !== userId) {
		return {
			ok: false,
			error: 'Only the room host can update room settings.',
			room: serializeRoomSummary(room)
		};
	}

	if (typeof isPublic === 'boolean') room.isPublic = isPublic;
	if (typeof allowGuestControl === 'boolean') room.allowGuestControl = allowGuestControl;
	if (typeof name === 'string' && name.trim()) room.name = name.trim().slice(0, 60);

	broadcastToRoom(room, 'room_updated', {
		room: serializeRoomSummary(room)
	});
	broadcastLobbyUpdateToAll();

	return {
		ok: true,
		room: serializeRoomSummary(room)
	};
}

export function getSyncSnapshotForDevice(deviceId: string, userId: number, username: string) {
	const room = getActiveRoomForDevice(deviceId, userId, username);
	const dev = room.devices.get(deviceId);
	return {
		serverNowMs: Date.now(),
		room: serializeRoomSummary(room),
		state: {
			...room.state,
			positionSec: getEffectivePositionSec(room.state),
			updatedAtServerMs: Date.now()
		},
		devices: serializeDevices(room),
		myDeviceId: deviceId,
		myAudioOutput: dev ? dev.isAudioOutput : true,
		myStandalone: dev ? dev.isStandalone : false,
		publicRooms: listPublicRooms()
	};
}

// Periodic keepalive comment & stale room cleanup every 15 seconds
const KEEPALIVE_INTERVAL_MS = 15_000;
const STALE_EMPTY_SHARED_ROOM_MS = 15 * 60 * 1000;

const keepaliveTimer = setInterval(() => {
	const nowMs = Date.now();
	const commentBytes = encoder.encode(`: keepalive ${nowMs}\n\n`);

	for (const [roomId, room] of rooms.entries()) {
		const deadConns: string[] = [];
		for (const [connId, conn] of room.connections.entries()) {
			try {
				conn.controller.enqueue(commentBytes);
			} catch {
				deadConns.push(connId);
			}
		}
		for (const connId of deadConns) {
			removeConnectionFromRoom(room, connId);
		}

		if (
			room.type === 'shared' &&
			room.connections.size === 0 &&
			nowMs - room.lastActivityMs > STALE_EMPTY_SHARED_ROOM_MS
		) {
			if (room.code) roomCodeIndex.delete(room.code);
			rooms.delete(roomId);
		}
	}
}, KEEPALIVE_INTERVAL_MS);

if (typeof (keepaliveTimer as any).unref === 'function') {
	(keepaliveTimer as any).unref();
}
