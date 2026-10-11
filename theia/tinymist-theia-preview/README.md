# Tinymist Theia Preview

This is a small VS Code extension for Eclipse Theia. It keeps Tinymist's existing preview button, command, shortcut, and preview server, but opens the rendered document in Theia's Mini Browser.

Tinymist's built in VS Code webview preview uses a WebSocket. Theia webviews use a `*.webview.localhost` origin, which Tinymist currently rejects. Tinymist's browser preview works because it is served directly from `127.0.0.1`.

The extension uses Tinymist's previewer provider API. Tinymist starts its normal preview server and passes the provider its static server port. This adapter only opens that URL through Theia's normal `mini-browser.openUrl` command. It contains no tab grouping logic.

The native `theia-group-tabs` extension can learn a Mini Browser URL Preview relationship after the user groups it once. That behavior is generic to Theia's URL Preview and does not contain Typst specific matching.

The package contributes this default:

```json
{
	"tinymist.previewer": "epicstuff.tinymist-theia-preview"
}
```

An explicit user or workspace value for `tinymist.previewer` still takes priority. Remove that explicit value, or set it to `epicstuff.tinymist-theia-preview`.

When `HOMEBREW_THEIA_EXTENSIONS` points at the repository's `theia` directory, the custom Homebrew formula bundles the VS Code extensions in `theia` into the packaged Theia plugin directory.
