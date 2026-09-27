# Velum Code 0.6.0 verification

Scope: task prerequisites, due dates, Needs attention, recoverable Trash, bot
presets, and profile duplication on desktop and paired phones.

## Automated checks

- Production TypeScript/Vite build and 66 browser tests passed, including
  desktop/phone accessibility, blocked controls, Trash restoration and permanent
  deletion, preserved drafts, view-only access, and separate duplicate memory.
- 95 Rust tests passed; the existing live GitHub download test remains explicitly
  ignored offline. New cases cover legacy boards, invalid dates, dependency cycles,
  deleted prerequisites, revision conflicts, bounded Trash retention, restoration
  with automatic work off, and schedule state transitions that preserve pauses.
- Rust formatting and Clippy with warnings denied passed. The plugin SDK test
  passed; no plugin API or dependency changes were needed.
- Android's 16 unit tests and release lint passed. The release APK is minimized
  with R8 and its signature verified. Version 0.6.0 uses Android version code 8.

## Native execution checks

`scripts/bots-smoke.mjs --release` passed against the packaged Windows executable
and isolated local CLI fixtures:

- Blocked Run now calls do not launch a provider, and interactive bot actions
  cannot advance blocked cards. Done unlocks the dependent job.
- Due dates and prerequisite IDs reach the bot's board context. Deleted
  prerequisites remain blocking; restoration resolves them.
- A prerequisite changed during a short run cannot advance the card through the
  successful-run fallback. The job pauses for review.
- Three eligible automatic jobs run by due date, then priority, after a full
  restart. Completed jobs are not replayed.
- Existing Muse/Codex/Antigravity handoffs, isolated memory, cancellation, stale
  board protection, and bounded background history still pass.

`scripts/remote-smoke.mjs --release --usb-fixture` also passed against the native
HTTP server: shared Kanban and memory, bot creation, scheduling controls, phone
draft recovery, USB reconnect, view-only restrictions, and immediate revocation.

## Installed desktop and physical phone

The signed APK was installed on a Pixel 7 Pro over USB. Its native date picker,
task editor, Needs attention, Trash, and bot presets were checked on-device.
Android's narrower date control exposed an alignment issue; the date and assigned
bot fields now use the editor width. Draft checks were discarded without creating
tasks or bots in the user's profile.

The Windows installer upgraded the app to 0.6.0. The saved conversation recovered
with the same tab and messages, USB reconnected with the existing paired device,
and the remote-access preference was preserved.

## Performance and storage

Boards and bot panels remain loaded on demand. No dependency, database, service,
or recurring network request was added. Scheduler checks retain the existing
five-second interval; startup reconciliation touches only workspaces with saved
jobs. Opening the board never calls a model provider.

Limits remain 300 active cards per board, 500 jobs, 32 profiles, and 100 recent
runs. Each card permits 20 prerequisites. Trash adds at most 50 cards and keeps
entries for up to 30 days, within the same 4 MB board limit. Expired entries are
omitted on load and removed from disk at the next board save.

## Practical limits

Due dates are calendar targets. They order eligible work and flag overdue cards;
they do not wake Windows, change cron times, or send deadline reminders. Review
does not satisfy a prerequisite; Done does. Human status changes are still
available. Deleting a prerequisite keeps dependent work blocked until the task
is restored or the dependency is explicitly removed.

Restoring a task does not restore its previous running process. Automatic work
is off on the restored assignment. Duplicates retain shared-memory preferences
but receive a new identity and an empty private vault.

The native checks use deterministic local CLI fixtures, not paid model calls.
The phone relies on the desktop being open or running in its tray. See the
[Kanban guide](kanban.md) and [bots guide](bots.md) for behavior and limits.
