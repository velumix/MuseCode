# Desktop startup and installation verification — 2026-09-29

## Changes

The desktop HTML paints the existing Velum mark before the application bundle
loads. A blue glow, wordmark reveal and thin loading sweep lead into a 180 ms
fade. Fast launches show roughly one second of animation; initialization runs
concurrently. Clicking or pressing a key skips once the recovered desktop has
mounted. Reduced motion disables animation and the minimum display time.
Switching conversations or reopening from the tray does not replay the intro.

The HTML keeps the desktop inert until it is revealed. Dismissal removes the
overlay, releases the controls and focuses the composer. A timer also removes
the overlay if WebView2 does not deliver a transition event. The native window
uses the same dark background as the launch screen.

Files: `index.html`, `src/startup.css`, `src/startup.ts`, `src/App.tsx`, and
`src-tauri/tauri.conf.json`.

## Issue found during installed-app testing

Repeated WebView reloads exposed stale model configuration routing. More than
one native session could refer to a desktop tab, and `configure_session` selected
the first matching entry in a HashMap. The picker could update while the active
session continued using the previous model and reasoning effort.

`src-tauri/src/runner.rs` now assigns registrations a monotonic sequence and
routes desktop configuration to the latest owner of the tab. Requests carrying
an exact native session ID retain their exact target. No running provider is
stopped by this selection change. A Rust regression checks both routing forms;
the installed-app suite changes model and reasoning after four reloads and
checks the arguments received by the provider fixture.

## Verification

- `npm.cmd test`: **90 passed**, including six startup regressions.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: **121 passed,
  1 ignored** (the existing optional public GitHub download test).
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`:
  passed.
- `git diff --check`: passed.
- Production TypeScript/Vite and Tauri NSIS build: passed.
- `node scripts/native-smoke.mjs --installed`: passed on the final installed
  build, including startup, model/reasoning changes after reload, workspace
  validation, provider fixture turns, Stop, ConPTY, tray reopening and Quit.

The native suite uses the installed executable with isolated settings, history,
memory and WebView data under `.qa`. Startup checks exercise the packaged
`http://tauri.localhost/` page and save screenshots and lifecycle timings.
Provider behavior in this suite uses local CLI fixtures; these results are not
new live-provider, external connector, UI attachment or memory-service checks.
The Windows computer-use helper was unavailable, so runtime inspection uses the
app's native WebView2 integration harness.

`tests/ui/startup.spec.ts` covers pre-bundle painting, readiness and focus,
pointer/keyboard skipping, reduced motion, StrictMode resubscription and cleanup
without transition events. `scripts/startup-smoke.mjs` covers the same startup
paths in the packaged app. The shared UI fixture and native suite now wait until
the startup overlay is dismissed before typing into app controls.

## Installation

Install target: `C:\Users\c0dec\AppData\Local\Velum Code\velum-code.exe`.
The NSIS installer runs per user. Existing app data is retained.

Tauri changes the embedded bundle marker from `UNK` in the standalone build to
`NSS` in the NSIS payload. Installation verification compares all executable
bytes after normalizing only those three marker bytes in memory; it does not
modify either executable.

Final NSIS installation exited with code 0. The installed executable is version
0.6.1, 10,241,024 bytes, and matches the rebuilt payload after the marker check.
Installed SHA-256:
`10b4f58199b6907eee58c3cff8a959c23aced60ea2eea1b9ced058ea07715d89`.

Installation evidence: `.qa/startup/installation.json`.
Final native artifacts: `.qa/native 1790706801242 & workspace/`.

| Packaged startup path | Overlay removed after navigation | Result |
| --- | ---: | --- |
| Normal reveal and fade | 1,034 ms | Pass |
| Escape skip | 85 ms | Pass |
| Pointer skip | 102 ms | Pass |
| Reduced motion | 66 ms | Pass |

The skip and reduced-motion paths removed the overlay in the same event as
unlocking the desktop. Screenshots are `startup.png` and
`desktop-after-startup.png`; measurements are in `startup-results.json`.
These timing checks reload the real packaged page in the installed process;
the native suite also launches the installed executable from a stopped state.

After verification, the isolated test process was shut down and the installed
app was launched normally, without test configuration or debugging overrides.
Its `Velum Code` main window was present and responding. The native test
debugging listener was no longer present.
