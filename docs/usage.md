# Context and usage

The desktop and phone status strips sit directly above the composer. The desktop uses the space previously occupied by memory usage. The strip keeps the context ring, percentage used, average token speed, turn duration, and memory estimate compact. Click anywhere on it for details; Escape closes the panel. The ring becomes amber at 80% and red at 95%. A dashed ring and a dash mean the provider has not reported capacity, rather than zero usage.

## What the numbers mean

- **Context** uses the active Codex thread's latest `last_token_usage.total_tokens` and `model_context_window`. This is the last reported model snapshot, including input and output, not lifetime billable tokens. The unsent draft is excluded. The details show the measurement time, counts, and remaining capacity. No model limits are hardcoded.
- **Token speed** is output tokens divided by elapsed provider-process time, including reasoning, tools, and startup. It is a whole-turn average, not instantaneous model decoding speed. It updates when the provider reports counters. Resumed Codex sessions subtract a baseline captured before the turn from cumulative counters; old turns cannot inflate the rate. A missing baseline or decreasing counter leaves the corresponding metric unavailable. Fresh Codex sessions can also use the completion event's counters.
- **Input, cached input, output, and reasoning** are provider counts. Cached input is included in input; reasoning is included in output. They are not added a second time.
- **Memory** shows actual bytes added by Velum this turn and a separately labelled rough estimate of one token per four bytes. It does not measure the conversation's full context. Details retain the names of recalled notes, without copying their contents into telemetry.

## Availability and lifetime

Codex context metadata is read only from the session UUID returned by the active CLI, respecting `CODEX_HOME`. Reads are bounded to the last 512 KiB and retain only numeric usage data and the measurement timestamp. While a turn runs, snapshots are checked once per second; only changed snapshots are published. The monitor is joined before turn completion and cannot publish to a replacement native session.

Muse and Antigravity currently expose elapsed time in this strip. Their token counters and context capacity remain unavailable until their stream adapters support a confirmed usage schema. A missing metric is never filled with an invented model limit or a text-length estimate.

Usage events are kept with conversation history for recovery. A fresh session, workspace change, model change, or permission change that replaces the provider conversation clears old counters. Starting another turn retains the last context snapshot and clears the prior turn's speed/counts. Provider-managed compaction may reduce the next reported context value.

The normalized events are `usage` (independent `context` and `turn` snapshots) and `usage_reset`. The phone renders the same counters from authenticated desktop replay, including resets and per-turn memory. On narrow screens memory details stay in the expandable panel. The phone shows measured provider elapsed time when available; it does not start a misleading timer when reconnecting midway through a turn.

The phone keeps workspace tools together, anchors its conversation menu below its trigger, and uses a side-by-side conversation/composer layout in landscape. With an extremely short keyboard viewport, it prioritizes the draft and Send/Stop; the other controls return when the keyboard closes.

Protocol reference: [Codex non-interactive JSON output](https://learn.chatgpt.com/docs/non-interactive-mode#make-output-machine-readable). Local Codex 0.157 metadata and generated protocol types distinguish `last`, `total`, and the context window; the adapter preserves those scopes.
