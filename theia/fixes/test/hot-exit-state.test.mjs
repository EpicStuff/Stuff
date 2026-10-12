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
