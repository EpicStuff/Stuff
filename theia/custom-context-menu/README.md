# theia-custom-context-menu

A native Eclipse Theia extension for configuring context menus without patching workbench HTML.

Current features:

- Editor right click
- Explorer right click
- Settings gear menu
- Hiding menu items
- Drag reordering
- Move Up and Move Down controls
- Adding and moving separators
- Expanding existing submenus and editing their contents
- Creating custom submenus and dragging commands into or out of them
- Renaming custom submenus
- Adding registered commands
- Restoring a menu to its contributed default layout
- A main area configuration tab for testing menus while the configurator stays open
- An optional modal dialog configurator
- Native Theia controls and theme styling

The normal `Custom Context Menu: Configure` command opens the configurator in a main area tab. Apply changes, switch to another editor or view, and right click to inspect the result without closing the configurator.

`Custom Context Menu: Configure in Dialog` keeps the modal workflow available.

The extension leaves Theia's `MenuModelRegistry` untouched. It applies the saved layout to a temporary menu model immediately before `ContextMenuRenderer` renders it. The original command enablement and `when` conditions therefore remain active, and the same customization path is used for browser style and native Electron context menus.

Configuration is stored in the hidden user preference `customContextMenu.layouts`.

The saved model is hierarchical. Existing extension supplied submenus keep their original nodes and conditions, while their children can be hidden, reordered, or moved. Custom submenus contain references to the original command nodes when an existing menu command is moved into them, so that command's original visibility condition is retained.

New extension supplied menu entries are appended automatically if they were not present when a customized layout was last saved.

The current version intentionally does not add per context overrides or `Configure This Context Menu`. Extension supplied dynamic visibility still works because the original menu nodes are reused after reordering.
