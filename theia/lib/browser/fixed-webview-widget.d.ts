import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
export interface WebviewContextMenuEvent {
    clientX: number;
    clientY: number;
    context: Record<string, unknown>;
}
export declare class FixedWebviewWidget extends WebviewWidget {
    handleContextMenu(event: WebviewContextMenuEvent): void;
}
