# theia-custom-context-menu

A native Eclipse Theia extension for configuring context menus without patching workbench HTML.

Current features:

- Editor right click
- Explorer right click
- Settings gear menu
- Webview right click menus, including GitLens Commit Graph and other `webview/context` contributions
- Terminal right click
- Extension tree view item right click, including `view/item/context` contributions
- SCM history commit row right click
- SCM history ref badge right click
- Timeline item right click
- Hiding menu items
- Drag reordering with before and after drop positions
- Move Up and Move Down controls
- Adding and moving separators
- Expanding existing submenus and editing their contents
- Creating custom submenus and dragging commands into or out of them
- Double click editing for item name, visibility condition, and icon
- Theia toolbar icon selector reuse for choosing item icons
- Adding registered commands
- Restoring a menu to its contributed default layout
- Popup and main area tab configuration modes
- Native Theia controls and theme styling

The normal `Custom Context Menu: Configure` command opens according to `customContextMenu.openMode`. The default is `dialog`. Set it to `tab` to make the configurator open in the main area by default.

The popup includes a VS Code style `Open in Tab` icon in its title bar. It transfers the live configurator state into the main area tab without saving first, then closes the popup. Draft menu edits, the selected menu, expanded submenus, selection, and an in progress item editor are preserved.

Explicit `Custom Context Menu: Configure in Dialog` and `Custom Context Menu: Configure in Tab` commands are also available.

Webview customization uses Theia's normal `WEBVIEW_CONTEXT_MENU`, which is the target for VS Code `webview/context` contributions. GitLens Commit Graph, Inspect, Rebase, and other GitLens webviews therefore use the same customization path while their original context based `when` clauses continue to decide which items are visible for the clicked row or ref.

The additional targets use the same renderer interception for Theia's terminal context menu, VS Code `view/item/context`, `scm/historyItem/context`, `scm/historyItemRef/context`, and `timeline/item/context` contribution points. Their original context keys and command argument adapters are preserved.

The extension leaves Theia's `MenuModelRegistry` untouched. It applies the saved layout to a temporary menu model immediately before `ContextMenuRenderer` renders it. Original command behavior and extension supplied conditions remain active unless a condition is explicitly overridden.

## Storage

Configuration uses the normal Theia user preference `customContextMenu.layouts`, but it stores only differences from the currently contributed menu. Untouched commands are not copied into the setting.

A lightly customized menu can look like:

```json
{
	"customContextMenu.layouts": {
		"editor": {
			"hide": [
				"some.command"
			],
			"edit": {
				"other.command": {
					"label": "My Command",
					"beforeGroup": "navigation"
				}
			},
			"add": {
				"submenu1": {
					"type": "submenu",
					"label": "Tools"
				}
			}
		}
	}
}
```

Existing entries use `edit` for every override, including `label`, `icon`, `when`, `parent`, and placement. Commands moved into a submenu use `parent`. Placement prefers `group` with `at`, then `beforeGroup` or `afterGroup`, and only falls back to relative `before` or `after` references when the desired position is inside a group.

Custom commands, submenus, and separators are stored under `add`. Removed default entries are listed under `hide`. Structural separator entries use keys such as `separator:Jupyter3`; that key represents the separator before the group, not the commands in the group. New extension supplied commands therefore appear normally unless they are explicitly hidden or affected by an existing sparse override.

The previous full tree format containing `entries` and `knownDefaultKeys` is intentionally not migrated by the extension. It is ignored by the new reader. Clear the old `customContextMenu.layouts` value once and recreate the desired changes through the configurator.

`customContextMenu.openMode` remains a normal visible preference and is unchanged.
