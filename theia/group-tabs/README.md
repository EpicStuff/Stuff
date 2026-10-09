# theia-group-tabs

A native Eclipse Theia extension that groups related widgets into one top level tab.

The extension is generic. It does not contain Markdown or Typst matching. The first time a combination is used, open the widgets normally and run `Group Tabs`. The command automatically groups the currently shown tab from each visible main editor split. Background tabs and side or bottom panel widgets are ignored.

Groups can contain more than two panes. The Group Tabs command snapshots the actual visible main area dock tree and restores that tree inside a nested DockPanel, so mixed horizontal and vertical layouts keep the same nesting and relative sizes. If one of the visible tabs is already a group, the other visible tabs are added to that group instead, each placed beside the group's first pane according to how it was opened, so the snapshot's nesting and sizes are not kept in that case. Dragging another tab onto a group does not add it to the group; the drop lands in the main area as it would on any other tab.

## Remembered layouts

When `groupTabs.rememberGroups` is enabled, which is the default, every group made with `Group Tabs` is remembered as a layout template. A template is the group's set of slots plus its split layout and relative sizes. Each slot is the widget type of a pane and how that tab was opened: the open mode Theia used, such as `split-right` or `open-to-right`, `open` for a normal open with no mode, or the URL Preview case described below. A tab has no parent tab; a file opened normally is just `open`, wherever the focus was. Titles and file names are not part of a template.

Whenever a tab opens in the main area, Group Tabs checks whether the currently open, ungrouped main area tabs can fill every slot of a template, with the new tab among them. Order does not matter: any matching tab can fill any slot, whenever it was opened. When there are more candidates than slots, the most recently opened or focused tabs are used. On a match exactly those tabs are grouped with the template's saved layout and sizes. Tabs of the same type and open mode are interchangeable; they fill those slots in the order they were opened. When several templates match at once, the most recently learned one wins.

Tabs whose opening was not seen, such as tabs restored at startup or opened before the extension started, have an unknown open mode. They can fill any slot of their widget type. Panes of such tabs grouped manually likewise give slots that accept any open mode. Dragging is not recorded either, so a layout arranged by dragging tabs is matched by widget type and open mode, not by the drag.

For example, with a template of three editors opened normally side by side: opening `1.md` and `2.md` does nothing. Opening `3.md` groups `1.md`, `2.md` and `3.md` in the saved layout. Opening `4.md` and `5.md` does nothing again, and opening `6.md` groups them as the next group.

Templates with the same set of slots are kept once; grouping the same set again replaces the saved layout with the newer one. To change a remembered layout, resize inside the group and run `Group Tabs` on it again. Resizing alone does not change the template. Overlapping templates are not treated specially. If a two editor template is a subset of a three editor template, the two editor one completes first and the three editor one never gets the chance until the smaller template is removed.

Templates are stored in this device's local storage and shared across all workspaces. Grouped layouts are part of each workspace's shell layout and stay per workspace.

Run `Ungroup Tabs` on a grouped tab to rebuild the same split nesting in the main area using normal Theia split operations. Relative pane sizes are not kept; the new splits use Theia's default sizes. It does not hand an old live DockPanel layout back to Lumino. Ungrouping also forgets that group's template so the same tabs are not immediately grouped again.

## Mini Browser URL Preview

Theia Mini Browser URL Preview is the one special case. The built in `mini-browser.openUrl` command uses a shared preview widget in the right panel and does not expose a source reference, so Group Tabs records that the preview was opened through URL Preview and which tab was active when it was opened. The first time, the preview must be moved into the main editor area manually before running `Group Tabs`. After that template has been learned, opening the URL Preview again can move it directly from the right panel into a group with the tab it was opened from, which must be one of the group's tabs. If the right panel was collapsed before opening the preview, Group Tabs collapses it again after the preview has moved into the group. There is no Typst specific code in this path.

The grouped layout is stored through Theia's normal shell layout restoration when all panes can be restored. Mini Browser URL Preview panes are treated as transient because a local preview server might not survive a restart. When only the source pane can be restored, the group container is kept only if `groupTabs.rememberGroups` is enabled and the group's template has a URL Preview slot beside that one pane, so the preview is inserted back into that same group, in its saved place, the next time it is opened from that pane. Otherwise the remaining pane becomes a normal tab again.

## Setting

```json
{
	"groupTabs.rememberGroups": true
}
```

Turning it off stops learning templates and stops automatic grouping. Turning it off does not delete saved templates, so turning the setting back on resumes them, but `Ungroup Tabs` still forgets the template of the group it ungroups even while the setting is off.
