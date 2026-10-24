import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '$lib/server/db.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard for GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Get or initialize persistent 32-byte AES key for Subsonic password storage
 */
function getEncryptionKey(): Buffer {
	if (process.env.SUBSONIC_SECRET_KEY) {
		return crypto.createHash('sha256').update(process.env.SUBSONIC_SECRET_KEY).digest();
	}

	const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve('./data');
	if (!fs.existsSync(dataDir)) {
		fs.mkdirSync(dataDir, { recursive: true });
	}

	const keyPath = path.join(dataDir, 'subsonic.key');
	if (fs.existsSync(keyPath)) {
		try {
			const keyHex = fs.readFileSync(keyPath, 'utf8').trim();
			if (keyHex.length === 64) {
				return Buffer.from(keyHex, 'hex');
			}
		} catch (err) {
			console.error('Error reading Subsonic key file:', err);
		}
	}

	// Generate and persist new random key
	const newKey = crypto.randomBytes(32);
	try {
		fs.writeFileSync(keyPath, newKey.toString('hex'), { mode: 0o600 });
	} catch (err) {
		console.error('Failed to persist Subsonic encryption key:', err);
	}
	return newKey;
}

/**
 * Encrypt cleartext password using AES-256-GCM
 */
export function encryptSubsonicPassword(password: string): string {
	const key = getEncryptionKey();
	const iv = crypto.randomBytes(IV_LENGTH);
	const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
	
	let encrypted = cipher.update(password, 'utf8', 'hex');
	encrypted += cipher.final('hex');
	const tag = cipher.getAuthTag().toString('hex');
	
	// format: iv:tag:ciphertext
	return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

/**
 * Decrypt AES-256-GCM encrypted password
 */
export function decryptSubsonicPassword(encryptedPayload: string): string | null {
	try {
		const parts = encryptedPayload.split(':');
		if (parts.length !== 3) return null;

		const [ivHex, tagHex, cipherHex] = parts;
		const key = getEncryptionKey();
		const iv = Buffer.from(ivHex, 'hex');
		const tag = Buffer.from(tagHex, 'hex');

		const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
		decipher.setAuthTag(tag);

		let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
		decrypted += decipher.final('utf8');
		return decrypted;
	} catch {
		return null;
	}
}

/**
 * Verify MD5 token authentication (u, t, s)
 * token = md5(password + salt)
 */
export function verifySubsonicToken(token: string, salt: string, cleartextPassword: string): boolean {
	if (!token || !salt || !cleartextPassword) return false;
	const computed = crypto.createHash('md5').update(cleartextPassword + salt).digest('hex').toLowerCase();
	return computed === token.toLowerCase();
}

/**
 * Decode legacy password parameter if hex-encoded (e.g. enc:68656c6c6f)
 */
export function decodeSubsonicPasswordParam(pParam: string): string {
	if (pParam.startsWith('enc:')) {
		const hex = pParam.substring(4);
		try {
			return Buffer.from(hex, 'hex').toString('utf8');
		} catch {
			return pParam;
		}
	}
	return pParam;
}

/**
 * Save user's Subsonic encrypted secret to database
 */
export function persistUserSubsonicSecret(userId: number, cleartextPassword: string): void {
	const encrypted = encryptSubsonicPassword(cleartextPassword);
	db.prepare("UPDATE users SET subsonic_secret = ?, updated_at = datetime('now') WHERE id = ?").run(encrypted, userId);
}
