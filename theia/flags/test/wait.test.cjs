'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const { parseVscodeCliArgs } = require('../lib/electron-main/vscode-cli.js');
const { runWaitController } = require('../lib/electron-main/wait-controller.js');

test('--wait parses a regular file and --goto', () => {
	const ordinary = parseVscodeCliArgs(['--wait', '/tmp/COMMIT_EDITMSG']);
	assert.equal(ordinary.wait, true);
	assert.deepEqual(ordinary.remainingArgs, ['/tmp/COMMIT_EDITMSG']);

	const goto = parseVscodeCliArgs(['-w', '--goto', '/tmp/message:5:2']);
	assert.equal(goto.wait, true);
	assert.equal(goto.gotoTarget, '/tmp/message:5:2');
});

test('--wait cannot be used without an opening target', () => {
	assert.throws(() => parseVscodeCliArgs(['--wait']), /requires a file/);
	assert.throws(() => parseVscodeCliArgs(['--wait', '--restore']), /cannot be combined/);
});

test('internal wait socket is parsed without passing it to upstream Theia', () => {
	const parsed = parseVscodeCliArgs(['--theia-wait-socket=/tmp/complete.sock', '/tmp/COMMIT_EDITMSG']);
	assert.equal(parsed.waitSocket, '/tmp/complete.sock');
	assert.deepEqual(parsed.remainingArgs, ['/tmp/COMMIT_EDITMSG']);
});

test('wait controller returns success only after the editor signals completion', async () => {
	const client = path.join(__dirname, 'fixtures/wait-client.cjs');
	assert.equal(await runWaitController([client, '0']), 0);
});

test('wait controller passes editor errors back as failure', async () => {
	const client = path.join(__dirname, 'fixtures/wait-client.cjs');
	assert.equal(await runWaitController([client, '1:test failure']), 1);
});
