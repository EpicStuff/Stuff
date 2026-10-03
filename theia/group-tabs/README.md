# theia-group-tabs

A native Eclipse Theia extension that groups a source widget and a companion widget into one top level tab.

The generic core uses Theia's `SplitWidget`. The source stays on the left, the companion stays on the right, and the divider is draggable.

Current integrations:

- Tinymist previews opened through `group-tabs.openPreviewUrl`.
- VS Code Markdown dynamic previews with view type `markdown.preview`.
- VS Code Markdown preview custom editors with view type `vscode.markdown.preview.editor`.

Closing the outer tab closes both contained widgets. The outer toolbar also exposes a Close Preview action. Closing the companion by any other route unwraps the source and restores it as a normal main area tab.

A group has one companion. Pairing a source that is already grouped with a different companion replaces the old companion; VS Code Markdown does this on every Preview to Side because it cannot match a grouped preview's view column. If Theia moves a grouped widget back into the dock (webviews revealed in an explicit view column), the group adopts it again.

The grouped tab delegates its tab toolbar to the source widget, so normal source editor toolbar actions continue to appear.

The grouping service is generic and exported from `theia-group-tabs/lib/browser/group-tabs-service`. The current integrations only create two pane source and preview groups.

Session restoration is not implemented yet. This first version is intended to be exercised in the packaged Theia 1.75.0 application before persistence is added.
