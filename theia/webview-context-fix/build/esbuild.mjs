import fs from 'node:fs/promises';
import path from 'node:path';

export const supportedTheiaVersion = '1.73.1';

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

export function patchWebviewPreloadSource(source) {
	if (source.includes(fixedCall) && source.includes(fixedFunction)) {
		return {
			changed: false,
			source
		};
	}

	if (!source.includes(originalCall) || !source.includes(originalFunction)) {
		throw new Error(`Unsupported @theia/plugin-ext webview preload. This fix is written for Theia ${supportedTheiaVersion}.`);
	}

	return {
		changed: true,
		source: source.replace(originalCall, fixedCall).replace(originalFunction, fixedFunction)
	};
}

export function webviewContextFixPlugin(options = {}) {
	const preloadPath = options.preloadPath ?? path.resolve(process.cwd(), 'lib/webview/pre/main.js');

	return {
		name: 'theia-webview-context-fix',
		setup(build) {
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
					return {
						errors: [{
							text: error instanceof Error ? error.message : String(error)
						}]
					};
				}
			});
		}
	};
}

export default webviewContextFixPlugin;
