import { verifyTheiaSources } from '../../shared/theia-source-check.mjs';

const expectedConstructorFocus = `        const fireDidFocus = () => this.onFocusChanged(true);
        window.addEventListener('focus', fireDidFocus);
        this.toDispose.push(Disposable.create(() => window.removeEventListener('focus', fireDidFocus)));

        const fireDidBlur = () => this.onFocusChanged(false);
        window.addEventListener('blur', fireDidBlur);
        this.toDispose.push(Disposable.create(() => window.removeEventListener('blur', fireDidBlur)));`;

const expectedFocusMethod = `    private onFocusChanged(focused: boolean): void {
        this.proxy.$onDidChangeWindowFocus(focused);
    }`;

await verifyTheiaSources(import.meta.url, [{
	package: '@theia/plugin-ext',
	file: 'src/main/browser/window-state-main.ts',
	expect: [
		{ snippet: expectedConstructorFocus, message: 'Unsupported @theia/plugin-ext WindowStateMain top level focus and blur listener block.' },
		{ snippet: expectedFocusMethod, message: 'Unsupported @theia/plugin-ext WindowStateMain.onFocusChanged implementation.' }
	]
}]);
