import { createRequire } from 'module';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const startupAnchor = "require('@theia/core/shared/reflect-metadata');";
const lockAnchor = "    if (isSingleInstance && !app.requestSingleInstanceLock(process.argv)) {";
const marker = '// theia-flags: validate arguments before the single instance lock';

export function addEarlyCliValidation(source) {
	if (source.includes(marker)) {
		return source;
	}
	if (source.split(startupAnchor).length !== 2 || source.split(lockAnchor).length !== 2 || source.indexOf(startupAnchor) > source.indexOf(lockAnchor)) {
		throw new Error('Unsupported Theia Electron bootstrap generator. Refusing to skip early CLI validation.');
	}
	const validation = [
		marker,
		"const { parseVscodeCliArgs, VSCODE_COMPAT_HELP } = require('theia-flags/lib/electron-main/vscode-cli');",
		'const applicationArgs = process.argv.slice(process.versions.electron && !process.defaultApp ? 1 : 2);',
		'try {',
		'    const parsed = parseVscodeCliArgs(applicationArgs);',
		'    if (parsed.help) {',
		'        process.stdout.write(VSCODE_COMPAT_HELP);',
		'        process.exit(0);',
		'    }',
		'} catch (error) {',
		"    process.stderr.write('theia: ' + (error instanceof Error ? error.message : String(error)) + '\\\\n\\\\n' + VSCODE_COMPAT_HELP);",
		'    process.exit(1);',
		'}'
	].join('\n');
	return source.replace(startupAnchor, startupAnchor + '\n' + validation);
}

export async function patchElectronBootstrap(generatorPath) {
	const original = await fs.readFile(generatorPath, 'utf8');
	const patched = addEarlyCliValidation(original);
	if (patched === original) {
		return false;
	}
	await fs.writeFile(generatorPath, patched, 'utf8');
	return true;
}

export function resolveElectronBootstrapGenerator() {
	let packagePath;
	try {
		packagePath = require.resolve('@theia/application-manager/package.json');
	} catch (error) {
		throw new Error('Could not find @theia/application-manager. The Theia flags build requires the full application installation to validate arguments before Electron starts.', { cause: error });
	}
	return path.join(path.dirname(packagePath), 'lib', 'generator', 'backend-generator.js');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await patchElectronBootstrap(resolveElectronBootstrapGenerator());
}
