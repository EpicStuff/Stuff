import { PluginViewWidget } from '@theia/plugin-ext/lib/main/browser/view/plugin-view-widget';
import { WEBVIEW_CONTEXT_MENU, WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';

export interface WebviewContextMenuEvent {
	clientX: number;
	clientY: number;
	context: Record<string, unknown>;
}

export class FixedWebviewWidget extends WebviewWidget {
	override handleContextMenu(event: WebviewContextMenuEvent): void {
		const domRect = this.node.getBoundingClientRect();
		const context = this.parent instanceof PluginViewWidget
			? { webviewId: this.parent.options.viewId, ...event.context }
			: event.context;

		this.contextKeyService.with(context, () => {
			this.contextMenuRenderer.render({
				menuPath: WEBVIEW_CONTEXT_MENU,
				args: [event.context],
				anchor: {
					x: domRect.x + event.clientX,
					y: domRect.y + event.clientY
				},
				context: this.node
			});
		});
	}
}
