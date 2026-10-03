"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FixedWebviewWidget = void 0;
const plugin_view_widget_1 = require("@theia/plugin-ext/lib/main/browser/view/plugin-view-widget");
const webview_1 = require("@theia/plugin-ext/lib/main/browser/webview/webview");
class FixedWebviewWidget extends webview_1.WebviewWidget {
    handleContextMenu(event) {
        const domRect = this.node.getBoundingClientRect();
        const context = this.parent instanceof plugin_view_widget_1.PluginViewWidget
            ? { webviewId: this.parent.options.viewId, ...event.context }
            : event.context;
        this.contextKeyService.with(context, () => {
            this.contextMenuRenderer.render({
                menuPath: webview_1.WEBVIEW_CONTEXT_MENU,
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
exports.FixedWebviewWidget = FixedWebviewWidget;
//# sourceMappingURL=fixed-webview-widget.js.map