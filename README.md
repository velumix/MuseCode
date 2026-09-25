# Muse Code (desktop)

A Tauri + React desktop shell for the [Muse](https://github.com/anthropics/claude-code) coding agent.
v1 hosts the `muse` CLI inside an embedded terminal (xterm.js over a native
ConPTY), in a frameless window with a custom title bar.

## Prerequisites

- Node.js LTS + npm
- Rust (stable) + MSVC build tools (Windows)
- The `muse` CLI on your `PATH` (the app shells out to it)

## Develop

```sh
npm install
npm run tauri dev
```

## Build the installer

```sh
npm run tauri build -- --bundles nsis
```

Produces `src-tauri/target/release/bundle/nsis/Muse Code_<version>_x64-setup.exe`.
The installer uses custom NSIS hooks (`src-tauri/nsis/installer-hooks.nsi`):
branded welcome/finish pages plus a post-install check that warns when the
`muse` CLI is missing from `PATH`.

## Tests

```sh
cargo test -p muse-code-app --lib   # run from src-tauri/
```

Covers the PTY output decoder (UTF-8 split across reads, invalid bytes).

## Layout

- `src/` — React UI: `components/TitleBar.tsx`, `components/TerminalView.tsx`
- `src-tauri/src/pty.rs` — PTY session manager (`pty_spawn/write/resize/kill`)
- `src-tauri/nsis/installer-hooks.nsi` — custom installer hooks
