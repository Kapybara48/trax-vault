import fs from 'node:fs';
import path from 'node:path';

const buildIndexPath = path.resolve('./build/index.js');
const envDefaultsPath = path.resolve('./build/env-defaults.js');

if (fs.existsSync(buildIndexPath)) {
	fs.writeFileSync(
		envDefaultsPath,
		`import dns from 'node:dns';\nimport net from 'node:net';\n\nif (!process.env.BODY_SIZE_LIMIT) {\n\tprocess.env.BODY_SIZE_LIMIT = 'Infinity';\n}\n\ntry {\n\tif (typeof net.setDefaultAutoSelectFamily === 'function') {\n\t\tnet.setDefaultAutoSelectFamily(false);\n\t}\n\tdns.setDefaultResultOrder('ipv4first');\n} catch {}\n`,
		'utf-8'
	);

	let content = fs.readFileSync(buildIndexPath, 'utf-8');
	if (!content.includes('env-defaults.js')) {
		content = `import './env-defaults.js';\n` + content;
		fs.writeFileSync(buildIndexPath, content, 'utf-8');
	}
	console.log('[Postbuild] Injected default BODY_SIZE_LIMIT=Infinity and IPv4 network defaults into build/index.js');
}
