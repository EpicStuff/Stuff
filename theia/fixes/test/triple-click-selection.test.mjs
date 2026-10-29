import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getTripleClickControls, getTripleClickSelection } from '../lib/browser/triple-click-selection.js';

test('triple click selects the line without its newline', () => {
	const native = { startLineNumber: 2, startColumn: 1, endLineNumber: 3, endColumn: 1 };
	assert.deepEqual(getTripleClickSelection(3, 2, 11, native), { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 11 });
});

test('empty lines become an empty selection at column one', () => {
	const native = { startLineNumber: 2, startColumn: 1, endLineNumber: 3, endColumn: 1 };
	assert.deepEqual(getTripleClickSelection(3, 2, 1, native), { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 1 });
});

test('single, double and quadruple clicks keep Monaco behavior', () => {
	const native = { startLineNumber: 2, startColumn: 1, endLineNumber: 3, endColumn: 1 };
	for (const count of [1, 2, 4, 5]) {
		assert.equal(getTripleClickSelection(count, 2, 11, native), undefined);
	}
});

test('does not change partial, multiple line, or final line selections', () => {
	assert.equal(getTripleClickSelection(3, 2, 11, { startLineNumber: 2, startColumn: 2, endLineNumber: 3, endColumn: 1 }), undefined);
	assert.equal(getTripleClickSelection(3, 2, 11, { startLineNumber: 2, startColumn: 1, endLineNumber: 4, endColumn: 1 }), undefined);
	assert.equal(getTripleClickSelection(3, 2, 11, { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 11 }), undefined);
	assert.equal(getTripleClickSelection(3, 2, 11, null), undefined);
});

test('diff editor handles original and modified controls', () => {
	const modified = { name: 'modified' };
	const original = { name: 'original' };
	const controls = getTripleClickControls(modified, original);
	assert.deepEqual(controls, [original, modified]);
});

test('normal editor handles one control, without duplicate registrations', () => {
	const modified = { name: 'modified' };
	assert.deepEqual(getTripleClickControls(modified), [modified]);
	assert.deepEqual(getTripleClickControls(modified, modified), [modified]);
});
