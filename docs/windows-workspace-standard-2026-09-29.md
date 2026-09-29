# Windows Standard workspace follow-up — 2026-09-29

Repository: `C:\Users\c0dec\code\muse-code-app` (Velum Code 0.6.1).
Provider: installed Codex CLI 0.157.0 on Windows. This investigation preserves
the previous uncommitted Velum changes.

## Cause established by execution

The selected user-profile root was not a usable Standard coding workspace on
this machine. Velum's host runs as the signed-in user; sandbox commands run as
the separate `CodexSandboxOffline` account. The profile-root ACL has no
`CodexSandboxUsers` listing/write grant. The repository has a Modify grant, and
`.codex` has a ReadAndExecute grant. Reading a known file therefore does not
establish directory listing or permission to create a new file in its parent.

This matches the dedicated lower-privilege account and filesystem boundaries
described in the [official Windows sandbox documentation](https://learn.chatgpt.com/docs/windows/windows-sandbox).
The cause here was established with actual commands and ACL inspection, rather
than inferred from that documentation or from `workspace-write` metadata.

Reproduction before editing:

- Both a fresh dedicated project and `C:\Users\c0dec` passed host checks.
- The real Velum runner passed all six agent checks in the dedicated project,
  including a resumed Standard turn.
- The same runner failed profile-root listing with `UnauthorizedAccessException`.
- A standalone `New-Item` through the installed Codex Windows sandbox executed
  and returned `NewItemUnauthorizedAccessError` at the profile root. A known,
  harmless fixture could be read. These are filesystem results, not a policy
  rejection.
- A later sandboxed PowerShell listing emitted `PermissionDenied` and
  `UnauthorizedAccessException`, then emitted a completion marker and exited
  **0**. Diagnostics must inspect error records.
- The prior diagnostic write target lived in a **host-created child directory**.
  That child received different sandbox access: its writes passed even while
  direct profile-root creation failed. This was a diagnostic scope defect.

`resolve_workspace` canonicalizes explicitly selected directories and converts
Windows extended/UNC prefixes for CLI use. The existing provider launcher passes
the selected directory as both process cwd and `-C`, plus its explicit writable
root, for fresh and resumed turns. These arguments already worked for a real
project. Paths containing spaces, an apostrophe and `&` passed live validation.

The root failure also occurred in fresh provider sessions with the correct cwd,
`workspace-write`, approvals `never`, and restricted network metadata. There is
no evidence that stale session configuration or path quoting caused this failure.
The host process was not running as administrator.

## Small fix

| File | Follow-up change |
| --- | --- |
| `src-tauri/src/workspace_access.rs` | Place the unique write target directly in the selected directory; keep the known read fixture separate; compare exact read-back contents; retain unknown patch failures as unknown; sanitize the new target name; identify canonical profile-root selections. |
| `src-tauri/src/runner.rs` | Explain profile-root selection and require a project folder for ordinary Windows Codex Standard turns. Diagnostic turns can still inspect the root. Apply a requested permission change even if the workspace guard prevents launch. Invalidate results if the provider returns a replacement thread. |
| `src-tauri/src/app_context.rs` | Include diagnostic collection semantics, workspace kind, guidance and write-probe scope in context and the sanitized report. |
| `src/components/ChatView.tsx` | Show project-selection guidance and preserve an unsent draft when changing folders. |
| `src/components/ContextPanel.tsx`, `src/context.ts` | Explain explicit diagnostic collection and distinguish refreshing the report from executing agent checks. |
| `tests/ui/context.spec.ts`, `tests/ui/fixture.ts` | Cover ordinary tools remaining untested, folder guidance and draft recovery, alongside existing host/agent and permission-change tests. |
| `scripts/workspace-access-smoke.mjs` | Default to a dedicated workspace; validate ordinary calls, root failure, project recovery, same-mode resume, permission reset, session recreation and cleanup through native IPC and the real provider. |

No provider restriction was weakened. No global configuration, manual ACL grant,
administrator launch or unrestricted provider turn is part of the fix. Standard
project selection is the supported recovery; Velum does not silently grant the
agent access to the entire user profile or select a different folder on the
user's behalf.

## Diagnostic semantics

The six agent results belong to **Test agent access**, an explicit diagnostic
turn in the active conversation. Ordinary chat commands do **not** mutate this
snapshot. `untested` means there is no result from that diagnostic flow; it does
not contradict an ordinary command that ran successfully. “Refresh report”
reloads the snapshot; it does not launch a provider turn.

Host results, agent results and host fixture cleanup remain separate. Each
operation includes its path, time, execution environment, status and available
error classification. Host success and configured permissions never establish
agent success.

| Evidence | Result |
| --- | --- |
| Tool rejected before execution with “blocked by policy” | `blocked` / `provider_policy` |
| Executed PowerShell returns `UnauthorizedAccessException` or `PermissionDenied`, including exit 0 | `fail` / `access_denied` |
| Failed Codex patch event omits the underlying error | `fail` / `tool_failure`, explicitly unclassified |
| No diagnostic operation evidence, or results invalidated by mode/session change | `untested` |
| Actual provider operation and expected verification succeed | `pass` |

The profile-root patch really failed. Codex's underlying tool output said only
“Failed to write file”; its `file_change` event omitted even that text. The report
does not manufacture an OS denial code for that event. The independently
executed PowerShell creation above supplies the explicit filesystem-denial
evidence. The historical combined-shell policy rejection is a separate failure;
its classification has regression coverage, not a claim of fresh live execution.

## Validation

- **128 Rust tests passed**, 1 optional public-GitHub test ignored.
- **62 targeted browser tests passed**: desktop app, context/diagnostics and phone
  UI. An earlier concurrent run lost its shared Vite server and reported
  `ERR_CONNECTION_REFUSED`; the sequential rerun passed all 62.
- The new draft-preservation test initially failed and exposed the recovery bug;
  it passed after the fix.
- Frontend production build, native debug build, Clippy with `-D warnings`, and
  `git diff --check` passed.
- Real native IPC → Velum runner → installed Codex: all six operations passed in
  Standard, resumed Standard and a fresh Standard thread after permission reset.
  The same-mode resume ID remained the same; after reset it changed. Evidence
  revisions advanced from 0 to 2. Native session recreation reset checks to
  untested. An ordinary tool turn left the diagnostic checks untested.
- Live profile-root → explicit project recovery passed. At the root, host checks
  passed, agent listing failed with `access_denied`, known-file reading passed,
  patch creation failed with `tool_failure`, and the three dependent operations
  remained untested. Selecting a dedicated project then passed all six agent
  operations under Standard restrictions.
- Each completed native run asserted no new `.velum-access-*` files/directories
  remained. Regression tests also cover interrupted cleanup, preserving existing
  user files, and refusing recursive deletion when unexpected files are present.

Mode-reset tests change the isolated app session's requested setting and switch
it back to Standard **before** running a provider turn. No unrestricted provider
execution is needed for these tests. They do not change the open user's session.

Sanitized evidence:

- `.qa/workspace-standard-1790708149026/before-sandbox.json`
- `.qa/workspace-standard-1790708149026/powershell-zero-exit.json`
- `.qa/access-live-1790708566502/diagnostics.json` — Standard resume/reset checks
- `.qa/access-live-1790709063962/diagnostics.json` — root failure/project recovery

To repeat with the separately identified `.qa/velum-access-smoke.exe` test build:

```powershell
node scripts/workspace-access-smoke.mjs --live --isolated --ordinary-probe --mode-reset
node scripts/workspace-access-smoke.mjs --live --isolated --workspace C:\Users\c0dec --expect-profile-denial --recover-project
```

Run native and Playwright checks sequentially because both use the local Vite
port. See `workspace-access-fix.md` for building the isolated application.

## Remaining limits

- This does not make the user-profile root broadly writable. Select the actual
  project, such as `C:\Users\c0dec\code\muse-code-app`, and run Test agent access.
- Live provider verification covers Codex on this machine. Other providers and
  different managed Windows configurations were not retested.
- The installed desktop executable has not been replaced by this follow-up;
  the source and separately identified native test build contain the changes.
- The reported **Computer Use native pipe unavailable / OS error 2** is a
  separate integration failure. It was not used as filesystem evidence and was
  not repaired or retested here. UI regression tests use Playwright/WebView
  automation, not a claimed attached Computer Use session.
- No live UI/document attachment discovery or new memory-retrieval capability
  was added. Connection health remains untested in these reports.
- Abrupt process termination can still prevent cleanup. Reports preserve the
  generated probe basename so a leftover can be located without sharing private
  path prefixes or file contents.
