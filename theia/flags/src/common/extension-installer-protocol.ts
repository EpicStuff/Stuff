import { RpcServer } from '@theia/core/lib/common/messaging/proxy-factory';

export const KeepWarmExtensionInstallerPath = '/services/keep-warm-extension-installer';

export interface KeepWarmExtensionInstallerClient {
	getWindowId(): Promise<number>;
	getWorkspacePath(): Promise<string | undefined>;
	openWorkspace(workspacePath: string): Promise<void>;
	openFile(filePath: string, line?: number, column?: number): Promise<void>;
	openDiff(leftPath: string, rightPath: string): Promise<void>;
}

export const KeepWarmExtensionInstallerService = Symbol('KeepWarmExtensionInstallerService');
export interface KeepWarmExtensionInstallerService extends RpcServer<KeepWarmExtensionInstallerClient> {
}
