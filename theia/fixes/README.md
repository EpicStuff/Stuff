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

A triple click in a Monaco source editor, including either side of a diff editor, selects all characters of the clicked line without its terminating newline. Single and double clicks, clicks with selection modifiers, and quadruple clicks retain their built in behavior. The change also handles empty lines and does not interfere with selections that Monaco has not recognized as a full line. The handler is registered centrally through Monaco's `ICodeEditorService`, which automatically covers every Monaco code editor instance, including both sides of diffs and embedded editors. Listeners are cleaned up when the corresponding Monaco editor is removed.

## Word wrap toggle

The View: Toggle Word Wrap command now matches VS Code: it temporarily switches wrapping for the current Monaco text document without updating `editor.wordWrap` or other saved preferences. The next toggle removes the temporary override and restores the configured wrapping mode, including `wordWrapColumn` and `bounded`.

The temporary state uses Monaco's transient model properties, so split editors display the same wrapping and switching tabs keeps the state until the model is released. Diff editor sides are synchronized when toggled and when compared models change. The command targets the focused Monaco editor, including embedded editors, and follows VS Code's inline diff restrictions. Menu enablement and its checked state reflect the active editor. Editor preferences still apply whenever there is no temporary override.

## Hot Exit across windows

Backup filenames are scoped to the owning Electron window and process run as well as the workspace and file URI. Two windows editing the same file cannot overwrite or delete each other's backup files. Older backups remain readable. Backups from other currently open windows are not recovered into the new window. If multiple abandoned versions exist for the same file, recovery does not select one automatically: both JSON backups remain on disk for manual recovery.

Grouped Monaco text editors are included in Hot Exit. A final backup check during Electron shutdown also runs when `application.confirmExit` is set to `never`. Notebooks and unsupported custom editors still do not have Hot Exit backup support.

## Diff preview tabs

Diff editors opened without an explicit preview choice use Theia's existing temporary editor tabs, matching VS Code. A new diff replaces the previous temporary tab in the same editor group. Double clicking the tab or choosing Keep Open makes it permanent. Explicit `preview: false` requests stay permanent, and the `editor.enablePreview` preference is respected. Ordinary editors are unchanged.

This is implemented by extending Theia's existing `EditorPreviewManager` instead of installing a separate diff editor or overriding commands. The behavior applies to diff URI editors regardless of which opener produced them.

## Natural Explorer sorting

Explorer file and directory names use VS Code's default numeric comparison, so `1`, `2`, `10`, `11` appear in that order. Numeric ties place the shorter name first. Directories remain before files, as in Theia's original Explorer. The fix replaces only the Explorer's tree implementation in its child container; file dialogs and other filesystem trees are unaffected.

## Swap diff sides

In a text diff editor, the Compare: Swap Left and Right Editor Side command and arrow swap toolbar button reverse the original and modified files. The replacement opens as a permanent tab in the same editor group and position. Theia's existing diff opener supplies the editor, and the original comparison closes after the new one opens. For unsaved changes on the old modified side, an editable tab is retained before swapping, matching VS Code's safeguard. Ordinary file editors and custom diff widgets are unaffected.

## Keyboard Shortcuts command ID search

The Keyboard Shortcuts search now matches command IDs as well as command names, shortcuts, contexts, and sources. Type a command ID such as `core.nextTab` directly to find it. As in VS Code, `@command:core.nextTab` filters to that exact command ID, with optional `+when:<expression>` to filter existing binding contexts. The implementation extends Theia's existing `KeybindingWidget` and preserves its editing and filtering behavior.

## Keyboard Shortcuts JSON tab placement

The Keyboard Shortcuts toolbar's JSON button opens `keymaps.json` in a normal tab, consistent with Settings JSON, instead of splitting the editor group to the right. The fix reuses Theia's existing `KeymapsService.open()` without a reference widget. The standalone Open Keyboard Shortcuts (JSON) command and the remaining shortcut editor actions are unchanged.
