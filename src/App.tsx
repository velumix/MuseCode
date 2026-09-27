import { Fragment, lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import TitleBar from "./components/TitleBar";
import TabBar, { conversationTitle } from "./components/TabBar";
import Icon from "./components/Icon";
import SearchBar from "./components/SearchBar";
const TerminalView = lazy(() => import("./components/TerminalView"));
import type { PtyStatus, TerminalHandles } from "./components/TerminalView";
import ChatView from "./components/ChatView";
import type { AgentStatus } from "./components/ChatView";
import CommandPalette from "./components/CommandPalette";
const RemotePanel = lazy(() => import("./components/RemotePanel"));
import type { PaletteAction } from "./components/CommandPalette";
import "./App.css";
import ProviderPicker from "./components/ProviderPicker";
import { preferredProvider, providerNames, type Provider } from "./providers";

type TabMode = "agent" | "terminal";
interface DesktopStatus { notifications_enabled: boolean; last_error: string | null }

interface Tab {
  provider: Provider;
  id: string;
  title: string;
  mode: TabMode;
  agentStatus: AgentStatus;
  terminalStatus: PtyStatus;
  agentKey: number;
  terminalKey: number;
  terminalStarted: boolean;
  workspace?: string;
}

function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `tab-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function createTab(n: number, provider = preferredProvider()): Tab {
  return { provider, id: newId(), title: `muse ${n}`, mode: "agent", agentStatus: { kind: "starting" }, terminalStatus: { kind: "starting" }, agentKey: 0, terminalKey: 0, terminalStarted: false };
}

function tabStatus(tab: Tab): PtyStatus | AgentStatus {
  return tab.mode === "agent" ? tab.agentStatus : tab.terminalStatus;
}

function statusText(tab: Tab): string {
  const status = tabStatus(tab);
  switch (status.kind) {
    case "starting":
      return `Starting ${providerNames[tab.provider]}…`;
    case "idle":
      return "Ready";
    case "done":
      return "\u2713 Done";
    case "running":
      if ("backend" in status) return `${providerNames[tab.provider]} · ${status.backend}`;
      return "detail" in status && status.detail ? `Working… · ${status.detail}` : "Working…";
    case "exited":
      return status.code === null ? `${providerNames[tab.provider]} exited` : `${providerNames[tab.provider]} exited (code ${status.code})`;
    case "error":
      return status.message;
  }
}

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>(() => [createTab(1)]);
  const [activeId, setActiveId] = useState<string>(() => "");
  const [searchOpen, setSearchOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [desktop, setDesktop] = useState<DesktopStatus>({ notifications_enabled: true, last_error: null });
  const [desktopMessage, setDesktopMessage] = useState<{ text: string; error: boolean } | null>(null);

  const counter = useRef(1);
  const handlesRef = useRef(new Map<string, TerminalHandles>());
  // Render-committed snapshot so global shortcut handlers never go stale.
  const stateRef = useRef({ tabs, activeId });
  stateRef.current = { tabs, activeId };

  // Default to the first tab on initial mount.
  useEffect(() => {
    setActiveId((prev) => prev || stateRef.current.tabs[0]?.id || "");
  }, []);

  useEffect(() => {
    let disposed = false;
    const unlistens: Array<() => void> = [];
    const navigate = async () => {
      const id = await invoke<string | null>("desktop_take_navigation");
      if (disposed || !id) return;
      if (stateRef.current.tabs.some((t) => t.id === id)) {
        setTabs((tabs) => tabs.map((t) => t.id === id ? { ...t, mode: "agent" } : t));
        setActiveId(id);
        setSearchOpen(false);
      } else {
        setDesktopMessage({ text: "That conversation has already been closed.", error: false });
      }
    };
    const setup = (async () => {
      const track = async (registration: Promise<() => void>) => {
        const unlisten = await registration;
        if (disposed) unlisten(); else unlistens.push(unlisten);
      };
      await Promise.all([
        track(listen<DesktopStatus>("desktop-status", ({ payload }) => { if (!disposed) setDesktop(payload); })),
        track(listen("desktop-navigation", () => { if (!disposed) void navigate().catch(() => {}); })),
      ]);
      if (disposed) return;
      const initial = await invoke<DesktopStatus>("desktop_status");
      if (!disposed && initial) setDesktop(initial);
      if (!disposed) await navigate();
    })().catch(() => {});
    return () => { disposed = true; for (const off of unlistens) off(); void setup; };
  }, []);

  const toggleNotifications = useCallback(async () => {
    try {
      setDesktop(await invoke<DesktopStatus>("desktop_set_notifications", { enabled: !desktop.notifications_enabled }));
      setDesktopMessage(null);
    } catch (error) { setDesktopMessage({ text: String(error), error: true }); }
  }, [desktop.notifications_enabled]);

  const testNotification = useCallback(async () => {
    try {
      await invoke("desktop_test_notification");
      setDesktopMessage({ text: "Test notification sent to Windows.", error: false });
    } catch (error) { setDesktopMessage({ text: String(error), error: true }); }
  }, []);

  const handleAgentStatus = useCallback((sessionId: string, s: AgentStatus) => {
    setTabs((prev) => prev.map((t) => (t.id === sessionId ? { ...t, agentStatus: s } : t)));
  }, []);

  const handleWorkspace = useCallback((sessionId: string, workspace: string) => {
    setTabs((prev) => prev.map((t) => t.id === sessionId
      ? { ...t, workspace, title: t.workspace && t.workspace !== workspace ? "New conversation" : t.title }
      : t));
  }, []);

  const handleTitle = useCallback((sessionId: string, title: string) => {
    setTabs((prev) => prev.map((t) => t.id === sessionId ? { ...t, title } : t));
  }, []);

  const handleTerminalStatus = useCallback((sessionId: string, s: PtyStatus) => {
    setTabs((prev) => prev.map((t) => (t.id === sessionId ? { ...t, terminalStatus: s } : t)));
    if (s.kind === "error") {
      // Surface spawn failures inside the terminal view itself (chat view
      // renders its own errors inline, so this only fires for terminals).
      const h = handlesRef.current.get(sessionId);
      h?.term.writeln(`\r\n\x1b[31m${s.message}\x1b[0m`);
      h?.term.writeln("\x1b[90mUse Restart in the toolbar to try again.\x1b[0m");
    }
  }, []);

  const handleHandles = useCallback((sessionId: string, h: TerminalHandles | null) => {
    if (h) handlesRef.current.set(sessionId, h);
    else handlesRef.current.delete(sessionId);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    for (const h of handlesRef.current.values()) h.search.clearDecorations();
    requestAnimationFrame(() => {
      const { tabs: current, activeId: id } = stateRef.current;
      if (current.find((t) => t.id === id)?.mode === "terminal") handlesRef.current.get(id)?.term.focus();
    });
  }, []);

  const openProvider = useCallback((provider: Provider) => {
    try { localStorage.setItem("velum-provider", provider); } catch { /* Storage is optional. */ }
    const t = createTab(++counter.current, provider);
    t.workspace = stateRef.current.tabs.find((tab) => tab.id === stateRef.current.activeId)?.workspace;
    setTabs((prev) => [...prev, t]);
    setActiveId(t.id);
  }, []);

  const newTab = useCallback(() => openProvider(preferredProvider()), [openProvider]);

  const selectTab = useCallback(
    (id: string) => {
      setActiveId(id);
      closeSearch();
    },
    [closeSearch],
  );

  const setMode = useCallback((id: string, mode: TabMode) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === id && t.mode !== mode ? { ...t, mode, terminalStarted: t.terminalStarted || mode === "terminal" } : t,
      ),
    );
    closeSearch();
  }, [closeSearch]);

  const closeTab = useCallback((id: string) => {
    // Each view owns its native session and completes cleanup after any
    // pending initialization. Sending a second kill here races that owner.
    handlesRef.current.delete(id);
    const prev = stateRef.current.tabs;
    const next = prev.filter((t) => t.id !== id);
    if (next.length === 0) {
      const t = createTab(++counter.current);
      setTabs([t]);
      setActiveId(t.id);
      return;
    }
    setTabs(next);
    if (stateRef.current.activeId === id) {
      const idx = prev.findIndex((t) => t.id === id);
      setActiveId(next[Math.min(idx, next.length - 1)].id);
    }
  }, []);

  const cycleTab = useCallback(
    (dir: 1 | -1) => {
      const { tabs: current, activeId: currentActive } = stateRef.current;
      if (current.length < 2) return;
      const idx = current.findIndex((t) => t.id === currentActive);
      setActiveId(current[(idx + dir + current.length) % current.length].id);
      closeSearch();
    },
    [closeSearch],
  );

  const togglePalette = useCallback(() => {
    setPaletteOpen((v) => !v);
  }, []);

  const focusComposer = useCallback(() => {
    const id = stateRef.current.activeId;
    if (id) setMode(id, "agent");
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("muse:focus-composer", { detail: id }));
    });
  }, [setMode]);

  const jumpTab = useCallback(
    (idx: number) => {
      const t = stateRef.current.tabs[idx];
      if (t) selectTab(t.id);
    },
    [selectTab],
  );

  const zoomActive = useCallback((delta: number | null) => {
    const h = handlesRef.current.get(stateRef.current.activeId);
    if (!h) return;
    const next = delta === null ? 14 : Math.min(32, Math.max(8, (h.term.options.fontSize ?? 14) + delta));
    h.term.options.fontSize = next;
    try {
      h.fit.fit();
      invoke("pty_resize", {
        id: h.id,
        cols: Math.max(1, h.term.cols),
        rows: Math.max(1, h.term.rows),
      }).catch(() => {});
    } catch {
      // Tearing down; safe to ignore.
    }
  }, []);

  const actionsRef = useRef({ newTab, cycleTab, zoomActive, togglePalette, focusComposer, jumpTab });
  actionsRef.current = { newTab, cycleTab, zoomActive, togglePalette, focusComposer, jumpTab };

  // Global shortcuts in the capture phase so the terminal never sees them.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      const actions = actionsRef.current;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        e.stopPropagation();
        actions.zoomActive(1);
      } else if (e.key === "-") {
        e.preventDefault();
        e.stopPropagation();
        actions.zoomActive(-1);
      } else if (e.key === "0") {
        e.preventDefault();
        e.stopPropagation();
        actions.zoomActive(null);
      } else if (e.key === "f" || e.key === "F") {
        const { tabs: ts, activeId: aid } = stateRef.current;
        if (ts.find((t) => t.id === aid)?.mode !== "terminal") return;
        e.preventDefault();
        e.stopPropagation();
        setSearchOpen(true);
      } else if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        e.stopPropagation();
        actions.newTab();
      } else if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        actions.cycleTab(e.shiftKey ? -1 : 1);
      } else if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        e.stopPropagation();
        actions.togglePalette();
      } else if (e.key === "l" || e.key === "L") {
        const { tabs: ts, activeId: aid } = stateRef.current;
        if (ts.find((t) => t.id === aid)?.mode !== "agent") return;
        e.preventDefault();
        e.stopPropagation();
        actions.focusComposer();
      } else if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        actions.jumpTab(Number(e.key) - 1);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const find = useCallback(
    (dir: 1 | -1, query: string) => {
      const h = handlesRef.current.get(stateRef.current.activeId);
      if (!h || !query) return;
      if (dir === 1) h.search.findNext(query);
      else h.search.findPrevious(query);
    },
    [],
  );

  const restartActive = useCallback(() => {
    const id = stateRef.current.activeId;
    if (!id) return;
    setTabs((prev) => prev.map((t) => t.id !== id ? t : t.mode === "agent"
      ? { ...t, title: "New conversation", agentStatus: { kind: "starting" }, agentKey: t.agentKey + 1 }
      : { ...t, terminalStatus: { kind: "starting" }, terminalKey: t.terminalKey + 1 }));
  }, []);

  const clearActive = useCallback(() => {
    handlesRef.current.get(stateRef.current.activeId)?.term.clear();
  }, []);

  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const failed = activeTab && (tabStatus(activeTab).kind === "error" || tabStatus(activeTab).kind === "exited");

  const paletteActions: PaletteAction[] = [
    { id: "cmd-remote", title: "Connect your phone with Tailscale or USB", run: () => setRemoteOpen(true) },
    { id: "cmd-new", title: "New agent tab", hint: "Ctrl+T", run: newTab },
    { id: "cmd-focus", title: "Focus message input", hint: "Ctrl+L", run: focusComposer },
    {
      id: "cmd-agent",
      title: "Switch this tab to Agent mode",
      run: () => {
        const id = stateRef.current.activeId;
        if (id) setMode(id, "agent");
      },
    },
    {
      id: "cmd-terminal",
      title: "Switch this tab to Terminal mode",
      run: () => {
        const id = stateRef.current.activeId;
        if (id) setMode(id, "terminal");
      },
    },
    { id: "cmd-restart", title: "Restart this tab's session", run: restartActive },
    { id: "cmd-notifications", title: desktop.notifications_enabled ? "Turn off background notifications" : "Turn on background notifications", run: () => void toggleNotifications() },
    { id: "cmd-test-notification", title: "Send a test Windows notification", run: () => void testNotification() },
    { id: "cmd-tray", title: "Hide Velum Code to the system tray", run: () => void getCurrentWindow().close() },
    { id: "cmd-quit", title: "Quit Velum Code and stop background work", run: () => void invoke("desktop_quit") },
    {
      id: "cmd-close",
      title: "Close this tab",
      run: () => {
        const id = stateRef.current.activeId;
        if (id) closeTab(id);
      },
    },
    ...tabs.map((t, i) => ({
      id: `cmd-goto-${t.id}`,
      title: `Go to conversation: ${conversationTitle(t.title)} (${t.mode})`,
      hint: i < 9 ? `Ctrl+${i + 1}` : undefined,
      run: () => selectTab(t.id),
    })),
  ];

  return (
    <div className="app">
      <TitleBar onCommands={togglePalette} />
      {(desktopMessage || desktop.last_error) && <div className={`desktop-notice${desktopMessage?.error || desktop.last_error ? " error" : ""}`} role={desktopMessage?.error || desktop.last_error ? "alert" : "status"}>
        <span>{desktopMessage?.text || desktop.last_error}</span>
        <button type="button" aria-label="Dismiss notification message" onClick={() => { setDesktopMessage(null); setDesktop((s) => ({ ...s, last_error: null })); }}><Icon name="close" size={15} /></button>
      </div>}
      <div className="app-body">
      <TabBar tabs={tabs.map((t) => ({ ...t, status: tabStatus(t) }))} activeId={activeTab?.id ?? ""} onSelect={selectTab} onClose={closeTab} onNew={newTab} onCommands={togglePalette} workspace={activeTab?.workspace} />
      <main className="conversation-pane" aria-label="Current conversation">
      <div className="conversation-toolbar">
        <div className="conversation-heading">
          <span className="section-label">Your space to create</span>
          <h1>{activeTab ? conversationTitle(activeTab.title) : "New conversation"}</h1>
        </div>
        {activeTab && (
          <div className="mode-toggle" data-mode={activeTab.mode} role="group" aria-label="Tab mode">
            <button type="button" className={activeTab.mode === "agent" ? "active" : ""} aria-pressed={activeTab.mode === "agent"} onClick={() => setMode(activeTab.id, "agent")}>
              <Icon name="chat" size={16} />Agent
            </button>
            <button type="button" className={activeTab.mode === "terminal" ? "active" : ""} aria-pressed={activeTab.mode === "terminal"} title={`Open a separate ${providerNames[activeTab.provider]} terminal conversation in this workspace`} onClick={() => setMode(activeTab.id, "terminal")}>
              <Icon name="terminal" size={17} />Terminal
            </button>
          </div>
        )}
        {activeTab?.mode === "terminal" && <button type="button" className="status-btn" onClick={clearActive}>Clear</button>}
        <button type="button" className={`restart-btn${failed ? " primary" : ""}`} onClick={restartActive} aria-label="Restart" title="Restart this session">
          <Icon name="reset" size={17} />
        </button>
      </div>
      {activeTab && <ProviderPicker value={activeTab.provider} onChange={(provider) => { if (provider !== activeTab.provider) openProvider(provider); }} />}
      <div className="terminal-wrap">
        {tabs.map((t) => (
          <Fragment key={t.id}>
            <ChatView
              sessionId={t.id}
              provider={t.provider}
              initialWorkspace={t.workspace}
              active={t.id === activeTab?.id && t.mode === "agent"}
              sessionKey={t.agentKey}
              onStatus={handleAgentStatus}
              onWorkspace={handleWorkspace}
              onTitle={handleTitle}
            />
            {t.terminalStarted && <Suspense fallback={t.id === activeTab?.id && t.mode === "terminal" ? <p>Loading terminal…</p> : null}>
            <TerminalView
              sessionId={t.id}
              provider={t.provider}
              active={t.id === activeTab?.id && t.mode === "terminal"}
              sessionKey={t.terminalKey}
              workspace={t.workspace}
              onStatus={handleTerminalStatus}
              onHandles={handleHandles}
            />
            </Suspense>}
          </Fragment>
        ))}
        {searchOpen && activeTab?.mode === "terminal" && (
          <SearchBar onNext={(q) => find(1, q)} onPrevious={(q) => find(-1, q)} onClose={closeSearch} />
        )}
      </div>
      <footer className="statusbar">
        {activeTab && (
          <>
            <span className={`status-dot ${tabStatus(activeTab).kind}`} aria-hidden="true" />
            <span className="status-text" title={statusText(activeTab)}>
              {statusText(activeTab)}
            </span>
          </>
        )}
        <span className="status-spacer" />
        <button type="button" className="notification-toggle" onClick={() => setRemoteOpen(true)}><Icon name="phone" size={13} />Connect phone</button>
        <button type="button" className="notification-toggle" aria-label="Background notifications" aria-pressed={desktop.notifications_enabled} title={desktop.notifications_enabled ? "Background notifications on — click to mute" : "Background notifications muted — click to enable"} onClick={() => void toggleNotifications()}><Icon name="bell" size={13} />{desktop.notifications_enabled ? "Notifications on" : "Notifications muted"}</button>
        <span className="footer-hint" title="Closing the window keeps Velum Code running. Use the tray menu or Ctrl+K → Quit to exit.">Runs in tray</span>
      </footer>
      </main>
      </div>
      {paletteOpen && <CommandPalette actions={paletteActions} onClose={() => setPaletteOpen(false)} />}
      {remoteOpen && <Suspense fallback={null}><RemotePanel onClose={() => setRemoteOpen(false)} /></Suspense>}
    </div>
  );
}
