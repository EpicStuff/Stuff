import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideHotExitRecovery } from '../lib/browser/hot-exit-state.js';

const backup = { workspace: '/project', uri: 'file:///project/test.ts', baseContent: 'initial', content: 'unsaved changes' };

test('restores backed up content if disk content has not changed', () => {
	assert.equal(decideHotExitRecovery(backup, 'initial', false), 'restore');
});

test('does not apply backup if file contents already match', () => {
	assert.equal(decideHotExitRecovery(backup, 'unsaved changes', false), 'unchanged');
});

test('preserves backup when disk was modified externally', () => {
	assert.equal(decideHotExitRecovery(backup, 'external edits', false), 'conflict');
});

test('never overwrites a model already containing new unsaved changes', () => {
	assert.equal(decideHotExitRecovery(backup, 'initial', true), 'conflict');
});

test('separate window versions never overwrite one another during recovery', async () => {
	const { selectHotExitBackups } = await import('../lib/browser/hot-exit-state.js');
	const left = { ...backup, owner: 'run-a:1', content: 'window one' };
	const right = { ...backup, owner: 'run-a:2', content: 'window two' };
	const { selected, conflicts } = selectHotExitBackups([left, right]);
	assert.equal(selected.size, 0);
	assert.deepEqual([...conflicts], [backup.uri]);
});

test('unambiguous files can recover independently', async () => {
	const { selectHotExitBackups } = await import('../lib/browser/hot-exit-state.js');
	const other = { ...backup, uri: 'file:///project/other.ts', owner: 'run-a:2' };
	const { selected, conflicts } = selectHotExitBackups([backup, other]);
	assert.equal(selected.size, 2);
	assert.equal(conflicts.size, 0);
});
