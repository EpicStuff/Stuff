import { ContainerModule } from '@theia/core/shared/inversify';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { FixedWebviewWidget } from './fixed-webview-widget';

export default new ContainerModule(() => {
	WebviewWidget.prototype.handleContextMenu = FixedWebviewWidget.prototype.handleContextMenu;
});
