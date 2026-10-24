import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TransientWordWrapState } from '../lib/browser/word-wrap-state.js';

test('unwrapped editor toggles on, then restores its configured mode', () => {
	const state = new TransientWordWrapState();
	const model = {};
	assert.equal(state.toggle(model, false), 'on');
	assert.equal(state.get(model), 'on');
	assert.equal(state.toggle(model, true), 'inherit');
});

test('wrapped editor toggles off, then restores its configured mode', () => {
	const state = new TransientWordWrapState();
	const model = {};
	assert.equal(state.toggle(model, true), 'off');
	assert.equal(state.toggle(model, false), 'inherit');
});

test('transient modes are associated with individual models', () => {
	const state = new TransientWordWrapState();
	const first = {};
	const second = {};
	state.toggle(first, true);
	assert.equal(state.get(first), 'off');
	assert.equal(state.get(second), 'inherit');
	assert.equal(state.get(null), 'inherit');
});

test('diff editor overrides can be synchronized and reset on both models', () => {
	const state = new TransientWordWrapState();
	const original = {};
	const modified = {};
	const next = state.toggle(modified, false);
	state.set(original, next);
	assert.equal(state.get(original), 'on');
	assert.equal(state.get(modified), 'on');
	state.set(original, state.toggle(modified, true));
	assert.equal(state.get(original), 'inherit');
	assert.equal(state.get(modified), 'inherit');
});
