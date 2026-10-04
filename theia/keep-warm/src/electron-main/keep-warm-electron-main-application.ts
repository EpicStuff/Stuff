import { spawn } from 'child_process';
import { app, BrowserWindow, Event as ElectronEvent } from '@theia/core/electron-shared/electron';
import { DEFAULT_WINDOW_HASH } from '@theia/core/lib/common/window';
import { MaybePromise } from '@theia/core/lib/common/types';
import { ElectronMainApplication, ElectronMainCommandOptions } from '@theia/core/lib/electron-main/electron-main-application';
import { TheiaBrowserWindowOptions } from '@theia/core/lib/electron-main/theia-electron-window';
import { injectable } from '@theia/core/shared/inversify';

const KEEP_WARM_FLAG = '--keep-warm';
const KEEP_WARMER_FLAG = '--keep-warmer';
const DAEMON_FLAG = '--daemon';
const QUIT_FLAG = '--quit';

@injectable()
export class KeepWarmElectronMainApplication extends ElectronMainApplication {
	protected keepWarm = false;
	protected keepWarmer = false;
	protected suppressInitialEmptyWindow = false;
	protected warmRenderer: BrowserWindow | undefined;
	protected quitting = false;

	override async start(config: Parameters<ElectronMainApplication['start']>[0]): Promise<void> {
		const applicationArgs = this.processArgv.getProcessArgvWithoutBin(process.argv);

		if (applicationArgs.includes(DAEMON_FLAG)) {
			this.spawnDetached(applicationArgs.filter(arg => arg !== DAEMON_FLAG));
			app.exit(0);
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

	protected spawnDetached(args: string[]): void {
		const child = spawn(process.execPath, args, {
			cwd: process.cwd(),
			detached: true,
			env: { ...process.env },
			stdio: 'ignore'
		});
		child.unref();
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
		if (this.keepWarm && !urlToOpen) {
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

	protected async ensureWarmRenderer(): Promise<void> {
		if (!this.keepWarmer || this.quitting || this.warmRenderer && !this.warmRenderer.isDestroyed()) {
			return;
		}

		const options = await this.getLastWindowOptions();
		const window = await this.createWindow({
			...options,
			show: false,
			preventAutomaticShow: true
		});
		const uri = await this.createWindowUri();

		this.warmRenderer = window;
		this.initialWindow = window;
		await window.loadURL(uri.withFragment(DEFAULT_WINDOW_HASH).toString(true));
	}

	protected override async reuseOrCreateWindow(asyncOptions: MaybePromise<TheiaBrowserWindowOptions>): Promise<BrowserWindow> {
		const warmRenderer = this.warmRenderer;
		const window = await super.reuseOrCreateWindow(asyncOptions);

		if (warmRenderer && window === warmRenderer) {
			this.warmRenderer = undefined;
			window.webContents.once('did-finish-load', () => {
				if (!window.isDestroyed()) {
					window.show();
				}
			});
		}

		return window;
	}

	protected override onWindowAllClosed(event: ElectronEvent): void {
		if (this.keepWarmer && !this.quitting) {
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
