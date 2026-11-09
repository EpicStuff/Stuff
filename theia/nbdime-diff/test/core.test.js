'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {notebookDiffInput, signature, notebookContent, EMPTY_NOTEBOOK, safeHtml} = require('../src/core');

function uri(path, scheme = 'git') {
	return {path, toString: () => `${scheme}:${path}`};
}

test('accepts virtual Git notebook revisions', () => {
	const tab = {input: {original: uri('/src/data.ipynb'), modified: uri('/src/data.ipynb')}};
	assert.equal(notebookDiffInput(tab), tab.input);
	assert.equal(signature(tab.input), 'git:/src/data.ipynb\u0000git:/src/data.ipynb');
});

test('does not intercept ordinary JSON or Python files', () => {
	assert.equal(notebookDiffInput({input: {original: uri('/a.json'), modified: uri('/a.json')}}), undefined);
	assert.equal(notebookDiffInput({input: {uri: uri('/a.ipynb')}}), undefined);
});

test('accepts empty added or removed notebook revisions', () => {
	assert.equal(notebookContent('  '), EMPTY_NOTEBOOK);
	assert.equal(notebookContent('{"cells":[],"metadata":{},"nbformat":4,"nbformat_minor":5}').includes('nbformat'), true);
});

test('rejects invalid notebook JSON', () => {
	assert.throws(() => notebookContent('{"cells": []}'), /not a valid/);
	assert.throws(() => notebookContent('{oops}'), SyntaxError);
});

test('escapes HTML injected through titles and errors', () => {
	assert.equal(safeHtml('<iframe src="a&b">'), '&lt;iframe src=&quot;a&amp;b&quot;&gt;');
});
