const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('keeps two Typst previews independent and cleans up their Tinymist tasks', async () => {
	const panels = [];
	const commands = [];
	const vscode = {
		ViewColumn: {Beside: 2},
		extensions: {getExtension: () => ({packageJSON: {version: '0.15.10'}})},
		window: {
			createWebviewPanel(viewType, title, column, options) {
				const listeners = [];
				const panel = {
					viewType, title, column, options, webview: {html: ''}, disposed: false,
					onDidDispose(listener) { listeners.push(listener); },
					dispose() {
						if (this.disposed) return;
						this.disposed = true;
						for (const listener of listeners) listener();
					}
				};
				panels.push(panel);
				return panel;
			}
		},
		commands: {
			async executeCommand(command, argument) {
				commands.push([command, argument.taskId]);
			}
		}
	};
	const module = {exports: {}};
	vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8'), {
		module,
		require: name => name === 'vscode' ? vscode : require(name),
		console
	});
	const previewer = module.exports.activate().providePreviewer();
	const first = {
		taskId: 'first', documentUri: 'file:///tmp/first.typ',
		documentPath: '/tmp/first.typ', staticServerPort: 34501
	};
	const second = {
		taskId: 'second', documentUri: 'file:///tmp/second.typ',
		documentPath: '/tmp/second.typ', staticServerPort: 34502
	};
	const firstDisposer = previewer.handlePreview(first);
	const secondDisposer = previewer.handlePreview(second);

	assert.equal(panels.length, 2);
	assert.equal(panels[0].disposed, false);
	assert.equal(panels[1].disposed, false);
	assert.equal(panels[0].title, 'Typst: first.typ');
	assert.equal(panels[1].title, 'Typst: second.typ');
	assert.equal(panels[0].viewType, 'tinymist.theiaPreview');
	assert.equal(panels[0].column, vscode.ViewColumn.Beside);
	assert.equal(panels[0].options.retainContextWhenHidden, true);
	assert.match(panels[0].webview.html, /frame-src http:\/\/127\.0\.0\.1:34501\//);
	assert.match(panels[0].webview.html, /src='http:\/\/127\.0\.0\.1:34501\/'/);
	assert.match(panels[1].webview.html, /src='http:\/\/127\.0\.0\.1:34502\/'/);

	panels[0].dispose();
	await Promise.resolve();
	assert.deepEqual(commands, [['tinymist.doDisposePreview', 'first']]);
	assert.equal(panels[1].disposed, false);

	previewer.handlePreview({...first, taskId: 'first-reopened', staticServerPort: 34503});
	assert.equal(panels.length, 3);
	assert.equal(panels[2].disposed, false);
	assert.match(panels[2].webview.html, /127\.0\.0\.1:34503/);

	firstDisposer.dispose();
	secondDisposer.dispose();
	assert.equal(panels[1].disposed, true);
	assert.equal(panels[2].disposed, false);
	assert.deepEqual(commands, [['tinymist.doDisposePreview', 'first']]);

	previewer.handlePreview({...first, taskId: 'first-again', staticServerPort: 34505});
	await Promise.resolve();
	assert.equal(panels.length, 4);
	assert.equal(panels[2].disposed, true);
	assert.equal(panels[3].disposed, false);
	assert.deepEqual(commands, [
		['tinymist.doDisposePreview', 'first'],
		['tinymist.doDisposePreview', 'first-reopened']
	]);

	await module.exports.deactivate();
	assert.equal(panels[3].disposed, true);
	assert.deepEqual(commands, [
		['tinymist.doDisposePreview', 'first'],
		['tinymist.doDisposePreview', 'first-reopened'],
		['tinymist.doDisposePreview', 'first-again']
	]);
});
