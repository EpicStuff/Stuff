# theia-webview-context-fix

A native Eclipse Theia extension that fixes VS Code compatible webview context menus such as the GitLens Commit Graph menu.

The implementation was verified against Theia 1.75.0. It fixes editor hosted webviews so inherited `data-vscode-context` values are merged correctly and passed into menu context evaluation.

The frontend module patches `WebviewWidget.handleContextMenu`. The exported esbuild plugin patches the copied webview preload asset and deliberately fails the build if the verified upstream implementation changes.
