# Notebook Diff for GitLens and Source Control

A VS Code compatible extension for Eclipse Theia that opens `.ipynb` comparisons with nbdime's notebook aware web viewer. Clicking a notebook change in GitLens commit history or Source Control opens a visual notebook comparison in an editor tab; other file types are unaffected.

## Requirements

- Eclipse Theia supporting VS Code webviews and editor tab events.
- The `nbdime` executable available on the extension host's `PATH`.
- A local Theia installation where the extension host and browser can access loopback ports.

Check the command that the extension uses:

```fish
nbdime --version
```

Your installed `nbdime` 4.0.4 is suitable. The extension uses `nbdime diff-web` directly. It never searches for Python interpreters or runs a custom Python launcher.

## Installation

Use **Extensions: Install from VSIX...** in Theia and choose `theia-nbdime-diff-0.1.3.vsix`.

When a notebook text diff opens, the extension reads the original and modified revision URIs, saves temporary notebook snapshots, and starts `nbdime diff-web` on localhost with a private URL prefix. An internal local proxy permits nbdime's page to load in Theia's webview, removes the iframe blocking CSP header, and adds a message that only fires once the notebook comparison widget appears.

The original JSON tab remains open until the viewer actually reports that its comparison widget is present. Closing the notebook viewer terminates the process and removes the temporary snapshots.

The top bar has an **Open original JSON diff** action that skips automatic replacement once.

## Settings

- `notebookDiff.enabled`: automatically open notebook comparisons (default `true`).
- `notebookDiff.replaceOriginalDiff`: close the original JSON tab after successful rendering (default `true`).
- `notebookDiff.hideUnchanged`: initially hide unchanged notebook cells (default `true`).

A `Notebook Diff: Open Active Notebook Diff with nbdime` command is also provided.

## Implementation and limitations

- Uses the installed nbdime comparison engine and web viewer without bundling them.
- Accepts the version output from `nbdime --version` even if nbdime exits with code 1 and `nbdime diff-web` to launch the comparison.
- Binds both the viewer and proxy to `127.0.0.1`; the URL contains a cryptographically random prefix. Do not expose these ports to a network.
- Uses a local HTTP proxy only for the diff view, its API, and static assets. The proxy removes nbdime's `frame-ancestors` restriction so Theia can embed it. It does not change the browser's global security settings.
- GitLens and Source Control will still open the JSON text diff first; this VS Code compatible extension then opens its own webview and closes the original after rendering. A native Theia `OpenHandler` is needed to replace the editor before it opens.
- If the backend fails, the JSON diff remains available and an error is shown.

Automated tests cover revision detection, invalid JSON, the `nbdime` executable check, server startup with a mocked nbdime CLI, CSP header removal, the embedded renderer notification, and closing the original only after a ready message. Rendering with real nbdime on your Theia build still requires testing.

## Upstream

- https://github.com/jupyter/nbdime
- https://theia-ide.org/docs/authoring_vscode_extensions/
