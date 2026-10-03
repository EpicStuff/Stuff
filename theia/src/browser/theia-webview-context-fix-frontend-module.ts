import { CommandContribution, MenuContribution } from '@theia/core';
import { ContainerModule } from '@theia/core/shared/inversify';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { codeToTheiaMappings } from '@theia/plugin-ext/lib/main/browser/menus/vscode-theia-menu-mappings';
import { NotebookMenus } from '@theia/notebook/lib/browser/contributions/notebook-actions-contribution';
import { FixedWebviewWidget } from './fixed-webview-widget';
import { NotebookCellInputCollapseContribution, patchNotebookCellToolbarInputCollapseIcon, patchNotebookCodeCellInputCollapse, readNotebookCellInputCollapseState } from './notebook-cell-input-collapse';
import { patchNotebookContextCompatibility, setNotebookCellInputCollapseStateReader } from './notebook-context-compatibility';

function patchNotebookToolbarMenuMapping(): void {
	codeToTheiaMappings.set('notebook/toolbar', [NotebookMenus.NOTEBOOK_MAIN_TOOLBAR]);
}

export default new ContainerModule(bind => {
	WebviewWidget.prototype.handleContextMenu = FixedWebviewWidget.prototype.handleContextMenu;
	patchNotebookToolbarMenuMapping();
	setNotebookCellInputCollapseStateReader(readNotebookCellInputCollapseState);
	patchNotebookContextCompatibility();
	patchNotebookCodeCellInputCollapse();
	patchNotebookCellToolbarInputCollapseIcon();

	bind(NotebookCellInputCollapseContribution).toSelf().inSingletonScope();
	bind(CommandContribution).toService(NotebookCellInputCollapseContribution);
	bind(MenuContribution).toService(NotebookCellInputCollapseContribution);
});
