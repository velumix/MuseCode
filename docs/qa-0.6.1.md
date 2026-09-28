# Velum Code 0.6.1 verification

Scope: project selection and access checks, automatic request context, desktop and
phone diagnostics, explicit chat layout attachments, and Antigravity headless
permission denials.

## Passed locally

- Production TypeScript/Vite build; 73 browser tests, including seven new desktop
  and phone checks for picker cancellation, unreadable projects, draft retention,
  exact attachment previews, no automatic sending, view-only access, revocation,
  keyboard focus, accessibility, and waiting for memory saves before closing.
  Desktop and phone previews were also visually
  inspected from browser screenshots.
- 99 Rust tests passed; the existing live GitHub plugin download test remains
  ignored. New tests cover temporary-file cleanup, missing folders, Git worktree
  context without remote credentials, the 4 KB context cap, and permission denials overriding success
  while preserving partial output and user cancellation.
- Rust formatting, Clippy with warnings denied, and the plugin SDK test passed.
- Windows x64 NSIS installer built successfully.
- Android unit tests and release lint passed. The R8 release APK passed signature
  verification; version 0.6.1 uses version code 9. Phone features are served by the
  desktop, so the existing 0.6.0 companion also receives them after a desktop update.

## Native execution and installation

`scripts/native-smoke.mjs --release` passed against isolated CLI fixtures. It
checks injected context, actual folder access, sanitized diagnostics, and an
Antigravity SUCCESS result accompanied by a denied tool outside the retained
stderr tail. Partial output remains visible. Provider resume, Stop, ConPTY, tray
behavior, authentication UI, staged-prompt cleanup and explicit Quit also passed.

`scripts/bots-smoke.mjs --release` passed. Permission denials immediately pause
the scheduled job and suppress both memory proposals and board actions. Existing
handoffs, prerequisites, due dates, stale actions and restart behavior also passed.

`scripts/remote-smoke.mjs --release --usb-fixture` passed against the native HTTP
server. Paired diagnostics are sanitized and uncached; the phone displays its own
layout snapshot. Pairing, shared/private memory, Kanban, bot chats, USB reconnect,
Stop and revocation passed. The first run caught a save/close race in the memory
editor: Close and Escape now wait for pending saves. The reconnect fixture also
selects its conversation explicitly after disconnect clears local selection.

The Windows installer upgraded the installed app to 0.6.1. Both saved tabs and
all 12 messages recovered, including six user messages; there were no unsent
drafts. The existing paired-device count stayed at one and Windows notification
initialization reported no error. Conversation files were backed up before the
update. No Android device was attached for an on-device update or smoke check.

## Bounds and limitations

App context uses local filesystem checks and a bounded Git HEAD read; it does not
spawn a Git process or probe provider accounts. Diagnostics and their UI load on
demand. No new runtime dependency, background polling loop or database was added.

The Windows folder dialog itself was not automated because the native UI helper
was unavailable. Browser tests exercise selection/cancellation at the IPC
boundary; filesystem checks were exercised in the native Windows runner.

Installed CLIs are labeled separately from authentication and working tool
connections, which remain unchecked. The optional view attachment describes the
chat layout, not a screenshot or live computer-control connection. Reports omit
paths, raw logs, chat text, drafts, credentials and memory contents. Antigravity
permission rules are never modified automatically.
