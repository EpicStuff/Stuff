import { promises as fs } from 'fs';
import * as path from 'path';
import { BackendApplicationContribution, CliContribution } from '@theia/core/lib/node';
import { Arguments, Argv } from '@theia/core/shared/yargs';
import { inject, injectable } from '@theia/core/shared/inversify';
import { PluginDeployerHandler, PluginIdentifiers, PluginServer, PluginType } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { PluginDeployerContribution } from '@theia/plugin-ext/lib/main/node/plugin-deployer-contribution';
import { VSXExtensionUri } from '@theia/vsx-registry/lib/common';
import { VsxCli } from '@theia/vsx-registry/lib/node/vsx-cli';

@injectable()
export class KeepWarmBackendCliState {
	readonly active = process.env.THEIA_BACKEND_CLI === '1';
	installExtensions: string[] = [];
	uninstallExtensions: string[] = [];
	listExtensions = false;
	showVersions = false;
	deploymentError: unknown;
}

@injectable()
export class KeepWarmBackendCliContribution implements CliContribution {
	@inject(KeepWarmBackendCliState)
	protected readonly state!: KeepWarmBackendCliState;

	@inject(VsxCli)
	protected readonly vsxCli!: VsxCli;

	configure(conf: Argv): void {
		conf.option('uninstall-extension', {
			type: 'string',
			array: true,
			nargs: 1,
			description: 'Uninstall an extension'
		});
		conf.option('list-extensions', {
			type: 'boolean',
			default: false,
			description: 'List installed user extensions'
		});
		conf.option('show-versions', {
			type: 'boolean',
			default: false,
			description: 'Show versions with --list-extensions'
		});
		conf.option('user-data-dir', {
			type: 'string',
			description: 'Set the Theia user data directory'
		});
	}

	setArguments(args: Arguments): void {
		if (!this.state.active) {
			return;
		}

		const installExtensions = args.installPlugin;
		if (typeof installExtensions === 'string') {
			this.state.installExtensions = [installExtensions];
		} else if (Array.isArray(installExtensions)) {
			this.state.installExtensions = installExtensions.filter((value): value is string => typeof value === 'string');
		}
		this.vsxCli.pluginsToInstall = [];

		const uninstallExtensions = args.uninstallExtension;
		if (typeof uninstallExtensions === 'string') {
			this.state.uninstallExtensions = [uninstallExtensions];
		} else if (Array.isArray(uninstallExtensions)) {
			this.state.uninstallExtensions = uninstallExtensions.filter((value): value is string => typeof value === 'string');
		}

		this.state.listExtensions = args.listExtensions === true;
		this.state.showVersions = args.showVersions === true;

		if (typeof args.userDataDir === 'string') {
			process.env.THEIA_CONFIG_DIR = path.resolve(process.cwd(), args.userDataDir);
		}
	}
}

@injectable()
export class KeepWarmBackendCliPluginDeployerContribution extends PluginDeployerContribution {
	@inject(KeepWarmBackendCliState)
	protected readonly backendCliState!: KeepWarmBackendCliState;

	override async initialize(): Promise<void> {
		if (!this.backendCliState.active) {
			return super.initialize();
		}

		try {
			await this.pluginDeployer.start();
		} catch (error) {
			this.backendCliState.deploymentError = error;
		}
	}
}

@injectable()
export class KeepWarmBackendCliRunner implements BackendApplicationContribution {
	@inject(KeepWarmBackendCliState)
	protected readonly state!: KeepWarmBackendCliState;

	@inject(PluginDeployerHandler)
	protected readonly pluginDeployerHandler!: PluginDeployerHandler;

	@inject(PluginServer)
	protected readonly pluginServer!: PluginServer;

	async configure(): Promise<void> {
		if (!this.state.active) {
			return;
		}

		let exitCode = 0;
		try {
			if (this.state.deploymentError) {
				throw this.state.deploymentError;
			}
			if (this.state.showVersions && !this.state.listExtensions) {
				throw new Error('--show-versions requires --list-extensions');
			}

			for (const extension of this.state.installExtensions) {
				const resolved = await this.resolveExtensionInstallTarget(extension);
				await this.pluginServer.install(resolved.entry);
				process.stdout.write(`Installed extension: ${resolved.display}\n`);
			}

			for (const extensionId of this.state.uninstallExtensions) {
				const versionedId = await this.resolveInstalledExtension(extensionId);
				await this.pluginServer.uninstall(versionedId);
				process.stdout.write(`Uninstalled extension: ${versionedId}\n`);
			}

			if (this.state.listExtensions) {
				const extensions = await this.getUserExtensionVersionedIds();
				const output = this.state.showVersions ? extensions : extensions.map(id => PluginIdentifiers.toUnversioned(id));
				if (output.length > 0) {
					process.stdout.write(`${output.join('\n')}\n`);
				}
			}
		} catch (error) {
			exitCode = 1;
			const message = error instanceof Error ? error.message : String(error);
			process.stderr.write(`theia: ${message}\n`);
		}

		await new Promise<never>(() => {
			setImmediate(() => process.exit(exitCode));
		});
	}

	protected async resolveExtensionInstallTarget(extension: string): Promise<{ entry: string; display: string }> {
		const resolvedPath = path.resolve(process.cwd(), extension);

		try {
			const stat = await fs.stat(resolvedPath);
			if (stat.isFile()) {
				if (path.extname(resolvedPath).toLowerCase() !== '.vsix') {
					throw new Error(`Local extension path must point to a .vsix file: ${extension}`);
				}
				return {
					entry: `local-file:${resolvedPath}`,
					display: resolvedPath
				};
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}

		if (extension.toLowerCase().endsWith('.vsix')) {
			throw new Error(`Extension file does not exist: ${extension}`);
		}
		if (!/^[^.\s@]+\.[^\s@]+(?:@[^\s@]+)?$/.test(extension)) {
			throw new Error(`Invalid extension id '${extension}'. Expected publisher.name[@version] or a .vsix path`);
		}

		return {
			entry: VSXExtensionUri.fromVersionedId(extension).toString(),
			display: extension
		};
	}

	protected async resolveInstalledExtension(extensionId: string): Promise<PluginIdentifiers.VersionedId> {
		const installed = await this.getUserExtensionVersionedIds();
		const requested = extensionId.toLowerCase();
		const versionedId = installed.find(id =>
			id.toLowerCase() === requested || PluginIdentifiers.toUnversioned(id).toLowerCase() === requested
		);
		if (!versionedId) {
			throw new Error(`Extension '${extensionId}' is not installed`);
		}
		return versionedId;
	}

	protected async getUserExtensionVersionedIds(): Promise<PluginIdentifiers.VersionedId[]> {
		const plugins = await this.pluginDeployerHandler.getDeployedPlugins();
		const ids = plugins
			.filter(plugin => plugin.type === PluginType.User)
			.map(plugin => PluginIdentifiers.componentsToVersionedId(plugin.metadata.model));
		return [...new Set(ids)].sort();
	}
}
