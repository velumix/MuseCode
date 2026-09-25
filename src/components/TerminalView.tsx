import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@xterm/xterm/css/xterm.css";

export type PtyStatus =
  | { kind: "starting" }
  | { kind: "running"; Backend: string }
  | { kind: "exited"; code: number | null }
  | { kind: "error"; message: string };

interface TerminalViewProps {
  /** Bump to tear down the session and spawn a fresh one. */
  sessionKey: number;
  onStatus: (status: PtyStatus) => void;
  onTerminal: (term: Terminal | null) => void;
}

export default function TerminalView({ sessionKey, onStatus, onTerminal }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  const terminalRef = useRef(onTerminal);
  terminalRef.current = onTerminal;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let disposed = false;
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: '"Cascadia Code", Consolas, "JetBrains Mono", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: {
        background: "#0b0e11",
        foreground: "#d6dde6",
        cursor: "#d9a648",
        selectionBackground: "#2c3a4a",
        black: "#0b0e11",
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
    term.loadAddon(fit);
    term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        openUrl(uri).catch(() => {});
      }),
    );
    term.open(el);
    fit.fit();
    terminalRef.current(term);

    const unlistens: Array<() => void> = [];
    const setStatus = (s: PtyStatus) => {
      if (!disposed) statusRef.current(s);
    };
    setStatus({ kind: "starting" });

    // Attach listeners before spawning so early output can't be missed.
    (async () => {
      try {
        unlistens.push(
          await listen<string>("pty-data", (e) => {
            if (!disposed) term.write(e.payload);
          }),
        );
        unlistens.push(
          await listen<{ code: number | null }>("pty-exit", (e) => {
            setStatus({ kind: "exited", code: e.payload.code });
          }),
        );
        const Backend = await invoke<string>("pty_spawn", {
          cols: Math.max(1, term.cols),
          rows: Math.max(1, term.rows),
        });
        setStatus({ kind: "running", Backend });
      } catch (err) {
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    term.onData((data) => {
      invoke("pty_write", { data }).catch(() => {});
    });

    const ro = new ResizeObserver(() => {
      if (disposed) return;
      try {
        fit.fit();
        invoke("pty_resize", {
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
      terminalRef.current(null);
      term.dispose();
      invoke("pty_kill").catch(() => {});
    };
  }, [sessionKey]);

  return <div ref={containerRef} className="terminal-host" />;
}
