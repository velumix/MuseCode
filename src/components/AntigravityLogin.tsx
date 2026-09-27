import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import Icon, { VelumMark } from "./Icon";
import "./AntigravityLogin.css";

interface Status { phase: "starting" | "code" | "verifying" | "complete" | "error"; url: string | null; message: string }
export default function AntigravityLogin({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const current = useRef("");
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<Status>({ phase: "starting", url: null, message: "Preparing Google sign-in…" });
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const id = crypto.randomUUID(); current.current = id;
    let disposed = false;
    let timer: number | undefined;
    setCode(""); setError(""); setBusy(false);
    setStatus({ phase: "starting", url: null, message: "Preparing Google sign-in…" });
    const starting = invoke("antigravity_login_start", { id });
    const poll = async () => {
      try {
        const result = await invoke<Status>("antigravity_login_status", { id });
        if (disposed) return;
        setStatus(result);
        if (result.phase === "complete" || result.phase === "error") { setCode(""); return; }
        timer = window.setTimeout(() => void poll(), 400);
      } catch {
        if (!disposed) setStatus({ phase: "error", url: null, message: "The sign-in session ended. Start again to get a fresh code." });
      }
    };
    void starting.then(() => { if (!disposed) void poll(); }).catch((e) => {
      if (!disposed) setStatus({ phase: "error", url: null, message: String(e) });
    });
    return () => {
      disposed = true; clearTimeout(timer);
      // Wait for a pending spawn so closing cannot leave an orphan login.
      void starting.catch(() => {}).then(() => invoke("antigravity_login_cancel", { id })).catch(() => {});
    };
  }, [attempt]);
  useEffect(() => { if (status.phase === "code") input.current?.focus(); }, [status.phase]);
  const submit = async () => {
    if (busy || status.phase !== "code" || !code.trim()) return;
    setBusy(true); setError("");
    const value = code.trim(); setCode("");
    try {
      await invoke("antigravity_login_submit", { id: current.current, code: value });
      setStatus({ phase: "verifying", url: null, message: "Checking your sign-in…" });
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="auth-dialog" aria-labelledby="auth-title" onCancel={onClose}>
    <button className="auth-close" aria-label="Close sign-in" onClick={onClose}><Icon name="close" /></button>
    <VelumMark size={48} />
    <span className="auth-eyebrow">YOUR PROVIDERS</span>
    <h2 id="auth-title">{status.phase === "complete" ? "You're connected." : "Connect Antigravity"}</h2>
    <p className="auth-description">{status.phase === "complete" ? "Your Google account is ready. Return to your conversation and send your message when you're ready." : "One Google sign-in. Your coding agent, right here in Velum Code."}</p>
    <div className={`auth-status ${status.phase}`} role={status.phase === "error" ? "alert" : "status"}>{status.message}</div>
    {status.phase === "code" && <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="auth-step"><span>1</span><div><h3>Sign in with Google</h3><p>Your browser will give you a one-time authorization code.</p>
        <button type="button" className="auth-browser" onClick={() => void openUrl(status.url!).catch(() => setError("Could not open your browser. Try again."))}>Open Google sign-in <Icon name="arrow" size={16} /></button></div></div>
      <div className="auth-step"><span>2</span><div><label htmlFor="auth-code">Paste your authorization code</label><input ref={input} id="auth-code" type="password" autoComplete="off" spellCheck={false} maxLength={4096} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code from your browser" aria-describedby="auth-code-help" />
        <p id="auth-code-help">Use the code from this sign-in attempt. Older codes won't work.</p></div></div>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="auth-primary" type="submit" disabled={busy || !code.trim()}>Connect account</button>
    </form>}
    {status.phase !== "code" && error && <p className="auth-error" role="alert">{error}</p>}
    {status.phase === "complete" ? <button className="auth-primary" onClick={onClose}>Back to conversation</button> : <div className="auth-actions"><button onClick={onClose}>Cancel</button>{status.phase !== "starting" && <button disabled={busy} onClick={() => setAttempt((n) => n + 1)}>Start again</button>}</div>}
    <p className="auth-footnote">Antigravity saves your account in its own secure credential store. Velum Code doesn't save your pasted code.</p>
  </dialog>;
}
