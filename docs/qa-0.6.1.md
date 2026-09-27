# Velum Code 0.6.1 verification

Scope: project selection and access checks, automatic request context, desktop and
phone diagnostics, explicit chat layout attachments, and Antigravity headless
permission denials.

## Passed locally

- Production TypeScript/Vite build; 72 browser tests, including six new desktop
  and phone checks for picker cancellation, unreadable projects, draft retention,
  exact attachment previews, no automatic sending, view-only access, revocation,
  keyboard focus and accessibility. Desktop and phone previews were also visually
  inspected from browser screenshots.
- 98 Rust tests passed; the existing live GitHub plugin download test remains
  ignored. New tests cover temporary-file cleanup, missing folders, Git worktree
  context without remote credentials, and permission denials overriding success
  while preserving partial output and user cancellation.
- Rust formatting, Clippy with warnings denied, and the plugin SDK test passed.
- Windows x64 NSIS installer built successfully.
- Android unit tests and release lint passed. The R8 release APK passed signature
  verification; version 0.6.1 uses version code 9. Phone features are served by the
  desktop, so the existing 0.6.0 companion also receives them after a desktop update.

## Native checks awaiting an idle desktop

Native smoke fixtures now cover injected context, local access checks, sanitized
diagnostics, and an Antigravity SUCCESS result accompanied by a permission denial
that falls outside the retained stderr tail. Bot fixtures also check immediate
pause and suppression of memory proposals and board actions after a denied tool.

These updated native fixtures have not yet run: the installed 0.6.0 app was still
open, its debugging interface was unavailable, and the Windows inspection helper
reported an unavailable native pipe. The live app was left running to preserve
the user's work. The new installer has not replaced that running installation.
No Android device was attached for an on-device update or smoke check.

## Bounds and limitations

App context uses local filesystem checks and a bounded Git HEAD read; it does not
spawn a Git process or probe provider accounts. Diagnostics and their UI load on
demand. No new runtime dependency, background polling loop or database was added.

Installed CLIs are labeled separately from authentication and working tool
connections, which remain unchecked. The optional view attachment describes the
chat layout, not a screenshot or live computer-control connection. Reports omit
paths, raw logs, chat text, drafts, credentials and memory contents. Antigravity
permission rules are never modified automatically.
