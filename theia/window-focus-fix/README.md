# theia-window-focus-fix

A native Eclipse Theia extension that keeps `vscode.window.state.focused` accurate while focus is inside a webview.

Theia reports window focus from the top window's `focus` and `blur` events. Clicking into a webview iframe blurs the top window, so extensions see the IDE as unfocused. GitLens pauses repository watching while unfocused, which left the Commit Graph stale until focus returned to the workbench.

The frontend module patches `WindowStateMain.onFocusChanged`. After a top window blur it waits for focus to settle and checks `document.hasFocus()`. If a child iframe still owns focus, the false blur is suppressed. While the iframe owns focus, a 50 ms monitor tracks `document.hasFocus()` so switching to another application still reports `focused = false`, and returning directly to the iframe reports `focused = true`.

The implementation is verified against Theia 1.75.x. Because it patches a private `WindowStateMain` method, the package intentionally limits its peer dependency to that minor release and fails immediately if the method is missing.
