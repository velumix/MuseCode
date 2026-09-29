# Muse and Agy validation — 2026-09-29

## Cause and reproduction

The source is `C:\Users\c0dec\code\muse-code-app`. The similarly named Documents
folder contains memory data, not the application source.

The user's interrupted Muse run recorded **HTTP 503 service errors**, followed by
60,000 ms waits before attempts 2 and 3 of 10. This is direct evidence from the
installed Muse CLI's retained `external_attempt` events, not an inference from
the spinner or workspace permissions. The model was
`muse-spark-1.3-contributor`, Muse CLI `1.4.0-R4302.1`.

Velum displayed only the generic activity message and dropped the structured
HTTP status and retry delay. Simple fresh and resumed turns already worked when
the investigation began, on both the installed Velum 0.6.1 and the current source.
The service outage was not reproduced on demand. Its exact event shape is now a
regression fixture; Velum cannot repair a provider's remote service.
This occurred before workspace tool execution and is separate from the earlier
Codex sandbox failure at the Windows user-profile root.

Two additional integration defects were reproduced through real provider tools:

- Muse completed all six workspace operations under Standard permissions, but
  Velum marked every check untested. Muse's managed PowerShell tool returns JSON
  **inside** `tool.result.payload.text`; the diagnostic collector was searching
  the outer JSON text rather than the actual `output` field.
- Agy 1.2.13 rejected its shell tool under the configured headless approval
  policy. It emitted a tool `ERROR` state and `denied_actions` with a `SUCCESS`
  result and exit code 0. Velum detected the overall rejection from stderr, but
  ignored the failed tool state and could not attribute the blocked operation.
  This is a policy rejection, not a Windows filesystem denial.
  A later live run emitted an empty completed tool record and reported the
  denial only through stderr. The final correction associates that denial only
  with the latest command lacking result evidence. It never overrides a passed
  operation, a concrete filesystem error or a different later tool.

The evidence from the original outage is sanitized in
`.qa/provider-install-0.6.2/original-service-failure.sanitized.json`.
Before-change live runs are `.qa/providers-live-1790713244623/` (installed app)
and `.qa/providers-live-1790713449694/` (source, including file probes).

## Changes in 0.6.2

- `src-tauri/src/provider_progress.rs`, `events.rs`: extract only the phase,
  attempt counts, HTTP status and retry deadline from Muse's structured events.
  Request IDs, account data, raw errors and credentials are not copied.
- `session_log.rs`, `app_context.rs`: include current provider progress and the
  last retry in the previewable diagnostics. A new turn or permission/session
  reset clears stale provider evidence. Workspace checks remain separate.
- `src/providerProgress.ts`, `components/ProviderWait.tsx`, `ChatView.tsx`,
  `remote/RemoteApp.tsx`, `remote/transcript.ts`: show the service error and a
  compact countdown on desktop and phone, retain Stop, and clear the wait on
  recovery. Phone reconnection retains the original retry deadline.
- `components/ContextPanel.tsx`, `context.ts`: display the active provider's
  observed state and last retry. Installation is not described as proof of
  authentication or working external tools.
- `workspace_access.rs`: unwrap Muse's real shell result before checking
  markers, exit codes and PowerShell errors. Command text cannot establish a
  pass. Attribute Agy policy errors only to operations that were attempted;
  dependent operations remain untested.
- `provider_events.rs`: recognize Agy's `ERROR` tool state and `denied_actions`,
  including when the CLI exits zero or reports `SUCCESS`.
- `runner.rs`: require a completion event from Muse, as for other providers.
  An incomplete or empty zero-exit run is no longer marked Done.
- Native testing also exposed a workspace selection race in `ChatView.tsx`:
  late provider registration overwrote a newly entered project path. Preserve
  edits made during registration and keep Apply disabled until it finishes.
  Failed initialization still allows selecting a different folder. A delayed
  registration regression covers this case.
- Version manifests, README installer name and phone shell cache updated for
  0.6.2. Existing uncommitted workspace/UI/startup work was preserved.

No sandbox was disabled. Velum does not rewrite provider permission rules or
credentials, and this fix makes no system ACL or administrator changes.

## Regression coverage

Rust coverage includes the real retry shape and sanitized fields, new-turn and
permission-reset invalidation, nested Muse shell results, exit-zero access
denials, echoed commands, separate edit/read-back evidence, Agy policy rejection
and probe cleanup. Desktop/phone tests cover countdowns, recovery, Stop, draft
preservation, narrow layouts and replayed deadlines.

`scripts/native-smoke.mjs` adds incomplete Muse exit and 503/recovery fixtures
through the actual native process bridge and checks the diagnostics preview.
`scripts/providers-live-smoke.mjs --live [--installed]` is opt-in: it uses the real
signed-in CLIs with isolated app data and a dedicated project containing a
harmless fixture. It checks replies, provider resume, workspace operations,
cleanup and fresh Standard sessions after permission changes. It never runs a
YOLO turn; mode changes are confined to its disposable test conversations.

Automated checks: **96 UI tests**, **139 Rust tests** and the plugin SDK test
passed. One pre-existing Rust test remains ignored because it requires an
optional public GitHub download. Production frontend build, formatting,
Clippy with warnings denied and `git diff --check` passed.

## Installed build and final live results

Built the production Tauri/NSIS package and installed **Velum Code 0.6.2** at
`C:\Users\c0dec\AppData\Local\Velum Code\velum-code.exe`. The installer exited
successfully. The installed executable matches the final release build except
for Tauri's expected three-byte installer-format marker (`UNK` to `NSS`). Its
SHA-256 is
`b2fd38592fcb8b906bf75214a4512f030dd3222720fc73d8a5f1d556c3303aac`.
All 14 existing settings/history files captured before installation retained
their original hashes after the isolated validation runs.

`node scripts/providers-live-smoke.mjs --live --installed` passed against this
exact installed build. Evidence and UI screenshots are in
`.qa/providers-verified-1790715932013/`; `result.json` contains no errors.
The dedicated selected project included spaces, an apostrophe and `&` in its
path. Both providers rendered real replies through the installed desktop UI.

| Check | Muse | Agy / Antigravity |
| --- | --- | --- |
| Live model discovery | 4 models | 7 models |
| Fresh reply and resumed conversation | Pass | Pass |
| Standard agent directory listing | Pass | Blocked: provider approval policy |
| Standard agent known-file read | Pass | Untested after listing rejection |
| Standard agent file creation | Pass | Untested after listing rejection |
| Standard agent editing and exact read-back | Pass | Untested after listing rejection |
| Standard agent cleanup | Pass | Untested; host fixture cleanup passed |
| Host checks, separately recorded | All six pass | All six pass |
| Mode change invalidates diagnostic results | Pass | Pass |
| Return to Standard creates a fresh provider session | Pass | Pass |
| Installed UI reply, selected project, Standard | Pass | Pass |

The harmless seed file was unchanged and no diagnostic probe remained. Agy's
blocked result is evidence that its restriction is enforced and reported; it
is not a successful agent filesystem test. No real unrestricted turn was run.
Ordinary chat tools do not populate diagnostic checks: **Test agent access**
starts a separate, attributable diagnostic turn for the current session.

`node scripts/native-smoke.mjs --installed` also passed on the final binary.
Evidence is in `.qa/native 1790716177386 & workspace/`. This exercised packaged
startup, workspace selection, provider streams, the incomplete-zero-exit and
HTTP-503/recovery fixtures, sanitized diagnostic preview, Stop and descendant
cleanup, terminal, local memory review/retrieval, tray behavior, authentication
fixtures and the stderr-only Agy denial. Agy authentication in this suite is a
fixture; the separate live suite establishes real signed-in replies.

After validation, the installed app was opened with normal user data. Its
`Velum Code` window was responding; the test WebView debugging listeners were
closed. The app was left running for the user.

## Limits

- Agy shell operations requiring interactive approval remain blocked in its
  headless Standard session. The app explains the command-specific permission
  review in Terminal; it does not silently grant access.
- Muse/Agy effective sandbox metadata is not supplied by these streams and
  remains untested in diagnostics. Actual tool results establish the tested
  operations; launch settings alone are not evidence of access.
- External GitHub/Gmail/Drive/Trello connection health, native UI/document
  attachments and external memory services were not tested or asserted.
  The Windows Computer Use pipe issue is separate; native testing uses Velum's
  WebView2 harness. Phone layout checks do not constitute a new physical APK test.
