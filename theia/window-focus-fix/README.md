# theia-window-focus-fix

A native Eclipse Theia extension that keeps `vscode.window.state.focused` true while focus is inside a webview.

Theia reports window focus from the top window's `focus` and `blur` events. Clicking into a webview iframe blurs the top window, so extensions see the IDE as unfocused. GitLens pauses repository watching while unfocused, which left the Commit Graph stale until focus returned to the workbench.

The frontend module patches `WindowStateMain.onFocusChanged` so a blur is only reported when `document.hasFocus()` is false once focus settles. The implementation was verified against Theia 1.75.0.

Switching to another application while a webview holds focus is not reported as a blur, because the top window gets no event for it.
