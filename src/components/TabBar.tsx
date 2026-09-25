import type { PtyStatus } from "./TerminalView";

export interface TabInfo {
  id: string;
  title: string;
  status: PtyStatus;
}

interface TabBarProps {
  tabs: TabInfo[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

export default function TabBar({ tabs, activeId, onSelect, onClose, onNew }: TabBarProps) {
  return (
    <div className="tabbar" role="tablist" aria-label="Sessions">
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tab"
          aria-selected={t.id === activeId}
          className={`tab${t.id === activeId ? " active" : ""}`}
          onClick={() => onSelect(t.id)}
          onMouseUp={(e) => {
            if (e.button === 1) onClose(t.id);
          }}
        >
          <span className={`status-dot ${t.status.kind}`} aria-hidden="true" />
          <span className="tab-title">{t.title}</span>
          <button
            type="button"
            className="tab-close"
            aria-label={`Close ${t.title}`}
            onClick={(e) => {
              e.stopPropagation();
              onClose(t.id);
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="tab-new" aria-label="New session (Ctrl+T)" title="New session (Ctrl+T)" onClick={onNew}>
        +
      </button>
    </div>
  );
}
