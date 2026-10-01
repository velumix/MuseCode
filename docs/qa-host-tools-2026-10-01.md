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
| Regenerated dependency notices and legal consistency | Passed; legal status remains draft |

The unchanged frontend also passed its full 150-test suite in the preceding
[live-counter validation](qa-live-counters-2026-09-30.md). Native release and
installer verification will be recorded after packaging.

See [agent tools](agent-tools.md) for hash copying, search pagination and browser
behavior, and [usage](usage.md) for completed host/client diagnostics.
