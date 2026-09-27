# Kanban and GitHub plugins — verification

Checked on Windows 11 with WebView2 and the repository's pinned toolchain.

## Automated checks

- 51 browser tests: existing desktop and phone flows, Kanban CRUD/reorder/search, persistence, conflict recovery, unsaved-edit protection, agent draft handoff, accessibility, phone touch layout, read-only access and revocation, plus GitHub update review.
- 77 offline Rust tests: workspace board persistence/isolation, stale-write rejection, request validation, paired-phone authorization, GitHub URL validation, reviewed-byte installation, repository collision prevention, update settings, and legacy plugin migration, alongside existing checks.
- SDK generator and TypeScript checks pass. Generated projects include GitHub installation/publishing instructions and a `.gitignore`.
- Production frontend build, Rust formatting and Clippy with warnings denied pass.
- The explicitly run network test downloaded the public Project tools manifest and source at commit `90dd9ebc7c3d5d2b0f7bef44e4da45413fa75831`. It is ignored in ordinary CI so network availability does not make offline tests flaky.
- The Windows NSIS installer builds successfully.

## Runtime and performance

The board is a shared lazy chunk of approximately 7.7 KB JavaScript (2.7 KB gzip) plus 5.5 KB CSS (1.7 KB gzip). Opening a board loads only that workspace's saved file. Board writes run off the UI thread and replace the previous file atomically. No board data is scanned at startup.

GitHub requests happen only on Review or Check for updates. The host downloads two bounded text files from one commit; it never clones, extracts archives, runs build scripts or grants plugins network access. Only the latest reviewed package is retained, and its cached source is released after installation. Plugin workers still terminate after completion, cancellation or the five-second timeout.

The installed-app checks are available as:

```sh
node scripts/extensions-smoke.mjs --installed
node scripts/remote-smoke.mjs --installed --usb-fixture
```

Quit the normal app first. These checks use isolated settings and CLI fixtures, cover actual WebView2 plugin execution, native board persistence across a restart, and shared phone/desktop board edits. The extension check requires GitHub access. They do not make paid model requests.

## Deliberate limits

GitHub public repositories and the default branch are supported. Updates require review; there is no automatic polling or private-repository token field. Existing folder plugins need repository migration before enabling.

Boards are limited to 300 cards per workspace. Refresh picks up edits from another screen. Work on this prepares a draft; card status changes are explicit, and agent completion is not automatically inferred. The Android companion gets the board from the running desktop, so this feature does not require a new APK binary.
