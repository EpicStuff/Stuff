'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const { parseVscodeCliArgs } = require('../lib/electron-main/vscode-cli.js');
const { runWaitController } = require('../lib/electron-main/wait-controller.js');
const { waitForEditorResourcesClosed } = require('../lib/electron-browser/wait-for-editors.js');

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

function createEditor(resource, dirty = false) {
	const listeners = new Set();
	const saveable = {
		dirty,
		onDirtyChanged(listener) {
			listeners.add(listener);
			return { dispose: () => listeners.delete(listener) };
		}
	};
	return {
		resource,
		saveable,
		setDirty(next) {
			saveable.dirty = next;
			for (const listener of listeners) {
				listener();
			}
		}
	};
}

function createHost(...editors) {
	const listeners = new Set();
	const host = {
		editors,
		getOpenEditors: () => host.editors,
		onDidChangeEditors(listener) {
			listeners.add(listener);
			return { dispose: () => listeners.delete(listener) };
		},
		close(editor) {
			host.editors = host.editors.filter(candidate => candidate !== editor);
			for (const listener of listeners) {
				listener(editor);
			}
		},
		open(editor) {
			host.editors.push(editor);
			for (const listener of listeners) {
				listener(editor);
			}
		}
	};
	return host;
}

function observe(promise) {
	let completed = false;
	promise.then(() => { completed = true; });
	return () => completed;
}

function nextCheck() {
	return new Promise(resolve => setTimeout(resolve, 20));
}

test('wait ends on the requested tab close, not an unrelated tab', async () => {
	const target = createEditor('file:///message');
	const unrelated = createEditor('file:///other');
	const host = createHost(target, unrelated);
	const completion = waitForEditorResourcesClosed(['file:///message'], host);
	const done = observe(completion);
	host.close(unrelated);
	await nextCheck();
	assert.equal(done(), false);
	host.close(target);
	await completion;
	assert.equal(done(), true);
});

test('moving an editor does not end the wait', async () => {
	const editor = createEditor('file:///message');
	const host = createHost(editor);
	const completion = waitForEditorResourcesClosed(['file:///message'], host);
	const done = observe(completion);
	host.close(editor);
	host.open(editor);
	await nextCheck();
	assert.equal(done(), false);
	host.close(editor);
	await completion;
	assert.equal(done(), true);
});

test('replacing a tab for the same resource does not end the wait', async () => {
	const previous = createEditor('file:///message');
	const replacement = createEditor('file:///message');
	const host = createHost(previous);
	const completion = waitForEditorResourcesClosed(['file:///message'], host);
	const done = observe(completion);
	host.close(previous);
	host.open(replacement);
	await nextCheck();
	assert.equal(done(), false);
	host.close(replacement);
	await completion;
	assert.equal(done(), true);
});

test('closing a tab with a pending save keeps Git waiting', async () => {
	const editor = createEditor('file:///message', true);
	const host = createHost(editor);
	const completion = waitForEditorResourcesClosed(['file:///message'], host);
	const done = observe(completion);
	await nextCheck();
	host.close(editor);
	await nextCheck();
	assert.equal(done(), false);
	editor.setDirty(false);
	await completion;
	assert.equal(done(), true);
});

test('a multi file wait finishes after every requested resource closes', async () => {
	const first = createEditor('file:///one');
	const second = createEditor('file:///two');
	const host = createHost(first, second);
	const completion = waitForEditorResourcesClosed(['file:///one', 'file:///two'], host);
	const done = observe(completion);
	host.close(first);
	await nextCheck();
	assert.equal(done(), false);
	host.close(second);
	await completion;
	assert.equal(done(), true);
});

test('passthrough flags are not mistaken for file targets', () => {
	const { getWindowTargets, getWindowTargetIndices } = require('../lib/electron-main/vscode-cli.js');
	const args = ['--log-level', 'debug', 'first.py', 'second.py', '--', '-dash.txt'];
	assert.deepEqual(getWindowTargets(args), ['first.py', 'second.py', '-dash.txt']);
	assert.deepEqual(getWindowTargetIndices(args), [2, 3, 5]);
});
