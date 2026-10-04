# theia-keep-warm

Native Eclipse Theia Electron startup extension verified against Theia 1.75.0.

It adds these command line flags:

- `--keep-warm` keeps one Electron main process and its Theia backend alive after the last window closes. Starting with only this flag opens no workspace and no visible window.
- `--daemon` relaunches the requested invocation as a detached process with standard input and output disconnected from the terminal.
- `--quit` asks the resident keep warm instance to quit.

Typical use:

```fish
theia --keep-warm
```

This stays attached to the terminal. To start the warm process and immediately return to the shell:

```fish
theia --keep-warm --daemon
```

A later normal invocation is routed to the resident process:

```fish
theia
theia /path/to/project
```

When the resident process has no windows, a plain `theia` invocation behaves like a fresh launch and restores the previous workspace. Closing the last window leaves the backend resident.

To stop it:

```fish
theia --quit
```

The extension only holds the Electron single instance lock while keep warm mode is active. Normal Theia launches release the lock and preserve the existing behavior of allowing independent Electron processes.
