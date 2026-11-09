import assert from 'node:assert/strict';
import { test } from 'node:test';
import { swapDiffInputs } from '../lib/browser/swap-diff-inputs.js';

test('swap reverses both file URIs', () => {
	assert.deepEqual(swapDiffInputs('file:///left', 'file:///right'), ['file:///right', 'file:///left']);
});

test('swap twice restores the original sides', () => {
	const sides = ['git:///base', 'file:///modified'];
	const reversed = swapDiffInputs(...sides);
	assert.deepEqual(swapDiffInputs(...reversed), sides);
});

test('swap preserves original object references', () => {
	const original = { uri: 'file:///one' };
	const modified = { uri: 'file:///two' };
	const swapped = swapDiffInputs(original, modified);
	assert.equal(swapped[0], modified);
	assert.equal(swapped[1], original);
});
