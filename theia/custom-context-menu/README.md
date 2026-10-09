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
- Live editing: every change is written to the settings immediately, with no Save or Apply step
- Undo and Redo per menu, from the toolbar or with Ctrl+Z and Ctrl+Shift+Z (Cmd on macOS)
- Popup and main area tab configuration modes
- Native Theia controls and theme styling

The normal `Custom Context Menu: Configure` command opens according to `customContextMenu.openMode`. The default is `dialog`. Set it to `tab` to make the configurator open in the main area by default.

The popup includes a VS Code style `Open in Tab` icon in its title bar. It moves the configurator into the main area tab and closes the popup, keeping the selected menu, expanded submenus, selection, and an in progress item editor. Menu edits are already saved, so there is nothing else to transfer.

Every edit is written to `customContextMenu.layouts` right away. Bursts of edits are coalesced into one settings write, and the status area shows `Saving...`, `Saved`, or the error if the write fails. The configurator keeps no draft: it always shows the currently contributed menu with the stored layout applied, and it updates live when extensions contribute or remove menu items or when the setting changes elsewhere, for example in `settings.json` or another configurator.

Undo and Redo restore earlier stored values of the selected menu's layout, including after Restore Defaults. History is kept per configurator and per menu, and a new edit clears the redo history. The keyboard shortcuts work while the configurator has focus; inside a text field they keep the field's own undo. Theia's own redo binding, Ctrl+Y outside macOS, also redoes configurator edits.

Explicit `Custom Context Menu: Configure in Dialog` and `Custom Context Menu: Configure in Tab` commands are also available.

Webview customization uses Theia's normal `WEBVIEW_CONTEXT_MENU`, which is the target for VS Code `webview/context` contributions. GitLens Commit Graph, Inspect, Rebase, and other GitLens webviews therefore use the same customization path while their original context based `when` clauses continue to decide which items are visible for the clicked row or ref.

The additional targets use the same renderer interception for Theia's terminal context menu, VS Code `view/item/context`, `scm/historyItem/context`, `scm/historyItemRef/context`, and `timeline/item/context` contribution points. Their original context keys and command argument adapters are preserved.

Commands added through the configurator that are contributed by extensions receive the same argument conversion Theia applies to extension menu items in that menu, for example only the first argument in `webview/context` or only the tree item references in `view/item/context`. Built-in Theia commands receive the menu's arguments unchanged.

The extension leaves Theia's `MenuModelRegistry` untouched. It applies the saved layout to a temporary menu model immediately before `ContextMenuRenderer` renders it. Original command behavior and extension supplied conditions remain active unless a condition is explicitly overridden.

## Storage

Configuration uses the normal Theia user preference `customContextMenu.layouts`, but it stores only differences from the currently contributed menu. Untouched commands are not copied into the setting. Writing one menu's layout leaves the stored values of all other menus exactly as they are.

A lightly customized menu can look like:

```json
{
	"customContextMenu.layouts": {
		"editor": {
			"hide": [
				"navigation/some.command"
			],
			"edit": {
				"1_modification/other.command": {
					"label": "My Command",
					"beforeGroup": "navigation"
				}
			},
			"add": {
				"custom:1": {
					"type": "submenu",
					"label": "Tools"
				},
				"custom:2": {
					"type": "command",
					"command": "extension.command",
					"parent": "custom:1"
				}
			}
		}
	}
}
```

### Keys

Contributed entries are keyed by their Theia menu path relative to the configured menu: the groups and submenus that contain them followed by the command or submenu id, such as `navigation/some.command` or `1_x/some.submenu/navigation/nested.command`. When the same command appears more than once in one group, later occurrences get `#2`, `#3`, and so on. A key therefore only changes when an extension moves the contribution itself, not when the same command appears or disappears elsewhere in the menu or when another occurrence changes its `when` condition. The characters `%`, `/`, and `#` inside ids are percent encoded.

Structural separators use `separator:` followed by the path of the group they start, such as `separator:navigation` at the top level or `separator:1_x/some.submenu/navigation` inside a submenu. Such a key represents the separator before the group, not the commands in it.

Entries added through the configurator use keys `custom:1`, `custom:2`, and so on, which never collide with contributed entries. If an extension later contributes the same command, both the added and the contributed entry are shown.

Layouts written by versions before 0.9 used command ids, `submenu:` ids, and `separator:` group ids as keys. They are not migrated: entries whose keys no longer match are ignored. Clear the old value for the affected menu and recreate the changes through the configurator.

### Fields

Existing entries use `edit` for every override, including `label`, `icon`, `when`, `parent`, and placement. Commands moved into a submenu use `parent`, with `null` for the top level. Custom commands, submenus, and separators are stored under `add`. Removed default entries are listed under `hide`. New extension supplied commands therefore appear normally unless they are explicitly hidden or affected by an existing sparse override.

The configurator writes these placement fields:

- `group` with `at` set to `start` or `end`, to place an entry at the edge of a group
- `beforeGroup`, to place an entry just before a group's separator
- `before` or `after` with another entry's key, used inside groups and to chain consecutively moved entries so they replay in order
- `at` alone, to place an entry at the start or end of its menu or submenu

`afterGroup` is accepted when reading but never written. When the structural fields cannot reproduce an arrangement, for example because the referenced group is hidden or a separator was moved into another submenu, the configurator falls back to `before` and `after` keys for that menu level.

Separators stay where they are placed in the configurator, including at the top of a menu or next to another separator. The rendered menu collapses leading, trailing, and repeated separators like Theia does. Deleting a custom submenu moves the contributed entries it contained back to the submenu's position.

Malformed values are ignored when reading: entries with the wrong type, non-string labels, conditions, or icons, `add` entries without a valid `command`, and submenus without a label. If applying a layout fails anyway, the default menu is shown.

The previous full tree format containing `entries` and `knownDefaultKeys` is intentionally not migrated by the extension. It is ignored by the reader and left untouched in the setting until that menu is edited, which replaces it. Clear the old value once and recreate the desired changes through the configurator.

`customContextMenu.openMode` remains a normal visible preference and is unchanged.
