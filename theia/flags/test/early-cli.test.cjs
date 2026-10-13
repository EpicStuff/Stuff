const assert = require('node:assert/strict');
const { test } = require('node:test');

test('unknown flags fail before attempting to acquire the single instance lock', async () => {
	const { addEarlyCliValidation } = await import('../build/patch-electron-bootstrap.mjs');
	const source = "require('@theia/core/shared/reflect-metadata');\nconsole.log('Electron main: loading modules...');\n    if (isSingleInstance && !app.requestSingleInstanceLock(process.argv)) {\n";
	const updated = addEarlyCliValidation(source);
	assert.ok(updated.indexOf('parseVscodeCliArgs(applicationArgs)') < updated.indexOf('requestSingleInstanceLock'));
	assert.ok(updated.indexOf('parseVscodeCliArgs(applicationArgs)') < updated.indexOf("console.log('Electron main"));
	assert.match(updated, /process\.exit\(1\)/);
	assert.equal(addEarlyCliValidation(updated), updated);
});

test('fail the build when Theia changes the bootstrap', async () => {
	const { addEarlyCliValidation } = await import('../build/patch-electron-bootstrap.mjs');
	assert.throws(() => addEarlyCliValidation('something else'), /Unsupported Theia Electron bootstrap generator/);
});

test('shared argument parser rejects an unknown flag', () => {
	const { parseVscodeCliArgs } = require('../lib/electron-main/vscode-cli.js');
	assert.throws(() => parseVscodeCliArgs(['--wrong-flag']), /Unknown option '--wrong-flag'/);
	assert.equal(parseVscodeCliArgs(['--keep-warm', '--restore']).restore, true);
});

test('patched generator emits syntactically valid JavaScript', async () => {
	const { addEarlyCliValidation } = await import('../build/patch-electron-bootstrap.mjs');
	const tick = String.fromCharCode(96);
	const original = [
		'function generate() {',
		'return ' + tick + '// @ts-check',
		"require('@theia/core/shared/reflect-metadata');",
		"console.log('Electron main: loading modules...');",
		'    if (isSingleInstance && !app.requestSingleInstanceLock(process.argv)) {',
		'        app.quit();',
		'    }',
		tick + ';',
		'}'
	].join('\n');
	const generator = new Function(addEarlyCliValidation(original) + '\nreturn generate;')();
	const emitted = generator();
	assert.doesNotThrow(() => new Function(emitted));
	assert.match(emitted, /process\.stderr\.write/);
});

test('a second launch reports invalid options to its own terminal before Electron startup', async () => {
	const { spawnSync } = require('node:child_process');
	const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
	const { tmpdir } = require('node:os');
	const { join } = require('node:path');
	const { addEarlyCliValidation } = await import('../build/patch-electron-bootstrap.mjs');
	const tick = String.fromCharCode(96);
	const original = [
		'function generate() {',
		'return ' + tick + '// @ts-check',
		"require('@theia/core/shared/reflect-metadata');",
		"console.log('Electron main: loading modules...');",
		'    if (isSingleInstance && !app.requestSingleInstanceLock(process.argv)) {',
		'        app.quit();',
		'    }',
		tick + ';',
		'}'
	].join('\n');
	const generated = new Function(addEarlyCliValidation(original) + '\nreturn generate;')();
	const stub = "const parseVscodeCliArgs = args => { if (args.includes('--wrong-flag')) throw new Error('Unknown option \\'--wrong-flag\\''); return { help: args.includes('--help') }; }; const VSCODE_COMPAT_HELP = 'Usage: theia [options] [path]\\n';";
	const executable = generated.replace("const { parseVscodeCliArgs, VSCODE_COMPAT_HELP } = require('theia-flags/lib/electron-main/vscode-cli');", stub);
	const dir = mkdtempSync(join(tmpdir(), 'theia-early-cli-'));
	const target = join(dir, 'electron-main.cjs');
	try {
		writeFileSync(target, executable);
		const bad = spawnSync(process.execPath, [target, '--wrong-flag'], { encoding: 'utf8' });
		assert.equal(bad.status, 1);
		assert.match(bad.stderr, /theia: Unknown option '--wrong-flag'/);
		assert.match(bad.stderr, /Usage: theia/);
		assert.doesNotMatch(bad.stdout, /Electron main: loading modules/);
		const help = spawnSync(process.execPath, [target, '--help'], { encoding: 'utf8' });
		assert.equal(help.status, 0);
		assert.match(help.stdout, /Usage: theia/);
		assert.doesNotMatch(help.stdout, /Electron main: loading modules/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
