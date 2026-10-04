import { FrontendApplicationContribution, OpenerService, open } from '@theia/core/lib/browser';
import { DiffUris } from '@theia/core/lib/browser/diff-uris';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { inject, injectable } from '@theia/core/shared/inversify';
import { HostedPluginServer, PluginIdentifiers, PluginServer, PluginType } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { VSCodeExtensionUri } from '@theia/plugin-ext-vscode/lib/common/plugin-vscode-uri';
import { KeepWarmExtensionInstallerClient, KeepWarmExtensionInstallerService } from '../common/extension-installer-protocol';

@injectable()
export class KeepWarmExtensionInstallerClientImpl implements KeepWarmExtensionInstallerClient {
	@inject(PluginServer)
	protected readonly pluginServer!: PluginServer;

	@inject(HostedPluginServer)
	protected readonly hostedPluginServer!: HostedPluginServer;

	@inject(OpenerService)
	protected readonly openerService!: OpenerService;

	@inject(WindowService)
	protected readonly windowService!: WindowService;

	async getWindowId(): Promise<number> {
		return Number(window.electronTheiaCore.WindowMetadata.webcontentId);
	}

	async installExtension(extension: string, local: boolean): Promise<void> {
		const entry = local ? `local-file:${extension}` : VSCodeExtensionUri.fromVersionedId(extension).toString();
		await this.pluginServer.install(entry);
	}

	async uninstallExtension(extensionId: string): Promise<string> {
		const installed = await this.getUserExtensions(true);
		const requested = extensionId.toLowerCase();
		const versionedId = installed.find(id =>
			id.toLowerCase() === requested || PluginIdentifiers.toUnversioned(id).toLowerCase() === requested
		);

		if (!versionedId) {
			throw new Error(`Extension '${extensionId}' is not installed`);
		}

		await this.pluginServer.uninstall(versionedId as PluginIdentifiers.VersionedId);
		return versionedId;
	}

	async listExtensions(showVersions: boolean): Promise<string[]> {
		return this.getUserExtensions(showVersions);
	}

	async openWorkspace(workspacePath: string): Promise<void> {
		window.location.hash = encodeURI(workspacePath);
		this.windowService.reload();
	}

	async openFile(filePath: string, line?: number, column?: number): Promise<void> {
		const selection = line === undefined ? undefined : {
			start: {
				line: line - 1,
				character: (column ?? 1) - 1
			}
		};
		await open(this.openerService, FileUri.create(filePath), selection ? { selection } : undefined);
	}

	async openDiff(leftPath: string, rightPath: string): Promise<void> {
		const uri = DiffUris.encode(FileUri.create(leftPath), FileUri.create(rightPath));
		await open(this.openerService, uri);
	}

	protected async getUserExtensions(showVersions: boolean): Promise<string[]> {
		const installedIds = await this.hostedPluginServer.getInstalledPluginIds();
		const installedPlugins = await this.hostedPluginServer.getDeployedPlugins(installedIds);
		const versionedIds = installedPlugins
			.filter(plugin => plugin.type === PluginType.User)
			.map(plugin => PluginIdentifiers.componentsToVersionedId(plugin.metadata.model))
			.sort();

		if (showVersions) {
			return versionedIds;
		}
		return versionedIds.map(id => PluginIdentifiers.toUnversioned(id));
	}
}

@injectable()
export class KeepWarmExtensionInstallerFrontendContribution implements FrontendApplicationContribution {
	@inject(KeepWarmExtensionInstallerService)
	protected readonly installerService!: KeepWarmExtensionInstallerService;

	onStart(): void {
		void this.installerService;
	}
}
