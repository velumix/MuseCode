import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { providerNames } from "../providers";
import Icon, { VelumMark } from "../components/Icon";
import Markdown from "../components/Markdown";
import { transcript, type Replay, type Session } from "./transcript";

interface Device { id: string; name: string; control: boolean }
interface Pending { name: string; code: string; expires_at: number }
interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
const usb = location.origin === "http://127.0.0.1:43827";
class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: "same-origin", cache: "no-store",
    signal: AbortSignal.timeout(20_000),
    ...(body !== undefined ? { method: "POST", headers: { "Content-Type": "application/json", "X-Muse-Request": "1" }, body: JSON.stringify(body) } : {}),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(value.error || `Could not connect (${response.status}).`, response.status);
  return value as T;
}
function secret() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join(""); }
function storedClaim(): string { try { return sessionStorage.getItem("muse-pair-claim") || ""; } catch { return ""; } }
function saveClaim(value: string) { try { if (value) sessionStorage.setItem("muse-pair-claim", value); else sessionStorage.removeItem("muse-pair-claim"); } catch { /* Pairing still works without storage. */ } }
function mergeReplay(previous: Replay | undefined, next: Replay): Replay {
  const events = [...(!next.truncated ? previous?.events || [] : []), ...next.events].slice(-8000);
  let size = 0;
  let start = events.length;
  while (start > 0) { const length = JSON.stringify(events[start - 1]).length; if (size + length > 2 * 1024 * 1024) break; size += length; start--; }
  return { ...next, events: events.slice(start), truncated: next.truncated || !!previous?.truncated || start > 0 };
}

export default function RemoteApp() {
  const [invitation, setInvitation] = useState(() => new URLSearchParams(location.hash.slice(1)).get("pair") || "");
  const [claim, setClaim] = useState(storedClaim);
  const [pending, setPending] = useState<Pending | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [computer, setComputer] = useState("");
  const [name, setName] = useState("My phone");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState("");
  const [replay, setReplay] = useState<Replay | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [listOpen, setListOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [latest, setLatest] = useState(false);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [installHelp, setInstallHelp] = useState(false);
  const [signout, setSignout] = useState(false);
  const cache = useRef(new Map<string, Replay>());
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const input = drafts[selected] || "";
  const current = sessions.find((s) => s.id === selected);
  const view = useMemo(() => transcript(replay?.events || []), [replay]);

  const forget = () => { setDevice(null); setSessions([]); setReplay(null); cache.current.clear(); setConnected(false); setDrafts({}); saveClaim(""); setClaim(""); };

  useEffect(() => {
    if (location.hash) history.replaceState(null, "", location.pathname);
    let disposed = false;
    api<{ device: Device; computer: string }>("/me").then((value) => {
      if (!disposed) { setDevice(value.device); setInvitation(""); setComputer(value.computer || "Your desktop"); saveClaim(""); setClaim(""); }
    }).catch((e) => { if (!disposed && !(e instanceof ApiError && e.status === 401)) setError(usb ? "Check the USB cable and choose Reconnect in Connect phone on your desktop." : "Your desktop is unavailable. Connect Tailscale and make sure Velum Code is running."); })
      .finally(() => { if (!disposed) setLoading(false); });
    const installable = (event: Event) => { event.preventDefault(); setInstall(event as InstallEvent); };
    window.addEventListener("beforeinstallprompt", installable);
    return () => { disposed = true; window.removeEventListener("beforeinstallprompt", installable); };
  }, []);

  useEffect(() => {
    if (!claim || device) return;
    let disposed = false;
    let timer: number;
    const poll = async () => {
      try {
        const value = await api<{ status: string; device?: Device; pending?: Pending }>("/pair/finish", { claim });
        if (disposed) return;
        if (value.device) { setDevice(value.device); setInvitation(""); setPending(null); setClaim(""); saveClaim(""); setError(""); return; }
        if (value.pending) setPending(value.pending);
      } catch (e) {
        if (disposed) return;
        setError(String(e instanceof Error ? e.message : e));
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) { setPending(null); setClaim(""); saveClaim(""); return; }
      }
      if (!disposed) timer = window.setTimeout(() => void poll(), 1800);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [claim, device]);

  useEffect(() => {
    if (!device) return;
    let disposed = false;
    let inFlight = false;
    let again = false;
    let debounce: number;
    const refresh = async () => {
      if (disposed) return;
      if (inFlight) { again = true; return; }
      inFlight = true;
      try {
        const value = await api<{ sessions: Session[] }>("/sessions");
        if (disposed) return;
        setSessions(value.sessions);
        for (const id of cache.current.keys()) if (!value.sessions.some((s) => s.id === id)) cache.current.delete(id);
        const id = value.sessions.some((s) => s.id === selected) ? selected : value.sessions[0]?.id || "";
        if (id !== selected) { setSelected(id); setReplay(null); follow.current = true; return; }
        const item = value.sessions.find((s) => s.id === id);
        if (item) {
          const previous = cache.current.get(id);
          if (!previous || previous.session.revision !== item.revision) {
            const next = await api<Replay>(`/sessions/${encodeURIComponent(id)}?after=${previous?.session.revision || 0}`);
            if (disposed) return;
            const merged = mergeReplay(previous, next);
            cache.current.set(id, merged); setReplay(merged);
          } else { setReplay(previous); }
        } else { setReplay(null); }
        setConnected(true);
      } catch (e) {
        if (disposed) return;
        setConnected(false);
        if (e instanceof ApiError && e.status === 401) { forget(); setError("This phone was disconnected. Scan a new QR code on your desktop."); }
      } finally {
        inFlight = false;
        if (again && !disposed) { again = false; debounce = window.setTimeout(() => void refresh(), 100); }
      }
    };
    refreshRef.current = refresh;
    void refresh();
    const source = new EventSource("/api/events");
    source.addEventListener("change", () => { clearTimeout(debounce); debounce = window.setTimeout(() => void refresh(), 100); });
    source.addEventListener("revoked", () => { if (!disposed) { forget(); setError(usb ? "This phone was disconnected. Choose Connect phone → USB cable on your desktop to reconnect." : "This phone was disconnected. Scan a new QR code."); } });
    source.onerror = () => { if (!disposed) setConnected(false); };
    const wake = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { disposed = true; source.close(); clearInterval(timer); clearTimeout(debounce); document.removeEventListener("visibilitychange", wake); window.removeEventListener("online", wake); };
  }, [device?.id, selected]);

  useLayoutEffect(() => {
    if (follow.current && scroll.current) { scroll.current.scrollTop = scroll.current.scrollHeight; setLatest(false); }
  }, [replay, selected]);

  const pair = async () => {
    if (busy || !name.trim()) return;
    setBusy(true); setError("");
    try {
      const claim = secret();
      const value = await api<{ pending: Pending }>("/pair/claim", { invitation, claim, name });
      saveClaim(claim); setClaim(claim); setPending(value.pending);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const send = async () => {
    const prompt = input.trim();
    if (busy || !prompt || !current || current.running || !connected || !device?.control) return;
    const id = selected;
    setBusy(true); setError(""); follow.current = true;
    try {
      await api(`/sessions/${encodeURIComponent(id)}/send`, { prompt });
      setDrafts((drafts) => ({ ...drafts, [id]: drafts[id]?.trim() === prompt ? "" : drafts[id] }));
      await refreshRef.current();
    } catch (e) { setError(e instanceof Error ? e.message : "Connection interrupted. Reconnect and check the conversation before sending again."); }
    finally { setBusy(false); }
  };

  const stop = async () => {
    if (busy || !current?.running || !connected) return;
    setBusy(true); setError("");
    try { await api(`/sessions/${encodeURIComponent(selected)}/stop`, {}); await refreshRef.current(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const disconnect = async () => {
    setBusy(true);
    try { await api("/logout", {}); forget(); setSignout(false); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  if (!device) return <main className="phone-entry">
    <div className="phone-entry-brand"><VelumMark size={52} /><span>Velum Code</span></div>
    <div className="phone-entry-card">
      <div className="phone-eyebrow"><Icon name="shield" size={15} />Your private workspace</div>
      <h1>{loading ? "Finding your desktop…" : claim ? "One last check." : invitation ? "Meet your desktop, here." : "Your desktop. In your pocket."}</h1>
      <p>{claim ? "Confirm this connection in Velum Code on your desktop. Keep this screen open." : invitation ? "Pair this phone to follow your agent and keep work moving, wherever you are." : usb ? "Open Connect phone on your desktop, choose USB cable, and connect this phone." : "Open Velum Code on your desktop, choose Connect phone, and scan its QR code."}</p>
      {error && <div className="phone-error" role="alert">{error}</div>}
      {claim ? <><div className="phone-pair-code" aria-label="Pairing code">{pending?.code || "Waiting…"}</div><div className="phone-wait"><span className="phone-pulse" />Waiting for desktop confirmation</div></> : !loading && invitation ? <form onSubmit={(e) => { e.preventDefault(); void pair(); }}>
        <label htmlFor="phone-name">Name this phone</label><input id="phone-name" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        <button className="phone-primary" disabled={busy || !name.trim()}>{busy ? "Connecting…" : "Pair with desktop"}<Icon name="arrow" size={18} /></button>
      </form> : null}
      <div className="phone-entry-note"><Icon name="shield" size={16} /><span>{usb ? "Connected through your USB cable." : "Connect Tailscale on both devices."}<br />Your conversations stay on your private connection.</span></div>
    </div>
    <p className="phone-entry-footer">Made for the moments away from your desk.</p>
  </main>;

  return <main className="phone-app">
    <header className="phone-header"><VelumMark size={35} /><div><h1>Velum Code</h1><span className={connected ? "phone-online" : "phone-offline"}><i />{connected ? "Desktop connected" : "Reconnecting…"}</span></div>
      <button className="phone-icon-button" aria-label="Phone settings" onClick={() => setInstallHelp((value) => !value)}><Icon name="phone" size={21} /></button>
    </header>
    {installHelp && <section className="phone-settings" aria-label="Phone settings"><strong>{device.name}</strong><p>{computer || "Your desktop"}</p><p>{device.control ? "View and control · standard agent permissions" : "View-only access"}</p>
      {install ? <button onClick={() => void install.prompt().then(() => setInstall(null))}>Add to home screen</button> : <p>Use your browser menu → Add to Home screen or Install app.</p>}
      <button onClick={() => setSignout(true)}>Disconnect this phone</button>
      {signout && <div className="phone-signout"><p>You’ll need to scan a new QR code to reconnect.</p><button disabled={busy} onClick={() => void disconnect()}>Disconnect</button><button onClick={() => setSignout(false)}>Keep connected</button></div>}
    </section>}
    <button className="phone-session-select" aria-expanded={listOpen} aria-controls="phone-sessions" onClick={() => setListOpen((value) => !value)}><span><span className="phone-eyebrow">Conversation</span><strong>{current?.title || "Your conversations"}</strong></span><Icon name="down" size={18} /></button>
    {listOpen && <nav className="phone-sessions" id="phone-sessions" aria-label="Conversations">{sessions.map((session) => <button key={session.id} aria-current={session.id === selected ? "true" : undefined} onClick={() => { setSelected(session.id); setReplay(cache.current.get(session.id) || null); setListOpen(false); follow.current = true; setError(""); }}><Icon name="chat" size={18} /><span><strong>{session.title}</strong><small>{providerNames[session.provider || "muse"]} · {session.workspace.split(/[\\/]/).filter(Boolean).pop()}</small></span><i className={session.running ? "working" : ""}>{session.running ? "Working" : session.status === "completed" ? "Done" : "Ready"}</i></button>)}</nav>}
    {!connected && <div className="phone-reconnect" role="status">{usb ? "Check your USB cable and keep your desktop awake." : "Reconnect Tailscale and keep your desktop awake."} Your draft is safe.<button onClick={() => void refreshRef.current()}>Retry</button></div>}
    <div className="phone-transcript" ref={scroll} onScroll={() => { const el = scroll.current; if (el) { follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; setLatest(!follow.current); } }}>
      {!sessions.length ? <div className="phone-empty"><Icon name="chat" size={32} /><h2>No conversations yet</h2><p>Open an Agent conversation on your desktop. It will appear here automatically.</p></div> : !view.blocks.length ? <div className="phone-empty"><VelumMark size={64} /><h2>What’s next?</h2><p>Send a message to your desktop agent. Your files and tools stay on your computer.</p></div> : null}
      {replay?.truncated && <p className="phone-history-note">Showing recent activity. Earlier messages remain in the desktop conversation.</p>}
      {view.blocks.map((block) => block.kind === "tool" ? <details className="phone-tool" key={block.id}><summary><Icon name="code" size={15} /><strong>{block.name}</strong><span>{block.status}</span></summary><pre>{block.text || "Waiting for output…"}</pre></details> : block.kind === "notice" ? <div className="phone-notice" key={block.id}>{block.text}</div> : <article className={`phone-message ${block.kind}`} key={block.id}><div className="phone-message-label">{block.kind === "user" ? "You" : <><VelumMark size={20} />{providerNames[current?.provider || "muse"]}</>}</div>{block.kind === "user" ? <p>{block.text}</p> : <Markdown text={block.text} />}</article>)}
      {view.todos.length > 0 && <details className="phone-todos"><summary>Task checklist <span>{view.todos.filter((todo) => todo.status === "completed").length}/{view.todos.length}</span></summary>{view.todos.map((todo, index) => <p key={index}><Icon name={todo.status === "completed" ? "check" : "code"} size={14} />{todo.text}</p>)}</details>}
      {current?.running && <div className="phone-working" role="status"><span className="phone-pulse" />{view.activity || `${providerNames[current?.provider || "muse"]} is working…`}</div>}
    </div>
    {latest && <button className="phone-latest" onClick={() => { follow.current = true; if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; setLatest(false); }}>Latest activity <Icon name="down" size={15} /></button>}
    <footer className="phone-composer">
      {error && <div className="phone-error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError("")}><Icon name="close" size={15} /></button></div>}
      {device.control ? <form onSubmit={(e) => { e.preventDefault(); void send(); }}><textarea aria-label="Message your desktop agent" placeholder={current?.running ? "Write your next thought…" : "Message your desktop agent…"} value={input} maxLength={16_000} rows={2} disabled={!selected} onChange={(e) => setDrafts((drafts) => ({ ...drafts, [selected]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        {current?.running ? <button type="button" className="phone-stop" disabled={busy || !connected} onClick={() => void stop()} aria-label="Stop task"><span />Stop</button> : <button className="phone-send" aria-label="Send message" disabled={busy || !connected || !input.trim() || !selected}><Icon name="arrow" size={21} /></button>}
      </form> : <p className="phone-view-only"><Icon name="shield" size={15} />View-only access</p>}
      <span className="phone-composer-note">{current?.workspace.split(/[\\/]/).filter(Boolean).pop() || "Velum Code"} · runs on your desktop</span>
    </footer>
  </main>;
}
