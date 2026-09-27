# Velum Code 0.4.0 checks

Checked on Windows with the existing Muse, Codex and Antigravity integrations, and a Pixel 7 Pro.

## Persistent memory

- Local Markdown notes survive store reopening and separate project and shared scopes.
- The context budget covers excerpts, framing and learning instructions, including multibyte text.
- Retrieval excludes pending/archived notes, finds relevant paragraphs, refreshes changed notes and avoids repeating unchanged excerpts on every turn.
- External Markdown edits and filename changes are read correctly. Stale saves/deletes fail without overwriting a newer note.
- Review, automatic and manual capture modes work. Duplicate proposals, conflicting active titles, invalid metadata, malformed output, oversized suggestions and obvious credential patterns are handled.
- Stream filtering handles every tested chunk boundary, Unicode, CRLF, incomplete blocks and oversized blocks.
- Native Windows fixtures exercise failed-turn rejection, hidden streamed proposals, review approval, retrieval, reuse and deduplication. Fresh Muse, Codex and Antigravity conversations use the same project vault; resumed turns omit unchanged notes.
- Phone memory requests require pairing and write permission. Unknown fields cannot supply another workspace or vault path.

## Desktop and phone UI

- 39 browser tests pass, including note editing, archive/restore/delete, review approval, settings, save-conflict recovery, keyboard focus, long Unicode messages and Remember actions on both devices.
- The memory panels pass automated accessibility checks and fit the tested desktop and 390-pixel phone layouts. The phone editor was also checked at keyboard-height viewport size.
- The compact desktop layout uses a 32-pixel title bar and matching provider, model and reasoning dropdowns. All three fields retain equal widths and align at 1200, 980 and 760-pixel window widths; phone dropdowns keep 44-pixel touch targets. All 38 browser tests pass after the layout changes. Minimize, maximize, restore and close-to-tray pass in the updated installed Windows build, and the paired Pixel reconnects with the new dropdown layout.
- Phone drafts survive reload. Logout/detected revocation removes local drafts and private UI. Reload does not extend a draft's expiry time.
- Real USB server integration verifies that the authenticated phone editor writes the desktop's Markdown vault. Sending, stopping, reconnecting and revocation continue to work while the desktop is in the tray.
- The installed build also passes phone-shell cache migration, offline branding, and checks that private API responses never enter the service-worker cache.
- Model selectors resolve empty preferences to concrete model IDs and supported reasoning levels, persist the choices, and retain saved selections when catalogs change or become unavailable. Unsupported reasoning controls show a descriptive status instead of a disabled default option.
- 66 Rust tests pass. Formatting and Clippy pass with warnings treated as errors.
- The 0.4.0 NSIS installer was built and installed. Native checks passed again against the installed executable, including actual Windows Notification Center delivery, COM click activation, close-to-tray lifetime, process cleanup, all three CLI fixtures, and memory reuse recovery after failures.

## Android package

- 13 Android unit tests pass, including address validation, origin isolation, pairing intent handling, connection recovery and reclaimed-renderer handling.
- Release lint and the signed release build pass. APK signature verification passes.
- The signed APK updates the existing Pixel 7 Pro installation to version 0.4.0, version code 5, without changing the package identity or signing key.
- Physical checks on the unlocked Pixel 7 Pro passed with the signed release APK and installed Windows app. USB connection and reconnection preserve the existing pairing and remote-access preference.
- Creating, saving, archiving, restoring and deleting a project memory note on the Pixel update the actual desktop vault. The note editor and message composer remain usable with the Android keyboard open. The available-model menu displays correctly.
- An unsent draft survives an Android force-stop and cold launch. Removing the USB route shows the native disconnected screen; reconnecting from the desktop restores access without re-pairing and retains the draft.
- The Pixel reconnects after a cold launch while the desktop window is closed to the tray. Temporary notes and drafts were removed and the normal workspace restored after testing.

## Limits

Memory is a notes system, not full chat restoration. Desktop transcripts/tabs still do not survive explicit Quit or Windows restart. Phone drafts cannot restore an ended desktop session.

Retrieval uses local keyword matching, not semantic embeddings. The app caps the memory it adds, not the provider's entire context or billed tokens. Providers decide whether to follow the optional suggestion format. Terminal sessions do not receive automatic memory augmentation.

CLI protocol fixtures verify app integration without making paid agent calls. They do not prove the quality of any provider's proposed memories. Antigravity's real Google account still needs the user's sign-in; fixture success does not claim that account is connected.
