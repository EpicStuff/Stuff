import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareExplorerNames } from '../lib/browser/natural-explorer-sort.js';

test('numeric filenames use natural order', () => {
	assert.deepEqual(['11.txt', '2.txt', '10.txt', '1.txt'].sort(compareExplorerNames), ['1.txt', '2.txt', '10.txt', '11.txt']);
});

test('number sequences in names are compared numerically', () => {
	assert.deepEqual(['file12.txt', 'file2.txt', 'file1.txt'].sort(compareExplorerNames), ['file1.txt', 'file2.txt', 'file12.txt']);
});

test('numeric ties put the shorter name first as VS Code does', () => {
	assert.deepEqual(['file001', 'file01', 'file1'].sort(compareExplorerNames), ['file1', 'file01', 'file001']);
});

test('non-numeric names keep collator order', () => {
	const names = ['delta', 'Alpha', 'beta'];
	assert.deepEqual(names.sort(compareExplorerNames), ['Alpha', 'beta', 'delta']);
});
