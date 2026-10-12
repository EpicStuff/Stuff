import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommonFrontendContribution } from '@theia/core/lib/browser/common-frontend-contribution';
import { ElectronIpcConnectionProvider } from '@theia/core/lib/electron-browser/messaging/electron-ipc-connection-source';
import { ContainerModule } from '@theia/core/shared/inversify';
import { CodeFoldingPersistenceContribution } from './code-folding-persistence';
import { HotExitBackupService, HotExitBackupServicePath } from '../common/hot-exit-protocol';
import { HotExitCommonFrontendContribution } from './hot-exit-common-frontend-contribution';
import { HotExitContribution } from './hot-exit-contribution';

export default new ContainerModule(bind => {
	bind(CodeFoldingPersistenceContribution).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(CodeFoldingPersistenceContribution);
	bind(HotExitBackupService).toDynamicValue(context => ElectronIpcConnectionProvider.createProxy(context.container, HotExitBackupServicePath)).inSingletonScope();
	bind(HotExitContribution).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(HotExitContribution);
	rebind(CommonFrontendContribution).to(HotExitCommonFrontendContribution).inSingletonScope();
});
