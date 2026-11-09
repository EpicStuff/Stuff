import { coordinateFromAnchor, type Anchor, type ContextMenuAccess } from '@theia/core/lib/browser/context-menu-renderer';
import type { ContextMatcher } from '@theia/core/lib/browser/context-key-service';
import { DynamicMenuWidget } from '@theia/core/lib/browser/menu/browser-menu-plugin';
import { ElectronContextMenuAccess, ElectronContextMenuRenderer } from '@theia/core/lib/electron-browser/menu/electron-context-menu-renderer';
import type { MenuDto } from '@theia/core/lib/electron-common/electron-api';
import type { CompoundMenuNode, MenuPath } from '@theia/core/lib/common/menu';

type ContextMenuRenderParams = {
	menuPath: MenuPath;
	menu: CompoundMenuNode;
	anchor: Anchor;
	contextMatcher: ContextMatcher;
	args?: unknown[];
	context?: HTMLElement;
	onHide?: () => void;
};

type ElectronDoRender = (this: ElectronContextMenuRenderer, params: ContextMenuRenderParams) => ContextMenuAccess;

type ElectronRendererInternals = {
	useNativeStyle: boolean;
	electronMenuFactory: {
		createElectronContextMenu(
			menuPath: MenuPath,
			menu: CompoundMenuNode,
			contextMatcher: ContextMatcher,
			args?: unknown[],
			context?: HTMLElement
		): MenuDto[];
	};
	context: {
		resetAltPressed(): void;
	};
};

type FocusAwareMenu = DynamicMenuWidget & {
	previousFocusedElement?: HTMLElement;
};

type ElectronTheiaCore = {
	popup(menu: MenuDto[], x: number, y: number, onClosed: () => void, windowName?: string): Promise<number>;
};

type WindowWithElectronApi = Window & {
	electronTheiaCore?: ElectronTheiaCore;
};

type DeferredNativeExecution = {
	closed: boolean;
	pending?: () => void;
};

const browserFocusRestoreDelayMs = 250;

function isWebviewContextMenu(params: ContextMenuRenderParams): boolean {
	return params.menuPath.length === 1
		&& params.menuPath[0] === 'webview-context-menu'
		&& params.context?.querySelector('iframe.webview') != null;
}

function isWebviewFrame(element: HTMLElement | undefined): element is HTMLIFrameElement {
	return element instanceof HTMLIFrameElement && element.classList.contains('webview');
}

function runAfterNativeMenuCloses(state: DeferredNativeExecution, execute: () => void): void {
	if (state.closed) {
		queueMicrotask(execute);
		return;
	}

	state.pending = execute;
}

function wrapNativeMenu(menu: MenuDto[], state: DeferredNativeExecution): MenuDto[] {
	return menu.map(item => {
		const execute = item.execute;
		return {
			...item,
			submenu: item.submenu == null ? undefined : wrapNativeMenu(item.submenu, state),
			execute: execute == null ? undefined : () => runAfterNativeMenuCloses(state, execute)
		};
	});
}

function restoreWebviewFocusIfIdle(frame: HTMLIFrameElement): void {
	if (!frame.isConnected || !document.hasFocus()) return;

	const activeElement = document.activeElement;
	if (activeElement == null || activeElement === document.body) {
		frame.focus({ preventScroll: true });
	}
}

let installed = false;

export function installWebviewContextMenuFocusFix(): void {
	if (installed) return;
	installed = true;

	const electronPrototype = ElectronContextMenuRenderer.prototype as unknown as {
		doRender?: ElectronDoRender;
	};
	const maybeOriginalElectronDoRender = electronPrototype.doRender;
	if (typeof maybeOriginalElectronDoRender !== 'function') {
		throw new Error('Unsupported Theia ElectronContextMenuRenderer: doRender was not found');
	}
	const originalElectronDoRender: ElectronDoRender = maybeOriginalElectronDoRender;

	electronPrototype.doRender = function (params) {
		const internals = this as unknown as ElectronRendererInternals;
		const electronApi = (window as WindowWithElectronApi).electronTheiaCore;
		if (!internals.useNativeStyle || electronApi == null || !isWebviewContextMenu(params)) {
			return originalElectronDoRender.call(this, params);
		}

		const menu = internals.electronMenuFactory.createElectronContextMenu(
			params.menuPath,
			params.menu,
			params.contextMatcher,
			params.args,
			params.context
		);
		const state: DeferredNativeExecution = { closed: false };
		const { x, y } = coordinateFromAnchor(params.anchor);
		const windowName = params.context?.ownerDocument.defaultView?.Window.name;
		const menuHandle = electronApi.popup(wrapNativeMenu(menu, state), x, y, () => {
			state.closed = true;
			params.onHide?.();

			const execute = state.pending;
			state.pending = undefined;
			if (execute != null) {
				queueMicrotask(execute);
			}
		}, windowName);

		internals.context.resetAltPressed();
		return new ElectronContextMenuAccess(menuHandle);
	};

	const browserPrototype = DynamicMenuWidget.prototype as unknown as {
		triggerActiveItem(this: DynamicMenuWidget): void;
	};
	const originalTriggerActiveItem = browserPrototype.triggerActiveItem;

	browserPrototype.triggerActiveItem = function () {
		const item = this.activeItem;
		const rootMenu = this.rootMenu as FocusAwareMenu;
		const previousFocusedElement = rootMenu.previousFocusedElement;

		if (item?.type !== 'command' || !isWebviewFrame(previousFocusedElement)) {
			originalTriggerActiveItem.call(this);
			return;
		}

		// Lumino closes the root menu before executing its command. Theia normally restores the
		// element that was focused before the menu at that point, and then focuses it again from
		// the generated command handler. If that element is a webview iframe, a command that opens
		// a QuickPick loses it immediately when the iframe regains focus.
		rootMenu.previousFocusedElement = undefined;
		const activeMenu = this as FocusAwareMenu;
		if (activeMenu.previousFocusedElement === previousFocusedElement) {
			activeMenu.previousFocusedElement = undefined;
		}

		originalTriggerActiveItem.call(this);

		// A browser style menu has no close callback that can run the command after focus settles,
		// so give host UI opened by the command a chance to claim focus first. If nothing does,
		// return keyboard focus to the webview.
		setTimeout(() => restoreWebviewFocusIfIdle(previousFocusedElement), browserFocusRestoreDelayMs);
	};
}
