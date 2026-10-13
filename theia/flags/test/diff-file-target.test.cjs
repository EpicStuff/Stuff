const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, writeFile, mkdir, symlink, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { resolveDiffFileTarget } = require('../lib/electron-main/diff-file-target.js');

test('diff accepts an existing file', async () => {
	const dir = await mkdtemp(path.join(tmpdir(), 'theia-diff-'));
	try {
		const file = path.join(dir, 'left.txt');
		await writeFile(file, 'contents');
		assert.deepEqual(await resolveDiffFileTarget('left.txt', dir), { path: file, exists: true });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test('diff accepts missing files without creating them', async () => {
	const dir = await mkdtemp(path.join(tmpdir(), 'theia-diff-'));
	try {
		assert.deepEqual(await resolveDiffFileTarget('missing.txt', dir), { path: path.join(dir, 'missing.txt'), exists: false });
		assert.deepEqual(await resolveDiffFileTarget('missing-dir/file.txt', dir), { path: path.join(dir, 'missing-dir/file.txt'), exists: false });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test('diff resolves symlinks to existing files', async () => {
	const dir = await mkdtemp(path.join(tmpdir(), 'theia-diff-'));
	try {
		const target = path.join(dir, 'target.txt');
		await writeFile(target, 'contents');
		await symlink(target, path.join(dir, 'link.txt'));
		assert.deepEqual(await resolveDiffFileTarget('link.txt', dir), { path: target, exists: true });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test('diff rejects directories', async () => {
	const dir = await mkdtemp(path.join(tmpdir(), 'theia-diff-'));
	try {
		await mkdir(path.join(dir, 'folder'));
		await assert.rejects(resolveDiffFileTarget('folder', dir), /Path is not a file/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test('diff supports the Git empty side marker on Unix', async () => {
	if (process.platform === 'win32') {
		return;
	}
	assert.deepEqual(await resolveDiffFileTarget('/dev/null', '/'), { path: '/dev/null', exists: false });
});
