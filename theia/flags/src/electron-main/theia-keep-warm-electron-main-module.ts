import { RpcConnectionHandler } from '@theia/core/lib/common/messaging/proxy-factory';
import { ElectronMainApplication } from '@theia/core/lib/electron-main/electron-main-application';
import { ElectronConnectionHandler } from '@theia/core/lib/electron-main/messaging/electron-connection-handler';
import { ContainerModule } from '@theia/core/shared/inversify';
import { KeepWarmExtensionInstallerClient, KeepWarmExtensionInstallerPath } from '../common/extension-installer-protocol';
import { KeepWarmElectronMainApplication } from './keep-warm-electron-main-application';
import { KeepWarmExtensionInstallerServiceImpl } from './keep-warm-extension-installer-service';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
	bind(KeepWarmExtensionInstallerServiceImpl).toSelf().inSingletonScope();
	bind(ElectronConnectionHandler).toDynamicValue(context =>
		new RpcConnectionHandler<KeepWarmExtensionInstallerClient>(KeepWarmExtensionInstallerPath, client => {
			const server = context.container.get(KeepWarmExtensionInstallerServiceImpl);
			server.addClient(client);
			client.onDidCloseConnection(() => server.disconnectClient(client));
			return server;
		})
	).inSingletonScope();

	rebind(ElectronMainApplication).to(KeepWarmElectronMainApplication).inSingletonScope();
});
