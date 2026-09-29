# Workspace access investigation and fix — 2026-09-29

> Follow-up: [Windows Standard profile-root investigation](windows-workspace-standard-2026-09-29.md) corrects the probe scope and documents current root-versus-project behavior. The results below describe the earlier stage.

The source repository is `C:\Users\c0dec\code\muse-code-app`. Its package and
Cargo manifests identify Velum Code 0.6.1. The initially selected
`OneDrive\Documents\Velum Code` directory contained only `Memory`.

## Reproduction before changes

- The original Rust app-context tests passed, including the assertion for
  `directory_listing: "passed in Velum"`. That field came from `std::fs::read_dir`
  in the Velum host process. No agent filesystem probe was involved.
- The host could enumerate the home directory and the repository. Codex CLI
  0.157.0's Standard Windows sandbox used a separate Codex sandbox account.
  From that environment, listing the repository succeeded and listing the home
  directory failed with `UnauthorizedAccessException` / `PermissionDenied`.
- A real `codex exec` launched with Velum's original Standard arguments could
  list/read the selected repository. Compound PowerShell write/edit/cleanup
  probes were rejected by provider policy before execution. The CLI process
  nevertheless exited with code zero.
- A separate Standard `codex exec` successfully created, edited, read back and
  deleted a fresh repository probe through `apply_patch` and a separate read.
  Ordinary project coding already worked with the correct project selected;
  the shell-policy rejection was a different result.
- A real PowerShell process emitted a nonterminating filesystem error and then
  exited zero. Process exit alone cannot establish filesystem success.

The reproduced causes are different Windows execution identities and sandbox
folder boundaries, provider command policy, and incomplete host-only diagnostics.
There is no evidence of a general host NTFS denial on this repository. The
historical conversation does not establish that its YOLO change was applied or
that a stale session caused its failures. The previous toggle supplied a flag on
the next turn, without invalidation or effective-policy evidence. This fix makes
that transition explicit and observable.

OpenAI describes the separate Windows sandbox accounts and bounded folder access
in its [Windows sandbox documentation](https://learn.chatgpt.com/docs/windows/windows-sandbox).

## Implementation

| Files | Change |
| --- | --- |
| `src-tauri/src/workspace_access.rs` | Six independent operation results; exclusive probe fixtures; actual provider tool evidence; error classification; bounded, sanitized errors; nonrecursive cleanup; active Codex permission metadata; report sanitization. |
| `src-tauri/src/runner.rs` | Run diagnostics through the active conversation's real provider process; serialize against running turns and mode changes; clear stale results; start a fresh provider session on mode changes; publish results with effective metadata; clean probes after errors/cancellation. |
| `src-tauri/src/providers.rs` | Explicit Codex `-C` and workspace-scoped writable roots for both fresh and resumed turns; Standard remains `workspace-write` with approvals `never`. |
| `src-tauri/src/history.rs` | Persist the last launched permission mode. Resume same-mode sessions; disclose a fresh session for unknown legacy modes. |
| `src-tauri/src/app_context.rs`, `lib.rs`, `remote.rs` | Separate host/agent payloads and IPC; bind phone reports to the correct session; no host pass is promoted to agent pass. |
| `src-tauri/src/provider_events.rs` | Recognize actual PowerShell error records even when the command exits zero. |
| `src/context.ts`, `src/components/ChatView.tsx`, `ContextPanel.tsx`, `ContextPanel.css` | Separate host/agent controls and operation table; mode transition notices; sanitized preview/copy/attachment; disable mode changes during turns. |
| `tests/ui/context.spec.ts`, `fixture.ts`, `remote.spec.ts` | Host-pass/agent-blocked, invalidation, active-turn mode locking, sanitized previews, draft preservation and phone access tests. |
| `scripts/native-smoke.mjs`, `scripts/workspace-access-smoke.mjs` | Update old host-only expectations and add opt-in verification using the real native IPC/runner and installed Codex. |

Each result is `pass`, `fail`, `blocked`, or `untested`, with operation, path,
timestamp, environment and error category/code. An assistant's final answer is
never accepted as probe evidence. Host cleanup has its own result and cannot
turn an agent cleanup failure into success. Generated probe basenames remain in
sanitized reports so a failed cleanup can be located; private path prefixes,
credentials, command output, account names and file contents are excluded.

Codex uses its native patch tool for creation/editing/deletion. Muse and
Antigravity receive separate PowerShell commands, with markers emitted only
after each operation succeeds; missing or unsupported tool evidence stays
untested. Their generated commands and result adapters are covered by local
PowerShell regression tests.

Mode changes preserve the visible transcript but intentionally start a fresh
provider conversation; prior provider context is not replayed. The UI discloses
this. Same-mode turns retain their resume ID. No global settings, Windows ACLs,
administrator privileges or weaker Standard sandbox are required by the fix.

## Verification

- Frontend production build passed.
- All 75 existing/updated Playwright browser tests passed, including accessibility
  and phone diagnostics coverage. The final desktop follow-up also includes a
  new test for carrying the permission mode into a replacement workspace session.
  All 28 desktop app tests and all 7 context tests passed after that final change.
  The new test initially read the preview before its async load completed; adding
  an explicit wait for the preview resolved that test synchronization failure.
- Rust: 113 passed, zero failed; one unrelated public-GitHub network test ignored.
- Plugin SDK test passed.
- Clippy with `--all-targets -- -D warnings` passed.
- Actual native runner, installed Codex: all six host and agent operations passed
  in fresh Standard, resumed Standard, YOLO, then Standard again. The two
  Standard turns shared a provider thread; each mode change used a fresh thread.
  Active provider metadata confirmed
  `workspace-write`, `danger-full-access`, then `workspace-write`. Permission
  revisions advanced and stale evidence was cleared. No probe directories leaked.
  The final sanitized run is `.qa/access-live-1790693968906/diagnostics.json`.

The native check used a separate app identifier, WebView profile and settings
directory because the installed Velum instance was open. It used the installed
Codex CLI and its existing account; it did not substitute a CLI fixture.

To repeat with the normal debug application closed:

```powershell
npm.cmd run build
cargo build --manifest-path src-tauri/Cargo.toml
node scripts/workspace-access-smoke.mjs --live --include-yolo
```

To keep the installed application open, build a separately identified test copy
(the environment variable below applies only to this build process):

```powershell
$env:TAURI_CONFIG = '{"identifier":"com.velumix.musecode.access-smoke","productName":"Velum Access Test"}'
cargo build --manifest-path src-tauri/Cargo.toml
Copy-Item -LiteralPath 'src-tauri\target\debug\velum-code.exe' -Destination '.qa\velum-access-smoke.exe'
Remove-Item Env:\TAURI_CONFIG
node scripts/workspace-access-smoke.mjs --live --include-yolo --isolated
cargo build --manifest-path src-tauri/Cargo.toml
```

The opt-in script checks same-mode resume IDs as well as transitions and writes
sanitized JSON under `.qa/access-live-*/diagnostics.json`. Model calls use the
existing CLI account. No API keys are read or exported by the report.

## Verification limits

- Live provider verification covers Codex on this Windows machine. Muse and
  Antigravity policy behavior and their effective restrictions have not been
  verified against live accounts.
- Connection health is explicitly untested. Successful checks from a different
  conversation are not imported as current provider evidence.
- Velum has no live browser/app or document-session discovery implementation.
  The report says untested with an unknown attachment count. A structural chat
  layout snapshot is not a live UI attachment.
- Filesystem diagnostics do not establish memory retrieval. Existing memory
  tests are separate; this change adds no memory retrieval or UI attachment API.
- An abrupt OS/process kill can prevent cleanup code from running. Ordinary
  failures, cancellation and staging/launch errors are handled, and unexpected
  files are never recursively removed.
- The currently installed 0.6.1 application has not been replaced. Source and
  test builds contain the fix; the open installed application's historical
  session was not mutated or claimed as retested.
