# Zellij Detach Others

This Rust plugin disconnects every other client attached to the current Zellij session, preserves the client that launched it, and closes its own pane.

It uses the official `zellij-tile` Rust API and requests only the `ChangeApplicationState` permission.

The dependency is pinned to Zellij 0.44.3.

## Build

Install Rust through rustup if it is not already installed, then run:

```fish
rustup target add wasm32-wasip1
cargo build --release
```

The compiled plugin is created at: `target/wasm32-wasip1/release/detach-others.wasm`

Copy it into the Zellij plugin directory `~/.config/zellij/plugins`

## Use as a command

Run this from a terminal pane inside the Zellij session whose other clients you want to disconnect:

```fish
zellij action launch-plugin 'file:/home/derek/.config/zellij/plugins/detach-others.wasm' --floating
```

The first run asks you to approve `ChangeApplicationState`.

## Use with a shortcut

Open the Zellij configuration:

```fish
edit ~/.config/zellij/config.kdl
```

Find the existing `shared_except "locked"` block inside `keybinds`, then add this binding inside that block:

```kdl
bind "Alt Shift d" {
	LaunchPlugin "file:/home/derek/.config/zellij/plugins/detach-others.wasm" {
		floating true
	}
}
```

Press `Alt Shift d` from any unlocked Zellij mode. Change the key combination if it conflicts with another shortcut.
