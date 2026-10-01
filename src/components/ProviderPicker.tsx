import { useEffect, useId, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { providerNames, type Provider, type RunOptions, type ModelCatalog } from "../providers";
import ModelControls from "./ModelControls";
import AntigravityLogin from "./AntigravityLogin";
import Icon from './Icon';
import './ConversationExperience.css';
interface Info { id: Provider; installed: boolean; setup_url: string }
export default function ProviderPicker({ value, onChange, failure, options, onOptionsChange, disabled, terminal, botPicker, actions, compact = true }: { value: Provider; onChange: (provider: Provider) => void; failure?: string; options: RunOptions; onOptionsChange: (options: RunOptions) => Promise<void>; disabled: boolean; terminal: boolean; botPicker?: ReactNode; actions?: ReactNode; compact?: boolean }) {
  const controlsId = useId();
  const [expanded, setExpanded] = useState(!compact);
  const [display, setDisplay] = useState({model:options.model,reasoning:options.reasoning});
  useEffect(()=>{setExpanded(!compact);},[compact]);
  const [providers, setProviders] = useState<Info[]>([]);
  const [error, setError] = useState("");
  const [signIn, setSignIn] = useState(false);
  const [modelsKey, setModelsKey] = useState(0);
  useEffect(() => {
    if (value === "antigravity" && failure && /sign[ -]?in|not authenticated|unauthorized|auth.*(?:required|expired|failed)|token.*expired/i.test(failure)) setSignIn(true);
  }, [value, failure]);
  const refresh = () => invoke<Info[]>("provider_status").then((result) => { setProviders(Array.isArray(result) ? result : []); setError(""); }).catch((error) => setError(String(error)));
  useEffect(() => { void refresh(); }, []);
  const current = providers.find((item) => item.id === value);
  useEffect(()=>{if (error || current?.installed === false) setExpanded(true);},[error,current?.installed]);
  return <div className={`assistant-controls${expanded ? ' expanded' : ''}`}>
    {compact && <button type="button" className="assistant-summary" aria-label="Assistant settings" aria-expanded={expanded} aria-controls={controlsId} onClick={()=>setExpanded(open=>!open)}><span className="assistant-summary-provider"><Icon name="chat" size={14}/>{providerNames[value]}</span><span className="assistant-summary-model">{display.model || 'Loading model…'}{display.reasoning && <span> · {display.reasoning}</span>}</span><span className="assistant-summary-action">{expanded ? 'Hide controls' : 'Customize'}<Icon name="down" size={12}/></span></button>}
    <div id={controlsId} hidden={!expanded} className={`provider-bar${botPicker ? " has-bot-picker" : ""}`}>
    <div className="provider-field">
      <label htmlFor="provider-choice">AI provider</label>
      <select id="provider-choice" value={value} onChange={(event) => onChange(event.target.value as Provider)} title="Choosing a different provider opens a new conversation">
        {Object.entries(providerNames).map(([id, name]) => <option key={id} value={id}>{name}{id === "codex" ? " · ChatGPT" : ""}</option>)}
      </select>
    </div>
    <ModelControls provider={value} options={options} onChange={onOptionsChange} disabled={disabled} refreshKey={modelsKey} load={(provider, refresh) => invoke<ModelCatalog>("provider_models", { provider, refresh })} onSummary={(model,reasoning)=>setDisplay(previous=>previous.model===model&&previous.reasoning===reasoning?previous:{model,reasoning})} onRefresh={() => void refresh()} refreshLabel="Refresh providers and models">
      {botPicker && <div className="provider-bot-field">{botPicker}</div>}
    </ModelControls>
    {(error || (current && !current.installed)) && <span className="provider-note">{error || "CLI not installed"}</span>}
    <div className="provider-actions">
      {current && !current.installed && <button className="status-btn" onClick={() => void openUrl(current.setup_url).catch((error) => setError(String(error)))}>Setup</button>}
      {value === "antigravity" && current?.installed && <button className="status-btn" onClick={() => setSignIn(true)}>Sign in</button>}
      {actions}
    </div>
    {terminal && <p className="provider-terminal-note">Terminal changes apply when you restart the session.</p>}
    </div>
    {signIn && <AntigravityLogin onClose={() => { setSignIn(false); setModelsKey((n) => n + 1); }} />}
  </div>;
}
