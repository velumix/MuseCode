import { useEffect, useId, useRef, useState } from "react";
import { providerNames, type Provider } from "../providers";
import { compactCount, tokenRate, type UsageSnapshot } from "../usage";
import Icon from "./Icon";
import "./UsageStrip.css";

interface Props {
  usage: UsageSnapshot;
  memory: { titles: string[]; bytes: number } | null;
  provider: Provider;
  running: boolean;
  elapsed: number | null;
  active: boolean;
}

function duration(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}

function tokens(value: number | null | undefined): string {
  return value == null ? "Not reported" : value.toLocaleString();
}

export default function UsageStrip({ usage, memory, provider, running, elapsed, active }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const details = useRef<HTMLDivElement>(null);
  const context = usage.context;
  const turn = usage.turn;
  const percent = context?.window_tokens ? context.used_tokens / context.window_tokens * 100 : null;
  const filled = percent == null ? 0 : Math.min(100, Math.max(0, percent));
  const estimated = context?.estimated === true;
  const contextLabel = percent == null
    ? context ? estimated ? `~${compactCount(context.used_tokens)} tokens est.` : `${compactCount(context.used_tokens)} tokens` : "—"
    : percent > 100 ? ">100%" : percent > 99 && percent < 100 ? ">99%" : percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`;
  const elapsedMs = running ? elapsed ?? turn?.elapsed_ms : turn?.elapsed_ms;
  const rate = tokenRate(turn, elapsedMs);
  const speed = rate == null ? "—" : rate.toLocaleString(undefined, { maximumFractionDigits: 1 });
  const memoryTokens = memory && memory.bytes > 0 ? Math.ceil(memory.bytes / 4) : null;
  const close = () => { setOpen(false); trigger.current?.focus(); };

  useEffect(() => { if (!active) setOpen(false); }, [active]);
  useEffect(() => {
    if (!open) return;
    details.current?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  return <div className="usage-strip" ref={root} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }}>
    <button ref={trigger} type="button" className="usage-summary" aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog"
      aria-label={`Context and usage: ${percent == null ? (estimated ? `estimated ${contextLabel} context used, provider reports no capacity` : "context capacity unavailable") : `${contextLabel} context used`}, ${rate == null ? "token speed unavailable" : `${speed} tokens per second average`}`}
      title="Context, token speed, and memory details" onClick={() => setOpen(value => !value)}>
      <span className={`usage-context${percent == null ? " unknown" : percent >= 95 ? " critical" : percent >= 80 ? " warning" : ""}`}>
        <svg className="context-ring" width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
          <circle className="context-ring-track" cx="10" cy="10" r="7.5" />
          {percent !== null && <circle className="context-ring-fill" cx="10" cy="10" r="7.5" pathLength="100" strokeDasharray={`${filled} 100`} transform="rotate(-90 10 10)" />}
        </svg>
        <span>Context <strong>{contextLabel}</strong></span>
      </span>
      <span className="usage-divider" aria-hidden="true">·</span>
      <span className="usage-speed"><strong>{speed}</strong> tok/s{rate !== null && <span className="usage-qualifier"> avg</span>}</span>
      {elapsedMs != null && <><span className="usage-divider" aria-hidden="true">·</span><span className="usage-time">{duration(elapsedMs)}{running ? " elapsed" : ""}</span></>}
      <span className="usage-memory">{memoryTokens !== null && <><Icon name="memory" size={13} /><span>Memory ~{compactCount(memoryTokens)} tok</span></>}</span>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" className={open ? "usage-chevron open" : "usage-chevron"} aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg>
    </button>
    {open && active && <div id={id} ref={details} className="usage-details" role="dialog" aria-label="Context and usage" tabIndex={-1}>
      <header><strong>Context & usage</strong><button type="button" onClick={close} aria-label="Close usage details"><Icon name="close" size={14} /></button></header>
      <section className="usage-context-detail">
        <div><span>Context window</span><strong>{context ? `${estimated ? "~" : ""}${tokens(context.used_tokens)} / ${context.window_tokens ? tokens(context.window_tokens) : "unknown"}` : "Not reported"}</strong></div>
        <div className={`usage-meter${percent == null ? " unknown" : percent >= 95 ? " critical" : percent >= 80 ? " warning" : ""}`} aria-hidden="true"><span style={{ width: `${filled}%` }} /></div>
        {context?.window_tokens && <p>{Math.max(0, 100 - percent!).toLocaleString(undefined, { maximumFractionDigits: 1 })}% available · {tokens(Math.max(0, context.window_tokens - context.used_tokens))} tokens remaining</p>}
        <p>{context ? estimated ? `Estimated from the largest input size the provider reported this turn · ${new Date(context.measured_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. No capacity figure is reported, so no percentage is shown. Your unsent draft is not included.` : `Latest provider snapshot · ${new Date(context.measured_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Your unsent draft is not included.` : `${providerNames[provider]} has not reported a context snapshot for this conversation.`}</p>
      </section>
      <section>
        <div className="usage-section-title">{running ? "Current turn" : "Last turn"}<span>{rate == null ? "Speed not reported" : `${speed} tok/s average`}</span></div>
        <dl>
          <div><dt>Input tokens</dt><dd>{tokens(turn?.input_tokens)}</dd></div>
          <div><dt>Cached input</dt><dd>{tokens(turn?.cached_input_tokens)}</dd></div>
          <div><dt>Output tokens</dt><dd>{tokens(turn?.output_tokens)}</dd></div>
          <div><dt>Reasoning tokens</dt><dd>{tokens(turn?.reasoning_output_tokens)}</dd></div>
          <div><dt>Turn duration</dt><dd>{elapsedMs == null ? running ? "Not reported" : "Not started" : duration(elapsedMs)}</dd></div>
        </dl>
        <p>{rate == null ? "Speed appears when the provider reports output-token counts. " : ""}Average speed includes thinking and tool time. Counts follow the provider’s accounting; cached and reasoning tokens are shown separately without adding them again.</p>
      </section>
      {memory && memory.bytes > 0 && <section>
        <div className="usage-section-title">Memory added<span>~{tokens(memoryTokens)} tokens</span></div>
        <p>{memory.bytes.toLocaleString()} bytes · {memory.titles.length ? `${memory.titles.length} note${memory.titles.length === 1 ? "" : "s"} recalled` : "Learning instructions"}. Memory tokens are an estimate, separate from provider counters.</p>
        {memory.titles.length > 0 && <ul>{memory.titles.map((title, index) => <li key={index}>{title}</li>)}</ul>}
      </section>}
    </div>}
  </div>;
}
