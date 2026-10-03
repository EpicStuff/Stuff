import { CommandContribution, MenuContribution } from '@theia/core';
import { ContainerModule } from '@theia/core/shared/inversify';
import { NotebookCellInputCollapseContribution, patchNotebookCodeCellInputCollapse } from './notebook-cell-input-collapse';

export default new ContainerModule(bind => {
	patchNotebookCodeCellInputCollapse();

	bind(NotebookCellInputCollapseContribution).toSelf().inSingletonScope();
	bind(CommandContribution).toService(NotebookCellInputCollapseContribution);
	bind(MenuContribution).toService(NotebookCellInputCollapseContribution);
});
