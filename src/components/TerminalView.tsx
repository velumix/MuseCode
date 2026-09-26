import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@xterm/xterm/css/xterm.css";

export type PtyStatus =
  | { kind: "starting" }
  | { kind: "running"; backend: string }
  | { kind: "exited"; code: number | null }
  | { kind: "error"; message: string };

export interface TerminalHandles {
  id: string;
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
}

interface TerminalViewProps {
  sessionId: string;
  active: boolean;
  /** Bump to tear down the session and spawn a fresh one. */
  sessionKey: number;
  workspace?: string;
  onStatus: (sessionId: string, status: PtyStatus) => void;
  onHandles: (sessionId: string, handles: TerminalHandles | null) => void;
}

export default function TerminalView({ sessionId, active, sessionKey, workspace, onStatus, onHandles }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<{ id: string; term: Terminal; fit: FitAddon } | null>(null);
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  const handlesRef = useRef(onHandles);
  handlesRef.current = onHandles;
  // Latest teardown promise; the next mount awaits it so a restart's
  // kill always lands before its replacement spawn.
  const killRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let disposed = false;
    let spawned = false;
    let exited = false;
    const nativeId = `${sessionId}-terminal-${crypto.randomUUID()}`;
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: '"Cascadia Code", Consolas, "JetBrains Mono", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: {
        background: "#18191b",
        foreground: "#e8eaed",
        cursor: "#84baff",
        selectionBackground: "#344962",
        black: "#18191b",
        red: "#e06c5b",
        green: "#8fc87a",
        yellow: "#d9a648",
        blue: "#6aa8d8",
        magenta: "#c07ab8",
        cyan: "#6fc2c5",
        white: "#d6dde6",
        brightBlack: "#5a6572",
        brightRed: "#e88a7a",
        brightGreen: "#a5d893",
        brightYellow: "#e5bb6b",
        brightBlue: "#8abfe8",
        brightMagenta: "#d194c9",
        brightCyan: "#8ad4d6",
        brightWhite: "#eef2f6",
      },
    });

    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        openUrl(uri).catch(() => {});
      }),
    );
    term.open(el);
    fit.fit();
    liveRef.current = { id: nativeId, term, fit };
    handlesRef.current(sessionId, { id: nativeId, term, fit, search });

    const unlistens: Array<() => void> = [];
    const setStatus = (s: PtyStatus) => {
      if (!disposed) statusRef.current(sessionId, s);
    };
    setStatus({ kind: "starting" });

    // Attach listeners before spawning so early output can't be missed.
    const setup = (async () => {
      try {
        await killRef.current;
        if (disposed) return;
        unlistens.push(
          await listen<{ id: string; data: string }>("pty-data", (e) => {
            if (!disposed && e.payload.id === nativeId) term.write(e.payload.data);
          }),
        );
        if (disposed) return;
        unlistens.push(
          await listen<{ id: string; code: number | null }>("pty-exit", (e) => {
            if (e.payload.id === nativeId) {
              exited = true;
              setStatus({ kind: "exited", code: e.payload.code });
            }
          }),
        );
        if (disposed) return;
        const info = await invoke<{ id: string; backend: string }>("pty_spawn", {
          id: nativeId,
          workspace,
          cols: Math.max(1, term.cols),
          rows: Math.max(1, term.rows),
        });
        spawned = true;
        if (!exited) setStatus({ kind: "running", backend: info.backend });
      } catch (err) {
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    term.onData((data) => {
      if (spawned && !disposed && !exited) invoke("pty_write", { id: nativeId, data }).catch(() => {});
    });

    const ro = new ResizeObserver(() => {
      if (disposed || !spawned || !el.clientWidth || !el.clientHeight) return;
      try {
        fit.fit();
        invoke("pty_resize", {
          id: nativeId,
          cols: Math.max(1, term.cols),
          rows: Math.max(1, term.rows),
        }).catch(() => {});
      } catch {
        // Resize during teardown; safe to ignore.
      }
    });
    ro.observe(el);

    return () => {
      disposed = true;
      ro.disconnect();
      for (const unlisten of unlistens) unlisten();
      liveRef.current = null;
      handlesRef.current(sessionId, null);
      term.dispose();
      killRef.current = setup.then(async () => {
        for (const unlisten of unlistens) unlisten();
        await invoke("pty_kill", { id: nativeId });
      }).catch(() => {});
    };
  }, [sessionId, sessionKey, workspace]);

  // Hidden tabs have no layout box; refit once this tab becomes visible.
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      const live = liveRef.current;
      if (!live) return;
      try {
        live.fit.fit();
        invoke("pty_resize", {
          id: live.id,
          cols: Math.max(1, live.term.cols),
          rows: Math.max(1, live.term.rows),
        }).catch(() => {});
      } catch {
        // Tearing down; safe to ignore.
      }
      live.term.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active, sessionId]);

  return <div ref={containerRef} className={active ? "terminal-host" : "terminal-host hidden"} />;
}
