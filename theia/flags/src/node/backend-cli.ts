import { randomBytes, timingSafeEqual } from 'crypto';
import { promises as fs } from 'fs';
import * as http from 'http';
import * as path from 'path';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { ElectronSecurityToken } from '@theia/core/lib/electron-common/electron-token';
import { BackendApplicationContribution, CliContribution } from '@theia/core/lib/node';
import express = require('@theia/core/shared/express');
import { Arguments, Argv } from '@theia/core/shared/yargs';
import { inject, injectable } from '@theia/core/shared/inversify';
import { PluginDeployerHandler, PluginIdentifiers, PluginServer, PluginType } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { PluginDeployerContribution } from '@theia/plugin-ext/lib/main/node/plugin-deployer-contribution';
import { VSXExtensionUri } from '@theia/vsx-registry/lib/common';
import { VsxCli } from '@theia/vsx-registry/lib/node/vsx-cli';

const BACKEND_CLI_ENDPOINT = '/epicstuff/backend-cli';
const BACKEND_CLI_STATE_FILE = 'backend-cli.json';
const BACKEND_CLI_TOKEN_HEADER = 'x-epicstuff-backend-cli-token';

interface BackendCliRequest {
	cwd: string;
	installExtensions: string[];
	uninstallExtensions: string[];
	listExtensions: boolean;
	showVersions: boolean;
}

interface BackendCliResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

interface BackendCliEndpointState {
	port: number;
	pid: number;
	token: string;
	electronToken?: string;
}

@injectable()
export class KeepWarmBackendCliState {
	readonly active = process.env.THEIA_BACKEND_CLI === '1';
	installExtensions: string[] = [];
	uninstallExtensions: string[] = [];
	listExtensions = false;
	showVersions = false;
	deploymentError: unknown;
	forwardedResult: BackendCliResult | undefined;

	toRequest(): BackendCliRequest {
		return {
			cwd: process.cwd(),
			installExtensions: this.installExtensions,
			uninstallExtensions: this.uninstallExtensions,
			listExtensions: this.listExtensions,
			showVersions: this.showVersions
		};
	}
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
export class KeepWarmBackendCliExecutor {
	@inject(PluginDeployerHandler)
	protected readonly pluginDeployerHandler!: PluginDeployerHandler;

	@inject(PluginServer)
	protected readonly pluginServer!: PluginServer;

	async execute(request: BackendCliRequest): Promise<BackendCliResult> {
		const stdout: string[] = [];
		const stderr: string[] = [];
		let exitCode = 0;

		try {
			if (request.showVersions && !request.listExtensions) {
				throw new Error('--show-versions requires --list-extensions');
			}

			for (const extension of request.installExtensions) {
				const resolved = await this.resolveExtensionInstallTarget(extension, request.cwd);
				await this.pluginServer.install(resolved.entry);
				stdout.push(`Installed extension: ${resolved.display}`);
			}

			for (const extensionId of request.uninstallExtensions) {
				const versionedId = await this.resolveInstalledExtension(extensionId);
				await this.pluginServer.uninstall(versionedId);
				stdout.push(`Uninstalled extension: ${versionedId}`);
			}

			if (request.listExtensions) {
				const extensions = await this.getUserExtensionVersionedIds();
				stdout.push(...(request.showVersions ? extensions : extensions.map(id => PluginIdentifiers.toUnversioned(id))));
			}
		} catch (error) {
			exitCode = 1;
			const message = error instanceof Error ? error.message : String(error);
			stderr.push(`theia: ${message}`);
		}

		return {
			stdout: stdout.length > 0 ? `${stdout.join('\n')}\n` : '',
			stderr: stderr.length > 0 ? `${stderr.join('\n')}\n` : '',
			exitCode
		};
	}

	protected async resolveExtensionInstallTarget(extension: string, cwd: string): Promise<{ entry: string; display: string }> {
		const resolvedPath = path.resolve(cwd, extension);

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

@injectable()
export class KeepWarmBackendCliForwarder {
	@inject(EnvVariablesServer)
	protected readonly envVariablesServer!: EnvVariablesServer;

	async forward(request: BackendCliRequest): Promise<BackendCliResult | undefined> {
		let state: BackendCliEndpointState;
		try {
			const raw = await fs.readFile(await this.statePath(), 'utf8');
			state = JSON.parse(raw) as BackendCliEndpointState;
		} catch {
			return undefined;
		}

		if (!Number.isInteger(state.port) || state.port <= 0 || typeof state.token !== 'string') {
			return undefined;
		}

		const body = JSON.stringify(request);
		return new Promise(resolve => {
			const headers: Record<string, string | number> = {
				'content-type': 'application/json',
				'content-length': Buffer.byteLength(body),
				[BACKEND_CLI_TOKEN_HEADER]: state.token
			};
			if (typeof state.electronToken === 'string') {
				headers.cookie = `${ElectronSecurityToken}=${encodeURIComponent(state.electronToken)}`;
			}

			const requestHandle = http.request({
				hostname: '127.0.0.1',
				port: state.port,
				path: BACKEND_CLI_ENDPOINT,
				method: 'POST',
				headers
			}, response => {
				const chunks: Buffer[] = [];
				response.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
				response.on('end', () => {
					if (response.statusCode !== 200) {
						resolve(undefined);
						return;
					}
					try {
						resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as BackendCliResult);
					} catch {
						resolve(undefined);
					}
				});
			});
			requestHandle.setTimeout(1000, () => requestHandle.destroy());
			requestHandle.on('error', () => resolve(undefined));
			requestHandle.end(body);
		});
	}

	async statePath(): Promise<string> {
		return path.join(FileUri.fsPath(await this.envVariablesServer.getConfigDirUri()), BACKEND_CLI_STATE_FILE);
	}
}

@injectable()
export class KeepWarmBackendCliPluginDeployerContribution extends PluginDeployerContribution {
	@inject(KeepWarmBackendCliState)
	protected readonly backendCliState!: KeepWarmBackendCliState;

	@inject(KeepWarmBackendCliForwarder)
	protected readonly forwarder!: KeepWarmBackendCliForwarder;

	@inject(VsxCli)
	protected readonly vsxCli!: VsxCli;

	override async initialize(): Promise<void> {
		if (!this.backendCliState.active) {
			return super.initialize();
		}

		this.backendCliState.forwardedResult = await this.forwarder.forward(this.backendCliState.toRequest());
		if (this.backendCliState.forwardedResult) {
			return;
		}

		this.vsxCli.pluginsToInstall = [];
		try {
			await this.pluginDeployer.start();
		} catch (error) {
			this.backendCliState.deploymentError = error;
		}
	}
}

@injectable()
export class KeepWarmBackendCliRunner implements BackendApplicationContribution {
	protected readonly endpointToken = randomBytes(32).toString('hex');

	@inject(KeepWarmBackendCliState)
	protected readonly state!: KeepWarmBackendCliState;

	@inject(KeepWarmBackendCliExecutor)
	protected readonly executor!: KeepWarmBackendCliExecutor;

	@inject(KeepWarmBackendCliForwarder)
	protected readonly forwarder!: KeepWarmBackendCliForwarder;

	configure(app: express.Application): Promise<void> | void {
		if (this.state.active) {
			return this.runCommand();
		}

		app.post(BACKEND_CLI_ENDPOINT, express.json({ limit: '1mb' }), async (request, response) => {
			if (!this.isEndpointTokenValid(request.get(BACKEND_CLI_TOKEN_HEADER))) {
				response.sendStatus(403);
				return;
			}
			const command = this.parseRequest(request.body);
			if (!command) {
				response.status(400).json({
					stdout: '',
					stderr: 'theia: Invalid backend CLI request\n',
					exitCode: 1
				} satisfies BackendCliResult);
				return;
			}
			response.json(await this.executor.execute(command));
		});
	}

	async onStart(server: http.Server): Promise<void> {
		if (this.state.active) {
			return;
		}
		const address = server.address();
		if (!address || typeof address === 'string') {
			return;
		}

		const state: BackendCliEndpointState = {
			port: address.port,
			pid: process.pid,
			token: this.endpointToken,
			electronToken: process.env[ElectronSecurityToken]
		};
		const statePath = await this.forwarder.statePath();
		await fs.mkdir(path.dirname(statePath), { recursive: true });
		const temporaryPath = `${statePath}.${process.pid}.tmp`;
		await fs.writeFile(temporaryPath, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 });
		await fs.rename(temporaryPath, statePath);
	}

	async onStop(): Promise<void> {
		if (this.state.active) {
			return;
		}
		const statePath = await this.forwarder.statePath();
		try {
			const raw = await fs.readFile(statePath, 'utf8');
			const state = JSON.parse(raw) as BackendCliEndpointState;
			if (state.pid === process.pid && state.token === this.endpointToken) {
				await fs.rm(statePath, { force: true });
			}
		} catch {
			// A missing or stale state file needs no cleanup.
		}
	}

	protected async runCommand(): Promise<void> {
		let result = this.state.forwardedResult;
		if (!result) {
			if (this.state.deploymentError) {
				const message = this.state.deploymentError instanceof Error ? this.state.deploymentError.message : String(this.state.deploymentError);
				result = {
					stdout: '',
					stderr: `theia: ${message}\n`,
					exitCode: 1
				};
			} else {
				result = await this.executor.execute(this.state.toRequest());
			}
		}

		if (result.stdout) {
			process.stdout.write(result.stdout);
		}
		if (result.stderr) {
			process.stderr.write(result.stderr);
		}
		await new Promise<never>(() => {
			setImmediate(() => process.exit(result.exitCode));
		});
	}

	protected isEndpointTokenValid(received: string | undefined): boolean {
		if (typeof received !== 'string') {
			return false;
		}
		const actual = Buffer.from(received, 'utf8');
		const expected = Buffer.from(this.endpointToken, 'utf8');
		return actual.length === expected.length && timingSafeEqual(actual, expected);
	}

	protected parseRequest(value: unknown): BackendCliRequest | undefined {
		if (!value || typeof value !== 'object') {
			return undefined;
		}
		const request = value as Partial<BackendCliRequest>;
		if (typeof request.cwd !== 'string' || !Array.isArray(request.installExtensions) || !Array.isArray(request.uninstallExtensions) ||
			typeof request.listExtensions !== 'boolean' || typeof request.showVersions !== 'boolean' ||
			!request.installExtensions.every(extension => typeof extension === 'string') ||
			!request.uninstallExtensions.every(extension => typeof extension === 'string')) {
			return undefined;
		}
		return {
			cwd: request.cwd,
			installExtensions: request.installExtensions,
			uninstallExtensions: request.uninstallExtensions,
			listExtensions: request.listExtensions,
			showVersions: request.showVersions
		};
	}
}
