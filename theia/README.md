# theia-webview-context-fix

A native Eclipse Theia extension for Theia 1.73.1 that fixes VS Code compatible webview context menus such as the GitLens Commit Graph menu.

It implements the two fixes already verified against Theia 1.73.1:

1. Editor hosted webviews now apply the context received from the webview when evaluating menu `when` clauses.
2. Webviews merge inherited `data-vscode-context` values from the complete composed event path, with inner values overriding outer values.

The first fix is a native Theia frontend module that replaces `WebviewWidget.handleContextMenu` on the host prototype before webviews are used. The second fix affects `webview/pre/main.js`, which Theia copies as a static asset during the application build. The same package therefore exports a small esbuild plugin that patches that copied asset after Theia copies it. It does not modify `node_modules`.

## Add the extension

Add this package to the dependencies of the Theia application that also contains `@theia/plugin-ext` 1.73.1.

For a local checkout:

```json
{
	"dependencies": {
		"@theia/plugin-ext": "1.73.1",
		"theia-webview-context-fix": "file:../theia-webview-context-fix"
	}
}
```

The provided package already contains compiled `lib` output. If you edit the TypeScript source, rebuild it before building the application:

```sh
npm install
npm run build
```

## Add the preload build fix

Theia 1.73.1 generates an `esbuild.mjs` file in the application directory. Add this import near the top:

```js
import { webviewContextFixPlugin } from 'theia-webview-context-fix/esbuild';
```

Then add this line after `browserOptions` is imported and before `esbuild.context(browserOptions)` is called:

```js
browserOptions.plugins.push(webviewContextFixPlugin());
```

For the default generated Theia 1.73.1 `esbuild.mjs`, the beginning should therefore look like:

```js
import { browserOptions, watch } from './gen-esbuild.browser.mjs';
import { nodeOptions } from './gen-esbuild.node.mjs';
import { electronOptions } from './gen-esbuild.electron.mjs';
import { webviewContextFixPlugin } from 'theia-webview-context-fix/esbuild';
import esbuild from 'esbuild';

browserOptions.plugins.push(webviewContextFixPlugin());

const browserContext = await esbuild.context(browserOptions);
```

Keep the rest of the generated file unchanged.

## Build

Build the application normally. The native frontend module replaces `WebviewWidget.handleContextMenu`, while the esbuild plugin patches `lib/webview/pre/main.js` after Theia copies it.

The preload patch is intentionally strict. If the expected Theia 1.73.1 implementation is not present, the build fails instead of silently applying a potentially incorrect patch.

## What it changes

The native override changes the editor hosted branch from effectively using an empty context to using the received webview context.

The preload build plugin changes context discovery from returning only the nearest `data-vscode-context` object to merging all inherited context objects along `event.composedPath()`.

## Scope

This package targets Theia 1.73.1. When upgrading Theia, first check whether the upstream bugs have been fixed. If they have, remove this package. If not, update the version guard and verify the two source locations before carrying the fix forward.
