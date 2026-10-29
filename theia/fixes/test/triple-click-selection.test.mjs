import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getTripleClickSelection, listenForTripleClickSelection } from '../lib/browser/triple-click-selection.js';

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

function mockCodeEditor() {
	let handler;
	let selection = { startLineNumber: 2, startColumn: 1, endLineNumber: 3, endColumn: 1 };
	const editor = {
		onMouseDown(callback) {
			handler = callback;
			return { dispose() { handler = undefined; } };
		},
		getModel() { return { getLineMaxColumn() { return 11; } }; },
		getSelection() { return selection; },
		setSelection(next) { selection = next; }
	};
	return {
		editor,
		click() {
			handler?.({
				event: { detail: 3, leftButton: true, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false },
				target: { position: { lineNumber: 2 } }
			});
		},
		get selection() { return selection; }
	};
}

test('the selection handler works on two independent Monaco code editors', () => {
	const original = mockCodeEditor();
	const modified = mockCodeEditor();
	const leftSubscription = listenForTripleClickSelection(original.editor);
	const rightSubscription = listenForTripleClickSelection(modified.editor);
	original.click();
	modified.click();
	const expected = { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 11 };
	assert.deepEqual(original.selection, expected);
	assert.deepEqual(modified.selection, expected);
	leftSubscription.dispose();
	rightSubscription.dispose();
});

test('disposing the Monaco mouse listener stops changing selections', () => {
	const control = mockCodeEditor();
	const listener = listenForTripleClickSelection(control.editor);
	listener.dispose();
	control.click();
	assert.deepEqual(control.selection, { startLineNumber: 2, startColumn: 1, endLineNumber: 3, endColumn: 1 });
});
