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

function countOccurrences(source, needle) {
	let count = 0;
	let offset = 0;

	while ((offset = source.indexOf(needle, offset)) !== -1) {
		count += 1;
		offset += needle.length;
	}

	return count;
}

function buildError(error) {
	return {
		errors: [{
			text: error instanceof Error ? error.message : String(error)
		}]
	};
}

export function verifyHostWebviewSource(source) {
	const count = countOccurrences(source, originalHostFunction);
	if (count !== 1) {
		throw new Error(`Unsupported @theia/plugin-ext WebviewWidget.handleContextMenu implementation. Expected exactly one copy of the implementation verified against Theia ${baselineTheiaVersion}, found ${count}.`);
	}
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

function resolveHostSourcePath() {
	const packageJsonPath = require.resolve('@theia/plugin-ext/package.json');
	return path.join(path.dirname(packageJsonPath), 'src/main/browser/webview/webview.ts');
}

export function webviewContextFixPlugin(options = {}) {
	const preloadPath = options.preloadPath ?? path.resolve(process.cwd(), 'lib/webview/pre/main.js');
	const hostSourcePath = options.hostSourcePath ?? resolveHostSourcePath();

	return {
		name: 'theia-webview-context-fix',
		setup(build) {
			build.onStart(async () => {
				try {
					const source = await fs.readFile(hostSourcePath, 'utf8');
					verifyHostWebviewSource(source);
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
