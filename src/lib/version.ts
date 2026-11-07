/**
 * Trax Vault Version & Compatibility Lifecycle
 *
 * Migration Policy: N-1 Stepping Stone Upgrades
 * - v1.6: Legacy Track Vault (trackvault.db, schema <= 160)
 * - v1.7.x: Bridge Release - automatically migrates v1.6 databases to traxvault.db and stamps schema 170
 * - v2.0: Requires v1.7+ (schema >= 170). Direct upgrades from v1.6 are rejected to prevent corruption.
 *
 * CI/CD: Automated builds published via Forgejo Actions (ubuntu-latest runner) and versioned via Git tags (v*).
 */

declare const __APP_VERSION__: string | undefined;

export const APP_NAME = 'Trax Vault';
export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.7.2';

// Current database schema version (integer: 170 = v1.7.x, 200 = v2.0.0)
export const CURRENT_SCHEMA_VERSION = 170;

// Minimum version required to upgrade to this release
export const MIN_COMPATIBLE_VERSION = '1.6.0';
export const MIN_COMPATIBLE_SCHEMA_VERSION = 160;
