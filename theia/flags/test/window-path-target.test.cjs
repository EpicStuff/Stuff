const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, mkdir, writeFile, rm, stat } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { resolveWindowPathTarget } = require('../lib/electron-main/window-path-target.js');

test('an existing file opens in an editor instead of as a workspace', async () => {
	const dir = await mkdtemp(path.join(tmpdir(), 'theia-file-'));
	try {
		await writeFile(path.join(dir, 'existing.py'), 'print(1)');
		assert.deepEqual(await resolveWindowPathTarget('existing.py', dir), { path: path.join(dir, 'existing.py'), isWorkspace: false, exists: true });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test('a nonexistent file opens as an unsaved editor without touching disk', async () => {
	const dir = await mkdtemp(path.join(tmpdir(), 'theia-file-'));
	try {
		const target = path.join(dir, 'new-dir/new.py');
		assert.deepEqual(await resolveWindowPathTarget('new-dir/new.py', dir), { path: target, isWorkspace: false, exists: false });
		await assert.rejects(stat(target), { code: 'ENOENT' });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test('directories and workspace files still open as workspaces', async () => {
	const dir = await mkdtemp(path.join(tmpdir(), 'theia-file-'));
	try {
		await mkdir(path.join(dir, 'folder'));
		await writeFile(path.join(dir, 'project.code-workspace'), '{}');
		assert.equal((await resolveWindowPathTarget('folder', dir)).isWorkspace, true);
		assert.equal((await resolveWindowPathTarget('project.code-workspace', dir)).isWorkspace, true);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
