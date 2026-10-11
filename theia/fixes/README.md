# theia-fixes

Native Eclipse Theia extension for persistent code folding in ordinary source files.

When code blocks are folded in a file, their state is saved in Theia's storage and restored when the file is reopened through File Explorer, Quick Open, or another editor opener. It is also preserved when the file was closed before Theia restarted. The extension does not modify the source file.

The extension listens for Monaco's `onDidChangeHiddenAreas` event and stores only `editor.contrib.folding` from the editor view state. Cursor position, selection, and scroll position are not overwritten. It waits for Monaco's folding model to compute before restoring a saved memento, and preserves Monaco's built in range checksums so folds are not applied to regions whose contents no longer match.

Only `file:` source editors are affected. Notebook cell input folding is handled separately by `theia/notebook-fixes`. Editors that remain open already have their view state managed by Theia.

The package is automatically discovered as a native extension by the existing `HOMEBREW_THEIA_EXTENSIONS` directory scan. Requires `@theia/core`, `@theia/editor`, and `@theia/monaco` from the host Theia installation.

Build with `yarn build`. Run the folding state tests with `yarn test` after building.

## Draggable windows

Adds VS Code style floating editor behavior to Theia's existing secondary window support.

Dragging an extractable tab outside the current Theia window and releasing it runs Theia's existing `extract-widget` command for that tab. Normal Lumino docking still handles tab reordering and moves between dock targets inside the window, and pressing Escape cancels the drag without opening a secondary window.

Before extraction, the Electron main process reads the current cursor screen position with Electron's `screen.getCursorScreenPoint()`, matching VS Code's current approach. The next secondary window keeps Theia's configured secondary window size and is positioned from the cursor using the dragged tab's dimensions, matching VS Code's top edge offset behavior.

This intentionally uses Theia's existing `SecondaryWindowHandler` and secondary window implementation. It does not start another frontend or backend process.

Theia currently disables drag and drop inside secondary window dock panels. This extension leaves that upstream restriction in place, so it supports dragging tabs out of normal Theia dock panels into a new secondary window, but does not yet support dragging tabs between secondary windows.
