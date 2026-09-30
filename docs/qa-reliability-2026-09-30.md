# App reliability review, 2026-09-30

Base: `149cc18`, Velum Code 0.6.2. Reviewed desktop and phone session behavior,
workspace changes, draft recovery, submission failures, bot handoffs, and copy feedback.

## Findings and changes

| Reproduced flaw | Resulting behavior | Regression coverage |
| --- | --- | --- |
| Failed browser storage writes prevent native saves; unavailable browser storage discards recovered tabs and drafts. | Valid native recovery loads into an in-memory cache. Browser storage errors do not prevent native saves or workspace changes. | Restore two saved tabs with blocked reads/writes; save and clear drafts with failed writes; checkpoint newly opened tabs. |
| A delayed whole-desktop save replaces a newer draft with the older draft it captured. | Native tab checkpoints and draft updates execute in submission order. | Hold a checkpoint, type a newer draft, release the checkpoint, and inspect the resulting native state. |
| A delayed submission error removes the original message after the user has typed a follow-up. | The rejected message stays visible with **Not sent** and a working Copy action. A newer draft stays intact; an empty composer restores the failed prompt. Rejected messages are excluded from plugin and handoff context. | Delayed send rejection, clipboard feedback, accessibility, and an actual bot handoff through the UI. |
| The copy confirmation wraps **Copied** into a vertical stack approximately 94 px tall. | The confirmation has its natural width and stays on one line. | Check confirmation dimensions and inspect the screenshot. |

The seven new browser tests are in `tests/ui/reliability.spec.ts`. The original
behavior failed all four initial storage/submission cases, the separate save-order
case, and the copy-layout check before their fixes.

## Validation

- `npm.cmd run build`: passed TypeScript and the production desktop/phone build.
- `npm.cmd test -- --reporter=dot`: all 103 browser tests passed.
- After the copy-layout fix, the affected app and reliability suites passed again:
  `npx.cmd playwright test tests/ui/app.spec.ts tests/ui/reliability.spec.ts --reporter=dot`
  (36 tests).
- `npm.cmd run test:sdk`: one SDK test passed.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked`: 142 passed,
  one opt-in public GitHub download test ignored.
- `cargo build --manifest-path src-tauri/Cargo.toml --locked`: passed.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: passed.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings`:
  passed.
- `git diff --check` and `node --check scripts/native-smoke.mjs`: passed.
- `node scripts/native-smoke.mjs`: passed with the development frontend and again
  with the production frontend served by Vite preview. Both runs used the development
  native executable and isolated settings/WebView profiles. The added check confirmed
  that failed browser storage still saves and clears drafts in the real Rust checkpoint
  on disk. Existing native checks covered provider protocol fixtures, resume, errors,
  Stop/process cleanup, ConPTY, memory, authentication fixtures, and tray behavior.
- `npx.cmd tauri build --bundles nsis`: built the optimized executable and Windows installer.

## Release execution limitation

`node scripts/native-smoke.mjs --release` could not launch the new optimized
executable. Windows Application Control returned error **4551**, and Code Integrity
events **3033/3077** reported that it did not meet the enterprise signing requirements.
The release executable's native smoke test and installer installation were therefore
not verified. The production frontend passed native checks through the development host.

Provider tests used deterministic local CLI fixtures. Live account access and a physical
Android installation were not part of this review. Native test data and screenshots are
in ignored `.qa/` folders. No GitHub publishing or installed-app update was performed.
