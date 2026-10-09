# theia-flags

Native Eclipse Theia Electron startup extension verified against Theia 1.75.0. The build fails if the upstream Theia Electron startup, window, and extension install code it overrides or relies on changes from that version.

It adds resident startup behavior plus a VS Code compatible CLI layer.

Resident process flags:

- `--keep-warm` keeps one Electron main process and its Theia backend alive after the last window closes. Starting with only this flag opens no workspace and no visible window.
- `--keep-warmer` includes `--keep-warm` behavior and also keeps one hidden empty Theia frontend renderer preloaded. It still keeps no project workspace open.
- `--daemon` relaunches the requested invocation as a detached process with standard input and output disconnected from the terminal.
- `--quit` asks the resident keep warm instance to quit.

VS Code compatible flags:

- `-h`, `--help`
- `-v`, `--version`
- `-n`, `--new-window`
- `-r`, `--reuse-window`
- `-g`, `--goto <file:line[:column]>`
- `-d`, `--diff <file1> <file2>`
- `--list-extensions`
- `--show-versions`
- `--install-extension <publisher.name[@version]|file.vsix>`
- `--uninstall-extension <publisher.name[@version]>`
- `--user-data-dir <dir>`
- `--disable-gpu`

The existing Theia `--version` behavior is preserved. `--user-data-dir` sets both Electron's `userData` path and `THEIA_CONFIG_DIR`, while the narrower Theia `--electronUserData` option keeps its original behavior.

Typical resident use:

```fish
theia --keep-warm
```

This stays attached to the terminal. Pressing `Ctrl+C` cleanly quits through Electron's normal shutdown path.

For a more aggressively preloaded resident process:

```fish
theia --keep-warmer
```

The warmer mode loads a hidden `!empty` frontend with no workspace. When a normal Theia invocation arrives, that BrowserWindow is reused for the requested workspace instead of creating a new renderer process.

To start either mode and immediately return to the shell:

```fish
theia --keep-warmer --daemon
```

A later normal invocation is routed to the resident process:

```fish
theia
theia /path/to/project
```

A plain `theia` invocation on a fresh process restores all workspace windows from the previous session. The same restoration happens on the first plain `theia` invocation after starting a resident keep warm process. An explicit file, folder, workspace, `--new-window`, `--reuse-window`, `--goto`, or `--diff` suppresses previous session restoration for that process. Closing the last visible window leaves the backend resident in keep warm mode. In warmer mode, a new hidden empty frontend is prepared after the last visible window closes.

Window selection can be made explicit:

```fish
theia --new-window /path/to/project
theia --reuse-window /path/to/project
```

When only the hidden warmer renderer exists, `--new-window` may reuse it because there is no existing visible user window. When another visible window exists, `--new-window` creates an additional window.

Files can be opened at a location or compared:

```fish
theia --goto src/main.ts:40:8
theia --diff old.txt new.txt
```

Extension management is available without opening a visible Theia window:

```fish
theia --list-extensions
theia --list-extensions --show-versions
theia --install-extension eamodio.gitlens
theia --install-extension ./foo.vsix
theia --uninstall-extension eamodio.gitlens
```

Extension management is backend only. The launcher runs these commands with Electron in Node mode, so they do not start Electron main, create a BrowserWindow, load frontend contributions, or touch the warmer renderer. If a Theia backend is already running for the same configuration directory, the short lived CLI backend forwards the command to that resident backend and waits for its result. Otherwise it performs the operation locally and exits before starting an HTTP server.

An isolated user data environment can be selected with:

```fish
theia --user-data-dir /tmp/theia-test
```

This changes both Electron user data and Theia configuration storage. Because Theia derives its user extension directory from the configuration directory, this currently isolates user extensions too.

Hardware acceleration can be disabled for a newly started Theia process with:

```fish
theia --disable-gpu
```

A normal `--disable-gpu` launch bypasses the resident keep warm instance because GPU acceleration has to be configured before Electron starts.

To stop a resident instance:

```fish
theia --quit
```

Normal Theia launches share one Electron main process for the same user data directory. Additional `theia` invocations are routed into that process using Electron's single instance payload so the original command line is preserved. `--disable-gpu` remains an independent process because hardware acceleration has to be configured before Electron starts.
