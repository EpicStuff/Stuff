import { CommandContribution, MenuContribution } from '@theia/core';
import { ContainerModule } from '@theia/core/shared/inversify';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { FixedWebviewWidget } from './fixed-webview-widget';
import { NotebookCellInputCollapseContribution, patchNotebookCellToolbarInputCollapseIcon, patchNotebookCodeCellInputCollapse } from './notebook-cell-input-collapse';

export default new ContainerModule(bind => {
	WebviewWidget.prototype.handleContextMenu = FixedWebviewWidget.prototype.handleContextMenu;
	patchNotebookCodeCellInputCollapse();
	patchNotebookCellToolbarInputCollapseIcon();

	bind(NotebookCellInputCollapseContribution).toSelf().inSingletonScope();
	bind(CommandContribution).toService(NotebookCellInputCollapseContribution);
	bind(MenuContribution).toService(NotebookCellInputCollapseContribution);
});
