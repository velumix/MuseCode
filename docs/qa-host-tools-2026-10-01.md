# Host tool follow-up — October 1, 2026

Velum Code **0.6.5**, Windows x64, branch `improve/agent-tools-and-diagnostics`.

## Findings from the reported run

The reported Muse run used the installed **0.6.3** executable. Its saved final
measurement for run `20f8e212-c813-4519-bbc4-98db12299e68` records 4,367 output
tokens, 250,595 ms elapsed, 11 tool calls, three tool errors and `finished: true`.
The final whole-turn average is **17.426525 tok/s**. Its first event arrived at
6,340 ms and its first visible assistant output at 184,676 ms. That output
offset is not a measurement of a provider's first decoded token.

Provider counts were already present in retained numeric events: 378 output
tokens at 20,209 ms and 2,381 at 165,510 ms. The running host snapshots missed
them because 0.6.3 lacks the live measurement update fixed in 0.6.4. This release
includes that fix. A running rate can be a provisional average when reported
counts exist; missing output counts still produce null. No text-length estimate
or tokenizer is substituted.

Both rejected deletion requests supplied **41 hexadecimal characters**. Their
preceding inspections returned **64-character SHA-256 values** for the 24-byte
file. The strict guard correctly rejected the incomplete arguments before file
removal. It does not require a hidden inspection ledger or session state.
Conversation text, credentials and raw tool arguments were not exported here.

The older browser failure did not record enough process detail to establish its
cause. A successful prior run does not establish that every subsequent launch
will succeed.

## Changes

- Deletion guidance and its MCP schema require the full 64-character SHA-256
  copied unchanged. A malformed argument reports its actual character count
  and confirms that no file was deleted. The strict guard remains in place.
- Browser startup verifies a live debugging endpoint whose loopback port and
  browser socket path match the newly created profile's port file.
- If the first installed browser cannot start, Velum tries the other installed
  Edge/Chrome browser with a fresh temporary profile. Errors distinguish launch
  failure, early exit and readiness timeout. Failed attempts clean their own
  profile and process.
- Two bounded startup attempts and a bounded browser operation fit the existing
  MCP transport deadline. Chromium sandbox and Windows policy are respected.
- Native fixtures exercise incomplete-hash rejection before successful deletion
  with a full inspected hash, across all three provider launch paths.

## Checks

| Check | Result |
| --- | --- |
| Rust library regression suite | 175 passed, 1 ignored public GitHub download test |
| Browser fallback regression | Passed for a missing executable and an early process exit, followed by a real browser launch |
| Browser readiness regression | Passed: foreign socket host and mismatched profile socket path rejected |
| Deletion regression | Passed: short/nonhex hashes preserve the file; the full matching hash removes it |
| Clippy, all targets, warnings denied | Passed |
| TypeScript and production frontend | Passed |
| Usage and measurement UI checks | 7 passed |
| Plugin SDK check | 1 passed |
| Regenerated dependency notices and legal consistency | Passed; legal status remains draft |
| Packaged native tool checks | Passed: all three provider fixture paths and one UI turn, full-hash deletion, paginated search, scoped vault, isolated browser actions/screenshots and live counters |
| Packaged native client timing | Passed: independent completed client report, correct host/client rates and attachment without sending |
| Real provider adapter configuration/discovery | Passed: Muse echo and Codex metadata initialize/discover tools; Antigravity parses configuration |

The unchanged frontend also passed its full 150-test suite in the preceding
[live-counter validation](qa-live-counters-2026-09-30.md).

Native release evidence is `.qa/agent tools 1790864444697 & project/result.json`
and `client-report.json`. Real adapter evidence is
`.qa/provider MCP 1790864444462/result.json`. Fixture token counters are
deterministic; host/client durations and tool operations come from the packaged
app. These checks use private configuration and do not make model requests or
change the user's provider settings. They do not independently validate a
provider tokenizer or establish new paid model calls for each provider.

## Packaging and installation

The optimized Windows x64 executable and NSIS installer were built from runtime
source commit `7546d888303bc5f584025f4f03eaed5796f2e148`. Packaging succeeded;
native tools, live counters, client timing and real adapter discovery passed
against that release executable.

The desktop archive is `Builds/Windows/2026-10-01-host-tools`, containing the
installer, raw executable, 34 legal resources and verification reports. Its
manifest records the runtime commit and checksums.

| Artifact | SHA-256 |
| --- | --- |
| Velum Code 0.6.5 x64 installer | `2e87ba40306740f799d68ad1db82cf77477724167c72f5f577441740b8ef142c` |
| Raw release executable | `0ab6cfb64296137197b3a8080188d946558b3d632a63ccb519ff67cce2992594` |

**Installed and file-verified:** after the owner fully quit 0.6.3, the verified
0.6.5 installer completed with exit code zero. Windows reports product/file
version 0.6.5. All 34 installed legal resources match the release inputs byte
for byte. The installed executable matches the raw release except for the
expected three-byte Tauri NSIS bundle marker.

The installed executable SHA-256 is
`34caf5b42d1ffc8da224afccfb6ba63905946c8bd030c6a3562e235451740435`.
The file verification report is `.qa/legal-install-verification.json`; its
runtime source commit is the build commit above. Terms remain drafts.

Real Muse/Codex initialization and tool discovery and Antigravity configuration
parsing passed again against the installed executable. Evidence:
`.qa/provider MCP 1790865235491/result.json`.

Installed native tool, live-counter and independent client-timing checks passed
across all three provider fixture paths and the UI turn. Evidence:
`.qa/agent tools 1790865413384 & project/result.json` and `client-report.json`.
An initial installed run stopped when Windows rejected an optional native
control operation (`.qa/agent tools 1790865235726 & project`). Repeating the
same checks passed, including Unicode input and window capture. No runtime
change or Windows policy change was made between attempts; this remains
evidence of an intermittent desktop-control rejection, not a proven fix for it.

See [agent tools](agent-tools.md) for hash copying, search pagination and browser
behavior, and [usage](usage.md) for completed host/client diagnostics.
