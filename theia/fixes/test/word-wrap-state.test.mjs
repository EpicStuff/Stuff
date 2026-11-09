import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextWordWrapOverride, syncedDiffWordWrapOverride } from '../lib/browser/word-wrap-state.js';

test('unwrapped editor toggles on, then restores the configured mode', () => {
	assert.equal(nextWordWrapOverride('inherit', false), 'on');
	assert.equal(nextWordWrapOverride('on', true), 'inherit');
});

test('wrapped editor toggles off, then restores the configured mode', () => {
	assert.equal(nextWordWrapOverride('inherit', true), 'off');
	assert.equal(nextWordWrapOverride('off', false), 'inherit');
});

test('diff model changes copy a temporary override to the other side', () => {
	assert.equal(syncedDiffWordWrapOverride('on', 'inherit'), 'on');
	assert.equal(syncedDiffWordWrapOverride('inherit', 'off'), 'off');
	assert.equal(syncedDiffWordWrapOverride('off', 'inherit'), 'off');
	assert.equal(syncedDiffWordWrapOverride('inherit', 'on'), 'on');
});

test('diff model changes preserve equal or separately configured overrides', () => {
	assert.equal(syncedDiffWordWrapOverride('inherit', 'inherit'), undefined);
	assert.equal(syncedDiffWordWrapOverride('on', 'off'), undefined);
	assert.equal(syncedDiffWordWrapOverride('off', 'off'), undefined);
});
