import { spawn } from 'child_process';
import { app, Event as ElectronEvent } from '@theia/core/electron-shared/electron';
import { ElectronMainApplication, ElectronMainCommandOptions } from '@theia/core/lib/electron-main/electron-main-application';
import { injectable } from '@theia/core/shared/inversify';

const KEEP_WARM_FLAG = '--keep-warm';
const DAEMON_FLAG = '--daemon';
const QUIT_FLAG = '--quit';

@injectable()
export class KeepWarmElectronMainApplication extends ElectronMainApplication {
	protected keepWarm = false;
	protected suppressInitialEmptyWindow = false;

	override async start(config: Parameters<ElectronMainApplication['start']>[0]): Promise<void> {
		const applicationArgs = this.processArgv.getProcessArgvWithoutBin(process.argv);

		if (applicationArgs.includes(DAEMON_FLAG)) {
			this.spawnDetached(applicationArgs.filter(arg => arg !== DAEMON_FLAG));
			app.exit(0);
			return;
		}

		const wantsKeepWarm = applicationArgs.includes(KEEP_WARM_FLAG);
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
		this.suppressInitialEmptyWindow = wantsKeepWarm;

		if (this.keepWarm) {
			process.once('SIGINT', () => this.requestStop());
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
		return args.filter(arg => arg !== KEEP_WARM_FLAG && arg !== DAEMON_FLAG && arg !== QUIT_FLAG);
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
				return;
			}
		}

		await super.handleMainCommand(options);
	}

	protected override onWindowAllClosed(event: ElectronEvent): void {
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

		const wantsKeepWarm = applicationArgs.includes(KEEP_WARM_FLAG);
		if (wantsKeepWarm) {
			this.keepWarm = true;
		}

		const cleanApplicationArgs = this.removeControlFlags(applicationArgs);
		if (wantsKeepWarm && cleanApplicationArgs.length === 0) {
			return;
		}

		if (this.keepWarm && this.windows.size === 0 && cleanApplicationArgs.length === 0) {
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
