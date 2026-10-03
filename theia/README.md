# theia-webview-context-fix

A native Eclipse Theia extension that fixes VS Code compatible webview context menus such as the GitLens Commit Graph menu.

The implementation was initially verified against Theia 1.75.0. It deliberately allows newer Theia 1.x releases only while both relevant upstream implementations remain unchanged.

It implements two fixes:

1. Editor hosted webviews apply the context received from the webview when evaluating menu `when` clauses.
2. Webviews merge inherited `data-vscode-context` values from the complete composed event path, with inner values overriding outer values.

The first fix is a native Theia frontend module that replaces `WebviewWidget.handleContextMenu` on the host prototype before webviews are used. The second fix affects `webview/pre/main.js`, which Theia copies as a static asset during the application build. The same package exports a small esbuild plugin that patches that copied asset after Theia copies it. It does not modify `node_modules`.

## Theia dependencies

`@theia/core` and `@theia/plugin-ext` are peer dependencies:

```json
{
	"peerDependencies": {
		"@theia/core": ">=1.75.0 <2.0.0",
		"@theia/plugin-ext": ">=1.75.0 <2.0.0"
	}
}
```

The extension therefore uses the Theia packages supplied by the application being built. It does not carry its own pinned copy of Theia.

The package is intended to be compiled inside the target Theia workspace. Its TypeScript build resolves the peer dependencies from that workspace.

## Add the extension

Add this package to the dependencies of the Theia application.

For a local checkout:

```json
{
	"dependencies": {
		"theia-webview-context-fix": "file:../theia-webview-context-fix"
	}
}
```

## Add the build fix and compatibility guards

Import the plugin in the application's generated `esbuild.mjs`:

```js
import { webviewContextFixPlugin } from 'theia-webview-context-fix/esbuild';
```

Then add this before `esbuild.context(browserOptions)`:

```js
browserOptions.plugins.push(webviewContextFixPlugin());
```

The plugin performs two compatibility checks during the build:

1. Before bundling, it reads the installed host `@theia/plugin-ext/src/main/browser/webview/webview.ts` and requires exactly one copy of the `WebviewWidget.handleContextMenu` implementation verified against Theia 1.75.0.
2. After bundling, it requires the generated webview preload to contain exactly one known unpatched implementation, or exactly one already patched implementation.

If either relevant upstream implementation changes, disappears, or is duplicated, the build fails instead of silently assuming compatibility.

## Upgrade behavior

This is intentional:

```text
upgrade Theia
	↓
relevant host and preload implementations unchanged
	→ build continues and the extension uses the new Theia packages

relevant host or preload implementation changes
	→ build fails
	→ review whether Theia fixed the bug or the extension needs updating
```

The peer dependency range stops at Theia 2.0, which requires an explicit review even if the guards would otherwise match.

## What it changes

The native override changes the editor hosted branch from using an empty context to using the received webview context.

The preload build plugin changes context discovery from returning only the nearest `data-vscode-context` object to merging all inherited context objects along `event.composedPath()`.
