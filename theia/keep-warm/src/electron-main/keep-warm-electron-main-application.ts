import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { app, BrowserWindow, Event as ElectronEvent } from '@theia/core/electron-shared/electron';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { DEFAULT_WINDOW_HASH } from '@theia/core/lib/common/window';
import { ElectronMainApplication, ElectronMainCommandOptions } from '@theia/core/lib/electron-main/electron-main-application';
import { inject, injectable } from '@theia/core/shared/inversify';
import { KeepWarmExtensionInstallerServiceImpl } from './keep-warm-extension-installer-service';
import { ParsedVscodeCliArgs, VSCODE_COMPAT_HELP, parseGotoTarget, parseVscodeCliArgs } from './vscode-cli';

const KEEP_WARM_FLAG = '--keep-warm';
const KEEP_WARMER_FLAG = '--keep-warmer';
const DAEMON_FLAG = '--daemon';
const QUIT_FLAG = '--quit';

interface ResolvedPathTarget {
	path: string;
	isWorkspace: boolean;
}

@injectable()
export class KeepWarmElectronMainApplication extends ElectronMainApplication {
	@inject(KeepWarmExtensionInstallerServiceImpl)
	protected readonly extensionInstaller!: KeepWarmExtensionInstallerServiceImpl;

	protected keepWarm = false;
	protected keepWarmer = false;
	protected cliOnly = false;
	protected suppressInitialEmptyWindow = false;
	protected warmRenderer: BrowserWindow | undefined;
	protected quitting = false;
	protected startupCliArgs: ParsedVscodeCliArgs | undefined;
	protected readonly pendingSecondInstanceCliArgs: ParsedVscodeCliArgs[] = [];
	protected readonly contributionsStarted = new Deferred<void>();

	override async start(config: Parameters<ElectronMainApplication['start']>[0]): Promise<void> {
		const applicationArgs = this.processArgv.getProcessArgvWithoutBin(process.argv);
		let cliArgs: ParsedVscodeCliArgs;

		try {
			cliArgs = parseVscodeCliArgs(applicationArgs);
		} catch (error) {
			this.failCli(error);
			return;
		}

		if (cliArgs.help) {
			process.stdout.write(VSCODE_COMPAT_HELP);
			app.exit(0);
			return;
		}

		if (applicationArgs.includes(DAEMON_FLAG)) {
			this.spawnDetached(applicationArgs.filter(arg => arg !== DAEMON_FLAG));
			app.exit(0);
			return;
		}

		if (cliArgs.userDataDir && this.hasElectronUserDataArg(cliArgs.remainingArgs)) {
			this.failCli(new Error('--user-data-dir cannot be combined with --electronUserData'));
			return;
		}

		if (cliArgs.userDataDir) {
			cliArgs.userDataDir = await this.configureUserDataDir(cliArgs.userDataDir, process.cwd());
		}

		if (cliArgs.disableGpu) {
			app.disableHardwareAcceleration();
		}

		this.startupCliArgs = cliArgs;

		if (this.hasCliOnlyAction(cliArgs)) {
			this.cliOnly = true;
			this.suppressInitialEmptyWindow = true;
			this.replaceProcessApplicationArgs(applicationArgs, this.getSuperArgs(cliArgs, true));
			await super.start(config);
			await this.contributionsStarted.promise;

			try {
				await this.runCliOnlyActions(cliArgs, process.cwd());
			} catch (error) {
				process.exitCode = 1;
				console.error(error);
			}
			this.requestStop();
			return;
		}

		const wantsKeepWarmer = applicationArgs.includes(KEEP_WARMER_FLAG);
		const wantsKeepWarm = wantsKeepWarmer || applicationArgs.includes(KEEP_WARM_FLAG);
		const wantsQuit = applicationArgs.includes(QUIT_FLAG);
		const useSingleInstanceLock = !cliArgs.disableGpu || wantsKeepWarm || wantsQuit;
		let ownsSingleInstanceLock = true;

		if (useSingleInstanceLock) {
			ownsSingleInstanceLock = app.requestSingleInstanceLock();
		}

		if (!ownsSingleInstanceLock) {
			app.quit();
			return;
		}

		if (wantsQuit) {
			if (useSingleInstanceLock) {
				app.releaseSingleInstanceLock();
			}
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

		if (!this.keepWarm && useSingleInstanceLock) {
			app.releaseSingleInstanceLock();
		}

		this.replaceProcessApplicationArgs(applicationArgs, this.getSuperArgs(cliArgs, true));
		await super.start(config);
	}

	protected override async startContributions(): Promise<void> {
		await super.startContributions();
		this.contributionsStarted.resolve();
	}

	protected failCli(error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`theia: ${message}\n`);
		app.exit(1);
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

	protected async configureUserDataDir(userDataDir: string, cwd: string): Promise<string> {
		const resolved = path.resolve(cwd, userDataDir);
		await fs.mkdir(resolved, { recursive: true });
		app.setPath('userData', resolved);
		process.env.THEIA_CONFIG_DIR = resolved;
		return resolved;
	}

	protected hasElectronUserDataArg(args: readonly string[]): boolean {
		return args.some(arg => arg === '--electronUserData' || arg.startsWith('--electronUserData='));
	}

	protected getSuperArgs(cliArgs: ParsedVscodeCliArgs, includeUserDataDir: boolean): string[] {
		const args = this.removeControlFlags(cliArgs.remainingArgs);
		if (includeUserDataDir && cliArgs.userDataDir) {
			args.push('--electronUserData', cliArgs.userDataDir);
		}
		return args;
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

	protected hasCliOnlyAction(cliArgs: ParsedVscodeCliArgs): boolean {
		return cliArgs.listExtensions || cliArgs.installExtensions.length > 0 || cliArgs.uninstallExtensions.length > 0;
	}

	protected hasWindowAction(cliArgs: ParsedVscodeCliArgs): boolean {
		return cliArgs.newWindow || cliArgs.reuseWindow || cliArgs.gotoTarget !== undefined || cliArgs.diffTargets !== undefined;
	}

	protected override showInitialWindow(urlToOpen: string | undefined): void {
		if ((this.keepWarm || this.cliOnly) && !urlToOpen) {
			return;
		}
		super.showInitialWindow(urlToOpen);
	}

	protected override async handleMainCommand(options: ElectronMainCommandOptions): Promise<void> {
		const cliArgs = options.secondInstance ? this.pendingSecondInstanceCliArgs.shift() : this.startupCliArgs;
		if (cliArgs && this.hasWindowAction(cliArgs)) {
			await this.handleVscodeWindowCommand(cliArgs, options);
			return;
		}

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

	protected async handleVscodeWindowCommand(cliArgs: ParsedVscodeCliArgs, options: ElectronMainCommandOptions): Promise<void> {
		if (cliArgs.gotoTarget) {
			await this.openGotoTarget(cliArgs, cliArgs.gotoTarget, options.cwd);
			return;
		}

		if (cliArgs.diffTargets) {
			await this.openDiffTargets(cliArgs, cliArgs.diffTargets, options.cwd);
			return;
		}

		if (options.file !== undefined) {
			await this.openPathWithWindowMode(cliArgs, options.file, options.cwd);
			return;
		}

		if (cliArgs.newWindow) {
			await this.openNewEmptyWindow();
			return;
		}

		if (cliArgs.reuseWindow) {
			await this.reuseLastWindow();
		}
	}

	protected async openGotoTarget(cliArgs: ParsedVscodeCliArgs, target: string, cwd: string): Promise<void> {
		const parsedTarget = parseGotoTarget(target);
		const filePath = await this.resolveFilePath(parsedTarget.filePath, cwd);
		const window = await this.acquireEditorWindow(cliArgs);
		await this.extensionInstaller.openFile(window.webContents.id, filePath, parsedTarget.line, parsedTarget.column);
		this.revealWindow(window);
	}

	protected async openDiffTargets(cliArgs: ParsedVscodeCliArgs, targets: [string, string], cwd: string): Promise<void> {
		const leftPath = await this.resolveFilePath(targets[0], cwd);
		const rightPath = await this.resolveFilePath(targets[1], cwd);
		const window = await this.acquireEditorWindow(cliArgs);
		await this.extensionInstaller.openDiff(window.webContents.id, leftPath, rightPath);
		this.revealWindow(window);
	}

	protected async openPathWithWindowMode(cliArgs: ParsedVscodeCliArgs, inputPath: string, cwd: string): Promise<void> {
		const target = await this.resolvePathTarget(inputPath, cwd);

		if (target.isWorkspace) {
			if (cliArgs.newWindow) {
				if (!this.getActiveVisibleWindow() && this.warmRenderer && !this.warmRenderer.isDestroyed()) {
					await this.openWindowWithWorkspace(target.path);
				} else {
					await this.openNewWindowWithWorkspace(target.path);
				}
			} else {
				await this.openWorkspaceReusingWindow(target.path);
			}
			return;
		}

		const window = await this.acquireEditorWindow(cliArgs);
		await this.extensionInstaller.openFile(window.webContents.id, target.path);
		this.revealWindow(window);
	}

	protected async resolvePathTarget(inputPath: string, cwd: string): Promise<ResolvedPathTarget> {
		const resolvedPath = await fs.realpath(path.resolve(cwd, inputPath));
		const stat = await fs.stat(resolvedPath);
		const extension = path.extname(resolvedPath).toLowerCase();

		if (!stat.isDirectory() && !stat.isFile()) {
			throw new Error(`Path is not a file or directory: ${inputPath}`);
		}

		return {
			path: resolvedPath,
			isWorkspace: stat.isDirectory() || extension === '.theia-workspace' || extension === '.code-workspace'
		};
	}

	protected async resolveFilePath(inputPath: string, cwd: string): Promise<string> {
		const resolvedPath = await fs.realpath(path.resolve(cwd, inputPath));
		const stat = await fs.stat(resolvedPath);
		if (!stat.isFile()) {
			throw new Error(`Path is not a file: ${inputPath}`);
		}
		return resolvedPath;
	}

	protected async acquireEditorWindow(cliArgs: ParsedVscodeCliArgs): Promise<BrowserWindow> {
		if (cliArgs.newWindow) {
			if (!this.getActiveVisibleWindow()) {
				const warmRenderer = this.takeWarmRenderer();
				if (warmRenderer) {
					return warmRenderer;
				}
			}
			return super.openDefaultWindow();
		}

		const activeWindow = this.getActiveVisibleWindow();
		if (activeWindow) {
			return activeWindow;
		}

		const warmRenderer = this.takeWarmRenderer();
		if (warmRenderer) {
			return warmRenderer;
		}

		return super.openDefaultWindow();
	}

	protected async openNewEmptyWindow(): Promise<BrowserWindow> {
		if (!this.getActiveVisibleWindow()) {
			const warmRenderer = this.takeWarmRenderer();
			if (warmRenderer) {
				this.revealWindow(warmRenderer);
				return warmRenderer;
			}
		}

		return super.openDefaultWindow();
	}

	protected async reuseLastWindow(): Promise<BrowserWindow> {
		const activeWindow = this.getActiveVisibleWindow();
		if (activeWindow) {
			this.revealWindow(activeWindow);
			return activeWindow;
		}

		const warmRenderer = this.takeWarmRenderer();
		if (warmRenderer) {
			return this.reloadWorkspaceWindow(warmRenderer, '');
		}

		return this.openWindowWithWorkspace('');
	}

	protected async openWorkspaceReusingWindow(workspacePath: string): Promise<BrowserWindow> {
		const activeWindow = this.getActiveVisibleWindow();
		if (activeWindow) {
			return this.reloadWorkspaceWindow(activeWindow, workspacePath);
		}

		const warmRenderer = this.takeWarmRenderer();
		if (warmRenderer) {
			return this.reloadWorkspaceWindow(warmRenderer, workspacePath);
		}

		return this.openWindowWithWorkspace(workspacePath);
	}

	protected getActiveVisibleWindow(): BrowserWindow | undefined {
		for (const id of this.activeWindowStack) {
			const window = this.windows.get(id)?.window;
			if (window && !window.isDestroyed() && window.isVisible()) {
				return window;
			}
		}
		return undefined;
	}

	protected takeWarmRenderer(): BrowserWindow | undefined {
		const window = this.warmRenderer;
		if (!window || window.isDestroyed()) {
			this.warmRenderer = undefined;
			return undefined;
		}

		this.warmRenderer = undefined;
		return window;
	}

	protected revealWindow(window: BrowserWindow): void {
		if (window.isDestroyed()) {
			return;
		}
		if (!window.isVisible()) {
			window.show();
		}
		window.focus();
	}

	protected async reloadWorkspaceWindow(window: BrowserWindow, workspacePath: string): Promise<BrowserWindow> {
		const revealAfterLoad = !window.isVisible();
		if (revealAfterLoad) {
			window.webContents.once('did-finish-load', () => this.revealWindow(window));
		}

		await this.extensionInstaller.openWorkspace(window.webContents.id, workspacePath);
		if (!revealAfterLoad) {
			this.revealWindow(window);
		}
		return window;
	}

	protected async openNewWindowWithWorkspace(workspacePath: string): Promise<BrowserWindow> {
		const options = await this.getLastWindowOptions();
		const [uri, window] = await Promise.all([this.createWindowUri(), this.createWindow(options)]);
		void window.loadURL(uri.withFragment(encodeURI(workspacePath)).toString(true));
		return window;
	}

	protected async runCliOnlyActions(cliArgs: ParsedVscodeCliArgs, cwd: string): Promise<void> {
		const renderer = await this.createHiddenEmptyRenderer();
		const windowId = renderer.webContents.id;

		try {
			for (const extension of cliArgs.installExtensions) {
				const resolved = await this.resolveExtensionInstallTarget(extension, cwd);
				await this.extensionInstaller.installExtension(windowId, resolved.value, resolved.local);
				process.stdout.write(`Installed extension: ${resolved.value}\n`);
			}

			for (const extensionId of cliArgs.uninstallExtensions) {
				const removed = await this.extensionInstaller.uninstallExtension(windowId, extensionId);
				process.stdout.write(`Uninstalled extension: ${removed}\n`);
			}

			if (cliArgs.listExtensions) {
				const extensions = await this.extensionInstaller.listExtensions(windowId, cliArgs.showVersions);
				if (extensions.length > 0) {
					process.stdout.write(`${extensions.join('\n')}\n`);
				}
			}
		} finally {
			const wrapper = this.windows.get(windowId);
			if (wrapper) {
				await wrapper.close();
			}
		}
	}

	protected async resolveExtensionInstallTarget(extension: string, cwd: string): Promise<{ value: string; local: boolean }> {
		const resolvedPath = path.resolve(cwd, extension);

		try {
			const stat = await fs.stat(resolvedPath);
			if (stat.isFile()) {
				if (path.extname(resolvedPath).toLowerCase() !== '.vsix') {
					throw new Error(`Local extension path must point to a .vsix file: ${extension}`);
				}
				return { value: resolvedPath, local: true };
			}
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== 'ENOENT') {
				throw error;
			}
		}

		if (extension.toLowerCase().endsWith('.vsix')) {
			throw new Error(`Extension file does not exist: ${extension}`);
		}
		if (!/^[^.\s@]+\.[^\s@]+(?:@[^\s@]+)?$/.test(extension)) {
			throw new Error(`Invalid extension id '${extension}'. Expected publisher.name[@version] or a .vsix path`);
		}

		return { value: extension, local: false };
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
		const window = this.takeWarmRenderer();
		if (!window) {
			return super.openWindowWithWorkspace(workspacePath);
		}

		return this.reloadWorkspaceWindow(window, workspacePath);
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
		if (this.cliOnly) {
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
		let cliArgs: ParsedVscodeCliArgs;

		try {
			cliArgs = parseVscodeCliArgs(applicationArgs);
		} catch (error) {
			console.error(error);
			return;
		}

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

		const cleanApplicationArgs = this.getSuperArgs(cliArgs, false);
		const hasWindowAction = this.hasWindowAction(cliArgs);

		if (wantsKeepWarm && cleanApplicationArgs.length === 0 && !hasWindowAction) {
			if (wantsKeepWarmer) {
				await this.ensureWarmRenderer();
			}
			return;
		}

		if (this.keepWarm && cleanApplicationArgs.length === 0 && !hasWindowAction && (this.windows.size === 0 || this.warmRenderer)) {
			await this.handleMainCommand({
				cwd,
				secondInstance: false
			});
			return;
		}

		if (hasWindowAction) {
			this.pendingSecondInstanceCliArgs.push(cliArgs);
		}

		const cleanOriginalArgv = this.replaceApplicationArgs(originalArgv, applicationArgs, cleanApplicationArgs);
		await super.onSecondInstance(event, argv, cwd, cleanOriginalArgv);
	}
}
