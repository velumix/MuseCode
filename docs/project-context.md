# Project context and diagnostics

Choose a project with the folder button beneath the desktop composer, then **Apply**. Velum checks that its host process can list the folder before changing the conversation workspace. An unreadable folder leaves the current conversation and draft intact. Applying a different project starts a new provider session in that tab.

Open **Project context and diagnostics** beside Send, or **Project context & diagnostics** on your phone. The report separates the Velum host process from the active provider session. Each operation has a pass, fail, blocked or untested status, path, timestamp, execution environment and sanitized error detail. A host pass never establishes agent access.

**Test host access** checks listing, a known fixture read, exclusive file creation, editing, read-back and cleanup through the host filesystem API. **Test agent access** runs a real turn through the active provider session and its current permission mode. It uses a uniquely named temporary directory in the selected project and touches no existing user files. Listing and reads use separate PowerShell calls; Codex creation, editing and deletion use `apply_patch`. An assistant's summary and a zero process exit code cannot establish a pass. PowerShell error records override apparent command success.

The host seeds a known read fixture, and removes its own fixtures after the turn, including failed or cancelled turns. Host cleanup is reported separately from agent cleanup. An operation without tool evidence stays untested, including unsupported provider result formats. A failure lists a safe error category/code; raw output is excluded. Unexpected files inside a probe directory are left in place, and cleanup failure is reported. Phone diagnostics view the active session's evidence and never start write probes.

Changing Standard/YOLO invalidates cached checks and starts a fresh provider conversation on the next turn. A notice explains that the visible transcript remains while previous provider context is not replayed. Mode changes are disabled during a running turn. Recovery persists the last launched mode; older sessions with unknown modes start fresh. Standard Codex turns explicitly select the project and request `workspace-write` with only that project as the added writable root. Effective restrictions, when available, come from that active Codex thread's permission metadata; launch flags are labelled separately. Velum does not change Windows ACLs, global provider configuration or permission rules.

## What the agent receives

Every request carries a reference block capped at 16 KB with the Velum version, host OS, workspace path, Git root and branch when available, provider, model, reasoning, permission mode and request source (desktop, phone or scheduler). It includes separate host and active-agent check results with their permission revision. Without agent evidence, agent operations are explicitly untested. Exceptionally long fields are omitted with an explanation instead of supplying an incomplete path. No process is launched to inspect Git, and repository remotes and credentials are not read.

The reference block describes available context; it does not add tools or grant permissions. Installed does not mean signed in. Connection health and UI/document discovery are explicitly **untested** unless actual evidence exists. Velum has no live UI/document discovery implementation; it does not assert an attached session count. Filesystem checks do not verify authentication, external connectors or memory retrieval.

Two optional attachments are available:

- **Diagnostics:** a previewable JSON report with workspace paths replaced by placeholders, and without conversation text, credentials, raw logs, environment variables or memory contents. Copy it, or add it to the current draft.
- **Chat layout:** a structural snapshot captured when the panel opens, including viewport dimensions, selected provider/model, chat region bounds and overflow. It excludes message text, input values, other tabs and dialogs. It is not a screenshot or a live browser connection.

Adding an attachment never sends the message. Existing drafts are preserved. View-only phones may inspect and copy reports but cannot attach them to a message. Diagnostics run on demand; the panel loads only when opened.

Memory remains a separate Markdown vault. Search and inspect saved notes in **Memory**. Recalled titles and their byte cost appear below the conversation; successful saves produce a notice. Proposing a note alone does not prove that it was saved. Bot-private memory is managed in the bot's own Memory screen and is not counted in the shared/project report.

## Antigravity command permissions

Antigravity can return a successful process exit even when a tool was denied because headless mode could not ask for permission. Velum marks these turns **blocked**, preserves partial output, skips memory proposals and board actions, and immediately pauses scheduled work. Background notifications also report blocked turns.

On the desktop, open Terminal in an Antigravity tab and enter `/permissions` to review the command rule in `~/.gemini/antigravity-cli/settings.json`. Velum already launches the selected CLI in that tab. Allow the specific command needed, then retry the conversation or resume the paused job. Deny and ask rules take precedence over allow rules; plain command matching on Windows is exact. Velum does not silently enable YOLO or rewrite global permission settings.

See Google's [headless mode](https://antigravity.google/docs/cli/headless/) and [permission rules](https://antigravity.google/docs/permissions?tab=cli) documentation.
