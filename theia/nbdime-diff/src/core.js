'use strict';

const EMPTY_NOTEBOOK = JSON.stringify({cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5});

function notebookDiffInput(tab) {
	if (!tab || !tab.input) return undefined;
	const input = tab.input;
	if (!input.original || !input.modified) return undefined;
	if (typeof input.original.toString !== 'function' || typeof input.modified.toString !== 'function') return undefined;
	const paths = [input.original.path, input.modified.path];
	const looksLikeNotebook = paths.some(value => typeof value === 'string' && /\.ipynb$/i.test(value));
	if (!looksLikeNotebook) return undefined;
	return input;
}

function signature(input) {
	return `${input.original.toString()}\u0000${input.modified.toString()}`;
}

function notebookContent(text) {
	if (!text.trim()) return EMPTY_NOTEBOOK;
	const parsed = JSON.parse(text);
	if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cells) || parsed.nbformat !== 4) {
		throw new Error('One revision is not a valid version 4 Jupyter notebook');
	}
	return text;
}

function safeHtml(text) {
	return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

module.exports = {EMPTY_NOTEBOOK, notebookDiffInput, notebookContent, signature, safeHtml};
