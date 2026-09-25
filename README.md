# Muse Code (desktop)

A Tauri + React desktop shell for the Muse coding agent.
Hosts the `muse` CLI in embedded terminal sessions (xterm.js over native
ConPTY), in a frameless window with session tabs.

## Prerequisites

- Node.js LTS + npm
- Rust (stable) + MSVC build tools (Windows)
- The `muse` CLI on your `PATH` (the app shells out to it)

## Develop

```sh
npm install
npm run tauri dev
```

## Install / uninstall

```powershell
.\scripts\install.ps1 -Build            # release build + silent install
.\scripts\install.ps1 -Build -Launch    # ...and launch it
.\scripts\install.ps1 -Uninstall         # silent uninstall
```

The installer is a custom NSIS bundle (`src-tauri/nsis/`): branded
welcome/finish pages, custom header/sidebar art, plus a post-install check
that warns when the `muse` CLI is missing from `PATH`.

Brand assets are generated reproducibly with `.\scripts\make-assets.ps1`
(app icon source, NSIS bitmaps); `npx tauri icon` turns the source PNG into
the full icon set.

## Shortcuts

- `Ctrl+T` new session, `Ctrl+Tab` / `Ctrl+Shift+Tab` switch sessions
- `Ctrl+F` find in terminal, `Enter` / `Shift+Enter` next/previous match
- `Ctrl+=` / `Ctrl+-` / `Ctrl+0` terminal zoom in/out/reset

## Tests

```sh
cargo test --lib   # run from src-tauri/
```

Covers the PTY output decoder (UTF-8 split across reads, invalid bytes).

## Layout

- `src/` — React UI: `TitleBar`, `TabBar`, `TerminalView`, `SearchBar`
- `src-tauri/src/pty.rs` — multi-session PTY manager
  (`pty_spawn/write/resize/kill`, `pty-data` / `pty-exit` events)
- `src-tauri/nsis/` — installer hooks + custom bitmaps
- `scripts/` — `install.ps1`, `make-assets.ps1`
