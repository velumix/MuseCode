# Agent tools and timing validation — September 30, 2026

Velum Code **0.6.3**, Windows x64, branch `improve/agent-tools-and-diagnostics`.
See [agent tools](agent-tools.md) for permissions and limits.

## Results

| Check | Result |
| --- | --- |
| Full browser/UI suite | 149 passed; final tool-settings/measurement regression rerun: 3 passed |
| Rust library | 171 passed, 1 ignored public GitHub download test |
| Clippy, all targets, warnings denied | Passed |
| TypeScript and production frontend | Passed |
| Plugin SDK | 1 passed |
| Dependency notices and legal consistency | Passed; legal documents remain drafts |
| Real native MCP bridge | Passed through all three provider launch paths with deterministic CLI fixtures |
| Installed Muse CLI, local echo | Real stdio adapter initialize and tool discovery passed on 1.4.2-R4684.1; no model/API call |
| Installed Codex metadata and Antigravity configuration | Codex per-turn config/credential-name allowlist accepted; actual adapter initialize/discovery passed through app-server metadata; Antigravity read the isolated MCP entry |

Native tests use an explicit private app identifier, configuration directory,
WebView profile and test window title. They can run alongside the user's app
without attaching to its conversations or editing its provider configuration.

### Native assertions

- Search found all **220 matches** over continuation pages, excluding generated
  `node_modules` and `.preview` fixtures. Generated-file overrides are explicit.
- A changed/wrong hash, parent traversal and Git metadata were rejected;
  correctly inspected fixture files were deleted individually.
- OneDrive source files were readable. A real Windows junction could not
  redirect file inspection, deletion or search to an outside fixture.
- Git status passed with `GIT_TEST_ASSUME_DIFFERENT_OWNER=1`, using repository
  trust for that command and without changing global Git configuration. Output
  collection is bounded and drained, with a ten-second timeout.
- Vault search excluded pending notes, another project and another bot. A bot
  with shared memory disabled found its private note and excluded project notes.
- The isolated preview browser navigated a local fixture, filled and clicked
  controls, evaluated the result and returned a valid PNG on each launch path.
- Native window discovery, Unicode input (`✓`) and PNG capture worked on the
  uniquely named test window. Desktop permissions were off by default.
- Requests with browser Origin headers or missing credentials were rejected.
  Unit tests also cover permission disabling and turn revocation.
- MCP image events retained image metadata without placing binary payloads in
  the derived UI transcript. The provider still receives the original image.
- Managed provider configuration preserves other settings/servers, one exact
  original backup, existing policy and Muse's legacy key spelling. Conflicting
  entries, invalid JSON and ambiguous Muse keys are rejected.

The three provider fixtures reported 125 output tokens. Host diagnostics used
that current-turn count and the actual Rust monotonic duration for each rate.
Intentional denied operations produced three tool errors per run; they were
counted, not hidden or mislabeled as successful.

### Independent client measurement and attachment

A real native UI turn produced an attachment with both monotonic clocks:

| Observation | Value |
| --- | --- |
| Provider fixture output count | 125 tokens |
| Host elapsed time | 1,939 ms |
| Client elapsed time | 2,299 ms |
| Host/displayed average | 64.4662 tok/s |
| Client average | 54.3715 tok/s |

The difference reflects distinct process/event-delivery boundaries, including
browser teardown before turn completion reaches the UI. The report was added
to the composer without sending it. Replayed history does not create a new
client timing observation, and run identifiers must match.

Local artifacts: `.qa/agent tools 1790828033531 & project/result.json` and
`client-report.json`; installed-CLI check: `.qa/provider MCP 1790828033267/result.json`.
These contain fixture evidence, not user conversation content or credentials.

## Practical limits

These tests establish native tool behavior, timing arithmetic and provider
launch/configuration compatibility. They did **not** make paid model requests
or verify new end-to-end tool calls through signed-in Codex/Antigravity model
sessions. Antigravity's configuration parsing was checked. Muse's actual local
echo session and Codex's app-server MCP metadata both initialized and discovered
the real adapter without making a model request. The Codex discovery fixture
also rejects unsupported resource methods, as a tools-only server may do.

Token counts remain provider-reported accounting. No independent provider
tokenizer or pure decoder-speed measurement is claimed. Unreported counters
remain unavailable. Browser previews require installed Edge/Chrome and Node.js
22 or newer; Windows may deny protected/elevated native windows.

Terms/privacy were updated for the new data flows and controls and remain
drafts pending publisher decisions and legal review.

## Packaging

The optimized Rust build and NSIS installer succeeded from runtime/frontend
source commit `5514d9d9874b6b3c4a0cbbe01f945698bd6cd02b`. The native tool/UI
timing smoke and installed-CLI configuration checks were repeated against that
release executable and passed. Dependency notices and legal consistency passed
again after packaging.

| Artifact | SHA-256 |
| --- | --- |
| Velum Code 0.6.3 x64 installer | `661770b7940f7748db270b6ba562848d7646a112e426d1173d865787ad7a55da` |
| Raw release executable | `bb7a3a113857dcbb5524104b1168e86355b1188c97090630ed24dede83a4e829` |
| Installed executable | `dbf7b7786b0c5e1460b8df24e83968dbbbf2b32af6ff38f22d43119037690ff9` |

The installer, raw executable, build manifest, 34 legal resources and debug/
release verification reports are archived in the desktop workspace's
`Builds/Windows/2026-09-30-agent-tools` folder. Release fixture evidence is also
in `.qa/agent tools 1790828617099 & project/result.json` and
`.qa/provider MCP 1790829274210/result.json` (latest path is also recorded in the
archived `release-provider-mcp-verification.json`).

### Installed application verification

Velum Code **0.6.3 is installed** in `%LOCALAPPDATA%/Velum Code`. The previous
app had exited before the silent NSIS update, which returned exit code zero.
The installed executable reports version 0.6.3, and all 34 bundled legal files
match the repository copies byte for byte. The only executable differences
from the raw release build are Tauri's expected three-byte `UNK` to `NSS`
bundle marker at offsets 9,470,364 through 9,470,366.

Both smoke checks passed again against the installed executable: native tools
and independent UI timing on the Muse, Codex and Antigravity fixture launch
paths; plus real Muse/Codex adapter initialization and discovery without model
requests. Antigravity's installed CLI configuration parsing also passed. The
signed-in model-call limits described above still apply.

Installed fixture evidence is in `.qa/agent tools 1790829934932 & project/`
(`result.json` and `client-report.json`),
`.qa/provider MCP 1790829934669/result.json`, and
`.qa/legal-install-verification.json`. Copies are archived alongside the
installer as `installed-tools-verification.json`,
`installed-client-diagnostics.json`, `installed-provider-mcp-verification.json`
and `installed-files-verification.json`.
