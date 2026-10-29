import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommonFrontendContribution } from '@theia/core/lib/browser/common-frontend-contribution';
import { ElectronIpcConnectionProvider } from '@theia/core/lib/electron-browser/messaging/electron-ipc-connection-source';
import { ContainerModule } from '@theia/core/shared/inversify';
import { EditorNavigationContribution } from '@theia/editor/lib/browser/editor-navigation-contribution';
import { EditorPreviewManager } from '@theia/editor-preview/lib/browser/editor-preview-manager';
import { FileNavigatorWidget } from '@theia/navigator/lib/browser/navigator-widget';
import { FileNavigatorTree } from '@theia/navigator/lib/browser/navigator-tree';
import { createFileNavigatorContainer } from '@theia/navigator/lib/browser/navigator-container';
import { CodeFoldingPersistenceContribution } from './code-folding-persistence';
import { TripleClickLineSelectionContribution } from './triple-click-line-selection';
import { HotExitBackupService, HotExitBackupServicePath } from '../common/hot-exit-protocol';
import { HotExitCommonFrontendContribution } from './hot-exit-common-frontend-contribution';
import { HotExitContribution } from './hot-exit-contribution';
import { VSCodeWordWrapNavigationContribution } from './vscode-word-wrap-navigation';
import { VSCodeDiffPreviewManager } from './vscode-diff-preview-manager';
import { VSCodeNaturalFileNavigatorTree } from './vscode-natural-file-navigator-tree';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
	bind(CodeFoldingPersistenceContribution).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(CodeFoldingPersistenceContribution);
	bind(TripleClickLineSelectionContribution).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(TripleClickLineSelectionContribution);
	bind(HotExitBackupService).toDynamicValue(context => ElectronIpcConnectionProvider.createProxy(context.container, HotExitBackupServicePath)).inSingletonScope();
	bind(HotExitContribution).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(HotExitContribution);
	rebind(CommonFrontendContribution).to(HotExitCommonFrontendContribution).inSingletonScope();
	rebind(EditorNavigationContribution).to(VSCodeWordWrapNavigationContribution).inSingletonScope();
	rebind(EditorPreviewManager).to(VSCodeDiffPreviewManager).inSingletonScope();
	rebind(FileNavigatorWidget).toDynamicValue(context => {
		const child = createFileNavigatorContainer(context.container);
		child.rebind(FileNavigatorTree).to(VSCodeNaturalFileNavigatorTree).inSingletonScope();
		return child.get(FileNavigatorWidget);
	});
});
