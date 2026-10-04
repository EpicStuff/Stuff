# theia-webview-context-fix

A native Eclipse Theia extension that fixes VS Code compatible webview context menus such as the GitLens Commit Graph menu.

The implementation is verified against the private Theia implementations it patches rather than being pinned to one Theia minor release. The build fails if those implementations change.

It fixes inherited `data-vscode-context` values by merging the full context chain before menu evaluation. It also fixes focus ordering when a webview context menu command opens host UI such as a VS Code QuickPick.

For native Electron context menus, Theia previously invoked the selected command while the native popup was still closing. If that command opened a QuickPick, the popup's later focus return to the webview could immediately dismiss it. Webview context menu commands are now deferred until the native popup has closed.

For browser style context menus, Theia restored the previously focused webview iframe before running the selected command. The fix suppresses that iframe restore while the command starts, then restores the webview only if no host UI has claimed focus.

The frontend module patches `WebviewWidget.handleContextMenu`, `ElectronContextMenuRenderer.doRender`, and `DynamicMenuWidget.triggerActiveItem`. The exported esbuild plugin patches the copied webview preload asset and verifies all upstream source shapes used by these patches.
