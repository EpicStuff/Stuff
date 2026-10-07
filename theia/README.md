# Theia customizations

Native Eclipse Theia extensions are direct child packages:

- `webview-context-fix` fixes inherited VS Code webview context menus.
- `notebook-fixes` adds notebook compatibility fixes and code cell input folding.

VS Code compatibility extensions sit beside them; the formula tells them apart by `engines.vscode` in their `package.json`:

- `tinymist-theia-preview` keeps Tinymist's existing preview command but renders it in Theia's Mini Browser.

The Homebrew `theia-ide` formula can point `HOMEBREW_THEIA_EXTENSIONS` at this directory. Native extensions are built into the app, and unpacked VS Code extensions are bundled as built-in plugins.
