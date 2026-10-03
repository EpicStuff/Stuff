import assert from 'node:assert/strict';
import test from 'node:test';
import { patchWebviewPreloadSource } from '../build/esbuild.mjs';

const original = `        host.postMessage('did-context-menu', {
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

test('patches Theia 1.73.1 webview context collection', () => {
	const result = patchWebviewPreloadSource(original);

	assert.equal(result.changed, true);
	assert.match(result.source, /findVscodeContext\(e\.composedPath\(\)\)/);
	assert.match(result.source, /nodes\.reduceRight/);
	assert.match(result.source, /\.\.\.context, \.\.\.JSON\.parse/);
});

test('is idempotent', () => {
	const first = patchWebviewPreloadSource(original);
	const second = patchWebviewPreloadSource(first.source);

	assert.equal(second.changed, false);
	assert.equal(second.source, first.source);
});

test('rejects an unknown preload implementation', () => {
	assert.throws(() => patchWebviewPreloadSource('unknown source'), /Unsupported @theia\/plugin-ext webview preload/);
});
