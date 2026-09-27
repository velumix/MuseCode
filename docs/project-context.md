# Project context and diagnostics

Choose a project with the folder button beneath the desktop composer, then **Apply**. Velum checks that Windows can list the folder before changing the conversation workspace. An unreadable folder leaves the current conversation and draft intact. Applying a different project starts a new provider session in that tab.

Open **Project context and diagnostics** beside Send, or **Project context & diagnostics** on your phone. The report shows when local checks ran, whether the folder can be listed, whether a Git repository was found, installed CLIs, shared/project memory health and failed or blocked session counts.

**Test file access** on desktop creates and removes an empty file with a random name in the selected folder. A read-only project remains usable for inspection. This check tests Windows filesystem access; it does not grant CLI tool permissions. Phone diagnostics never write probe files.

## What the agent receives

Every request carries a small reference block with the Velum version, host OS, workspace path, Git root and branch when available, provider, model, reasoning, permission mode and request source (desktop, phone or scheduler). A fresh directory-listing check is included. No process is launched to inspect Git, and repository remotes and credentials are not read.

The reference block describes available context; it does not add tools or grant permissions. Installed does not mean signed in. Authentication, MCP connections, browser attachments and native UI access are **not** verified by this check.

Two optional attachments are available:

- **Diagnostics:** a previewable JSON report without filesystem paths, conversation text, credentials, raw logs, environment variables or memory contents. Copy it, or add it to the current draft.
- **Chat layout:** a structural snapshot captured when the panel opens, including viewport dimensions, selected provider/model, chat region bounds and overflow. It excludes message text, input values, other tabs and dialogs. It is not a screenshot or a live browser connection.

Adding an attachment never sends the message. Existing drafts are preserved. View-only phones may inspect and copy reports but cannot attach them to a message. Diagnostics run on demand; the panel loads only when opened.

Memory remains a separate Markdown vault. Search and inspect saved notes in **Memory**. Recalled titles and their byte cost appear below the conversation; successful saves produce a notice. Proposing a note alone does not prove that it was saved. Bot-private memory is managed in the bot's own Memory screen and is not counted in the shared/project report.

## Antigravity command permissions

Antigravity can return a successful process exit even when a tool was denied because headless mode could not ask for permission. Velum marks these turns **blocked**, preserves partial output, skips memory proposals and board actions, and immediately pauses scheduled work. Background notifications also report blocked turns.

In the Terminal view, open `agy` and use `/permissions` to review the command rule in `~/.gemini/antigravity-cli/settings.json`. Allow the specific command needed, then retry the conversation or resume the paused job. Deny and ask rules take precedence over allow rules; plain command matching on Windows is exact. Velum does not silently enable YOLO or rewrite global permission settings.

See Google's [headless mode](https://antigravity.google/docs/cli/headless/) and [permission rules](https://antigravity.google/docs/permissions?tab=cli) documentation.
