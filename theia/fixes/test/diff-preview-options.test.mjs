import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffPreviewOptions } from '../lib/browser/diff-preview-options.js';

test('diff opened without options uses a temporary preview tab', () => {
	assert.deepEqual(diffPreviewOptions(true), { preview: true });
});

test('diff opened with unrelated options retains them and enables preview', () => {
	const options = { mode: 'reveal', widgetOptions: { area: 'main' } };
	assert.deepEqual(diffPreviewOptions(true, options), { ...options, preview: true });
	assert.deepEqual(options, { mode: 'reveal', widgetOptions: { area: 'main' } });
});

test('explicit permanent and preview opens remain unchanged', () => {
	const permanent = { preview: false };
	const temporary = { preview: true };
	assert.equal(diffPreviewOptions(true, permanent), permanent);
	assert.equal(diffPreviewOptions(true, temporary), temporary);
});

test('ordinary file editors do not change', () => {
	const options = { mode: 'reveal' };
	assert.equal(diffPreviewOptions(false, options), options);
	assert.equal(diffPreviewOptions(false), undefined);
});
