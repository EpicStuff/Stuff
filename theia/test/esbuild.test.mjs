import assert from 'node:assert/strict';
import test from 'node:test';
import { patchWebviewPreloadSource, verifyHostWebviewSource } from '../build/esbuild.mjs';

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
