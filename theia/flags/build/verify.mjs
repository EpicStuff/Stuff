import { verifyTheiaSources } from '../../shared/theia-source-check.mjs';

const expectedGetProcessArgvWithoutBin = `    getProcessArgvWithoutBin(argv = process.argv): Array<string> {
        return argv.slice(this.processArgvBinIndex + 1);
    }`;

const expectedStart = `    async start(config: FrontendApplicationConfig): Promise<void> {
        const argv = this.processArgv.getProcessArgvWithoutBin(process.argv);
        createYargs(argv, process.cwd())
            .help(false)
            .command('$0 [file]', false,
                cmd => cmd
                    .option('electronUserData', {
                        type: 'string',
                        describe: 'The area where the electron main process puts its data'
                    })
                    .positional('file', { type: 'string' }),
                async args => {
                    if (args.electronUserData) {
                        console.info(\`using electron user data area : '\${args.electronUserData}'\`);
                        await fs.mkdir(args.electronUserData, { recursive: true });
                        app.setPath('userData', args.electronUserData);
                    }
                    const startupMeasurement = this.stopwatch.start('electron-main-startup');
                    this.useNativeWindowFrame = this.getTitleBarStyle(config) === 'native';
                    this._config = config;
                    if (isWindows && !!config.electron.appUserModelId) {
                        app.setAppUserModelId(config.electron.appUserModelId);
                    }
                    this.hookApplicationEvents();
                    this.showInitialWindow(argv.includes('--open-url') ? argv[argv.length - 1] : undefined);
                    const port = await this.stopwatch.startAsync('electron-main-start-backend', 'Starting backend', () => this.startBackend());
                    this._backendPort.resolve(port);
                    await app.whenReady();
                    await this.stopwatch.startAsync('electron-main-security-token', 'Attaching security token',
                        () => this.attachElectronSecurityToken(port));
                    await this.stopwatch.startAsync('electron-main-start-contributions', 'Starting contributions',
                        () => this.startContributions());
                    startupMeasurement.info('Startup sequence completed');

                    this.handleMainCommand({
                        file: args.file,
                        cwd: process.cwd(),
                        secondInstance: false
                    });
                },
            ).parse();
    }`;

const expectedShowInitialWindow = `    protected showInitialWindow(urlToOpen: string | undefined): void {
        if (this.isShowWindowEarly() || this.isShowSplashScreen()) {
            app.whenReady().then(async () => {
                const options = await this.getLastWindowOptions();
                // If we want to show a splash screen, don't auto open the main window
                if (this.isShowSplashScreen()) {
                    options.preventAutomaticShow = true;
                }
                this.initialWindow = await this.createWindow({ ...options });
                TheiaRendererAPI.onApplicationStateChanged(this.initialWindow.webContents, state => {
                    if (state === 'ready' && urlToOpen) {
                        this.openUrl(urlToOpen);
                    }
                });
                if (this.isShowSplashScreen()) {
                    console.log('Showing splash screen');
                    this.configureAndShowSplashScreen(this.initialWindow);
                }

                // Show main window early if windows shall be shown early and splash screen is not configured
                if (this.isShowWindowEarly() && !this.isShowSplashScreen()) {
                    console.log('Showing main window early');
                    this.initialWindow.show();
                }
            });
        }
    }`;

const expectedCreateWindow = `    async createWindow(asyncOptions: MaybePromise<TheiaBrowserWindowOptions> = this.getDefaultTheiaWindowOptions()): Promise<BrowserWindow> {
        let options = await asyncOptions;
        options = this.avoidOverlap(options);
        const electronWindow = this.windowFactory(options, this.config);
        const id = electronWindow.window.webContents.id;
        this.activeWindowStack.push(id);
        this.windows.set(id, electronWindow);
        electronWindow.onDidClose(() => {
            const stackIndex = this.activeWindowStack.indexOf(id);
            if (stackIndex >= 0) {
                this.activeWindowStack.splice(stackIndex, 1);
            }
            this.windows.delete(id);
        });
        electronWindow.window.on('maximize', () => TheiaRendererAPI.sendWindowEvent(electronWindow.window.webContents, 'maximize'));
        electronWindow.window.on('unmaximize', () => TheiaRendererAPI.sendWindowEvent(electronWindow.window.webContents, 'unmaximize'));
        electronWindow.window.on('focus', () => {
            const stackIndex = this.activeWindowStack.indexOf(id);
            if (stackIndex >= 0) {
                this.activeWindowStack.splice(stackIndex, 1);
            }
            this.activeWindowStack.unshift(id);
            TheiaRendererAPI.sendWindowEvent(electronWindow.window.webContents, 'focus');
        });
        this.attachSaveWindowState(electronWindow.window);

        return electronWindow.window;
    }`;

const expectedOpenWindows = `    async openDefaultWindow(params?: WindowSearchParams): Promise<BrowserWindow> {
        const options = this.getDefaultTheiaWindowOptions();
        const [uri, electronWindow] = await Promise.all([this.createWindowUri(params), this.reuseOrCreateWindow(options)]);
        electronWindow.loadURL(uri.withFragment(DEFAULT_WINDOW_HASH).toString(true));
        return electronWindow;
    }

    protected async openWindowWithWorkspace(workspacePath: string): Promise<BrowserWindow> {
        const options = await this.getLastWindowOptions();
        const [uri, electronWindow] = await Promise.all([this.createWindowUri(), this.reuseOrCreateWindow(options)]);
        electronWindow.loadURL(uri.withFragment(encodeURI(workspacePath)).toString(true));
        return electronWindow;
    }

    protected async reuseOrCreateWindow(asyncOptions: MaybePromise<TheiaBrowserWindowOptions>): Promise<BrowserWindow> {
        if (!this.initialWindow) {
            return this.createWindow(asyncOptions);
        }
        // reset initial window after having it re-used once
        const window = this.initialWindow;
        this.initialWindow = undefined;
        return window;
    }`;

const expectedRequestStopAndHandleMainCommand = `    requestStop(): void {
        app.quit();
    }

    protected async handleMainCommand(options: ElectronMainCommandOptions): Promise<void> {
        let workspacePath: string | undefined;
        if (options.file) {
            try {
                workspacePath = await fs.realpath(path.resolve(options.cwd, options.file));
            } catch {
                console.error(\`Could not resolve the workspace path. "\${options.file}" is not a valid 'file' option. Falling back to the default workspace location.\`);
            }
        }
        if (workspacePath !== undefined) {
            await this.openWindowWithWorkspace(workspacePath);
        } else {
            if (options.secondInstance === false) {
                await this.openWindowWithWorkspace(''); // restore previous workspace.
            } else if (options.file === undefined) {
                await this.openDefaultWindow();
            }
        }
    }`;

const expectedApplicationEvents = `        app.on('second-instance', this.onSecondInstance.bind(this));
        app.on('window-all-closed', this.onWindowAllClosed.bind(this));`;

const expectedOnSecondInstance = `    protected async onSecondInstance(event: ElectronEvent, _: string[], cwd: string, originalArgv: string[]): Promise<void> {
        // the second instance passes it's original argument array as the fourth argument to this method
        // The \`argv\` second parameter is not usable for us since it is mangled by electron before being passed here

        if (originalArgv.includes('--open-url')) {
            this.openUrl(originalArgv[originalArgv.length - 1]);
        } else {
            createYargs(this.processArgv.getProcessArgvWithoutBin(originalArgv), cwd)
                .help(false)
                .command('$0 [file]', false,
                    cmd => cmd
                        .positional('file', { type: 'string' }),
                    async args => {
                        await this.handleMainCommand({
                            file: args.file,
                            cwd: cwd,
                            secondInstance: true
                        });
                    },
                ).parse();
        }
    }`;

const expectedOnWindowAllClosed = `    protected onWindowAllClosed(event: ElectronEvent): void {
        if (!this.restarting) {
            this.requestStop();
        }
    }`;

const expectedPluginDeployerInitialize = `    @inject(PluginDeployer)
    protected pluginDeployer: PluginDeployer;

    initialize(): Promise<void> {
        this.pluginDeployer.start().catch(error => this.logger.error('Initializing plugin deployer failed.', error));
        return Promise.resolve();
    }`;

const expectedPluginsToInstall = `    pluginsToInstall: string[] = [];`;

const expectedInstallPluginOption = `        conf.option('install-plugin', {
            alias: 'install-extension',
            nargs: 1,
            desc: 'Installs or updates a plugin. Argument is a path to the *.vsix file or a plugin id of the form "publisher.name[@version]"'
        });`;

const expectedVsxCliOnWillStart = `    async onWillStart(context: PluginDeployerStartContext): Promise<void> {
        const pluginUris = await Promise.all(this.vsxCli.pluginsToInstall.map(async id => {
            try {
                const resolvedPath = path.resolve(id);
                const stat = await fs.promises.stat(resolvedPath);
                if (stat.isFile()) {
                    return FileUri.create(resolvedPath).withScheme('local-file').toString();
                }
            } catch (e) {
                // expected if file does not exist
            }
            return VSXExtensionUri.fromVersionedId(id).toString();
        }));
        context.userEntries.push(...pluginUris);
    }`;

await verifyTheiaSources(import.meta.url, [{
	package: '@theia/core',
	file: 'src/electron-main/electron-main-application.ts',
	expect: [
		{ snippet: expectedGetProcessArgvWithoutBin, message: 'Unsupported @theia/core ElectronMainProcessArgv.getProcessArgvWithoutBin implementation.' },
		{ snippet: expectedStart, message: 'Unsupported @theia/core ElectronMainApplication.start implementation.' },
		{ snippet: expectedShowInitialWindow, message: 'Unsupported @theia/core ElectronMainApplication.showInitialWindow implementation.' },
		{ snippet: expectedCreateWindow, message: 'Unsupported @theia/core ElectronMainApplication.createWindow implementation.' },
		{ snippet: expectedOpenWindows, message: 'Unsupported @theia/core ElectronMainApplication openDefaultWindow, openWindowWithWorkspace and reuseOrCreateWindow implementation.' },
		{ snippet: expectedRequestStopAndHandleMainCommand, message: 'Unsupported @theia/core ElectronMainApplication requestStop and handleMainCommand implementation.' },
		{ snippet: expectedApplicationEvents, message: 'Unsupported @theia/core ElectronMainApplication second-instance and window-all-closed hooks.' },
		{ snippet: expectedOnSecondInstance, message: 'Unsupported @theia/core ElectronMainApplication.onSecondInstance implementation.' },
		{ snippet: expectedOnWindowAllClosed, message: 'Unsupported @theia/core ElectronMainApplication.onWindowAllClosed implementation.' }
	]
}, {
	package: '@theia/plugin-ext',
	file: 'src/main/node/plugin-deployer-contribution.ts',
	expect: [
		{ snippet: expectedPluginDeployerInitialize, message: 'Unsupported @theia/plugin-ext PluginDeployerContribution.initialize implementation.' }
	]
}, {
	package: '@theia/vsx-registry',
	file: 'src/node/vsx-cli.ts',
	expect: [
		{ snippet: expectedPluginsToInstall, message: 'Unsupported @theia/vsx-registry VsxCli.pluginsToInstall field.' },
		{ snippet: expectedInstallPluginOption, message: 'Unsupported @theia/vsx-registry VsxCli install-plugin option.' }
	]
}, {
	package: '@theia/vsx-registry',
	file: 'src/node/vsx-cli-deployer-participant.ts',
	expect: [
		{ snippet: expectedVsxCliOnWillStart, message: 'Unsupported @theia/vsx-registry VsxCliDeployerParticipant.onWillStart implementation.' }
	]
}]);
