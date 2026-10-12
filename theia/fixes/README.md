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
