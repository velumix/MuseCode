# Message queue and provider metrics review, 2026-09-30

Velum Code 0.6.2, branch `fix/message-queue-provider-metrics`, based on UI customization commit `cbf9cf4`.

## Changes and reproduced flaws

| Finding | Change |
| --- | --- |
| Submitting during active work had no queue. | A native queue per conversation runs messages in submission order after the current child process exits. Desktop and authenticated phones share edit, remove, pause, clear, and resume controls. |
| Stop, launch errors, and failed responses could discard the next request. | Pending messages stay paused for review. Recovery also pauses pending work. Native admission revalidates an edited queue entry before launching it. |
| A stale Muse retry warning survived healthy connection events. | Healthy phases work without optional attempt metadata. Response text and tool starts clear current retry status; completion clears live progress. Prior retry diagnostics remain historical. |
| Muse exec did not include usage in its stdout protocol. | An incremental retained-session reader counts only the current root run's numeric model usage, excluding old turns, child runs, duplicates, and oversized records. |
| The installed Codex CLI returned cumulative counters on resume. | Completion counts matching retained session totals use a pre-launch baseline. Documented per-turn completions are preserved. A live verification initially returned 18 output tokens for a resumed turn whose actual increase was 9, reproducing the inflated rate. |
| Antigravity repeated per-step usage and returned lifetime result totals. | Usage snapshots replace earlier values for their step, then sum only this invocation. Resumed result totals cannot inflate the rate. |
| The phone queue pushed Send outside the landscape viewport. | The queue scrolls within a bounded area. Portrait, narrow, and landscape layouts retain usable Send and Stop controls. |

Token speed is the reported output count divided by measured provider-process duration, including thinking, tools, startup, and child exit. Each queued turn resets the measurement. Missing counters remain unavailable. See the [usage and queue guide](usage.md).

The queue is limited to 20 pending messages and 256 KiB of prompt text. It preserves each submission's permission mode; phone submissions use Standard mode. Model, permission, and workspace changes wait for pending messages. Access probes and automated runs cannot interleave with them. Selecting another provider preserves the original conversation's queue.

[Desktop queue](images/message-queue-desktop.png) and [phone queue](images/message-queue-phone.png) screenshots use local protocol fixtures and were visually inspected.

## Validation

- `npx.cmd playwright test --reporter=dot`: **132 passed** in the final run.
- `cargo test --locked`: **156 passed, 1 ignored**. The ignored test requires an opt-in public GitHub download.
- `npm.cmd run test:sdk`: **1 passed**.
- `cargo clippy --all-targets --locked -- -D warnings` and `cargo fmt --all -- --check`: passed on the final Rust source.
- `npx.cmd tauri build --bundles nsis`: passed, including TypeScript and embedded desktop/phone production assets.
- `node scripts/native-smoke.mjs --release` and `--installed`: passed on the final executable with local Muse, Codex, and Antigravity protocol fixtures.
- Native coverage includes all three queues, FIFO dispatch after process exit, edit/remove, pause/resume, Stop and failure retention, current-turn usage and displayed tok/s, and both Codex completion schemas. It also covers model/reasoning selection, recovery, preferences, memory, PTY cleanup, tray behavior, authentication fixtures, and explicit Quit.
- `node scripts/remote-smoke.mjs --installed --usb-fixture`: passed against the installed native HTTP server and authenticated browser phone interface. It verifies shared queue order, edits/removals, Pause/Stop/Resume, Standard permissions, reported tok/s, background execution, recovery, pairing, cache behavior, and revocation. USB discovery and forwarding use a deterministic ADB fixture; physical Android hardware was not part of this check.
- An initial exit assertion failed while checking historical PIDs. The harness now identifies this run's fixture processes by a unique command-line marker, preventing PID reuse from authorizing cleanup of unrelated processes. It also checks unlogged model-catalog helpers. The optimized and installed reruns passed with no owned children remaining.

The deterministic native checks use isolated settings, provider data, projects, and WebView profiles. The tests refuse to attach to an existing Velum process.

## Real provider verification

`node scripts/providers-live-smoke.mjs --live --metrics-only --installed` passed with the existing signed-in CLIs. Each provider returned the exact verification marker, resumed the same conversation, and reported positive output counters with a measured duration. Codex counts also matched the increase in its own retained session totals for every supported counter.

| Provider | Fresh output tokens | Fresh elapsed | Fresh tok/s | Resumed output tokens | Resumed elapsed | Resumed tok/s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Muse | 71 | 14,422 ms | 4.9 | 132 | 24,257 ms | 5.4 |
| Codex | 9 | 4,414 ms | 2.0 | 9 | 4,063 ms | 2.2 |
| Antigravity | 138 | 4,047 ms | 34.1 | 104 | 4,907 ms | 21.2 |

These are measured verification turns, not provider speed benchmarks. Provider permission rules were not changed; the test used a disposable project and Standard permissions. Evidence is retained locally in ignored `.qa/providers-verified-1790809550330/result.json`.

## Installation

The corrected NSIS bundle is installed at `C:\Users\c0dec\AppData\Local\Velum Code\velum-code.exe`. The organized Desktop launcher points there. The matching installer is archived under `Desktop\Velum Code\Builds\Windows\2026-09-30-queue`; earlier UI and reliability installers remain available.

| Artifact | SHA-256 |
| --- | --- |
| NSIS installer | `E48F7B40CF6F170D658DC57ED0F4EA35BF9A8134995F84B72CE754C763311F43` |
| Optimized executable | `36029EB1DFE777267040BB7E4A22BBF205AF1C8040D08916DBD04004D7D84FAC` |
| Installed executable | `B4863ABCAAE9EB3FFCC807EE1EBEF093AD31510D18535703D1E62B6085B086E1` |

The installed payload matches the optimized executable byte for byte after accounting for Tauri's expected NSIS bundle marker in an in-memory comparison. No executable was modified during verification. The installer-created duplicate loose Desktop shortcut was removed after verifying both shortcut targets. `START HERE.txt` now identifies this update and its guides.

Work remains local on the named branch; no GitHub release or remote publication was performed.
