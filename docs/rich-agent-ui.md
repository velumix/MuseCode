# Rich agent UI — design (v1)

Flagship: replace the raw TUI-in-a-terminal with a native chat + activity UI
driven by structured `muse` CLI output. Chosen 2026-09-25 ("rich agent UI,
one big bet").

## What the probes proved (CLI 1.4.0, 2026-09-25)

- `muse serve` (MSP over stdio): `initialize` / `session/start` / `turn/start`
  work, and command methods + `session/started` broadcasts flow. But the view
  fold never emits (cursor stays `pending:...`; `view/subscribe`, `view/page`,
  `session/read` are all `methodNotFound` on this binary — the published
  schema is ahead of it). Turns run, but no `turn/*` / `item/*` notifications
  arrive. Verdict: serve is the **future control plane** (interactive
  approvals via `approval/request` + `approval/decide`), not a transcript
  source today.
- `muse exec --json`: streams the session event log as JSONL on stdout.
  Verified end to end: multi-turn continuity via `--session-id` (appends to
  the same `session.jsonl`, emits `session.resumed`), echo provider,
  `run.output.delta` streaming text, `run.terminal.*` turn end,
  `task.lifecycle.*` tool lifecycle. Verdict: **v1 data plane**.
- Hybrid (serve for control + tail the session log for transcript) is
  deferred: `approval/request` delivery is unverifiable without a
  tool-calling provider in this environment.

## v1 scope

- Chat-first tab: user/assistant messages, streaming assistant text, tool
  cards (name, status, output preview, expandable), todo list, turn status.
- Approvals and `request_user_input` prompts surface **read-only** (headless
  exec auto-resolves per policy; the cards say so and point at YOLO/the
  terminal). Interactive approval buttons need serve; tracked as the v2
  follow-up once the binary's views work.
- The PTY terminal stays as a per-tab fallback (`Agent | Terminal` toggle).

## Backend (`src-tauri/src/`)

- `runner.rs` — owns one `muse exec` child per tab:
  - `agent_new(id, workspace?)` mints a muse session UUID, binds the tab's
    workspace (an explicit existing directory, else home), and registers
    the tab idle. A bad workspace leaves any existing session untouched.
  - `agent_send(id, prompt, yolo)` spawns
    `muse exec --json [--yolo] --session-id <sid> --workspace <tab-workspace> --prompt-file <tmp>`
    (prompt via file, never argv), streams stdout lines in a reader thread,
    folds each line to `AgentEvent`s, emits `agent-event { id, event }`.
    A missing terminal record is synthesized from the exit code so every
    turn closes and no child lingers. Terminal events are delivered after
    process exit and resetting the running flag, so the next send is accepted.
  - `agent_stop(id)` kills a running child (the exec equivalent of
    `turn/interrupt`); `agent_destroy` also runs on tab close.
  - Reuses `pty::resolve_muse` / `home_dir`. Rust's `Command` handles batch
    file quoting for headless turns; ConPTY launches batch files through a
    PowerShell environment-variable reference. Both handle spaces and `&`
    in the executable/workspace paths. `.ps1` uses PowerShell `-File`.
  - Each turn owns a temporary prompt file, cleaned up on completion,
    failed spawn, Stop, or application shutdown. Session reader ownership
    prevents an old process from reaping or resetting a replacement.
- `events.rs` — tolerant fold of exec `--json` lines (`serde_json::Value`)
  into `AgentEvent` (`#[serde(tag = "kind")]`):
  - `turn.input.user` → user message; `run.output.delta` → text delta;
    `run.terminal.*` → turn end; `task.lifecycle.status` → activity
    detail (backend message); non-tool `task.lifecycle.started` →
    activity label (model → Thinking, verify → Verifying);
    `task.lifecycle.proposed` → tool start (`task_kind: "tool.<name>"`);
    `side_effect_intent` → policy decision; `tool_delta` → tool output
    delta; `completed/failed/cancelled/rejected` → tool end;
    `tool.result` → tool result text; `todo.snapshot.updated` → todos;
    `approval.*` → approval notice; unknown types ignored.
  - Joins: `task_id` directly; `call_id` → task via the
    `tool:<call_id>` idempotency key. All fields optional; never fail a
    whole line on one missing field.

## Frontend (`src/`)

- `ChatView.tsx` — message list + tool cards + todos + workspace bar +
  composer; owns the `agent-event` subscription and the
  `agent_new/send/stop/destroy` invokes. Applying a workspace restarts the
  tab's session against the new directory after validation; invalid paths
  preserve the old transcript. Native IDs are unique per view generation,
  and teardown awaits pending initialization before destroying the session.
- Assistant text renders Markdown/GFM, fenced code with copy buttons, and
  tables. Web links open externally; local paths remain inert.
- `App.tsx` — per-tab `mode: "agent" | "terminal"` with a toggle; closing a
  tab kills both its PTY and its agent session. Switching modes retains both
  views; terminal is lazy-loaded on first use and uses the selected workspace.
  Agent and terminal conversations remain independent.

## Verify

```sh
cargo test --lib   # from src-tauri/ (fold unit tests use real captured lines)
npm run build      # tsc + vite
```
