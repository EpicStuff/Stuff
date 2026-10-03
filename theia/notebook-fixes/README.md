# theia-notebook-fixes

Native Eclipse Theia notebook fixes verified against Theia 1.75.0.

It currently provides:

- Code cell input folding with fold and unfold toolbar icons.
- Persistent folded cell state across Theia restarts without modifying the notebook file.
- A Fold All Code Cells action in the notebook toolbar.
- Mapping of the VS Code `notebook/toolbar` contribution point into Theia's native notebook toolbar.
- Automatic refresh of clean open notebooks when their files are changed externally.
- Compatibility updates for notebook context keys used by VS Code extensions, including cell resource, collapse state, kernel count, and interruptibility.

The package uses the Theia packages supplied by the application through peer dependencies.
