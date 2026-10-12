import { RpcConnectionHandler } from '@theia/core/lib/common/messaging/proxy-factory';
import { ElectronConnectionHandler } from '@theia/core/lib/electron-main/messaging/electron-connection-handler';
import { ContainerModule } from '@theia/core/shared/inversify';
import { HotExitBackupService, HotExitBackupServicePath } from '../common/hot-exit-protocol';
import { HotExitBackupServiceImpl } from './hot-exit-backup-service';

export default new ContainerModule(bind => {
	bind(HotExitBackupServiceImpl).toSelf().inSingletonScope();
	bind(ElectronConnectionHandler).toDynamicValue(context =>
		new RpcConnectionHandler<HotExitBackupService>(HotExitBackupServicePath, () => context.container.get(HotExitBackupServiceImpl))
	).inSingletonScope();
});
