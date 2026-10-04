# theia-custom-context-menu

A native Eclipse Theia extension for configuring context menus without patching workbench HTML.

Version 0.1 supports:

- Editor right click
- Explorer right click
- Settings gear menu
- Hiding menu items
- Reordering menu items
- Adding and moving separators
- Adding registered commands
- Restoring a menu to its contributed default layout
- A native Theia React dialog for configuration

The extension leaves Theia's MenuModelRegistry untouched. It applies the saved layout to a temporary menu model immediately before ContextMenuRenderer renders it. That means the original command enablement and `when` conditions remain active, and the same customization path is used for browser style and native Electron context menus.

Configuration is stored in the hidden user preference `customContextMenu.layouts`. The dialog is available from the command palette as `Custom Context Menu: Configure` and from the Settings gear menu.

The first version intentionally does not add per context overrides or `Configure This Context Menu`. Extension supplied dynamic visibility still works because the original menu nodes are reused after reordering.

Commands manually added through the configurator have no extra `when` expression. Existing commands that were originally contributed to the selected menu keep their original visibility condition when removed and added back.
