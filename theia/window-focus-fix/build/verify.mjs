import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

const expectedConstructorFocus = `        const fireDidFocus = () => this.onFocusChanged(true);
        window.addEventListener('focus', fireDidFocus);
        this.toDispose.push(Disposable.create(() => window.removeEventListener('focus', fireDidFocus)));

        const fireDidBlur = () => this.onFocusChanged(false);
        window.addEventListener('blur', fireDidBlur);
        this.toDispose.push(Disposable.create(() => window.removeEventListener('blur', fireDidBlur)));`;

const expectedFocusMethod = `    private onFocusChanged(focused: boolean): void {
        this.proxy.$onDidChangeWindowFocus(focused);
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

function requireExactlyOnce(source, needle, label) {
	const count = countOccurrences(source, needle);
	if (count !== 1) {
		throw new Error(`Unsupported @theia/plugin-ext WindowStateMain implementation: expected exactly one ${label}, found ${count}.`);
	}
}

const packageJsonPath = require.resolve('@theia/plugin-ext/package.json');
const sourcePath = path.join(path.dirname(packageJsonPath), 'src/main/browser/window-state-main.ts');
const source = await fs.readFile(sourcePath, 'utf8');

requireExactlyOnce(source, expectedConstructorFocus, 'top level focus and blur listener block');
requireExactlyOnce(source, expectedFocusMethod, 'onFocusChanged implementation');
