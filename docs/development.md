# Development and technical notes

[Back to VelumCode](../README.md)

Run the commands below from the repository root.

## Prerequisites

- Node.js 24 + npm (the tested version is pinned in `.node-version`)
- Rust via rustup + MSVC build tools (the tested toolchain is pinned in `rust-toolchain.toml`)
- At least one supported CLI: `muse`, `codex`, or `agy`, installed and signed in

## Develop

```sh
git clone https://github.com/velumix/VelumCode.git
cd VelumCode
npm ci
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
that migrates the previous default Muse Code installation and registers native notifications.

Brand exports are generated from the saved transparent master with
`.\scripts\make-assets.ps1` (UI mark, favicon, platform icons, and NSIS artwork).
See [the brand notes](brand.md) for the master asset, generation prompt, and export process.

The [Windows CI workflow](https://github.com/velumix/VelumCode/actions/workflows/windows.yml)
runs the frontend, browser, Rust, formatting, and Clippy checks, then builds an NSIS installer.
Open a successful workflow run and download **VelumCode-windows-x64** under Artifacts. These
are unsigned development builds. Native tray/notification smoke tests require an interactive
Windows desktop and are run locally using the commands below.

## Shortcuts

- `Ctrl+T` new session, `Ctrl+Tab` / `Ctrl+Shift+Tab` switch sessions
- `Enter` send chat message, `Shift+Enter` newline, `Stop` interrupts the turn
- Agent/Terminal toggle in the conversation header
- `Ctrl+K` command palette, `Ctrl+L` focus message input, `Ctrl+1`–`Ctrl+9` jump to a tab
- Arrow keys / Home / End move between focused session tabs; Delete closes the focused tab
- `Ctrl+F` find in terminal, `Enter` / `Shift+Enter` next/previous match
- `Ctrl+=` / `Ctrl+-` / `Ctrl+0` terminal zoom in/out/reset
- Standard / YOLO toggle inside the composer controls YOLO (`--yolo`: no approvals/sandbox) for that tab's turns

## Tests

```sh
npm run check          # TypeScript + production frontend build + browser tests + Rust tests
npm run check:native   # Windows debug build + real WebView2/IPC/ConPTY smoke test
npm run check:remote   # real Tailscale HTTPS + native app + phone browser (Tailscale sign-in required)
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

On Windows with PowerShell script execution disabled, use `npm.cmd` / `npx.cmd`.
Browser tests use installed Chrome or Edge; set `BROWSER_PATH` for another Chromium executable.
The native test starts Vite if needed, launches a separate debug app with an isolated WebView2
profile, and substitutes a deterministic CLI fixture only in that child's environment. It
does not use the configured AI provider, alter the installed app, or change your CLI settings.
Quit any running Velum Code instance before testing. Use `node scripts/native-smoke.mjs --release`
for the packaged build, or `node scripts/native-smoke.mjs --installed --notifications` after
installing the current bundle to also verify Windows Notification Center delivery and the
registered COM activation path. These checks use isolated notification preferences.
Test artifacts are written to ignored `test-results/` and `.qa/` directories.

The remote smoke test uses the real signed-in Tailscale client and a temporary foreground
Serve route on 8443. It requires that port to be unused, and refuses to attach to a running
VelumCode instance. It pairs a separate browser with isolated app settings, runs fixture
turns while the desktop is hidden, stops a fixture process tree, reloads history, and revokes
the phone. It removes its own route on exit. For the installed bundle use
`node scripts/remote-smoke.mjs --installed`. This test is intentionally not run in CI because
it needs a signed-in tailnet; Rust HTTP tests cover the access boundary without a network.

For USB without a physical phone or tailnet, run
`node scripts/remote-smoke.mjs --release --usb-fixture` after a release build. It compiles a
small ADB fixture in `.qa`, then exercises the real loopback server, browser cookies,
desktop approval, tray control, disconnect/reconnect, stop, and revocation. It never invokes
real ADB. Android unit tests cover USB launch intents and strict loopback URL validation;
a connected Android phone is still needed to verify the physical cable and WebView.

Run `npm run build` before testing the phone interface in a debug native build. Tauri's asset
resolver serves the built `dist/remote.html` and assets; Vite hot reload is desktop-only.
See [remote access](remote-access.md) for permissions, lifecycle, limits, and setup.

Coverage includes chat/tool/todo rendering, final answers, error recovery, workspace changes,
tab and mode preservation, race-prone startup/teardown, keyboard/clipboard interactions,
accessibility, PTY decoding, native process trees, close-to-tray survival, single-instance
restoration, notification activation, and explicit Quit cleanup.
See [the QA report](qa-2026-09-26.md) for findings, evidence, and remaining work.

## Session behavior

Closing the window (including Alt+F4) hides Velum Code in the Windows system tray. Running Agent
turns, terminals, tabs, and drafts stay alive. Click the Velum Code tray icon or open the desktop
shortcut to restore the existing instance. Right-click the tray icon and choose **Quit Velum Code** to stop background work and exit; Quit is also available in the command palette.

Background Agent turns send native Windows notifications when they complete or fail while
Velum Code is hidden, minimized, or unfocused. Click a notification to open its conversation.
Notification text contains no prompt, answer, or workspace details. Mute notifications using
the footer bell or tray menu; this preference survives restarts. The tray menu and command
palette include **Send a test Windows notification**. Windows notification settings and Do
not disturb still control delivery. Install the NSIS bundle to register Velum Code's notification
identity and activation handler; the development executable alone does not install them.

Switching between Agent and Terminal preserves both views until the tab closes. Terminal is
a **separate conversation** launched in the tab's workspace; it does not share the Agent
transcript. Applying a different valid workspace starts a fresh chat and restarts an existing
terminal in that directory. Invalid workspace paths preserve the current conversation.
Restart resets only the currently selected mode. Closing a tab stops its processes; closing
the window preserves them. Explicit Quit stops every owned agent and terminal process.

Transcripts and drafts live in memory. They survive hiding to the tray, but are not restored
after explicit Quit, a crash, or a Windows restart.
The CLI keeps its own session logs, but this UI has no history browser or restore operation yet.
Headless chat displays approval notices and auto-cancels `request_user_input`; it cannot
collect interactive approval/question responses. Use a separate Terminal conversation for
those workflows. YOLO changes approval/sandbox behavior; it does not add interactive responses.

## Layout

- `src/` — React UI: `TitleBar`, `TabBar`, `ChatView`, `TerminalView`, `SearchBar`
- `src-tauri/src/runner.rs` — headless agent sessions, one `muse exec --json`
  child per turn (`agent_new/send/stop/destroy`, `agent-event` events)
- `src-tauri/src/events.rs` — tolerant fold of the `--json` stream into UI events
- `src-tauri/src/pty.rs` — multi-session PTY manager
  (`pty_spawn/write/resize/kill`, `pty-data` / `pty-exit` events)
- `src-tauri/src/desktop.rs` — tray lifetime, single-instance restoration, notification settings
- `src-tauri/src/windows_notifications.rs` — Windows toasts and COM conversation activation
- `src/remote/` — mobile interface, reconnects, and transcript rendering
- `src/components/RemotePanel.tsx` — desktop pairing and device management
- `src-tauri/src/remote.rs` — loopback HTTP API, cookies, live events, and remote commands
- `src-tauri/src/remote_auth.rs` — one-use pairing and revocable device credentials
- `src-tauri/src/session_log.rs` — backend event replay independent of the desktop WebView
- `src-tauri/src/tailscale.rs` — client discovery, connection status, and owned Serve lifecycle
- `src-tauri/src/usb.rs` — ADB discovery, USB forwarding, and Android app launch
- `src-tauri/nsis/` — installer hooks + custom bitmaps
- `scripts/` — `install.ps1`, `make-assets.ps1`
- `docs/rich-agent-ui.md` — rich-agent-UI design + CLI probe findings
