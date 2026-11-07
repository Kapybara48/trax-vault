import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { execSync } from 'child_process';
import fs from 'fs';

// Set BODY_SIZE_LIMIT to Infinity by default for Vite dev, preview, and build
if (!process.env.BODY_SIZE_LIMIT) {
	process.env.BODY_SIZE_LIMIT = 'Infinity';
}

function resolveAppVersion(): string {
	if (process.env.APP_VERSION) {
		return process.env.APP_VERSION.replace(/^v/, '');
	}
	try {
		const gitTag = execSync('git describe --tags --exact-match 2>/dev/null || git describe --tags --abbrev=0 2>/dev/null', {
			encoding: 'utf8'
		}).trim();
		if (gitTag) return gitTag.replace(/^v/, '');
	} catch {
		// Ignore git describe errors when building outside git repo
	}
	try {
		const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
		if (pkg.version) return pkg.version;
	} catch {
		// Ignore
	}
	return '1.7.3';
}

const appVersion = resolveAppVersion();

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(appVersion)
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			alias: {
				'$lib': 'src/lib',
				'$lib/*': 'src/lib/*'
			},
			csrf: {
				trustedOrigins: ['*']
			}
		})
	]
});
