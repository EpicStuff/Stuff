import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

export const baselineTheiaVersion = '1.75.0';

const require = createRequire(import.meta.url);

const originalCall = 'context: findVscodeContext(e.composedPath(), 0)';
const fixedCall = 'context: findVscodeContext(e.composedPath())';

const originalFunction = `        function findVscodeContext(nodes, index) {
            const node = nodes[index];
            if (node) {
                if (node.dataset?.vscodeContext) {
                    return JSON.parse(node.dataset.vscodeContext);
                }
                return findVscodeContext(nodes, ++index);
            }
            return {};
        }`;

const fixedFunction = `        function findVscodeContext(nodes) {
            return nodes.reduceRight((context, node) => {
                if (!node.dataset?.vscodeContext) {
                    return context;
                }

                return { ...context, ...JSON.parse(node.dataset.vscodeContext) };
            }, {});
        }`;

const originalHostFunction = `    handleContextMenu(event: { clientX: number, clientY: number, context: any }): void {
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

const browserMenuFocusRestore = `    public override open(x: number, y: number, options?: MenuWidget.IOpenOptions): void {
        const cb = () => {
            this.restoreFocusedElement();
            this.aboutToClose.disconnect(cb);
        };
        this.aboutToClose.connect(cb);
        this.preserveFocusedElement();
        super.open(x, y, options);
    }`;

const browserMenuCommandFocus = `                        execute: () => {
                            // Restore focus to the previously focused element before executing
                            // the command so that focus-dependent commands like clipboard
                            // operations target the correct element instead of the menu.
                            if (this.previousFocusedElement) {
                                this.previousFocusedElement.focus({ preventScroll: true });
                            }
                            node.run(nodePath, ...(this.args || []));
                        },`;

const electronNativeContextMenu = `        if (this.useNativeStyle) {
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

function countOccurrences(source, needle) {
	let count = 0;
	let offset = 0;

	while ((offset = source.indexOf(needle, offset)) !== -1) {
		count += 1;
		offset += needle.length;
	}

	return count;
}

function requireExactlyOnce(source, needle, message) {
	const count = countOccurrences(source, needle);
	if (count !== 1) {
		throw new Error(`${message} Expected exactly one implementation verified against Theia ${baselineTheiaVersion}, found ${count}.`);
	}
}

function buildError(error) {
	return {
		errors: [{
			text: error instanceof Error ? error.message : String(error)
		}]
	};
}

export function verifyHostWebviewSource(source) {
	requireExactlyOnce(
		source,
		originalHostFunction,
		'Unsupported @theia/plugin-ext WebviewWidget.handleContextMenu implementation.'
	);
}

export function verifyMenuFocusSource(browserMenuSource, electronContextMenuSource) {
	requireExactlyOnce(
		browserMenuSource,
		browserMenuFocusRestore,
		'Unsupported @theia/core DynamicMenuWidget focus restoration implementation.'
	);
	requireExactlyOnce(
		browserMenuSource,
		browserMenuCommandFocus,
		'Unsupported @theia/core DynamicMenuWidget command focus implementation.'
	);
	requireExactlyOnce(
		electronContextMenuSource,
		electronNativeContextMenu,
		'Unsupported @theia/core ElectronContextMenuRenderer native popup implementation.'
	);
}

export function patchWebviewPreloadSource(source) {
	const originalCallCount = countOccurrences(source, originalCall);
	const originalFunctionCount = countOccurrences(source, originalFunction);
	const fixedCallCount = countOccurrences(source, fixedCall);
	const fixedFunctionCount = countOccurrences(source, fixedFunction);

	if (
		originalCallCount === 0
		&& originalFunctionCount === 0
		&& fixedCallCount === 1
		&& fixedFunctionCount === 1
	) {
		return {
			changed: false,
			source
		};
	}

	if (
		originalCallCount !== 1
		|| originalFunctionCount !== 1
		|| fixedCallCount !== 0
		|| fixedFunctionCount !== 0
	) {
		throw new Error(`Unsupported @theia/plugin-ext webview preload implementation. Expected exactly one unpatched implementation verified against Theia ${baselineTheiaVersion}.`);
	}

	return {
		changed: true,
		source: source.replace(originalCall, fixedCall).replace(originalFunction, fixedFunction)
	};
}

function resolvePackageSourcePath(packageName, relativePath) {
	const packageJsonPath = require.resolve(`${packageName}/package.json`);
	return path.join(path.dirname(packageJsonPath), relativePath);
}

export function webviewContextFixPlugin(options = {}) {
	const preloadPath = options.preloadPath ?? path.resolve(process.cwd(), 'lib/webview/pre/main.js');
	const hostSourcePath = options.hostSourcePath ?? resolvePackageSourcePath('@theia/plugin-ext', 'src/main/browser/webview/webview.ts');
	const browserMenuSourcePath = options.browserMenuSourcePath ?? resolvePackageSourcePath('@theia/core', 'src/browser/menu/browser-menu-plugin.ts');
	const electronContextMenuSourcePath = options.electronContextMenuSourcePath ?? resolvePackageSourcePath('@theia/core', 'src/electron-browser/menu/electron-context-menu-renderer.ts');

	return {
		name: 'theia-webview-context-fix',
		setup(build) {
			build.onStart(async () => {
				try {
					const [hostSource, browserMenuSource, electronContextMenuSource] = await Promise.all([
						fs.readFile(hostSourcePath, 'utf8'),
						fs.readFile(browserMenuSourcePath, 'utf8'),
						fs.readFile(electronContextMenuSourcePath, 'utf8')
					]);
					verifyHostWebviewSource(hostSource);
					verifyMenuFocusSource(browserMenuSource, electronContextMenuSource);
				} catch (error) {
					return buildError(error);
				}
			});

			build.onEnd(async result => {
				if (result.errors.length > 0) {
					return;
				}

				try {
					const source = await fs.readFile(preloadPath, 'utf8');
					const patched = patchWebviewPreloadSource(source);
					if (patched.changed) {
						await fs.writeFile(preloadPath, patched.source);
					}
				} catch (error) {
					return buildError(error);
				}
			});
		}
	};
}

export default webviewContextFixPlugin;
