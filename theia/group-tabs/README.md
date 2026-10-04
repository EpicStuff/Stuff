# theia-group-tabs

A native Eclipse Theia extension that groups related widgets into one top level tab.

The extension is generic. It does not contain Markdown or Typst matching. The first time a relationship is used, open the widgets normally and run `Group Tabs`. The command automatically groups the currently shown tab from each visible main editor split. Background tabs and side or bottom panel widgets are ignored.

When `groupTabs.rememberGroups` is enabled, which is the default, the extension remembers the creation relationship rather than the displayed title or file name. A remembered relationship uses the source widget type, companion widget type, and how the companion was opened relative to its source. Opening the same kind of relationship for another file can therefore group automatically.

For example, group `1.md` with the preview that was opened from it once. Later, opening the same preview type from `2.md` can group automatically without a rule for the `2.md` path.

Editor splits are remembered the same way. A pane created with Split Editor Right or Split Editor Down keeps that source relationship. Groups can contain more than two panes. The Group Tabs command snapshots the actual visible main area dock tree and restores that tree inside a nested DockPanel, so mixed horizontal and vertical layouts keep the same nesting and relative sizes.

Theia Mini Browser URL Preview is the one special case for remembering provenance. The built in `mini-browser.openUrl` command uses a shared preview widget in the right panel and does not expose a source reference, so Group Tabs records the source that was active when URL Preview was opened. The preview is never grouped while it remains in a side panel. It must be moved into the main editor area before it can be grouped, either manually or by a remembered relationship after the move. There is no Typst specific code in this path.

The grouped layout is stored through Theia's normal shell layout restoration when all panes can be restored. Mini Browser URL Preview panes are treated as transient because a local preview server might not survive a restart. The source layout still restores normally, and the remembered relationship is applied again the next time URL Preview opens.

Run `Ungroup Tabs` on a grouped tab to rebuild the same visible split tree in the main area using normal Theia split operations. It does not hand an old live DockPanel layout back to Lumino. Ungrouping also removes the remembered rules represented by that group so the same relationship is not immediately grouped again.

The setting is:

```json
{
	"groupTabs.rememberGroups": true
}
```

Turning it off stops learning new relationships and stops automatic regrouping. Existing saved rules are kept so turning the setting back on resumes them.
