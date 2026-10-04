import { RpcServer } from '@theia/core/lib/common/messaging/proxy-factory';

export const KeepWarmExtensionInstallerPath = '/services/keep-warm-extension-installer';

export interface KeepWarmExtensionInstallerClient {
	installExtension(extensionPath: string): Promise<void>;
}

export interface KeepWarmExtensionInstallerService extends RpcServer<KeepWarmExtensionInstallerClient> {
}
