const assert = require('node:assert/strict');
const { test } = require('node:test');
const { selectExistingEditorWindow } = require('../lib/electron-main/editor-window-selection.js');

function window(visible, destroyed = false) {
	return { isVisible: () => visible, isDestroyed: () => destroyed };
}

test('prefer the last active visible editor window', () => {
	const hidden = window(false);
	const visible = window(true);
	const windows = new Map([[1, { window: hidden }], [2, { window: visible }]]);
	assert.equal(selectExistingEditorWindow([1, 2], windows), visible);
});

test('reuse an existing minimized editor window instead of creating a new window', () => {
	const hidden = window(false);
	const windows = new Map([[1, { window: hidden }]]);
	assert.equal(selectExistingEditorWindow([1], windows), hidden);
});

test('do not mistake the hidden warm renderer for an existing editor window', () => {
	const warm = window(false);
	const existing = window(false);
	const windows = new Map([[1, { window: warm }], [2, { window: existing }]]);
	assert.equal(selectExistingEditorWindow([1, 2], windows, warm), existing);
	assert.equal(selectExistingEditorWindow([1], windows, warm), undefined);
});

test('ignore destroyed windows', () => {
	const closed = window(true, true);
	const existing = window(false);
	const windows = new Map([[1, { window: closed }], [2, { window: existing }]]);
	assert.equal(selectExistingEditorWindow([1, 2], windows), existing);
	assert.equal(selectExistingEditorWindow([1], windows), undefined);
});
