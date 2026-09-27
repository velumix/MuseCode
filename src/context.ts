import type { Provider, RunOptions } from './providers';

export interface AccessCheck {
  path: string;
  checked_at: number;
  readable: boolean;
  writable: boolean | null;
  message: string;
}
export interface Diagnostics {
  app: string;
  version: string;
  host_os: string;
  checked_at: number;
  workspace: { directory_listing: boolean; git_repository: boolean; message: string };
  providers: { provider: Provider; installed: boolean; authentication: string; tool_connections: string }[];
  memory: { readable: boolean; enabled?: boolean; notes?: number; budget_bytes?: number; capture?: string };
  sessions: { active: number; failed: number; blocked: number };
}

// A layout snapshot of the active chat, not a screenshot or DOM text dump.
// Only known UI regions are inspected. No values, message text, titles, URLs,
// drafts or hidden conversations can enter the snapshot.
export function chatSnapshot(root: HTMLElement | null, provider: Provider, options: RunOptions, running: boolean, source: 'desktop' | 'phone') {
  const regions = ['.chat-scroll', '.composer', '.workspace-bar', '.phone-models', '.phone-transcript', '.phone-composer'];
  const layout = regions.flatMap(selector => {
    const element = root?.querySelector<HTMLElement>(selector);
    if (!element || !element.getClientRects().length) return [];
    const r = element.getBoundingClientRect();
    return [{ region: selector.slice(1), x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), horizontal_overflow: element.scrollWidth > element.clientWidth + 2 }];
  });
  return JSON.stringify({ type: 'Velum chat layout snapshot', captured_at: new Date().toISOString(), source,
    viewport: { width: window.innerWidth, height: window.innerHeight, pixel_ratio: window.devicePixelRatio },
    provider, options, running, layout,
    rendered_message_count: root?.querySelectorAll('.msg, .phone-message').length || 0,
    excluded: 'Message text, drafts, workspace paths, other tabs, dialogs and credentials. This is a structural view, not a screenshot or live UI connection.',
  }, null, 2);
}

export function attachment(label: string, text: string) {
  return `\n\n[${label} — reference data captured by Velum]\n\`\`\`json\n${text}\n\`\`\``;
}
