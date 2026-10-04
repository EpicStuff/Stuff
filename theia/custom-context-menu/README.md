# theia-custom-context-menu

A native Eclipse Theia extension for configuring context menus without patching workbench HTML.

Current features:

- Editor right click
- Explorer right click
- Settings gear menu
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

The popup includes an `Open in Tab` button. It applies the current changes, opens the main area configurator, and closes the popup. This makes it easy to switch back to an editor or view and right click the actual menu while the configurator remains open.

Explicit `Custom Context Menu: Configure in Dialog` and `Custom Context Menu: Configure in Tab` commands are also available.

The extension leaves Theia's `MenuModelRegistry` untouched. It applies the saved layout to a temporary menu model immediately before `ContextMenuRenderer` renders it. The original command enablement and `when` conditions therefore remain active unless a user explicitly overrides a condition in the item editor.

Configuration is stored in the hidden user preference `customContextMenu.layouts`. The normal user preference `customContextMenu.openMode` controls whether the main Configure command opens as a dialog or tab.

The saved model is hierarchical. Existing extension supplied submenus keep their original nodes while their children can be hidden, reordered, moved, or customized. Custom submenus contain references to the original command nodes when an existing menu command is moved into them, so command behavior is retained.

New extension supplied menu entries are appended automatically if they were not present when a customized layout was last saved.

The current version intentionally does not add per context layouts or `Configure This Context Menu`. Extension supplied dynamic visibility still works for items whose condition has not been overridden.
