const vscode = require('vscode');

const TINYMIST_EXTENSION_ID = 'myriad-dreamin.tinymist';
const GROUP_TABS_OPEN_PREVIEW_URL = 'group-tabs.openPreviewUrl';
const MINI_BROWSER_OPEN_URL = 'mini-browser.openUrl';

function activate() {
	return {
		providePreviewer() {
			const tinymist = vscode.extensions.getExtension(TINYMIST_EXTENSION_ID);
			if (!tinymist) {
				throw new Error('Tinymist is not installed');
			}

			return {
				compatibleTinymistVersion: String(tinymist.packageJSON.version),
				async handlePreview(task) {
					const commands = await vscode.commands.getCommands(true);
					const url = `http://127.0.0.1:${task.staticServerPort}`;

					if (commands.includes(GROUP_TABS_OPEN_PREVIEW_URL)) {
						await vscode.commands.executeCommand(GROUP_TABS_OPEN_PREVIEW_URL, url);
						return;
					}
					if (!commands.includes(MINI_BROWSER_OPEN_URL)) {
						throw new Error('Theia Mini Browser command is not available');
					}

					await vscode.commands.executeCommand(MINI_BROWSER_OPEN_URL, url);
				}
			};
		}
	};
}

function deactivate() {}

module.exports = {
	activate,
	deactivate
};
