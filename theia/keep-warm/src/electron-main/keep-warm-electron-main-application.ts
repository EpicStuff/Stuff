import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { app, BrowserWindow, Event as ElectronEvent } from '@theia/core/electron-shared/electron';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { DEFAULT_WINDOW_HASH } from '@theia/core/lib/common/window';
import { ElectronMainApplication, ElectronMainCommandOptions } from '@theia/core/lib/electron-main/electron-main-application';
import { inject, injectable } from '@theia/core/shared/inversify';
import { KeepWarmExtensionInstallerServiceImpl } from './keep-warm-extension-installer-service';

const KEEP_WARM_FLAG = '--keep-warm';
const KEEP_WARMER_FLAG = '--keep-warmer';
const DAEMON_FLAG = '--daemon';
const QUIT_FLAG = '--quit';
const INSTALL_EXTENSION_FLAG = '--install-extension';

@injectable()
export class KeepWarmElectronMainApplication extends ElectronMainApplication {
	@inject(KeepWarmExtensionInstallerServiceImpl)
	protected readonly extensionInstaller!: KeepWarmExtensionInstallerServiceImpl;

	protected keepWarm = false;
	protected keepWarmer = false;
	protected installOnly = false;
	protected suppressInitialEmptyWindow = false;
	protected warmRenderer: BrowserWindow | undefined;
	protected quitting = false;
	protected readonly contributionsStarted = new Deferred<void>();

	override async start(config: Parameters<ElectronMainApplication['start']>[0]): Promise<void> {
		const applicationArgs = this.processArgv.getProcessArgvWithoutBin(process.argv);

		if (applicationArgs.includes(DAEMON_FLAG)) {
			this.spawnDetached(applicationArgs.filter(arg => arg !== DAEMON_FLAG));
			app.exit(0);
			return;
		}

		const extensionToInstall = this.getInstallExtensionArg(applicationArgs);
		if (extensionToInstall) {
			this.installOnly = true;
			this.suppressInitialEmptyWindow = true;
			const cleanArgs = this.removeInstallExtensionArgs(this.removeControlFlags(applicationArgs));
			this.replaceProcessApplicationArgs(applicationArgs, cleanArgs);
			await super.start(config);
			await this.contributionsStarted.promise;

			try {
				const extensionPath = await this.resolveExtensionPath(extensionToInstall, process.cwd());
				await this.installExtension(extensionPath);
				process.stdout.write(`Installed extension: ${extensionPath}\n`);
				this.requestStop();
			} catch (error) {
				process.exitCode = 1;
				console.error(`Failed to install extension '${extensionToInstall}'.`, error);
				this.requestStop();
			}
			return;
		}

		const wantsKeepWarmer = applicationArgs.includes(KEEP_WARMER_FLAG);
		const wantsKeepWarm = wantsKeepWarmer || applicationArgs.includes(KEEP_WARM_FLAG);
		const wantsQuit = applicationArgs.includes(QUIT_FLAG);
		const ownsSingleInstanceLock = app.requestSingleInstanceLock();

		if (!ownsSingleInstanceLock) {
			app.quit();
			return;
		}

		if (wantsQuit) {
			app.releaseSingleInstanceLock();
			app.exit(0);
			return;
		}

		this.keepWarm = wantsKeepWarm;
		this.keepWarmer = wantsKeepWarmer;
		this.suppressInitialEmptyWindow = wantsKeepWarm;

		if (this.keepWarm) {
			process.once('SIGINT', () => this.requestStop());
			app.once('before-quit', () => {
				this.quitting = true;
			});
		}

		if (!this.keepWarm) {
			app.releaseSingleInstanceLock();
		}

		this.replaceProcessApplicationArgs(applicationArgs, this.removeControlFlags(applicationArgs));
		await super.start(config);
	}

	protected override async startContributions(): Promise<void> {
		await super.startContributions();
		this.contributionsStarted.resolve();
	}

	protected spawnDetached(args: string[]): void {
		const child = spawn(process.execPath, args, {
			cwd: process.cwd(),
			detached: true,
			env: { ...process.env },
			stdio: 'ignore'
		});
		child.unref();
	}

	protected getInstallExtensionArg(args: readonly string[]): string | undefined {
		const index = args.indexOf(INSTALL_EXTENSION_FLAG);
		if (index >= 0) {
			return args[index + 1];
		}

		const prefix = `${INSTALL_EXTENSION_FLAG}=`;
		const inlineArg = args.find(arg => arg.startsWith(prefix));
		return inlineArg?.slice(prefix.length);
	}

	protected removeInstallExtensionArgs(args: readonly string[]): string[] {
		const result: string[] = [];
		for (let index = 0; index < args.length; index++) {
			const arg = args[index];
			if (arg === INSTALL_EXTENSION_FLAG) {
				index++;
				continue;
			}
			if (arg.startsWith(`${INSTALL_EXTENSION_FLAG}=`)) {
				continue;
			}
			result.push(arg);
		}
		return result;
	}

	protected removeControlFlags(args: readonly string[]): string[] {
		return args.filter(arg => arg !== KEEP_WARM_FLAG && arg !== KEEP_WARMER_FLAG && arg !== DAEMON_FLAG && arg !== QUIT_FLAG);
	}

	protected replaceProcessApplicationArgs(oldArgs: readonly string[], newArgs: readonly string[]): void {
		const start = process.argv.length - oldArgs.length;
		process.argv.splice(start, oldArgs.length, ...newArgs);
	}

	protected replaceApplicationArgs(argv: readonly string[], oldArgs: readonly string[], newArgs: readonly string[]): string[] {
		const start = argv.length - oldArgs.length;
		return [...argv.slice(0, start), ...newArgs];
	}

	protected override showInitialWindow(urlToOpen: string | undefined): void {
		if ((this.keepWarm || this.installOnly) && !urlToOpen) {
			return;
		}
		super.showInitialWindow(urlToOpen);
	}

	protected override async handleMainCommand(options: ElectronMainCommandOptions): Promise<void> {
		if (this.suppressInitialEmptyWindow && !options.secondInstance) {
			this.suppressInitialEmptyWindow = false;
			if (options.file === undefined) {
				if (this.keepWarmer) {
					await this.ensureWarmRenderer();
				}
				return;
			}
		}

		await super.handleMainCommand(options);
	}

	protected async resolveExtensionPath(extensionPath: string, cwd: string): Promise<string> {
		const resolvedPath = path.resolve(cwd, extensionPath);
		const stat = await fs.stat(resolvedPath);
		if (!stat.isFile()) {
			throw new Error('Extension path is not a file');
		}
		if (path.extname(resolvedPath).toLowerCase() !== '.vsix') {
			throw new Error('Extension path must point to a .vsix file');
		}
		return resolvedPath;
	}

	protected async installExtension(extensionPath: string): Promise<void> {
		const renderer = await this.createHiddenEmptyRenderer();
		try {
			await this.extensionInstaller.installExtension(extensionPath);
		} finally {
			const wrapper = this.windows.get(renderer.webContents.id);
			if (wrapper) {
				await wrapper.close();
			}
		}
	}

	protected async createHiddenEmptyRenderer(): Promise<BrowserWindow> {
		const options = await this.getLastWindowOptions();
		const window = await this.createWindow({
			...options,
			show: false,
			preventAutomaticShow: true
		});
		const uri = await this.createWindowUri();
		await window.loadURL(uri.withFragment(DEFAULT_WINDOW_HASH).toString(true));
		return window;
	}

	protected async ensureWarmRenderer(): Promise<void> {
		if (!this.keepWarmer || this.quitting || this.warmRenderer && !this.warmRenderer.isDestroyed()) {
			return;
		}

		this.warmRenderer = await this.createHiddenEmptyRenderer();
	}

	protected override async openWindowWithWorkspace(workspacePath: string): Promise<BrowserWindow> {
		const window = this.warmRenderer;
		if (!window || window.isDestroyed()) {
			return super.openWindowWithWorkspace(workspacePath);
		}

		this.warmRenderer = undefined;
		window.webContents.once('did-finish-load', () => {
			if (!window.isDestroyed()) {
				window.show();
			}
		});

		await this.extensionInstaller.openWorkspace(workspacePath);
		return window;
	}

	override requestStop(): void {
		this.quitting = true;
		super.requestStop();
	}

	protected override onWindowAllClosed(event: ElectronEvent): void {
		if (this.quitting) {
			super.onWindowAllClosed(event);
			return;
		}
		if (this.installOnly) {
			return;
		}
		if (this.keepWarmer) {
			void this.ensureWarmRenderer();
			return;
		}
		if (this.keepWarm) {
			return;
		}
		super.onWindowAllClosed(event);
	}

	protected override async onSecondInstance(event: ElectronEvent, argv: string[], cwd: string, originalArgv: string[]): Promise<void> {
		const applicationArgs = this.processArgv.getProcessArgvWithoutBin(originalArgv);
		const wantsQuit = applicationArgs.includes(QUIT_FLAG);

		if (wantsQuit) {
			this.requestStop();
			return;
		}

		const wantsKeepWarmer = applicationArgs.includes(KEEP_WARMER_FLAG);
		const wantsKeepWarm = wantsKeepWarmer || applicationArgs.includes(KEEP_WARM_FLAG);
		if (wantsKeepWarm) {
			this.keepWarm = true;
		}
		if (wantsKeepWarmer) {
			this.keepWarmer = true;
		}

		const cleanApplicationArgs = this.removeControlFlags(applicationArgs);
		if (wantsKeepWarm && cleanApplicationArgs.length === 0) {
			if (wantsKeepWarmer) {
				await this.ensureWarmRenderer();
			}
			return;
		}

		if (this.keepWarm && cleanApplicationArgs.length === 0 && (this.windows.size === 0 || this.warmRenderer)) {
			await this.handleMainCommand({
				cwd,
				secondInstance: false
			});
			return;
		}

		const cleanOriginalArgv = this.replaceApplicationArgs(originalArgv, applicationArgs, cleanApplicationArgs);
		await super.onSecondInstance(event, argv, cwd, cleanOriginalArgv);
	}
}
