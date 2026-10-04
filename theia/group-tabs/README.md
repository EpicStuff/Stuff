# theia-group-tabs

A native Eclipse Theia extension that groups related widgets into one top level tab.

The extension is generic. It does not contain Markdown or Typst matching. The first time a relationship is used, open the widgets normally, run `Group Tabs`, and select the other widgets that belong with the current one.

When `groupTabs.rememberGroups` is enabled, which is the default, the extension remembers the creation relationship rather than the displayed title or file name. A remembered relationship uses the source widget type, companion widget type, and how the companion was opened relative to its source. Opening the same kind of relationship for another file can therefore group automatically.

For example, group `1.md` with the preview that was opened from it once. Later, opening the same preview type from `2.md` can group automatically without a rule for the `2.md` path.

Editor splits are remembered the same way. A pane created with Split Editor Right or Split Editor Down keeps that source relationship. Groups can contain more than two panes, and mixed horizontal and vertical split relationships are represented with nested split layouts.

Theia Mini Browser URL Preview is the one special case. The built in `mini-browser.openUrl` command uses a shared preview widget in the right panel and does not expose a source reference. Group Tabs records the source that was active when URL Preview was opened. After a Mini Browser URL Preview relationship has been grouped once, future matching URL previews can be moved from the panel into the remembered group automatically. There is no Typst specific code in this path.

The grouped layout is stored through Theia's normal shell layout restoration when all panes can be restored. Mini Browser URL Preview panes are treated as transient because a local preview server might not survive a restart. The source layout still restores normally, and the remembered relationship is applied again the next time URL Preview opens.

The setting is:

```json
{
	"groupTabs.rememberGroups": true
}
```

Turning it off stops learning new relationships and stops automatic regrouping. Existing saved rules are kept so turning the setting back on resumes them.
