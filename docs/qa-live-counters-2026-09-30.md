# Live counter diagnostics follow-up — September 30, 2026

Velum Code **0.6.4**, Windows x64, branch `improve/agent-tools-and-diagnostics`.

## Finding

A Muse agent reported `finished: false`, nine successful tool calls and missing
token counters from its active `turn_diagnostics` snapshot. Inspection of the
saved numeric events established that the UI had received provider counts
earlier: 423 output tokens at 12,110 ms, then 1,625 at 112,233 ms, before that
diagnostic call at 112,351 ms. The retained-session monitor emitted usage to
the UI without updating the shared host measurement until process exit.

That real turn completed with `finished: true`, 2,261 reported output tokens,
142,408 ms elapsed, nine tool calls and zero tool errors. Its final whole-turn
average is **15.876917 tok/s**. No text-length estimate or tokenizer was used.
Conversation text, credentials and user paths were not copied into this report.

## Change

- Muse and Codex retained-session snapshots now update host diagnostics as
  well as the UI while the process runs. Codex completion counters keep
  priority over its retained-session fallback.
- All provider usage paths share a measurement update method. Model-call
  counters cannot finish a turn or replace a completed measurement.
- Diagnostics distinguish a running turn awaiting counts from a completed
  turn whose provider never reported them. Client timing explicitly identifies
  an unfinished observation.
- Missing output counters still yield a null rate. Root-run/session filtering,
  resumed Codex baselines, Antigravity per-step accounting and optional desktop
  permissions retain their existing behavior.

An agent cannot inspect its own final process-exit rate during its response.
Refresh Context > Diagnostics after the turn finishes, then attach that
completed report to the next message. See [usage](usage.md).

## Checks

| Check | Result |
| --- | --- |
| Regression against the installed 0.6.3 executable | Reproduced: Muse's live provider counters did not reach host diagnostics |
| Rust library | 172 passed, 1 ignored public GitHub download test |
| Clippy, all targets, warnings denied | Passed |
| TypeScript and production frontend | Passed |
| Usage and measurement UI checks | 7 passed |
| Full browser/UI suite | 150 passed |
| Native MCP tools and UI timing | Passed: Muse, Codex and Antigravity fixture launch paths report 125 live output tokens with `finished: false`, then the correct final rate and a completed independent client report |

Native evidence: `.qa/agent tools 1790831089647 & project/result.json` and
`client-report.json`. The fixture provider counters are deterministic; host and
client durations and MCP calls come from the actual native app. The older
installed build's regression fixture is `.qa/agent tools 1790830783266 & project`.
Fixtures use private configuration, provider storage and window identities.
They neither send model requests nor change the user's provider configuration.

The numeric real-Muse completion confirms that its installed accounting path
works after exit. These fixture checks do not establish new signed-in model
calls for Codex or Antigravity, nor do they independently validate provider
tokenization. Desktop capture/input remain optional and are unnecessary for
token-speed measurement. Legal documents remain drafts.

## Packaging and installation

The optimized Windows build and NSIS installer succeeded from runtime/frontend
source commit `b2d9df8ea8e07bd5972982d75760a0b568de7f93`. Native tool/live-counter/
UI-timing checks and real Muse/Codex MCP initialization/discovery passed again
against that release executable. Antigravity's CLI configuration parsing and
regenerated dependency-notice/legal consistency checks also passed.

| Artifact | SHA-256 |
| --- | --- |
| Velum Code 0.6.4 x64 installer | `f095c7fb38c503b436163b34288c5704fbd89b0ca0e43078f9872ed8f88a8a00` |
| Raw release executable | `964e430b6bf8604ac8fb4241b5df13453e5d0fee1a52ee804f3d323dae8df990` |

Release evidence: `.qa/agent tools 1790831615429 & project/result.json` and
`client-report.json`, plus `.qa/provider MCP 1790831615049/result.json`.
The desktop archive is `Builds/Windows/2026-09-30-live-counters`, containing
the installer, raw executable, 34 legal resources and verification reports.

Installation was pending at the time of this validation because the 0.6.3 app
was running. The subsequent [0.6.5 host tool update](qa-host-tools-2026-10-01.md)
is installed and verified; it includes this live-diagnostics fix and clearer
measurement status.
