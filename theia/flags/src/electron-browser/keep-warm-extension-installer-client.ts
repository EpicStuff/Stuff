import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { PluginServer } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { KeepWarmExtensionInstallerClient, KeepWarmExtensionInstallerService } from '../common/extension-installer-protocol';

@injectable()
export class KeepWarmExtensionInstallerClientImpl implements KeepWarmExtensionInstallerClient {
	@inject(PluginServer)
	protected readonly pluginServer: PluginServer;

	async installExtension(extensionPath: string): Promise<void> {
		await this.pluginServer.install(`local-file:${extensionPath}`);
	}
}

@injectable()
export class KeepWarmExtensionInstallerFrontendContribution implements FrontendApplicationContribution {
	@inject(KeepWarmExtensionInstallerService)
	protected readonly installerService: KeepWarmExtensionInstallerService;

	onStart(): void {
		void this.installerService;
	}
}
