# theia-notebook-fixes

Native Eclipse Theia notebook fixes verified against Theia 1.75.0.

It currently provides:

- Code and Markdown cell input folding with fold and unfold toolbar icons and a Markdown sidebar chevron. Folded code cells stay editable on their first line.
- Persistent folded cell state across Theia restarts without modifying the notebook file.
- A Collapse All Cell Inputs action in the notebook toolbar.
- Notebook find matches inside folded cells, temporarily unfolding the cell to reveal them.
- Code folding inside code cell editors.
- Ctrl+Enter runs the focused code cell.
- Mapping of the VS Code `notebook/toolbar` contribution point into Theia's native notebook toolbar.
- Automatic refresh of clean open notebooks when their files are changed externally, keeping folded state and scroll position.
- KaTeX math rendering in notebook Markdown cells for inline `$...$` and display `$$...$$` expressions.
- Compatibility updates for notebook context keys used by VS Code extensions, including cell resource, collapse state, kernel count, and interruptibility.

The package uses the Theia packages supplied by the application through peer dependencies.
