import type { PtyStatus } from "./TerminalView";
import type { AgentStatus } from "./ChatView";
import Icon from "./Icon";
import { providerNames, type Provider } from "../providers";

export interface TabInfo {
  provider: Provider;
  id: string;
  title: string;
  status: PtyStatus | AgentStatus;
}

interface TabBarProps {
  tabs: TabInfo[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onCommands: () => void;
  onPlugins: () => void;
  workspace?: string;
}

export function conversationTitle(title: string): string {
  return /^(?:muse|New conversation) \d+$/.test(title) ? "New conversation" : title;
}

function sessionDetail(status: PtyStatus | AgentStatus): string {
  if (status.kind === "running") return "backend" in status ? "Terminal open" : "Working on it…";
  if (status.kind === "done") return "All caught up";
  if (status.kind === "error") return "Needs attention";
  if (status.kind === "exited") return "Terminal closed";
  if (status.kind === "starting") return "Getting ready…";
  return "Ready when you are";
}

export default function TabBar({ tabs, activeId, onSelect, onClose, onNew, onCommands, onPlugins, workspace }: TabBarProps) {
  const project = workspace?.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "Your workspace";
  return (
    <aside className="sidebar" aria-label="Conversations">
      <div className="sidebar-project" title={workspace}>
        <span className="project-icon"><Icon name="folder" size={21} /></span>
        <div><strong>{project}</strong><span>Current workspace</span></div>
      </div>
      <button type="button" className="tab-new" aria-label="New session (Ctrl+T)" title="New session (Ctrl+T)" onClick={onNew}>
        <Icon name="plus" size={19} /><span>New conversation</span>
      </button>
      <div className="sidebar-label"><span>Conversations</span><span>{tabs.length}</span></div>
      <div className="tablist" role="tablist" aria-label="Sessions" aria-orientation="vertical">
      {tabs.map((t, index) => (
        <button
          type="button"
          key={t.id}
          role="tab"
          data-session-id={t.id}
          aria-selected={t.id === activeId}
          aria-label={`${conversationTitle(t.title)}, ${sessionDetail(t.status)}`}
          tabIndex={t.id === activeId ? 0 : -1}
          aria-keyshortcuts="Delete"
          title={`${conversationTitle(t.title)} (Delete to close)`}
          className={`tab${t.id === activeId ? " active" : ""}`}
          onClick={() => onSelect(t.id)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Delete") { e.preventDefault(); onClose(t.id); return; }
            const next = e.key === "ArrowLeft" || e.key === "ArrowUp" ? (index + tabs.length - 1) % tabs.length
              : e.key === "ArrowRight" || e.key === "ArrowDown" ? (index + 1) % tabs.length
              : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
            if (next < 0) return;
            e.preventDefault();
            onSelect(tabs[next].id);
            (e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')[next])?.focus();
          }}
          onMouseUp={(e) => {
            if (e.button === 1) onClose(t.id);
          }}
        >
          <span className="conversation-icon"><Icon name="chat" size={19} /></span>
          <span className="tab-copy"><span className="tab-title">{conversationTitle(t.title)}</span><span className="tab-detail">{providerNames[t.provider]} · {sessionDetail(t.status)}</span></span>
          {t.status.kind === "running" && <span className="status-dot running" aria-hidden="true" />}
          <span
            className="tab-close"
            title={`Close ${conversationTitle(t.title)}`}
            aria-hidden="true"
            onClick={(e) => {
              e.stopPropagation();
              onClose(t.id);
            }}
          >
            <Icon name="close" size={13} />
          </span>
        </button>
      ))}
      </div>
      <div className="sidebar-footer">
        <button type="button" onClick={onPlugins} aria-label="Plugins" title="Plugins"><Icon name="code" size={18}/><span>Plugins</span></button>
        <button type="button" onClick={onCommands} aria-label="Command menu" title="Command menu (Ctrl+K)"><Icon name="command" size={18} /><span>Command menu</span><kbd>Ctrl K</kbd></button>
        <span className="sidebar-footnote">A little space to build something.</span>
      </div>
    </aside>
  );
}
