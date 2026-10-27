'use strict';

const vscode = require('vscode');
const path = require('node:path');
const crypto = require('node:crypto');
const {notebookDiffInput, notebookContent, signature, safeHtml} = require('./core');
const {startBackend, cleanupBackend} = require('./backend');

const treated = new WeakMap();
const sessions = new Set();
const openOriginalBypass = new Map();
let extensionContext;
let disposed = false;

function settings() {
	return vscode.workspace.getConfiguration('notebookDiff');
}

async function readRevision(uri) {
	try {
		const document = await vscode.workspace.openTextDocument(uri);
		return notebookContent(document.getText());
	} catch (documentError) {
		try {
			const contents = await vscode.workspace.fs.readFile(uri);
			return notebookContent(Buffer.from(contents).toString('utf8'));
		} catch (fileError) {
			throw new Error(`Cannot read revision ${uri.toString()}\nDocument: ${documentError.message}\nFilesystem: ${fileError.message}`);
		}
	}
}

function webviewDocument(url, title, cspSource, nonce) {
	const origin = new URL(url).origin;
	return `<!DOCTYPE html>
<html lang='en'>
<head>
<meta charset='UTF-8'>
<meta name='viewport' content='width=device-width, initial-scale=1.0'>
<meta http-equiv='Content-Security-Policy' content="default-src 'none'; frame-src ${origin}; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
<style>
html, body { height: 100%; width: 100%; margin: 0; overflow: hidden; background: var(--vscode-editor-background, #1e1e1e); color: var(--vscode-editor-foreground, white); font: 13px sans-serif; }
#head { height: 28px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; background: var(--vscode-editorGroupHeader-tabsBackground, #252526); }
#head button { background: none; color: inherit; border: none; cursor: pointer; text-decoration: underline; }
iframe { border: 0; width: 100%; height: calc(100% - 28px); display: block; background: white; }
</style>
</head>
<body>
<div id='head'><span>nbdime: ${safeHtml(title)}</span><button id='original'>Open original JSON diff</button></div>
<iframe id='notebook' title='Notebook diff' referrerpolicy='no-referrer' src='${safeHtml(url)}'></iframe>
<script nonce='${nonce}'>
const api = acquireVsCodeApi();
document.getElementById('original').addEventListener('click', () => api.postMessage({type: 'openOriginal'}));
const iframe = document.getElementById('notebook');
const message = document.createElement('div');
message.id = 'viewer-status';
message.setAttribute('role', 'status');
message.textContent = 'Loading nbdime notebook comparison...';
message.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: var(--vscode-editor-foreground, #ddd); background: var(--vscode-editor-background, #242424); padding: 14px 20px; border-radius: 6px;';
document.body.appendChild(message);
let ready = false;
window.addEventListener('message', event => {
	if (event.source !== iframe.contentWindow || event.origin !== new URL(iframe.src).origin || event.data?.type !== 'theia-nbdime-ready') return;
	ready = true;
	message.remove();
	api.postMessage({type: 'ready'});
});
setTimeout(() => {
	if (!ready) {
		message.textContent = 'nbdime did not render. Check Theia Developer Tools for blocked frames or Python errors. The original JSON diff remains available.';
		message.style.maxWidth = '520px';
	}
}, 15000);
</script>
</body>
</html>`;
}

async function openNotebookDiff(tab, force = false) {
	const input = notebookDiffInput(tab);
	if (!input || disposed) return;
	if (!force && !settings().get('enabled', true)) return;
	const key = signature(input);
	const skipUntil = openOriginalBypass.get(key);
	if (skipUntil && skipUntil > Date.now()) {
		openOriginalBypass.delete(key);
		return;
	}
	if (treated.get(tab) === key) return;
	treated.set(tab, key);
	let backend;
	let panel;
	try {
		const [before, after] = await Promise.all([readRevision(input.original), readRevision(input.modified)]);
		backend = await startBackend(before, after, settings().get('hideUnchanged', true));
		if (disposed) {
			cleanupBackend(backend);
			return;
		}
		const target = await vscode.env.asExternalUri(vscode.Uri.parse(backend.uri));
		const title = path.basename(input.modified.path || input.original.path || 'notebook.ipynb');
		const column = tab.group ? tab.group.viewColumn : vscode.ViewColumn.Active;
		panel = vscode.window.createWebviewPanel('notebookDiff.nbdime', `nbdime: ${title}`, column, {enableScripts: true, retainContextWhenHidden: true});
		const nonce = crypto.randomBytes(16).toString('base64');
		const html = webviewDocument(target.toString(), title, panel.webview.cspSource, nonce);
		const session = {panel, backend};
		sessions.add(session);
		panel.onDidDispose(() => {
			sessions.delete(session);
			cleanupBackend(backend);
		});
		let replaced = false;
		panel.webview.onDidReceiveMessage(async message => {
			if (message?.type === 'openOriginal') {
				openOriginalBypass.set(key, Date.now() + 10000);
				await vscode.commands.executeCommand('vscode.diff', input.original, input.modified, tab.label);
			} else if (message?.type === 'ready' && !replaced && settings().get('replaceOriginalDiff', true)) {
				replaced = true;
				await vscode.window.tabGroups.close(tab).catch(error => console.warn('Could not close JSON diff:', error));
			}
		});
		panel.webview.html = html;
	} catch (error) {
		if (panel) panel.dispose();
		else if (backend) cleanupBackend(backend);
		treated.delete(tab);
		vscode.window.showErrorMessage(`Notebook Diff: ${error.message}`, 'Show setup instructions').then(choice => {
			if (choice === 'Show setup instructions') vscode.commands.executeCommand('notebookDiff.showSetup');
		});
		console.error('Notebook Diff:', error);
	}
}

function activate(context) {
	disposed = false;
	extensionContext = context;
	context.subscriptions.push(vscode.commands.registerCommand('notebookDiff.openActiveDiff', async () => {
		const active = vscode.window.tabGroups.activeTabGroup.activeTab;
		if (!notebookDiffInput(active)) {
			vscode.window.showInformationMessage('Open a JSON .ipynb diff first, then run this command.');
			return;
		}
		await openNotebookDiff(active, true);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('notebookDiff.showSetup', async () => {
		await vscode.env.openExternal(vscode.Uri.parse('https://github.com/jupyter/nbdime#installation'));
	}));
	context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(event => {
		for (const tab of [...event.opened, ...event.changed]) {
			void openNotebookDiff(tab);
		}
		for (const tab of event.closed) treated.delete(tab);
	}));
	for (const group of vscode.window.tabGroups.all) {
		for (const tab of group.tabs) {
			if (tab.isActive) void openNotebookDiff(tab);
		}
	}
}

function deactivate() {
	disposed = true;
	for (const session of [...sessions]) session.panel.dispose();
}

module.exports = {activate, deactivate};
