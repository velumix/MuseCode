import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { providerNames, type Provider } from "../providers";
import Icon from "./Icon";
import AntigravityLogin from "./AntigravityLogin";
interface Info { id: Provider; installed: boolean; setup_url: string }
export default function ProviderPicker({ value, onChange, failure }: { value: Provider; onChange: (provider: Provider) => void; failure?: string }) {
  const [providers, setProviders] = useState<Info[]>([]);
  const [error, setError] = useState("");
  const [signIn, setSignIn] = useState(false);
  useEffect(() => {
    if (value === "antigravity" && failure && /sign[ -]?in|not authenticated|unauthorized|auth.*(?:required|expired|failed)|token.*expired/i.test(failure)) setSignIn(true);
  }, [value, failure]);
  const refresh = () => invoke<Info[]>("provider_status").then((result) => { setProviders(Array.isArray(result) ? result : []); setError(""); }).catch((error) => setError(String(error)));
  useEffect(() => { void refresh(); }, []);
  const current = providers.find((item) => item.id === value);
  return <div className="provider-bar">
    <label htmlFor="provider-choice">AI provider</label>
    <select id="provider-choice" value={value} onChange={(event) => onChange(event.target.value as Provider)} title="Choosing a different provider opens a new conversation">
      {Object.entries(providerNames).map(([id, name]) => <option key={id} value={id}>{name}{id === "codex" ? " · ChatGPT" : ""}</option>)}
    </select>
    <span className="provider-note">{error || (current && !current.installed ? "CLI not installed" : "Switch provider to start a new conversation")}</span>
    {current && !current.installed && <button className="status-btn" onClick={() => void openUrl(current.setup_url).catch((error) => setError(String(error)))}>Setup</button>}
    {value === "antigravity" && current?.installed && <button className="status-btn" onClick={() => setSignIn(true)}>Sign in</button>}
    <button className="status-btn" aria-label="Refresh installed providers" onClick={() => void refresh()}><Icon name="reset" size={14} /></button>
    {signIn && <AntigravityLogin onClose={() => setSignIn(false)} />}
  </div>;
}
