import { verifyTheiaSources } from '../../shared/theia-source-check.mjs';

const expectedAddWidget = `    async addWidget(widget: Widget, options?: Readonly<ApplicationShell.WidgetOptions>): Promise<void> {
        if (!widget.id) {
            this.logger.error('Widgets added to the application shell must have a unique id property.');
            return;
        }
        const resolvedOptions = this.resolveWidgetArea(widget, options);
        const { area, addOptions } = this.getInsertionOptions(resolvedOptions);
        const sidePanelOptions: SidePanel.WidgetOptions = { rank: options?.rank };
        switch (area) {
            case 'main':
                this.mainPanel.addWidget(widget, addOptions);
                break;
            case 'top':
                this.topPanel.addWidget(widget);
                break;
            case 'bottom':
                this.bottomPanel.addWidget(widget, addOptions);
                break;
            case 'left':
                this.leftPanelHandler.addWidget(widget, sidePanelOptions);
                break;
            case 'right':
                this.rightPanelHandler.addWidget(widget, sidePanelOptions);
                break;
            case 'secondaryWindow':
                const secondaryWindow = extractSecondaryWindow(addOptions.ref);
                if (secondaryWindow) {
                    this.secondaryWindowHandler.addWidgetToSecondaryWindow(widget, secondaryWindow, addOptions);
                } else {
                    // Fall back to adding widgets to the main area. This is preferred to throwing an error, because toolbar actions on secondary windows/commands
                    // may e.g. open further editors, e.g. a markdown preview.
                    this.mainPanel.addWidget(widget, {
                        ...addOptions,
                        ref: undefined
                    });
                }

                break;
            default:
                throw new Error('Unexpected area: ' + options?.area);
        }
        if (area !== 'top') {
            this.track(widget);
        }
    }`;

const expectedGetInsertionOptions = `    getInsertionOptions(options?: Readonly<ApplicationShell.WidgetOptions>): { area: string; addOptions: TheiaDockPanel.AddOptions; } {
        let ref: Widget | undefined = options?.ref;
        let area: ApplicationShell.Area = options?.area || 'main';
        if (!ref && (area === 'main' || area === 'bottom')) {
            const tabBar = this.getTabBarFor(area);
            ref = tabBar && tabBar.currentTitle && tabBar.currentTitle.owner || undefined;
        }
        // make sure that ref belongs to area
        area = ref && this.getAreaFor(ref) || area;
        const addOptions: TheiaDockPanel.AddOptions = {};
        if (ApplicationShell.isOpenToSideMode(options?.mode)) {
            const areaPanel = area === 'main' ? this.mainPanel : area === 'bottom' ? this.bottomPanel : undefined;
            const sideRef = areaPanel && ref && (options?.mode === 'open-to-left' ?
                areaPanel.previousTabBarWidget(ref) :
                areaPanel.nextTabBarWidget(ref));
            if (sideRef) {
                addOptions.ref = sideRef;
            } else {
                addOptions.ref = ref;
                addOptions.mode = options?.mode === 'open-to-left' ? 'split-left' : 'split-right';
            }
        } else if (ApplicationShell.isReplaceMode(options?.mode)) {
            addOptions.ref = options?.ref;
            addOptions.closeRef = true;
            addOptions.mode = 'tab-after';
        } else {
            addOptions.ref = ref;
            addOptions.mode = options?.mode;
        }
        return { area, addOptions };
    }`;

const expectedCompositeSaveables = `    async save(options?: SaveOptions): Promise<void> {
        await Promise.all(this.saveables.map(saveable => saveable.save(options)));
    }

    async revert(options?: Saveable.RevertOptions): Promise<void> {
        await Promise.all(this.saveables.map(saveable => saveable.revert?.(options)));
    }

    get saveables(): readonly Saveable[] {
        return Array.from(this.saveablesMap.keys());
    }`;

const expectedCompositeDirtyTracking = `        toDispose.push(saveable.onDirtyChanged(() => {
            const wasDirty = this.isDirty;
            this.isDirty = this.saveables.some(s => s.dirty);
            if (this.isDirty !== wasDirty) {
                this.onDirtyChangedEmitter.fire();
            }
        }));`;

const expectedPreviewUri = `    static PREVIEW_URI = new URI().withScheme('__minibrowser__preview__');`;

const expectedOpenPreview = `    async openPreview(startPage: string): Promise<MiniBrowser> {
        const props = await this.getOpenPreviewProps(await this.locationMapperService.map(startPage));
        return this.open(MiniBrowserOpenHandler.PREVIEW_URI, props);
    }

    protected async getOpenPreviewProps(startPage: string): Promise<MiniBrowserOpenerOptions> {
        const resetBackground = await this.resetBackground(new URI(startPage));
        return {
            name: nls.localize(MiniBrowserCommands.PREVIEW_CATEGORY_KEY, MiniBrowserCommands.PREVIEW_CATEGORY),
            startPage,
            toolbar: 'read-only',
            widgetOptions: {
                area: 'right'
            },
            resetBackground,
            iconClass: codicon('preview'),
            openFor: 'preview'
        };
    }`;

const expectedGetResourceUri = `    getResourceUri(): URI | undefined {
        return this.options.uri;
    }`;

const expectedWebviewReadyChannel = `    webviewReady = 'webview-ready',`;

const expectedWebviewReload = `    reload(): void {
        this.doUpdateContent();
    }`;

const expectedWebviewOn = `    protected on<T = unknown>(channel: WebviewMessageChannels, handler: (data: T) => void): Disposable {
        const listener = (e: any) => {
            if (!e || !e.data || e.data.target !== this.identifier.id) {
                return;
            }
            if (e.data.channel === channel) {
                this.trace('in', e.data.channel, e.data.data);
                handler(e.data.data);
            }
        };
        window.addEventListener('message', listener);
        return Disposable.create(() =>
            window.removeEventListener('message', listener)
        );
    }`;

await verifyTheiaSources(import.meta.url, [{
	package: '@theia/core',
	file: 'src/browser/shell/application-shell.ts',
	expect: [
		{ snippet: expectedAddWidget, message: 'Unsupported @theia/core ApplicationShell.addWidget implementation.' },
		{ snippet: expectedGetInsertionOptions, message: 'Unsupported @theia/core ApplicationShell.getInsertionOptions implementation.' }
	]
}, {
	package: '@theia/core',
	file: 'src/browser/saveable.ts',
	expect: [
		{ snippet: expectedCompositeSaveables, message: 'Unsupported @theia/core CompositeSaveable save, revert and saveables implementation.' },
		{ snippet: expectedCompositeDirtyTracking, message: 'Unsupported @theia/core CompositeSaveable.add dirty tracking.' }
	]
}, {
	package: '@theia/mini-browser',
	file: 'src/browser/mini-browser-open-handler.ts',
	expect: [
		{ snippet: expectedPreviewUri, message: 'Unsupported @theia/mini-browser MiniBrowserOpenHandler.PREVIEW_URI.' },
		{ snippet: expectedOpenPreview, message: 'Unsupported @theia/mini-browser MiniBrowserOpenHandler.openPreview implementation.' }
	]
}, {
	package: '@theia/mini-browser',
	file: 'src/browser/mini-browser.ts',
	expect: [
		{ snippet: expectedGetResourceUri, message: 'Unsupported @theia/mini-browser MiniBrowser.getResourceUri implementation.' }
	]
}, {
	package: '@theia/plugin-ext',
	file: 'src/main/browser/webview/webview.ts',
	expect: [
		{ snippet: expectedWebviewReadyChannel, message: 'Unsupported @theia/plugin-ext WebviewMessageChannels.webviewReady channel.' },
		{ snippet: expectedWebviewReload, message: 'Unsupported @theia/plugin-ext WebviewWidget.reload implementation.' },
		{ snippet: expectedWebviewOn, message: 'Unsupported @theia/plugin-ext WebviewWidget.on message filter.' }
	]
}]);
