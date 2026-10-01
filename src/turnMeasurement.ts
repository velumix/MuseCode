import { tokenRate, type TurnUsage } from './usage';
import type { Provider } from './providers';

export interface HostMeasurement {
  run_id: string; provider: Provider; started_at_ms: number; elapsed_ms: number;
  first_event_ms: number | null; first_output_ms: number | null; finished: boolean;
  counters: TurnUsage | null; counter_source: string; host_clock: string; tokenizer: string;
  mcp_initialized: boolean; tool_calls: number; tool_errors: number;
  tokens_per_second?: number | null;
}

// performance.now supplies an independent monotonic client clock. Start at
// the authoritative turn_start, not the optimistic Send click or history replay.
export class ClientMeasurement {
  private started: number | null = null;
  private elapsed: number | null = null;
  private runId: string | null = null;
  private last: HostMeasurement | null = null;
  start(replayed = false, now = performance.now()) {
    this.started = replayed ? null : now; this.elapsed = null; this.runId = null; this.last = null;
  }
  observe(value: HostMeasurement) {
    if (!value || typeof value.run_id !== 'string' || !Number.isSafeInteger(value.elapsed_ms) || value.elapsed_ms < 0) return;
    this.last = value; this.runId = value.run_id;
  }
  finish(now = performance.now()) {
    if (this.started !== null) this.elapsed = Math.max(0, Math.round(now - this.started));
  }
  reset() { this.started = null; this.elapsed = null; this.runId = null; this.last = null; }
  report(host: HostMeasurement | null | undefined, now = performance.now()) {
    const value = host ?? this.last;
    const sameRun = !!value && value.run_id === this.runId;
    const measured = this.started === null || !sameRun ? null : this.elapsed ?? Math.max(0, Math.round(now - this.started));
    return {
      run_id: sameRun ? this.runId : null,
      elapsed_ms: measured,
      clock: 'Browser performance.now; received turn_start through received turn_end',
      complete: measured !== null && this.elapsed !== null && !!value?.finished,
      output_tokens: value?.counters?.output_tokens ?? null,
      displayed_tokens_per_second: tokenRate(value?.counters, value?.elapsed_ms),
      client_tokens_per_second: measured === null ? null : tokenRate(value?.counters, measured),
      host_minus_client_ms: measured === null || !value ? null : value.elapsed_ms - measured,
      comparison: measured === null ? 'Unavailable: this client did not observe the full start, or the run changed. Replayed/reconnected history is never timed as new work.' : 'Client and host clocks cover different delivery boundaries. UI delivery and browser teardown can add latency. Both rates use the same provider-reported output count; no independent tokenizer is asserted.',
    };
  }
}
