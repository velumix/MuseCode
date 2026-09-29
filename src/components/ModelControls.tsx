import { useEffect, useRef, useState, type ReactNode } from "react";
import { resolveOptions, type ModelCatalog, type Provider, type RunOptions } from "../providers";
import ChoiceMenu from "./ChoiceMenu";
import Icon from "./Icon";
import "./ModelControls.css";
const effortLabels: Record<string, string> = { none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Maximum", ultra: "Ultra" };
const effortDescriptions: Record<string, string> = { none: "No extra reasoning", minimal: "Lightest reasoning", low: "Quicker responses for straightforward work", medium: "A balance of speed and depth", high: "More thought for complex work", xhigh: "Deeper reasoning; takes longer", max: "Maximum depth for demanding tasks", ultra: "The provider's highest reasoning setting" };
export default function ModelControls({ provider, options, onChange, load, disabled, refreshKey = 0, children, onRefresh, refreshLabel = "Refresh available models" }: { provider: Provider; options: RunOptions; onChange: (options: RunOptions) => Promise<void>; load: (provider: Provider, refresh: boolean) => Promise<ModelCatalog>; disabled?: boolean; refreshKey?: number; children?: ReactNode; onRefresh?: () => void; refreshLabel?: string }) {
  const [catalog, setCatalog] = useState<ModelCatalog>({ models: [], notice: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [custom, setCustom] = useState(false);
  const [modelId, setModelId] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loadedKey, setLoadedKey] = useState("");
  const [unresolved, setUnresolved] = useState(false);
  const loader = useRef(load); loader.current = load;
  const change = useRef(onChange); change.current = onChange;
  const generation = useRef(0);
  const inFlight = useRef(false);
  const attempted = useRef("");
  const loadKey = `${provider}:${refresh}:${refreshKey}`;
  useEffect(() => {
    let disposed = false; generation.current++;
    inFlight.current = false; attempted.current = "";
    setLoadedKey(""); setUnresolved(false); setLoading(true); setError(""); setCustom(false); setBusy(false); setCatalog({ models: [], notice: null });
    void loader.current(provider, refresh > 0 || refreshKey > 0).then((result) => { if (!disposed) setCatalog(result && Array.isArray(result.models) ? result : { models: [], notice: "This CLI did not return a model catalog." }); }).catch(() => { if (!disposed) setError("Could not load models. Check the CLI and refresh."); }).finally(() => { if (!disposed) { setLoading(false); setLoadedKey(loadKey); } });
    return () => { disposed = true; };
  }, [provider, refresh, refreshKey]);
  const ready = !loading && loadedKey === loadKey;
  const effective = ready ? resolveOptions(options, catalog) : options;
  const model = catalog.models.find((item) => item.id === effective.model);
  const apply = async (next: RunOptions, automatic = false) => {
    if (inFlight.current || disabled) return;
    const current = generation.current;
    inFlight.current = true; setBusy(true); setError("");
    try { await change.current(next); if (current === generation.current) { setCustom(false); setUnresolved(false); } }
    catch (e) { if (current === generation.current) { setError(String(e)); if (automatic) setUnresolved(true); } }
    finally { if (current === generation.current) { inFlight.current = false; setBusy(false); } }
  };
  // Resolve old empty preferences once the session is ready, and persist the
  // concrete values used by the desktop, phone and next CLI invocation.
  useEffect(() => {
    if (!ready || disabled || busy || !effective.model || (effective.model === options.model && effective.reasoning === options.reasoning)) return;
    const key = JSON.stringify([loadKey, options, effective]);
    if (attempted.current === key) return;
    attempted.current = key;
    void apply(effective, true);
  }, [ready, disabled, busy, loadKey, options.model, options.reasoning, effective.model, effective.reasoning]);
  const display = unresolved ? options : effective;
  const choices = catalog.models.map((m) => ({ id: m.id, label: m.label, description: m.description || m.id }));
  if (effective.model && !model) choices.push({ id: effective.model, label: effective.model, description: "Saved model ID · not in the current catalog" });
  choices.push({ id: "__custom", label: "Enter model ID…", description: "Use a model or alias you have configured" });
  const efforts = (model?.efforts || []).map((id) => ({ id, label: effortLabels[id] || id, description: effortDescriptions[id] }));
  // Keep a saved value visible if a catalog is temporarily unavailable.
  if (!model && display.reasoning) efforts.push({ id: display.reasoning, label: effortLabels[display.reasoning] || display.reasoning, description: "Saved preference · refresh to check availability" });
  const reasoningStatus = !ready ? "Loading…" : model ? "Not adjustable" : effective.model ? "Unavailable" : "Select a model";
  return <div className="model-controls" aria-busy={loading || busy}>
    <div className="model-selectors">
      <ChoiceMenu label="Model" choices={choices} value={display.model} placeholder={ready ? "Choose model…" : "Loading models…"} disabled={disabled || busy || !ready} onChange={(id) => {
        if (id === "__custom") { setModelId(effective.model); setCustom(true); return; }
        void apply(resolveOptions({ model: id, reasoning: effective.reasoning }, catalog));
      }} />
      {efforts.length ? <ChoiceMenu label="Reasoning" choices={efforts} value={display.reasoning} placeholder="Choose level…" disabled={disabled || busy || !ready} onChange={(reasoning) => void apply({ model: effective.model, reasoning })} /> :
        <div className="choice-field"><span className="choice-label">Reasoning</span><span className="choice-trigger choice-static" role="status" aria-label={`Reasoning: ${reasoningStatus}`} title={model ? "This model does not expose adjustable reasoning levels." : "Select an available model to see its reasoning levels."}>{reasoningStatus}</span></div>}
      {children}
      <button type="button" className="models-refresh" aria-label={refreshLabel} title={refreshLabel} disabled={loading || busy} onClick={() => { setRefresh((n) => n + 1); onRefresh?.(); }}><Icon name="reset" size={14} /></button>
    </div>
    {custom && <div className="custom-model"><input aria-label="Custom model ID" autoFocus value={modelId} maxLength={200} placeholder="provider/model-id" onChange={(e) => setModelId(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();if(modelId.trim())void apply(resolveOptions({model:modelId.trim(),reasoning:''},catalog));}}}/><button type="button" disabled={busy || disabled || !modelId.trim()} onClick={()=>void apply(resolveOptions({model:modelId.trim(),reasoning:''},catalog))}>Apply model</button><button type="button" onClick={() => setCustom(false)}>Cancel</button></div>}
    {(error || catalog.notice || loading) && <p className={`model-note${error ? " error" : ""}`} role={error ? "alert" : "status"}>{error || (loading ? "Loading available models…" : catalog.notice)}</p>}
  </div>;
}
