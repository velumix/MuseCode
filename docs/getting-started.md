# Getting started

[Documentation](README.md)

## 1. Install and connect a provider

Velum Code is a Windows x64 desktop app. Download a successful build as described
in the [project README](../README.md#get-velumcode), extract the artifact and run
the installer. Development artifacts are unsigned. The desktop installer sets
up the native notification identity; running an arbitrary copied executable is
not the same installation.

Install and sign in to at least one supported CLI: `muse`, `codex` or `agy`.
Choose it through the app's assistant/provider controls. The CLI's account,
models, limits and charges apply. Antigravity's dedicated sign-in flow forwards
your one-time code to its CLI; do not paste sign-in codes into a conversation.

Read the [legal status](../LEGAL.md) and [privacy notice draft](../PRIVACY.md),
especially the sections on provider processing and local storage.

## 2. Choose a project

Use the project folder picker and select the folder the agent should work in.
Check the access result before giving a file task. Keep a backup or a clean Git
checkpoint for work you care about. Standard permissions vary by provider;
YOLO can bypass approvals and sandbox protections.

Start with one concrete request: what you want to make, the intended audience,
and any constraints. The starters are editable drafts. Sending a prompt gives
the selected CLI the prompt and available context; project files read by its
tools can also be sent to that provider.

## 3. Work with the conversation

The assistant control exposes provider, model and reasoning choices. Settings
(`Ctrl+,`) changes themes, glass, layout, text and workflow preferences. The
default send shortcut is Enter; Shift+Enter inserts a line break.

| Action | What happens |
| --- | --- |
| Send while the agent is working | Your message joins the queue and can run after the current turn finishes |
| Edit/remove/pause the queue | Changes pending work before it runs |
| Stop a turn | Interrupts active work and preserves pending messages for review |
| Recover after a failure or restart | Interrupted work is stopped and the queue needs review/resume |
| Correct a response | Prepares a follow-up; optionally save a reviewed lesson for future project context |
| Switch Agent/Terminal | Keeps separate conversations; the terminal can handle interactive CLI prompts |

Review changed files and output. A saved lesson can help future turns but cannot
guarantee that an agent will follow it. See the [conversation guide](conversation-experience.md)
and [memory guide](memory.md) for the full behavior.

## 4. Understand the tray

Closing the window or pressing Alt+F4 hides Velum to the tray. Running work and
enabled schedules can continue. Choose **Quit Velum Code** from the tray or
command palette to exit and stop background processes. Open Agent tabs and
bounded recent history recover after reopening; terminal processes and
scrollback are not restored.

## 5. Add optional tools when you need them

- [Pair a phone](remote-access.md), choosing view-only or control access.
- [Create a bot](bots.md) and review its instructions and scheduling mode.
- [Plan tasks](kanban.md) before assigning automated work.
- [Install a plugin](plugins.md) after checking its source and permissions.

Keep the first workflow small. You can add these features as a task calls for
them. For errors, see [troubleshooting](support.md); for removal or privacy
choices, see [data controls](data-controls.md).
