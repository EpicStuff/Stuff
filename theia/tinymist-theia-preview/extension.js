const path = require('path');
const vscode = require('vscode');

const TINYMIST_EXTENSION_ID = 'myriad-dreamin.tinymist';

const panels = new Map();

function activate() {
	return {
		providePreviewer() {
			const tinymist = vscode.extensions.getExtension(TINYMIST_EXTENSION_ID);
			if (!tinymist) {
				throw new Error('Tinymist is not installed');
			}

			return {
				compatibleTinymistVersion: String(tinymist.packageJSON.version),
				handlePreview(task) {
					const port = Number(task.staticServerPort);
					if (!Number.isInteger(port) || port < 1 || port > 65535) {
						throw new Error('Tinymist provided an invalid preview server port');
					}
					if (typeof task.documentUri !== 'string' || !task.documentUri) {
						throw new Error('Tinymist did not provide a document URI');
					}

					panels.get(task.documentUri)?.panel.dispose();
					const panel = vscode.window.createWebviewPanel(
						'tinymist.theiaPreview',
						`Typst: ${path.basename(task.documentPath)}`,
						vscode.ViewColumn.Beside,
						{enableScripts: true, retainContextWhenHidden: true}
					);
					const entry = {panel, taskId: task.taskId, disposing: false};
					panels.set(task.documentUri, entry);
					panel.onDidDispose(() => {
						if (panels.get(task.documentUri) === entry) panels.delete(task.documentUri);
						if (!entry.disposing) {
							void vscode.commands.executeCommand('tinymist.doDisposePreview', {taskId: entry.taskId})
								.catch(error => console.error('Could not stop Tinymist preview:', error));
						}
					});

					const url = `http://127.0.0.1:${port}/`;
					panel.webview.html = `<!DOCTYPE html>
<html lang='en'>
<head>
<meta charset='UTF-8'>
<meta name='viewport' content='width=device-width, initial-scale=1.0'>
<meta http-equiv='Content-Security-Policy' content="default-src 'none'; frame-src ${url}; style-src 'unsafe-inline';">
<style>
html, body, iframe { width: 100%; height: 100%; margin: 0; border: 0; overflow: hidden; }
iframe { display: block; background: white; }
</style>
</head>
<body>
<iframe title='Tinymist preview' src='${url}' referrerpolicy='no-referrer'></iframe>
</body>
</html>`;

					return {
						dispose() {
							entry.disposing = true;
							panel.dispose();
						}
					};
				}
			};
		}
	};
}

async function deactivate() {
	for (const entry of [...panels.values()]) {
		entry.disposing = true;
		entry.panel.dispose();
		try {
			await vscode.commands.executeCommand('tinymist.doDisposePreview', {taskId: entry.taskId});
		} catch (error) {
			console.error('Could not stop Tinymist preview:', error);
		}
	}
	panels.clear();
}

module.exports = {
	activate,
	deactivate
};
