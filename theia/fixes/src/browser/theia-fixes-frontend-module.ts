import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommonFrontendContribution } from '@theia/core/lib/browser/common-frontend-contribution';
import { ElectronIpcConnectionProvider } from '@theia/core/lib/electron-browser/messaging/electron-ipc-connection-source';
import { ContainerModule } from '@theia/core/shared/inversify';
import { CodeFoldingPersistenceContribution } from './code-folding-persistence';
import { TripleClickLineSelectionContribution } from './triple-click-line-selection';
import { HotExitBackupService, HotExitBackupServicePath } from '../common/hot-exit-protocol';
import { HotExitCommonFrontendContribution } from './hot-exit-common-frontend-contribution';
import { HotExitContribution } from './hot-exit-contribution';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
	bind(CodeFoldingPersistenceContribution).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(CodeFoldingPersistenceContribution);
	bind(TripleClickLineSelectionContribution).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(TripleClickLineSelectionContribution);
	bind(HotExitBackupService).toDynamicValue(context => ElectronIpcConnectionProvider.createProxy(context.container, HotExitBackupServicePath)).inSingletonScope();
	bind(HotExitContribution).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(HotExitContribution);
	rebind(CommonFrontendContribution).to(HotExitCommonFrontendContribution).inSingletonScope();
});
