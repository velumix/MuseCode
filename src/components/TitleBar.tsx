import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import Icon, { MuseMark } from "./Icon";

function MinimizeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 6h8" strokeLinecap="round" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2.5" y="2.5" width="7" height="7" rx="1" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="4" y="2" width="6" height="6" rx="1" />
      <path d="M8 8v2H2V4h2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 3l6 6M9 3l-6 6" strokeLinecap="round" />
    </svg>
  );
}

export default function TitleBar({ onCommands }: { onCommands: () => void }) {
  const [maximized, setMaximized] = useState(false);
  const win = getCurrentWindow();

  useEffect(() => {
    const w = getCurrentWindow();
    let disposed = false;
    w.isMaximized().then(setMaximized).catch(() => {});
    let unlisten: (() => void) | undefined;
    listen("tauri://resize", () => {
      w.isMaximized().then(setMaximized).catch(() => {});
    })
      .then((u) => {
        if (disposed) u();
        else unlisten = u;
      })
      .catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  }, []);

  return (
    <header
      className="titlebar"
      onMouseDown={(e) => {
        if (e.button === 0 && !(e.target as HTMLElement).closest("button")) {
          void win.startDragging();
        }
      }}
      onDoubleClick={(e) => {
        if (!(e.target as HTMLElement).closest("button")) {
          void win.toggleMaximize();
        }
      }}
    >
      <div className="titlebar-brand">
        <MuseMark />
        <span>muse<span className="brand-suffix">code</span></span>
      </div>
      <button type="button" className="global-search" onClick={onCommands} aria-label="Search commands and conversations">
        <Icon name="search" size={17} />
        <span>Search Muse</span>
        <kbd>Ctrl K</kbd>
      </button>
      <div className="titlebar-drag-space" />
      <div className="titlebar-controls">
        <button type="button" aria-label="Minimize" onClick={() => void win.minimize()}>
          <MinimizeIcon />
        </button>
        <button type="button" aria-label={maximized ? "Restore" : "Maximize"} onClick={() => void win.toggleMaximize()}>
          {maximized ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button type="button" aria-label="Close" title="Hide to system tray — Muse keeps running" className="close" onClick={() => void win.close()}>
          <CloseIcon />
        </button>
      </div>
    </header>
  );
}
