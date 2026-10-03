"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const inversify_1 = require("@theia/core/shared/inversify");
const webview_1 = require("@theia/plugin-ext/lib/main/browser/webview/webview");
const fixed_webview_widget_1 = require("./fixed-webview-widget");
exports.default = new inversify_1.ContainerModule(() => {
    webview_1.WebviewWidget.prototype.handleContextMenu = fixed_webview_widget_1.FixedWebviewWidget.prototype.handleContextMenu;
});
//# sourceMappingURL=theia-webview-context-fix-frontend-module.js.map