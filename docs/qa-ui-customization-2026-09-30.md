# UI customization review, 2026-09-30

Velum Code 0.6.2, branch `improve/ui-customization`, based on reliability commit `f1de463`.

## Changes

- Twelve dark and light themes, system theme following, and custom accent, canvas, and surface colors.
- Frosted, Crystal, and Solid presets with live opacity, blur, saturation, glow, grain, borders, shadows, and corner controls.
- Density, sidebar, conversation width and margins, interface and message typography, and code font controls.
- Live terminal colors, font, spacing, cursor, blink, and scrollback without disconnecting the terminal.
- Message send shortcut, tool output display, conversation defaults, visibility controls, and reduced motion.
- Searchable, keyboard accessible Settings with a responsive phone version. Phone profiles stay on that device, including with view-only desktop access.
- Versioned JSON profile import/export and confirmed reset. Native desktop settings use atomic saves, serialized writes, a visible save status, and retry; browser storage is a secondary cache.

See the [appearance guide](appearance.md) for controls and profile behavior.

## Flaws reproduced and fixed

| Finding | Change and verification |
| --- | --- |
| Fixed dark colors made light themes inconsistent and some glass combinations unreadable. | Components use semantic colors. Text, muted text, status colors, and accent actions account for panel backgrounds. Dark/light and custom accent accessibility checks pass. |
| A blurred phone composer became the containing block for its fixed usage popover, clipping the popover in landscape. | Blur applies to the inner form. Existing phone overlay and landscape regressions pass. |
| A multiline draft kept its old height after changing message typography. | Draft layout responds to font and layout preferences. The new regression failed before the fix, then passed. |
| A brief Windows reader lock caused an atomic settings replacement to fail with access denied. | Atomic rename retries only Windows sharing/access errors with a bounded 310 ms delay. Native integration deliberately holds a reader without delete sharing: a brief lock saves the latest profile, while a persistent lock returns an error, preserves the previous profile, and removes the temporary file. |
| Startup opacity polling could miss the short fully revealed title state before removal. | The smoke check awaits the animation's actual completion and still rejects premature removal. Packaged and installed startup checks pass. Startup styling is unchanged. |

## Validation

- `npx.cmd playwright test --reporter=dot`: **119 passed** in the final full run.
- UI coverage includes all themes, system appearance, live glass, draft preservation, keyboard focus/search, minimum window size, phone portrait/landscape, typography, connected terminal changes, send/provider/tool preferences, save ordering, blocked storage, failures/retry, and profile validation/import/export/reset.
- Accessibility scans pass on the tested desktop and phone surfaces, including dark/light settings, Crystal glass, and custom accent combinations.
- `npm.cmd run build`: TypeScript and production desktop/phone Vite build passed.
- `npm.cmd run test:sdk`: **1 passed**.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked`: **145 passed, 1 ignored** before the final Windows atomic rename retry. The ignored case is an opt-in public GitHub download.
- The new Windows reader-lock unit test reproduced the original failure. After the retry change, Windows Application Control prevented the Rust test executable from launching (error **4551**), so the latest library test run did not execute. The same transient and persistent lock behavior passed through the real native preferences API in both the optimized and installed apps. No application control policy was changed.
- `cargo build --manifest-path src-tauri/Cargo.toml --locked`, `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, and `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings`: passed on the final Rust source.
- `node scripts/native-smoke.mjs`: passed with the production frontend through the development native host.
- `node scripts/native-smoke.mjs --release`: **passed** with the final embedded production frontend and optimized native executable.
- `node scripts/native-smoke.mjs --installed`: **passed** after installing the final NSIS bundle.
- Native checks covered startup/focus, settings persistence/reload, Windows reader locks, draft recovery with failed browser storage, provider protocol fixtures, model/reasoning options, workspace access, memory, retries/errors, Stop/process cleanup, ConPTY, tray restoration, authentication fixtures, and explicit Quit.
- `git diff --check`, `node --check scripts/native-smoke.mjs`, and `node --check scripts/startup-smoke.mjs`: passed.
- Desktop, light theme, glass, minimum window, phone, conversation, and terminal screenshots were visually inspected. [Theme preview](images/settings-themes.png) and [phone preview](images/settings-phone.png) are retained in this repository.

Provider tests used deterministic local CLI fixtures and isolated settings/WebView profiles. Live provider accounts and a physical Android installation were not exercised. Test artifacts remain in ignored `.qa/` folders.

## Installed build

The local Windows app is updated at `C:\Users\c0dec\AppData\Local\Velum Code\velum-code.exe`. The existing **Launch Velum Code** shortcut stays inside the desktop **Velum Code** folder; the duplicate shortcut created by setup was removed after confirming both targets.

The matching installer is retained in `Desktop\Velum Code\Builds\Windows\2026-09-30-ui\Velum Code_0.6.2_x64-setup.exe`. The previous reliability installer remains in the adjacent date folder.

| Artifact | SHA-256 |
| --- | --- |
| NSIS installer | `2839876E0C09E7DF10ACC00F188678844A7B24FA16835FE484C150F327EFA098` |
| Installed executable | `BF9E8C179D0955A37C95113A7126C2C2B9F7F8D776BB5FE80D98313D3F7773DD` |

The installed executable was compared byte-for-byte with the validated build. Its only difference is Tauri's expected three-byte bundle marker (`UNK` in the restored build output, `NSS` in the NSIS payload). Neither executable was modified for verification.

No GitHub publishing was performed.
