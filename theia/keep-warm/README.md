# theia-keep-warm

Native Eclipse Theia Electron startup extension verified against Theia 1.75.0.

It adds these command line flags:

- `--keep-warm` keeps one Electron main process and its Theia backend alive after the last window closes. Starting with only this flag opens no workspace and no visible window.
- `--keep-warmer` includes `--keep-warm` behavior and also keeps one hidden empty Theia frontend renderer preloaded. It still keeps no project workspace open.
- `--daemon` relaunches the requested invocation as a detached process with standard input and output disconnected from the terminal.
- `--quit` asks the resident keep warm instance to quit.
- `--install-extension <file.vsix>` installs a local VSIX without opening a visible Theia window.

Typical use:

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

A plain `theia` invocation with no visible windows behaves like a fresh launch and restores the previous workspace. Closing the last visible window leaves the backend resident. In warmer mode, a new hidden empty frontend is prepared after the last visible window closes.

To install a local VSIX from the terminal:

```fish
theia --install-extension foo.vsix
```

The installer invocation uses its own short lived backend and a hidden empty renderer, so it also works while a `--keep-warm` or `--keep-warmer` instance owns the Electron single instance lock. It waits for installation to complete, prints the installed path, then exits.

To stop a resident instance:

```fish
theia --quit
```

The extension only holds the Electron single instance lock while either keep warm mode is active. Normal Theia launches release the lock and preserve the existing behavior of allowing independent Electron processes.
