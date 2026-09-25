import { useCallback, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import TitleBar from "./components/TitleBar";
import TerminalView from "./components/TerminalView";
import type { PtyStatus } from "./components/TerminalView";
import "./App.css";

function statusText(status: PtyStatus): string {
  switch (status.kind) {
    case "starting":
      return "Starting muse…";
    case "running":
      return `muse · ${status.Backend}`;
    case "exited":
      return status.code === null ? "muse exited" : `muse exited (code ${status.code})`;
    case "error":
      return status.message;
  }
}

export default function App() {
  const [status, setStatus] = useState<PtyStatus>({ kind: "starting" });
  const [sessionKey, setSessionKey] = useState(0);
  const termRef = useRef<Terminal | null>(null);

  const handleStatus = useCallback((s: PtyStatus) => {
    setStatus(s);
    if (s.kind === "error") {
      // Surface spawn failures inside the terminal view itself.
      termRef.current?.writeln(`\r\n\x1b[31m${s.message}\x1b[0m`);
      termRef.current?.writeln("\x1b[90mPress Restart below to try again.\x1b[0m");
    }
  }, []);

  const handleTerminal = useCallback((t: Terminal | null) => {
    termRef.current = t;
  }, []);

  const restart = useCallback(() => {
    setStatus({ kind: "starting" });
    setSessionKey((k) => k + 1);
  }, []);

  const clear = useCallback(() => {
    termRef.current?.clear();
  }, []);

  const failed = status.kind === "error" || status.kind === "exited";

  return (
    <div className="app">
      <TitleBar />
      <div className="terminal-wrap">
        <TerminalView sessionKey={sessionKey} onStatus={handleStatus} onTerminal={handleTerminal} />
      </div>
      <footer className="statusbar">
        <span className={`status-dot ${status.kind}`} aria-hidden="true" />
        <span className="status-text" title={statusText(status)}>
          {statusText(status)}
        </span>
        <span className="status-spacer" />
        <button type="button" className="status-btn" onClick={clear}>
          Clear
        </button>
        <button type="button" className={`status-btn${failed ? " primary" : ""}`} onClick={restart}>
          Restart
        </button>
      </footer>
    </div>
  );
}
