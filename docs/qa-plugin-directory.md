# Plugin directory verification

Checked on Windows 11 with WebView2 and the repository's pinned toolchain.

## Checks completed

- 54 browser tests pass, including Browse/search, permission review, commit-pinned installation requests, publishing links, offline fallback, refresh and accessibility.
- 78 offline Rust tests pass. The explicit network test also fetched the public directory and downloaded Project tools at its listed commit. That network test is ignored during ordinary CI.
- SDK generation and TypeScript checks pass. Generated READMEs explain direct installation and submitting to the directory.
- Production frontend build, Rust formatting, Clippy with warnings denied, and the Windows NSIS installer build pass.
- The installed Windows app passes the extension smoke check: native directory browsing, GitHub installation, real plugin worker execution, permission and file boundaries, draft handoff, Kanban persistence, session recovery and interrupted-turn recovery.
- The installed app passes the USB remote smoke check with a fixture ADB: pairing, phone controls, shared memory and Kanban, reconnect, stop and revocation. The existing physical Pixel connection and paired login were restored after the update.

The [directory repository](https://github.com/velumix/velum-code-plugins) has three Node tests covering validation, duplicate entries and approval authorization. Its GitHub checks and manually dispatched publishing workflow pass against the real Project tools repository. The issue-label approval path shares the tested authorization/parser code; no artificial public submission issue was posted for testing.

## Performance and publishing behavior

The plugin panel and directory are loaded on demand. Opening Browse fetches metadata only; the native backend caches it for one hour, provides explicit Refresh and retains the last good disk copy. An included starter catalog covers the first offline launch. There are no directory requests or plugin execution at startup.

Browse installs the exact listed commit. A direct repository installation or Check for updates reviews the repository's current default-branch commit. Installing always uses the bytes from the reviewed package. The directory is limited to 500 plugins and 1 MB, and downloads have bounded sizes and timeouts.

Publish your plugin checks the repository and opens GitHub with its repository and full commit filled in. The author signs in and submits there. A directory maintainer reviews the exact commit and applies approved; GitHub Actions validates the files, generates the catalog and records the result with published or needs-fix. Velum does not collect a GitHub token or automatically post on the author's behalf.

Plugin code is never executed by directory generation or publication checks. Listing is not a security audit; users still review the requested permissions before installation.
