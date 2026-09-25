import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import TitleBar from "./components/TitleBar";
import TabBar from "./components/TabBar";
import SearchBar from "./components/SearchBar";
import TerminalView from "./components/TerminalView";
import type { PtyStatus, TerminalHandles } from "./components/TerminalView";
import "./App.css";

interface Tab {
  id: string;
  title: string;
  status: PtyStatus;
  sessionKey: number;
}

function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `tab-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function createTab(n: number): Tab {
  return { id: newId(), title: `muse ${n}`, status: { kind: "starting" }, sessionKey: 0 };
}

function statusText(status: PtyStatus): string {
  switch (status.kind) {
    case "starting":
      return "Starting muse…";
    case "running":
      return `muse · ${status.backend}`;
    case "exited":
      return status.code === null ? "muse exited" : `muse exited (code ${status.code})`;
    case "error":
      return status.message;
  }
}

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>(() => [createTab(1)]);
  const [activeId, setActiveId] = useState<string>(() => "");
  const [searchOpen, setSearchOpen] = useState(false);

  const counter = useRef(1);
  const handlesRef = useRef(new Map<string, TerminalHandles>());
  // Render-committed snapshot so global shortcut handlers never go stale.
  const stateRef = useRef({ tabs, activeId });
  stateRef.current = { tabs, activeId };

  // Default to the first tab on initial mount.
  useEffect(() => {
    setActiveId((prev) => prev || stateRef.current.tabs[0]?.id || "");
  }, []);

  const handleStatus = useCallback((sessionId: string, s: PtyStatus) => {
    setTabs((prev) => prev.map((t) => (t.id === sessionId ? { ...t, status: s } : t)));
    if (s.kind === "error") {
      // Surface spawn failures inside the terminal view itself.
      const h = handlesRef.current.get(sessionId);
      h?.term.writeln(`\r\n\x1b[31m${s.message}\x1b[0m`);
      h?.term.writeln("\x1b[90mPress Restart below to try again.\x1b[0m");
    }
  }, []);

  const handleHandles = useCallback((sessionId: string, h: TerminalHandles | null) => {
    if (h) handlesRef.current.set(sessionId, h);
    else handlesRef.current.delete(sessionId);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    for (const h of handlesRef.current.values()) h.search.clearDecorations();
  }, []);

  const newTab = useCallback(() => {
    const t = createTab(++counter.current);
    setTabs((prev) => [...prev, t]);
    setActiveId(t.id);
  }, []);

  const selectTab = useCallback(
    (id: string) => {
      setActiveId(id);
      closeSearch();
    },
    [closeSearch],
  );

  const closeTab = useCallback((id: string) => {
    invoke("pty_kill", { id }).catch(() => {});
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

  const zoomActive = useCallback((delta: number | null) => {
    const h = handlesRef.current.get(stateRef.current.activeId);
    if (!h) return;
    const next = delta === null ? 14 : Math.min(32, Math.max(8, (h.term.options.fontSize ?? 14) + delta));
    h.term.options.fontSize = next;
    try {
      h.fit.fit();
      invoke("pty_resize", {
        id: stateRef.current.activeId,
        cols: Math.max(1, h.term.cols),
        rows: Math.max(1, h.term.rows),
      }).catch(() => {});
    } catch {
      // Tearing down; safe to ignore.
    }
  }, []);

  const actionsRef = useRef({ newTab, cycleTab, zoomActive });
  actionsRef.current = { newTab, cycleTab, zoomActive };

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
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, status: { kind: "starting" }, sessionKey: t.sessionKey + 1 } : t)));
  }, []);

  const clearActive = useCallback(() => {
    handlesRef.current.get(stateRef.current.activeId)?.term.clear();
  }, []);

  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const failed = activeTab && (activeTab.status.kind === "error" || activeTab.status.kind === "exited");

  return (
    <div className="app">
      <TitleBar />
      <TabBar tabs={tabs} activeId={activeTab?.id ?? ""} onSelect={selectTab} onClose={closeTab} onNew={newTab} />
      <div className="terminal-wrap">
        {tabs.map((t) => (
          <TerminalView
            key={t.id}
            sessionId={t.id}
            active={t.id === activeTab?.id}
            sessionKey={t.sessionKey}
            onStatus={handleStatus}
            onHandles={handleHandles}
          />
        ))}
        {searchOpen && (
          <SearchBar onNext={(q) => find(1, q)} onPrevious={(q) => find(-1, q)} onClose={closeSearch} />
        )}
      </div>
      <footer className="statusbar">
        {activeTab && (
          <>
            <span className={`status-dot ${activeTab.status.kind}`} aria-hidden="true" />
            <span className="status-text" title={statusText(activeTab.status)}>
              {statusText(activeTab.status)}
            </span>
          </>
        )}
        <span className="status-spacer" />
        <button type="button" className="status-btn" onClick={clearActive}>
          Clear
        </button>
        <button type="button" className={`status-btn${failed ? " primary" : ""}`} onClick={restartActive}>
          Restart
        </button>
      </footer>
    </div>
  );
}
