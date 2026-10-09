# Theia customizations

Native Eclipse Theia extensions are direct child packages:

- `webview-context-fix` fixes VS Code webview context menus and webview panel focus semantics.
- `notebook-fixes` adds notebook compatibility fixes and code cell input folding.
- `group-tabs` groups source and preview widgets into one top level split tab.
- `custom-context-menu` adds native context menu hiding, reordering, separators, and a graphical configurator.
- `keep-warm` adds resident Electron startup controls including `--keep-warm`, `--daemon`, and `--quit`.
- `window-focus-fix` keeps the plugin window focused while focus is inside a webview.

VS Code compatibility extensions sit beside them; the formula tells them apart by `engines.vscode` in their `package.json`:

- `tinymist-theia-preview` keeps Tinymist's existing preview command but renders it in Theia's Mini Browser.

The Homebrew `theia-ide` formula can point `HOMEBREW_THEIA_EXTENSIONS` at this directory. Native extensions are built into the app, and unpacked VS Code extensions are bundled as built-in plugins.
