import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { ViewColumnService } from '@theia/core/lib/browser/shell/view-column-service';
import { JSONExt } from '@theia/core/shared/@lumino/coreutils';
import { WebviewsMainImpl } from '@theia/plugin-ext/lib/main/browser/webviews-main';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';

type WebviewViewState = WebviewWidget['viewState'];

type WebviewsMainInternals = {
	shell: ApplicationShell;
	viewColumnService: ViewColumnService;
	proxy: {
		$onDidChangeWebviewPanelViewState(handle: string, viewState: WebviewViewState): void;
	};
};

type UpdateViewState = (this: WebviewsMainImpl, widget: WebviewWidget, viewColumn?: number) => void;

function isWebviewPanelActive(shell: ApplicationShell, widget: WebviewWidget): boolean {
	if (shell.getAreaFor(widget) !== 'main') {
		return shell.activeWidget === widget;
	}

	return shell.mainPanel.currentTitle?.owner === widget;
}

let installed = false;

export function installWebviewPanelActiveFix(): void {
	if (installed) return;
	installed = true;

	const prototype = WebviewsMainImpl.prototype as unknown as {
		updateViewState?: UpdateViewState;
	};
	if (typeof prototype.updateViewState !== 'function') {
		throw new Error('Unsupported Theia WebviewsMainImpl: updateViewState was not found');
	}

	prototype.updateViewState = function (widget, viewColumn) {
		const internals = this as unknown as WebviewsMainInternals;
		let position = viewColumn || 0;
		if (typeof viewColumn !== 'number') {
			internals.viewColumnService.updateViewColumns();
			position = internals.viewColumnService.getViewColumn(widget.id) || 0;
		}

		const viewState: WebviewViewState = {
			active: isWebviewPanelActive(internals.shell, widget),
			visible: !widget.isHidden,
			position
		};
		if (JSONExt.deepEqual(viewState as any, widget.viewState as any)) {
			return;
		}

		widget.viewState = viewState;
		internals.proxy.$onDidChangeWebviewPanelViewState(widget.identifier.id, widget.viewState);
	};
}
