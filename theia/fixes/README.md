# theia-fixes

Native Eclipse Theia extension for persistent code folding in ordinary source files.

When code blocks are folded in a file, their state is saved in Theia's storage and restored when the file is reopened through File Explorer, Quick Open, or another editor opener. It is also preserved when the file was closed before Theia restarted. The extension does not modify the source file.

The extension listens for Monaco's `onDidChangeHiddenAreas` event and stores only `editor.contrib.folding` from the editor view state. Cursor position, selection, and scroll position are not overwritten. It waits for Monaco's folding model to compute before restoring a saved memento, and preserves Monaco's built in range checksums so folds are not applied to regions whose contents no longer match.

Only `file:` source editors are affected. Notebook cell input folding is handled separately by `theia/notebook-fixes`. Editors that remain open already have their view state managed by Theia.

The package is automatically discovered as a native extension by the existing `HOMEBREW_THEIA_EXTENSIONS` directory scan. Requires `@theia/core`, `@theia/editor`, and `@theia/monaco` from the host Theia installation.

Build with `yarn build`. Run the folding state tests with `yarn test` after building.
