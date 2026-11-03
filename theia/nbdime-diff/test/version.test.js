'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');
const {commandAvailable} = require('../src/backend');

test('accepts version printed to stdout with status 0 or stderr with status 1', async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nbdime-version-test-'));
	try {
		const normal = path.join(dir, 'normal');
		const legacy = path.join(dir, 'legacy');
		await fs.writeFile(normal, '#!/bin/sh\nprintf \'4.0.4\\n\'\nexit 0\n', {mode: 0o755});
		await fs.writeFile(legacy, '#!/bin/sh\nprintf \'4.0.4\\n\' >&2\nexit 1\n', {mode: 0o755});
		assert.equal(await commandAvailable(normal), '4.0.4');
		assert.equal(await commandAvailable(legacy), '4.0.4');
	} finally {
		await fs.rm(dir, {recursive: true, force: true});
	}
});

test('rejects absent executables and command failures', async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nbdime-version-fail-'));
	try {
		const broken = path.join(dir, 'broken');
		await fs.writeFile(broken, '#!/bin/sh\nprintf \'broken\\n\' >&2\nexit 1\n', {mode: 0o755});
		await assert.rejects(() => commandAvailable(broken), /broken/);
		await assert.rejects(() => commandAvailable(path.join(dir, 'missing')), /Cannot run/);
	} finally {
		await fs.rm(dir, {recursive: true, force: true});
	}
});
