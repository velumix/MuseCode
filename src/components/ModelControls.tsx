import { useEffect, useRef, useState } from "react";
import { type ModelCatalog, type Provider, type RunOptions } from "../providers";
import ChoiceMenu from "./ChoiceMenu";
import Icon from "./Icon";
import "./ModelControls.css";
const effortLabels: Record<string, string> = { none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Maximum", ultra: "Ultra" };
const effortDescriptions: Record<string, string> = { none: "No extra reasoning", minimal: "Lightest reasoning", low: "Quicker responses for straightforward work", medium: "A balance of speed and depth", high: "More thought for complex work", xhigh: "Deeper reasoning; takes longer", max: "Maximum depth for demanding tasks", ultra: "The provider's highest reasoning setting" };
export default function ModelControls({ provider, options, onChange, load, disabled, refreshKey = 0 }: { provider: Provider; options: RunOptions; onChange: (options: RunOptions) => Promise<void>; load: (provider: Provider, refresh: boolean) => Promise<ModelCatalog>; disabled?: boolean; refreshKey?: number }) {
  const [catalog, setCatalog] = useState<ModelCatalog>({ models: [], notice: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [custom, setCustom] = useState(false);
  const [modelId, setModelId] = useState("");
  const [refresh, setRefresh] = useState(0);
  const loader = useRef(load); loader.current = load;
  const generation = useRef(0);
  useEffect(() => {
    let disposed = false; generation.current++;
    setLoading(true); setError(""); setCustom(false); setBusy(false); setCatalog({ models: [], notice: null });
    void loader.current(provider, refresh > 0 || refreshKey > 0).then((result) => { if (!disposed) setCatalog(result && Array.isArray(result.models) ? result : { models: [], notice: "This CLI did not return a model catalog." }); }).catch(() => { if (!disposed) setError("Could not load models. Check the CLI and refresh."); }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [provider, refresh, refreshKey]);
  const model = catalog.models.find((item) => item.id === options.model);
  const apply = async (next: RunOptions) => {
    if (busy || disabled) return;
    const current = generation.current;
    setBusy(true); setError("");
    try { await onChange(next); if (current === generation.current) setCustom(false); }
    catch (e) { if (current === generation.current) setError(String(e)); }
    finally { if (current === generation.current) setBusy(false); }
  };
  const choices = [{ id: "", label: "CLI default", description: "Use your provider's configured model" }, ...catalog.models.map((m) => ({ id: m.id, label: m.label, description: m.description || m.id }))];
  if (options.model && !model) choices.push({ id: options.model, label: options.model, description: "Saved model ID · not in the current catalog" });
  choices.push({ id: "__custom", label: "Enter model ID…", description: "Use a model or alias you have configured" });
  const efforts = [{ id: "", label: "Default", description: model?.default_effort ? `Model default: ${effortLabels[model.default_effort] || model.default_effort}` : "Let the provider decide" }, ...(model?.efforts || []).map((id) => ({ id, label: effortLabels[id] || id, description: effortDescriptions[id] }))];
  // Keep a saved value visible if a catalog is temporarily unavailable.
  if (options.reasoning && !efforts.some((e) => e.id === options.reasoning)) efforts.push({ id: options.reasoning, label: effortLabels[options.reasoning] || options.reasoning, description: "Saved preference · refresh to check availability" });
  return <div className="model-controls" aria-busy={loading || busy}>
    <div className="model-selectors">
      <ChoiceMenu label="Model" choices={choices} value={options.model} disabled={disabled || busy} onChange={(id) => {
        if (id === "__custom") { setModelId(options.model); setCustom(true); return; }
        const next = catalog.models.find((m) => m.id === id);
        void apply({ model: id, reasoning: next?.efforts.includes(options.reasoning) ? options.reasoning : "" });
      }} />
      <ChoiceMenu label="Reasoning" choices={efforts} value={options.reasoning} disabled={disabled || busy || (efforts.length <= 1 && !options.reasoning)} onChange={(reasoning) => void apply({ ...options, reasoning })} />
      <button type="button" className="models-refresh" aria-label="Refresh available models" title="Refresh available models" disabled={loading || busy} onClick={() => setRefresh((n) => n + 1)}><Icon name="reset" size={14} /></button>
    </div>
    {custom && <form className="custom-model" onSubmit={(e) => { e.preventDefault(); void apply({ model: modelId.trim(), reasoning: "" }); }}><input aria-label="Custom model ID" autoFocus value={modelId} maxLength={200} placeholder="provider/model-id" onChange={(e) => setModelId(e.target.value)} /><button disabled={busy || disabled || !modelId.trim()}>Apply model</button><button type="button" onClick={() => setCustom(false)}>Cancel</button></form>}
    {(error || catalog.notice || loading) && <p className={`model-note${error ? " error" : ""}`} role={error ? "alert" : "status"}>{error || (loading ? "Loading available models…" : catalog.notice)}</p>}
  </div>;
}
