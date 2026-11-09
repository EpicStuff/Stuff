# Tinymist Theia Preview

This VS Code extension keeps Tinymist's preview button, command, shortcut, and server. Each document opens in its own Theia webview panel, with an iframe pointed at that document's localhost preview server.

The iframe loads Tinymist's page directly from `127.0.0.1`, so the page and its WebSocket use the same localhost origin. The outer webview allows that server in its `frame-src` CSP. Closing a panel calls `tinymist.doDisposePreview` to stop its preview task.

The adapter uses Tinymist's previewer provider API and returns a panel disposer. Tinymist relaunches a preview when the same document is requested again; the old panel closes before the new panel opens. The adapter contains no native Theia commands.

Group Tabs can learn to group the `tinymist.theiaPreview` webview kind after a manual grouping. In a Theia GUI test, a second editor and preview formed their own group automatically, and reopening that preview kept the correct pair. Its generic matching uses widget kind and opening mode rather than the document URI, so layouts with several matching ungrouped editors remain ambiguous. Webview session restoration also needs care: a restored iframe URL only works while its Tinymist preview server is running.

The package contributes this default:

```json
{
	"tinymist.previewer": "epicstuff.tinymist-theia-preview"
}
```

An explicit user or workspace value for `tinymist.previewer` still takes priority. Remove that explicit value, or set it to `epicstuff.tinymist-theia-preview`.

When `HOMEBREW_THEIA_EXTENSIONS` points at the repository's `theia` directory, the custom Homebrew formula bundles the VS Code extensions in `theia` into the packaged Theia plugin directory.
