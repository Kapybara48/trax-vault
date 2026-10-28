import fs from 'node:fs';
import path from 'node:path';

const buildIndexPath = path.resolve('./build/index.js');
const envDefaultsPath = path.resolve('./build/env-defaults.js');

if (fs.existsSync(buildIndexPath)) {
	fs.writeFileSync(
		envDefaultsPath,
		`if (!process.env.BODY_SIZE_LIMIT) {\n\tprocess.env.BODY_SIZE_LIMIT = 'Infinity';\n}\n`,
		'utf-8'
	);

	let content = fs.readFileSync(buildIndexPath, 'utf-8');
	if (!content.includes('env-defaults.js')) {
		content = `import './env-defaults.js';\n` + content;
		fs.writeFileSync(buildIndexPath, content, 'utf-8');
	}
	console.log('[Postbuild] Injected default BODY_SIZE_LIMIT=Infinity into build/index.js');
}
