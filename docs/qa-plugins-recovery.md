# Plugin and recovery checks

Validated on Windows with the installed 0.4.0 desktop bundle. These changes extend that version's model controls and memory vault.

## Automated checks

- **44 browser tests pass**, covering existing desktop and phone behavior, plugin installation, permission review, execution, draft handoff, disabling, accessibility, and reload recovery.
- **71 Rust tests pass**, including manifest validation, path confinement, file-size limits, disabled permissions, package digests, saved resume IDs, truncated history and interrupted turns. Oversized JSON-escaped text cannot replace a valid checkpoint.
- **SDK check passes**: the generator creates a runnable plugin, rejects invalid paths and refuses to overwrite an existing folder. A sample `definePlugin` command passes strict TypeScript checking.
- Production frontend build, Rust formatting and Clippy pass with warnings treated as errors.
- SDK package dry-run includes the generator, runtime helper, type definitions and README.

## Installed Windows verification

`node scripts/extensions-smoke.mjs --installed` passes against the actual installed executable, with isolated settings and deterministic CLI fixtures:

- Review/install the Project tools package, run it in WebView2, read the selected workspace and add its result to a draft without launching an agent.
- Reject a package changed after review and reject installed source modified after installation.
- Reject parent traversal, a Windows junction outside the workspace, undeclared storage access and calls to a disabled plugin.
- Keep storage separate between plugins; reject values over the storage budget; remove test plugins and their data.
- Quit and reopen with two providers. Restore tabs, draft text, transcripts and the active tab. Muse retains its session ID; Codex uses `exec resume` with its original thread ID.
- Force-kill the test app and its fixture children during a running turn. Restore the native draft checkpoint and show an interrupted-turn notice without restarting that work.
- Confirm no plugin manager or runtime code is loaded at startup after installation.

The existing installed native smoke suite also passes: model/effort arguments, workspace validation, streamed/final-only answers, memory suggestions and reuse, failures, process-tree Stop, ConPTY, mode switching, tray lifetime, provider login fixtures and explicit Quit cleanup.

The installed USB remote smoke suite passes: pairing, permissions, desktop approval, live background control, phone drafts, memory writes, reconnects, Stop, revocation and private-data cache protection. It uses a deterministic ADB fixture; it does not represent a new physical-phone test or require an APK update.

## Performance and isolation evidence

- The plugin manager and runtime are separate lazy chunks, approximately **8.7 KB** and **5.2 KB** before compression. No additional native JS engine, Node runtime or background plugin process is shipped.
- The example project brief finished in **110 ms** in the installed WebView2 test, including worker startup and a small native file read. This is an example measurement, not a general plugin benchmark.
- Installed app recovery became ready in approximately **0.6 seconds** on warm starts in this test. Cold startup and large histories will vary.
- An infinite-loop plugin times out while the main composer remains responsive. Browser checks confirm both iframe removal and worker termination after timeout and normal completion.
- Plugin attempts to use the network, IndexedDB, the DOM or native IPC fail. Missing permissions and oversized output are rejected by the host.
- Native recovery coalesces dirty snapshots once a second and flushes on normal exit. Draft updates send only the changed draft; transcript serialization does not run on the token-stream path.

## Scope and limits

Plugin API v1 provides local commands, workspace reads, conversation reads and private settings. It does not expose shell execution, network access, file writes, automatic model tools, provider adapters or arbitrary UI panels. Plugins currently run on desktop. Browser workers have no hard memory quota; only install code from authors you trust.

Recovery covers open Agent conversations, not terminal processes or a permanent archive of closed chats. Checkpoints contain local plaintext and are bounded; a crash can lose changes since the last completed checkpoint. Provider resume requires the CLI's own session files. Missing resume IDs are shown explicitly.

CLI fixtures verify the integration without making paid provider requests. They do not verify a live Antigravity Google account. See the [plugin SDK guide](plugins.md) for the public contract and limits.
