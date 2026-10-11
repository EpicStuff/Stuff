import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FOLDING_CONTRIBUTION_ID, mergeFoldingIntoViewState, parseFoldingState, readFoldingFromViewState, sanitizeStoredFoldingStates } from '../lib/browser/folding-state.js';

const folding = {
	collapsedRegions: [{ startLineNumber: 2, endLineNumber: 6, isCollapsed: true, checksum: 123456, source: 0 }],
	lineCount: 20,
	provider: 'indent',
	foldedImports: false
};

test('extracts Monaco folding mementos without storing unrelated view state', () => {
	const view = { cursorState: [{ lineNumber: 10 }], viewState: { scrollTop: 200 }, contributionsState: { [FOLDING_CONTRIBUTION_ID]: folding, find: { query: 'hi' } } };
	assert.deepEqual(readFoldingFromViewState(view), folding);
});

test('merge restores only folding and keeps cursor, scroll, and other contributions', () => {
	const current = { cursorState: [{ lineNumber: 8 }], viewState: { scrollTop: 500 }, contributionsState: { find: { query: 'test' }, [FOLDING_CONTRIBUTION_ID]: { lineCount: 20 } } };
	const merged = mergeFoldingIntoViewState(current, folding);
	assert.deepEqual(merged.cursorState, current.cursorState);
	assert.deepEqual(merged.viewState, current.viewState);
	assert.deepEqual(merged.contributionsState.find, current.contributionsState.find);
	assert.deepEqual(merged.contributionsState[FOLDING_CONTRIBUTION_ID], folding);
	assert.notStrictEqual(merged, current);
});

test('accepts an explicitly unfolded state to clear previously saved folds', () => {
	assert.deepEqual(parseFoldingState({ lineCount: 25 }), { lineCount: 25 });
});

test('rejects invalid or corrupted region data', () => {
	assert.equal(parseFoldingState({ collapsedRegions: [{ startLineNumber: 8, endLineNumber: 2 }] }), undefined);
	assert.equal(parseFoldingState({ collapsedRegions: 'bad' }), undefined);
	assert.equal(parseFoldingState({ collapsedRegions: [{ startLineNumber: 2, endLineNumber: 8, checksum: Infinity }] }), undefined);
});

test('keeps only valid states with regions from persisted storage', () => {
	const stored = sanitizeStoredFoldingStates({ 'file:///one.py': folding, 'file:///empty.py': { lineCount: 30 }, 'file:///bad.py': { collapsedRegions: [{}] } });
	assert.deepEqual(Object.keys(stored), ['file:///one.py']);
	assert.deepEqual(stored['file:///one.py'], folding);
});
