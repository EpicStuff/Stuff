import { verifyTheiaSources } from '../../shared/theia-source-check.mjs';

const expectedRender = `    render(options: RenderContextMenuOptions): ContextMenuAccess {
        let menu = options.menu;
        if (!menu) {
            menu = this.menuRegistry.getMenu(options.menuPath) || new GroupImpl('emtpyContextMenu');
        }

        const resolvedOptions = this.resolve(options);

        if (resolvedOptions.skipSingleRootNode) {
            menu = MenuModelRegistry.removeSingleRootNode(menu);
        }

        const access = this.doRender({
            menuPath: options.menuPath,
            menu,
            anchor: resolvedOptions.anchor,
            contextMatcher: options.contextKeyService || this.contextKeyService,
            args: resolvedOptions.args,
            context: resolvedOptions.context,
            onHide: resolvedOptions.onHide
        });
        this.setCurrent(access);
        return access;
    }`;

const expectedBrowserRendererClass = `export class BrowserContextMenuRenderer extends ContextMenuRenderer {`;

const renderOverride = '\n    render(';

const overrideRenderOverride = '\n    override render(';

const expectedElectronRendererClass = `export class ElectronContextMenuRenderer extends BrowserContextMenuRenderer {`;

const expectedActionIsVisible = `    isVisible<T>(effeciveMenuPath: MenuPath, contextMatcher: ContextExpressionMatcher<T>, context: T | undefined, ...args: unknown[]): boolean {
        if (!this.commands.isVisible(this.action.commandId, ...args)) {
            return false;
        }
        if (this.action.when) {
            return contextMatcher.match(this.action.when, context);
        }
        return true;
    }`;

const expectedCompoundIsEmpty = `    isEmpty<T>(effectiveMenuPath: MenuPath, contextMatcher: ContextExpressionMatcher<T>, context: T | undefined, ...args: unknown[]): boolean {
        for (const child of this.children) {
            if (child.isVisible(effectiveMenuPath, contextMatcher, context, ...args)) {
                if (!CompoundMenuNode.is(child) || !child.isEmpty(effectiveMenuPath, contextMatcher, context, ...args)) {
                    return false;
                }
            }
        }
        return true;
    }`;

await verifyTheiaSources(import.meta.url, [{
	package: '@theia/core',
	file: 'src/browser/context-menu-renderer.ts',
	expect: [
		{ snippet: expectedRender, message: 'Unsupported @theia/core ContextMenuRenderer.render implementation.' }
	]
}, {
	package: '@theia/core',
	file: 'src/browser/menu/browser-context-menu-renderer.ts',
	expect: [
		{ snippet: expectedBrowserRendererClass, message: 'Unsupported @theia/core BrowserContextMenuRenderer base class.' },
		{ snippet: renderOverride, message: 'Unsupported @theia/core BrowserContextMenuRenderer.render override.', absent: true },
		{ snippet: overrideRenderOverride, message: 'Unsupported @theia/core BrowserContextMenuRenderer.render override.', absent: true }
	]
}, {
	package: '@theia/core',
	file: 'src/electron-browser/menu/electron-context-menu-renderer.ts',
	expect: [
		{ snippet: expectedElectronRendererClass, message: 'Unsupported @theia/core ElectronContextMenuRenderer base class.' },
		{ snippet: renderOverride, message: 'Unsupported @theia/core ElectronContextMenuRenderer.render override.', absent: true },
		{ snippet: overrideRenderOverride, message: 'Unsupported @theia/core ElectronContextMenuRenderer.render override.', absent: true }
	]
}, {
	package: '@theia/core',
	file: 'src/browser/menu/action-menu-node.ts',
	expect: [
		{ snippet: expectedActionIsVisible, message: 'Unsupported @theia/core ActionMenuNode.isVisible implementation.' }
	]
}, {
	package: '@theia/core',
	file: 'src/browser/menu/composite-menu-node.ts',
	expect: [
		{ snippet: expectedCompoundIsEmpty, message: 'Unsupported @theia/core AbstractCompoundMenuImpl.isEmpty implementation.' }
	]
}]);
