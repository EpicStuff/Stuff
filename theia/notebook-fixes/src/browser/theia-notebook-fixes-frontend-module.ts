import { CommandContribution, MenuContribution } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ContainerModule } from '@theia/core/shared/inversify';
import { NotebookMenus } from '@theia/notebook/lib/browser/contributions/notebook-actions-contribution';
import { codeToTheiaMappings } from '@theia/plugin-ext/lib/main/browser/menus/vscode-theia-menu-mappings';
import { NotebookCellInputCollapseContribution, patchNotebookCellToolbarInputCollapseIcon, patchNotebookCodeCellInputCollapse, readNotebookCellInputCollapseState } from './notebook-cell-input-collapse';
import { patchNotebookContextCompatibility, setNotebookCellInputCollapseStateReader } from './notebook-context-compatibility';
import { NotebookExternalFileChangeContribution } from './notebook-external-file-change';
import { rebindNotebookMarkdownMath } from './notebook-markdown-math';

function patchNotebookToolbarMenuMapping(): void {
	codeToTheiaMappings.set('notebook/toolbar', [NotebookMenus.NOTEBOOK_MAIN_TOOLBAR]);
}

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
	patchNotebookToolbarMenuMapping();
	setNotebookCellInputCollapseStateReader(readNotebookCellInputCollapseState);
	patchNotebookContextCompatibility();
	patchNotebookCodeCellInputCollapse();
	patchNotebookCellToolbarInputCollapseIcon();
	rebindNotebookMarkdownMath(rebind);

	bind(NotebookCellInputCollapseContribution).toSelf().inSingletonScope();
	bind(CommandContribution).toService(NotebookCellInputCollapseContribution);
	bind(MenuContribution).toService(NotebookCellInputCollapseContribution);

	bind(NotebookExternalFileChangeContribution).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(NotebookExternalFileChangeContribution);
});
