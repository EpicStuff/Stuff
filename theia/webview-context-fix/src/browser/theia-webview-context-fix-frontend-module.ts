import { ContainerModule } from '@theia/core/shared/inversify';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { FixedWebviewWidget } from './fixed-webview-widget';
import { installWebviewContextMenuFocusFix } from './webview-context-menu-focus-fix';
import { installWebviewPanelActiveFix } from './webview-panel-active-fix';

export default new ContainerModule(() => {
	installWebviewContextMenuFocusFix();
	installWebviewPanelActiveFix();
	WebviewWidget.prototype.handleContextMenu = FixedWebviewWidget.prototype.handleContextMenu;
});
