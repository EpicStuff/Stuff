# Theia customizations

Native Eclipse Theia extensions are direct child packages:

- `webview-context-fix` fixes inherited VS Code webview context menus.
- `notebook-fixes` adds notebook compatibility fixes and code cell input folding.
- `group-tabs` groups source and preview widgets into one top level split tab.
- `custom-context-menu` adds native context menu hiding, reordering, separators, and a graphical configurator.
- `flags` adds VS Code compatible CLI flags and resident Electron startup controls including `--keep-warm`, `--daemon`, and `--quit`.
- `window-focus-fix` keeps the plugin window focused while focus is inside a webview.

VS Code compatibility extensions live under `vscode-extensions`:

- `tinymist-theia-preview` keeps Tinymist's existing preview command but renders it in Theia's Mini Browser.

The Homebrew `theia-ide` formula can point `HOMEBREW_THEIA_EXTENSIONS` at this directory. It discovers the native extension packages directly and bundles unpacked VS Code extensions from `vscode-extensions`.
