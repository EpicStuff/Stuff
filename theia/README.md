# Theia native extensions

Each child directory is an independent native Eclipse Theia extension package.

- `webview-context-fix` fixes inherited VS Code webview context menus.
- `notebook-fixes` adds notebook compatibility fixes and code cell input folding.

The Homebrew `theia-ide` formula can point `HOMEBREW_THEIA_EXTENSIONS` at this directory and will discover both packages automatically.
