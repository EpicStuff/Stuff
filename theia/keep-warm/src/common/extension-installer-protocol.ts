import { RpcServer } from '@theia/core/lib/common/messaging/proxy-factory';

export const KeepWarmExtensionInstallerPath = '/services/keep-warm-extension-installer';

export interface KeepWarmExtensionInstallerClient {
	installExtension(extensionPath: string): Promise<void>;
	openWorkspace(workspacePath: string): Promise<void>;
}

export const KeepWarmExtensionInstallerService = Symbol('KeepWarmExtensionInstallerService');
export interface KeepWarmExtensionInstallerService extends RpcServer<KeepWarmExtensionInstallerClient> {
}
