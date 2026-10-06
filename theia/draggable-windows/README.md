# Theia Draggable Windows

Adds VS Code style floating editor behavior to Theia's existing secondary window support.

Dragging an extractable tab outside the current Theia window and releasing it runs Theia's existing `extract-widget` command for that tab. Normal Lumino docking still handles tab reordering and moves between dock targets inside the window, and pressing Escape cancels the drag without opening a secondary window.

This intentionally uses Theia's existing `SecondaryWindowHandler`. It does not start another frontend or backend process.

Theia currently disables drag and drop inside secondary window dock panels. This extension leaves that upstream restriction in place, so the first version supports dragging tabs out of normal Theia dock panels into a new secondary window, but does not yet support dragging tabs between secondary windows.
