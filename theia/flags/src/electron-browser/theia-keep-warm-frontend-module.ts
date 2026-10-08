import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ElectronIpcConnectionProvider } from '@theia/core/lib/electron-browser/messaging/electron-ipc-connection-source';
import { ContainerModule } from '@theia/core/shared/inversify';
import { KeepWarmExtensionInstallerPath, KeepWarmExtensionInstallerService } from '../common/extension-installer-protocol';
import { KeepWarmExtensionInstallerClientImpl, KeepWarmExtensionInstallerFrontendContribution } from './keep-warm-extension-installer-client';

export default new ContainerModule(bind => {
	bind(KeepWarmExtensionInstallerClientImpl).toSelf().inSingletonScope();
	bind(KeepWarmExtensionInstallerService).toDynamicValue(context => {
		const client = context.container.get(KeepWarmExtensionInstallerClientImpl);
		return ElectronIpcConnectionProvider.createProxy(context.container, KeepWarmExtensionInstallerPath, client);
	}).inSingletonScope();

	bind(KeepWarmExtensionInstallerFrontendContribution).toSelf().inSingletonScope();
	bind(FrontendApplicationContribution).toService(KeepWarmExtensionInstallerFrontendContribution);
});
