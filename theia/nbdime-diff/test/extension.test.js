'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {renderDiffPage, commandAvailable} = require('../src/backend');

const NOTEBOOK = JSON.stringify({cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5});

function get(url) {
	return new Promise((resolve, reject) => {
		http.get(url, response => {
			let body = '';
			response.on('data', data => body += data.toString());
			response.on('end', () => resolve({status: response.statusCode, headers: response.headers, body}));
		}).once('error', reject);
	});
}

test('inserts the nbdime ready notification without changing notebook comparison markup', () => {
	const html = renderDiffPage('<html><body><div id="nbdime-root"></div></body></html>');
	assert.match(html, /theia-nbdime-ready/);
	assert.match(html, /jp-Notebook-diff/);
	assert.match(html, /nbdime-root/);
	assert.throws(() => renderDiffPage('<html></html>'), /body closing tag/);
});

test('supports nbdime version printed on stderr with status 1, then replaces opened diff only after render notification', async () => {
	const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'nbdime-cli-test-'));
	const bin = path.join(fixture, 'bin');
	await fs.mkdir(bin);
	const command = path.join(bin, 'nbdime');
	await fs.writeFile(command, `#!/usr/bin/env node
const http = require('node:http');
const args = process.argv.slice(2);
if (args.includes('--version')) {
	console.error('4.0.4');
	process.exit(1);
}
if (args[0] !== 'diff-web') process.exit(5);
const port = Number(args.find(x => x.startsWith('--port=')).split('=')[1]);
const prefix = args.find(x => x.startsWith('--base-url=')).split('=')[1];
http.createServer((req, res) => {
	res.setHeader('Content-Security-Policy', 'frame-ancestors \\'self\\'');
	if (req.url.startsWith(prefix + 'diff')) {
		res.setHeader('Content-Type', 'text/html; charset=utf-8');
		res.end('<html><body><div id="nbdime-root"></div></body></html>');
	} else if (req.url.startsWith(prefix + 'api/diff')) {
		const xsrf = req.headers['x-xsrftoken'];
		if (req.method !== 'POST' || !xsrf || req.headers.cookie !== '_xsrf=' + xsrf) {
			res.statusCode = 403;
			res.end('XSRF token missing');
			return;
		}
		res.setHeader('Content-Type', 'application/json');
		res.end(JSON.stringify({base: {cells: []}, diff: []}));
	} else if (req.url.startsWith(prefix + 'static/')) {
		res.end('/* test asset */');
	} else {
		res.statusCode = 404;
		res.end();
	}
}).listen(port, '127.0.0.1');
`, {mode: 0o755});
	const previousPath = process.env.PATH;
	process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
	let onTabs;
	let onMessage;
	let createdPanel;
	let closed = 0;
	let createCount = 0;
	const uri = text => ({path: '/project/sample.ipynb', toString: () => text});
	const original = uri('git:/project/sample.ipynb?ref=A');
	const modified = uri('file:/project/sample.ipynb');
	const tab = {label: 'sample.ipynb', input: {original, modified}, group: {viewColumn: 1}};
	const mock = {
		ViewColumn: {Active: 1},
		Uri: {parse: value => ({toString: () => value})},
		workspace: {
			openTextDocument: async () => ({getText: () => NOTEBOOK}),
			fs: {readFile: async () => Buffer.from(NOTEBOOK)},
			getConfiguration: () => ({get: (key, def) => def})
		},
		env: {asExternalUri: async uri => {
			const url = new URL(uri.toString());
			if (url.search) url.search = `?${encodeURIComponent(url.search.slice(1))}`;
			return {toString: () => url.toString()};
		}, openExternal: async () => true},
		commands: {registerCommand: () => ({dispose() {}}), executeCommand: async () => undefined},
		window: {
			tabGroups: {
				activeTabGroup: {activeTab: tab},
				all: [],
				close: async () => {closed++; return true;},
				onDidChangeTabs: listener => {onTabs = listener; return {dispose() {}};}
			},
			createWebviewPanel: () => {
				createCount++;
				createdPanel = {
					webview: {cspSource: 'vscode-resource:', html: '', onDidReceiveMessage: listener => {onMessage = listener; return {dispose() {}};}},
					onDidDispose(listener) {this.onDispose = listener;},
					dispose() {if (this.onDispose) this.onDispose();}
				};
				return createdPanel;
			},
			showErrorMessage: error => {throw Error(error);},
			showInformationMessage: () => undefined
		}
	};
	const previousLoad = Module._load;
	Module._load = function(request, ...args) {
		if (request === 'vscode') return mock;
		return previousLoad.call(this, request, ...args);
	};
	let extension;
	try {
		assert.equal(await commandAvailable('nbdime'), '4.0.4');
		delete require.cache[require.resolve('../src/extension')];
		extension = require('../src/extension');
		extension.activate({extensionPath: path.resolve(__dirname, '..'), subscriptions: []});
		onTabs({opened: [tab], changed: [], closed: []});
		for (let i = 0; i < 120 && (!createdPanel || !createdPanel.webview.html); i++) {
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		assert.equal(createCount, 1);
		assert.match(createdPanel.webview.html, /nbdime: sample.ipynb/);
		assert.match(createdPanel.webview.html, /iframe/);
		assert.equal(closed, 0);
		const url = createdPanel.webview.html.match(/src='([^']+\/diff\?base=before\.ipynb[^']+)'/)[1].replaceAll('&amp;', '&');
		assert.match(url, /\?base=before\.ipynb&remote=after\.ipynb$/);
		const page = await get(url);
		assert.equal(page.status, 200);
		assert.equal(page.headers['content-security-policy'], undefined);
		assert.match(page.body, /theia-nbdime-ready/);
		assert.match(page.body, /nbdime-root/);
		const apiUrl = new URL(url);
		apiUrl.pathname = apiUrl.pathname.replace(/\/diff$/, '/api/diff');
		apiUrl.search = '';
		const apiStatus = await new Promise((resolve, reject) => {
			const request = http.request(apiUrl, {method: 'POST', headers: {'content-type': 'application/json'}}, response => {
				response.resume();
				response.on('end', () => resolve(response.statusCode));
			});
			request.once('error', reject);
			request.end(JSON.stringify({base: 'before.ipynb', remote: 'after.ipynb'}));
		});
		assert.equal(apiStatus, 200);
		await onMessage({type: 'loaded'});
		assert.equal(closed, 0, 'A generic iframe load must not close the JSON diff');
		await onMessage({type: 'ready'});
		assert.equal(closed, 1);
	} finally {
		if (extension) extension.deactivate();
		Module._load = previousLoad;
		process.env.PATH = previousPath;
		await fs.rm(fixture, {recursive: true, force: true});
	}
});
