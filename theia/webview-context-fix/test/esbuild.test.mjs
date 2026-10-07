import assert from 'node:assert/strict';
import test from 'node:test';
import { patchWebviewPreloadSource, verifyHostWebviewSource, verifyMenuFocusSource, verifyWebviewPanelViewStateSource } from '../build/esbuild.mjs';

const originalPreload = `        host.postMessage('did-context-menu', {
            clientX: e.clientX,
            clientY: e.clientY,
            context: findVscodeContext(e.composedPath(), 0)
        });

        function findVscodeContext(nodes, index) {
            const node = nodes[index];
            if (node) {
                if (node.dataset?.vscodeContext) {
                    return JSON.parse(node.dataset.vscodeContext);
                }
                return findVscodeContext(nodes, ++index);
            }
            return {};
        }`;

const originalHost = `    handleContextMenu(event: { clientX: number, clientY: number, context: any }): void {
        const domRect = this.node.getBoundingClientRect();
        this.contextKeyService.with(this.parent instanceof PluginViewWidget ?
            { webviewId: this.parent.options.viewId, ...event.context } : {},
            () => {
                this.contextMenuRenderer.render({
                    menuPath: WEBVIEW_CONTEXT_MENU,
                    args: [event.context],
                    anchor: {
                        x: domRect.x + event.clientX, y: domRect.y + event.clientY
                    },
                    context: this.node
                });
            });
    }`;

const browserMenuSource = `    public override open(x: number, y: number, options?: MenuWidget.IOpenOptions): void {
        const cb = () => {
            this.restoreFocusedElement();
            this.aboutToClose.disconnect(cb);
        };
        this.aboutToClose.connect(cb);
        this.preserveFocusedElement();
        super.open(x, y, options);
    }

                        execute: () => {
                            // Restore focus to the previously focused element before executing
                            // the command so that focus-dependent commands like clipboard
                            // operations target the correct element instead of the menu.
                            if (this.previousFocusedElement) {
                                this.previousFocusedElement.focus({ preventScroll: true });
                            }
                            node.run(nodePath, ...(this.args || []));
                        },`;

const webviewPanelSource = `    private updateViewState(widget: WebviewWidget, viewColumn?: number | undefined): void {
        const viewState: Mutable<WebviewPanelViewState> = {
            active: this.shell.activeWidget === widget,
            visible: !widget.isHidden,
            position: viewColumn || 0
        };
        if (typeof viewColumn !== 'number') {
            this.viewColumnService.updateViewColumns();
            viewState.position = this.viewColumnService.getViewColumn(widget.id) || 0;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (JSONExt.deepEqual(<any>viewState, <any>widget.viewState)) {
            return;
        }
        widget.viewState = viewState;
        this.proxy.$onDidChangeWebviewPanelViewState(widget.identifier.id, widget.viewState);
    }`;

const electronContextMenuSource = `        if (this.useNativeStyle) {
            const contextMenu = this.electronMenuFactory.createElectronContextMenu(params.menuPath, params.menu, params.contextMatcher, params.args, params.context);
            const { x, y } = coordinateFromAnchor(params.anchor);

            const windowName = params.context?.ownerDocument.defaultView?.Window.name;

            const menuHandle = window.electronTheiaCore.popup(contextMenu, x, y, () => {
                if (params.onHide) {
                    params.onHide();
                }
            }, windowName);
            // native context menu stops the event loop, so there is no keyboard events
            this.context.resetAltPressed();
            return new ElectronContextMenuAccess(menuHandle);
        } else {`;

test('patches the verified webview context collection exactly once', () => {
	const result = patchWebviewPreloadSource(originalPreload);

	assert.equal(result.changed, true);
	assert.match(result.source, /findVscodeContext\(e\.composedPath\(\)\)/);
	assert.match(result.source, /nodes\.reduceRight/);
	assert.match(result.source, /\.\.\.context, \.\.\.JSON\.parse/);
});

test('preload patch is idempotent', () => {
	const first = patchWebviewPreloadSource(originalPreload);
	const second = patchWebviewPreloadSource(first.source);

	assert.equal(second.changed, false);
	assert.equal(second.source, first.source);
});

test('rejects an unknown preload implementation', () => {
	assert.throws(() => patchWebviewPreloadSource('unknown source'), /Unsupported @theia\/plugin-ext webview preload/);
});

test('rejects duplicate preload implementations', () => {
	assert.throws(() => patchWebviewPreloadSource(`${originalPreload}\n${originalPreload}`), /Expected exactly one unpatched implementation/);
});

test('accepts the verified host context menu implementation', () => {
	assert.doesNotThrow(() => verifyHostWebviewSource(originalHost));
});

test('rejects a changed host context menu implementation', () => {
	const changed = originalHost.replace('} : {},', '} : event.context,');
	assert.throws(() => verifyHostWebviewSource(changed), /Unsupported @theia\/plugin-ext WebviewWidget\.handleContextMenu implementation/);
});

test('rejects duplicate host context menu implementations', () => {
	assert.throws(() => verifyHostWebviewSource(`${originalHost}\n${originalHost}`), /found 2/);
});

test('accepts the verified browser and native menu focus implementations', () => {
	assert.doesNotThrow(() => verifyMenuFocusSource(browserMenuSource, electronContextMenuSource));
});

test('rejects changed browser menu focus restoration', () => {
	const changed = browserMenuSource.replace('this.restoreFocusedElement();', 'this.node.focus();');
	assert.throws(() => verifyMenuFocusSource(changed, electronContextMenuSource), /DynamicMenuWidget focus restoration/);
});

test('rejects changed browser menu command focus handling', () => {
	const changed = browserMenuSource.replace('this.previousFocusedElement.focus({ preventScroll: true });', 'this.node.focus();');
	assert.throws(() => verifyMenuFocusSource(changed, electronContextMenuSource), /DynamicMenuWidget command focus/);
});

test('rejects changed native context menu handling', () => {
	const changed = electronContextMenuSource.replace('window.electronTheiaCore.popup', 'window.electronTheiaCore.otherPopup');
	assert.throws(() => verifyMenuFocusSource(browserMenuSource, changed), /ElectronContextMenuRenderer native popup/);
});


test('accepts the verified webview panel view state implementation', () => {
	assert.doesNotThrow(() => verifyWebviewPanelViewStateSource(webviewPanelSource));
});

test('rejects changed webview panel active state handling', () => {
	const changed = webviewPanelSource.replace('active: this.shell.activeWidget === widget,', 'active: true,');
	assert.throws(() => verifyWebviewPanelViewStateSource(changed), /WebviewsMainImpl\.updateViewState/);
});
