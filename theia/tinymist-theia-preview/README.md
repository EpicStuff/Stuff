# Tinymist Theia Preview

This is a small VS Code extension for Eclipse Theia. It keeps Tinymist's existing preview button, command, shortcut, and preview server, but opens the rendered document in Theia's Mini Browser.

Tinymist's built in VS Code webview preview uses a WebSocket. Theia webviews use a `*.webview.localhost` origin, which Tinymist currently rejects. Tinymist's browser preview works because it is served directly from `127.0.0.1`.

The extension uses Tinymist's previewer provider API. Tinymist starts its normal preview server and passes the provider its static server port and document URI. When the native `theia-group-tabs` extension is installed, the adapter calls `group-tabs.openDocumentUrlPreview`, which creates a separate Mini Browser widget for each document URI. Opening a preview for another `.typ` file no longer replaces the first preview. Reopening the same document updates its existing preview.

The native `theia-group-tabs` extension can learn the Mini Browser URL Preview relationship after the user groups it once. Automatic grouping remains generic and does not depend on Typst file names. If Group Tabs is unavailable, the adapter falls back to Theia's original `mini-browser.openUrl` command, which shares a single URL Preview widget.

The package contributes this default:

```json
{
	"tinymist.previewer": "epicstuff.tinymist-theia-preview"
}
```

An explicit user or workspace value for `tinymist.previewer` still takes priority. Remove that explicit value, or set it to `epicstuff.tinymist-theia-preview`.

When `HOMEBREW_THEIA_EXTENSIONS` points at the repository's `theia` directory, the custom Homebrew formula bundles the VS Code extensions in `theia` into the packaged Theia plugin directory.
