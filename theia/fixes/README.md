# theia-fixes

Native Eclipse Theia extension for persistent code folding and Hot Exit recovery of unsaved text changes.

When code blocks are folded in a file, their state is saved in Theia's storage and restored when the file is reopened through File Explorer, Quick Open, or another editor opener. It is also preserved when the file was closed before Theia restarted. The extension does not modify the source file.

The extension listens for Monaco's `onDidChangeHiddenAreas` event and stores only `editor.contrib.folding` from the editor view state. Cursor position, selection, and scroll position are not overwritten. It waits for Monaco's folding model to compute before restoring a saved memento, and preserves Monaco's built in range checksums so folds are not applied to regions whose contents no longer match.

Only `file:` source editors are affected. Notebook cell input folding is handled separately by `theia/notebook-fixes`. Editors that remain open already have their view state managed by Theia.

The package is automatically discovered as a native extension by the existing `HOMEBREW_THEIA_EXTENSIONS` directory scan. Requires `@theia/core`, `@theia/editor`, and `@theia/monaco` from the host Theia installation.

## Hot Exit

Unsaved `file:` and `untitled:` Monaco text editor contents are backed up as separate JSON files under the Electron user data directory at `hot-exit-backups/`. The original files are not modified by the backup process. On reopening a workspace, backed up editors are reopened with their changes still unsaved. The backup is deleted after a successful save or when an editor is explicitly closed.

Closing a window with dirty supported text editors waits for the backups to finish rather than prompting to save the original files. If there are unsupported dirty editors (including notebooks), Theia retains its existing save dialog. If a backup cannot be written, shutdown is cancelled to avoid data loss. Files modified outside Theia are never overwritten with an older backup; the backup is retained for manual recovery.

The backup is deliberately scoped to the workspace window. Editor buffers are restored into Monaco models, not written to their original paths. The extension does not yet preserve Monaco undo history or notebook cell state.

Build with `yarn build`. Run the tests with `yarn test` after building.

## Triple click selection

A triple click in an ordinary Monaco source editor selects all characters of the clicked line without its terminating newline. Single and double clicks, clicks with selection modifiers, and quadruple clicks retain their built in behavior. The change also handles empty lines and does not interfere with selections that Monaco has not recognized as a full line.

## Word wrap toggle

The View: Toggle Word Wrap command now matches VS Code: it temporarily switches wrapping for the current Monaco text document without updating `editor.wordWrap` or other saved preferences. The next toggle removes the temporary override and restores the configured wrapping mode, including `wordWrapColumn` and `bounded`.

The temporary state uses Monaco's transient model properties, so split editors display the same wrapping and switching tabs keeps the state until the model is released. Diff editor sides are synchronized when toggled and when compared models change. The command targets the focused Monaco editor, including embedded editors, and follows VS Code's inline diff restrictions. Menu enablement and its checked state reflect the active editor. Editor preferences still apply whenever there is no temporary override.

## Draggable windows

Adds VS Code style floating editor behavior to Theia's existing secondary window support.

Dragging an extractable tab outside the current Theia window and releasing it runs Theia's existing `extract-widget` command for that tab. Normal Lumino docking still handles tab reordering and moves between dock targets inside the window, and pressing Escape cancels the drag without opening a secondary window.

Before extraction, the Electron main process reads the current cursor screen position with Electron's `screen.getCursorScreenPoint()`, matching VS Code's current approach. The next secondary window keeps Theia's configured secondary window size and is positioned from the cursor using the dragged tab's dimensions, matching VS Code's top edge offset behavior.

This intentionally uses Theia's existing `SecondaryWindowHandler` and secondary window implementation. It does not start another frontend or backend process.

Theia currently disables drag and drop inside secondary window dock panels. This extension leaves that upstream restriction in place, so it supports dragging tabs out of normal Theia dock panels into a new secondary window, but does not yet support dragging tabs between secondary windows.
