export interface ContextUsage {
  used_tokens: number;
  window_tokens: number | null;
  measured_at: number;
}

export interface TurnUsage {
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  reasoning_output_tokens: number | null;
  elapsed_ms: number | null;
}

export interface UsageSnapshot {
  context?: ContextUsage | null;
  turn?: TurnUsage | null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function mergeUsage(previous: UsageSnapshot, event: Record<string, unknown>): UsageSnapshot {
  const next = { ...previous };
  const context = record(event.context);
  const used = count(context?.used_tokens);
  const stamp = count(context?.measured_at);
  if (context && used !== null && stamp !== null) {
    const capacity = count(context.window_tokens);
    next.context = { used_tokens: used, window_tokens: capacity && capacity > 0 ? capacity : null, measured_at: stamp };
  }
  const turn = record(event.turn);
  if (turn) next.turn = {
    input_tokens: count(turn.input_tokens), cached_input_tokens: count(turn.cached_input_tokens),
    output_tokens: count(turn.output_tokens), reasoning_output_tokens: count(turn.reasoning_output_tokens), elapsed_ms: count(turn.elapsed_ms),
  };
  return next;
}

export function tokenRate(turn?: TurnUsage | null): number | null {
  return turn?.output_tokens != null && turn.elapsed_ms != null && turn.elapsed_ms > 0 ? turn.output_tokens * 1000 / turn.elapsed_ms : null;
}

export function compactCount(value: number): string {
  return Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
