# Velum Code 0.5.0 verification

Scope: provider-independent bot profiles, private memory, Kanban assignments,
cron scheduling, handoffs, desktop controls, and the paired phone interface.

## Automated checks

- TypeScript compilation and production asset build.
- Browser suite covering desktop and phone, with accessibility checks. New cases
  cover profile/avatar/model persistence, custom model editing, stale profile saves,
  conversational handoff drafts, Kanban assignment, schedules, and view-only devices.
- Native Rust tests cover profile revision conflicts, separate private vaults,
  editable Markdown, streaming action fences, cron timezones/DST, crash recovery,
  preserved corrupt storage, failed checkpoints, HTTP permissions, and memory budgets.
- Rust formatting and Clippy with warnings denied.

## Native fixture verification

`scripts/bots-smoke.mjs` runs the actual Windows application and native IPC with
deterministic local CLI processes. It never contacts a model provider.

- One named bot receives the same identity and private context through Muse,
  Codex, and Antigravity. A different bot cannot recall its private notes.
- Pending memory proposals stay out of recall. The combined 1 KB budget retains
  useful shared/private excerpts, including learning/framing overhead.
- An assigned task moves from Muse to Codex to Antigravity, with fresh sessions,
  summaries, durable jobs, and Review stopping further work.
- Concurrent scheduled runs are rejected. A mid-turn board edit rejects stale
  actions and pauses the job. Removing an assignment cancels its old process.
- Successful work without an explicit action moves to Review. Profiles, memory,
  and schedules survive a full restart without replaying completed work.
- Background runs are removed from conversation recovery storage; Activity keeps
  the bounded run history instead.

`scripts/remote-smoke.mjs --usb-fixture` additionally checks the actual HTTP server,
pairing/approval, shared memory/Kanban, native bot creation, private bot notes,
cron previews, and phone-to-desktop bot conversation creation without a real phone.

## Practical limits

Provider behavior is verified through protocol fixtures, not paid live model calls.
The host validates structured requests, but a model must still follow the action
format. Personality instructions cannot guarantee identical prose across models.

The scheduler runs inside Velum while Windows is awake. It does not wake the PC or
run after Quit. Standard CLI permissions still apply. Automatic runs can use a
provider subscription; task and global pause controls remain available.

See [the bots guide](bots.md) for configured limits, missed-run behavior, private
memory boundaries, and handoff semantics. Existing Windows/Android CI workflows
run the platform checks and produce installable artifacts for every main push.
