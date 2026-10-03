import { CommandContribution, MenuContribution } from '@theia/core';
import { ContainerModule } from '@theia/core/shared/inversify';
import { codeToTheiaMappings } from '@theia/plugin-ext/lib/main/browser/menus/vscode-theia-menu-mappings';
import { NotebookMenus } from '@theia/notebook/lib/browser/contributions/notebook-actions-contribution';
import { NotebookCellInputCollapseContribution, patchNotebookCellToolbarInputCollapseIcon, patchNotebookCodeCellInputCollapse } from './notebook-cell-input-collapse';

function patchNotebookToolbarMenuMapping(): void {
	codeToTheiaMappings.set('notebook/toolbar', [NotebookMenus.NOTEBOOK_MAIN_TOOLBAR]);
}

export default new ContainerModule(bind => {
	patchNotebookToolbarMenuMapping();
	patchNotebookCodeCellInputCollapse();
	patchNotebookCellToolbarInputCollapseIcon();

	bind(NotebookCellInputCollapseContribution).toSelf().inSingletonScope();
	bind(CommandContribution).toService(NotebookCellInputCollapseContribution);
	bind(MenuContribution).toService(NotebookCellInputCollapseContribution);
});
