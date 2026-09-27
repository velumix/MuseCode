import type { Provider, RunOptions } from "./providers";
import { invoke } from "@tauri-apps/api/core";
export interface SavedTab {
  id: string;
  title: string;
  workspace?: string;
  provider: Provider;
  options: RunOptions;
}
const KEY = "velum-desktop-tabs-v1";
const DRAFT = "velum-desktop-draft-";
let queued = false;
export let recoveryError: string | null = null;
function checkpoint() {
  if (queued) return;
  queued = true;
  // One native update per rendering batch. Disk snapshots are coalesced by Rust.
  queueMicrotask(() => {
    queued = false;
    const desktop = loadDesktop();
    const drafts = Object.fromEntries(
      desktop.tabs.map((t) => [t.id, readDraft(t.id)]),
    );
    void invoke("history_desktop_save", {
      snapshot: { ...desktop, drafts },
    }).catch((error) => {
      window.dispatchEvent(
        new CustomEvent("velum:recovery-error", { detail: String(error) }),
      );
    });
  });
}
export async function initializeDesktop() {
  try {
    const saved = await invoke<{
      tabs: SavedTab[];
      activeId: string;
      drafts: Record<string, string>;
    } | null>("history_desktop_load");
    if (!saved || !Array.isArray(saved.tabs)) return;
    localStorage.setItem(
      KEY,
      JSON.stringify({ tabs: saved.tabs, activeId: saved.activeId }),
    );
    for (const tab of loadDesktop().tabs) {
      const draft = saved.drafts?.[tab.id];
      if (typeof draft === "string")
        localStorage.setItem(DRAFT + tab.id, draft.slice(0, 64000));
      else localStorage.removeItem(DRAFT + tab.id);
    }
  } catch (error) {
    recoveryError = `Could not load the recovery checkpoint: ${String(error)}`;
  }
}
export function loadDesktop(): { tabs: SavedTab[]; activeId: string } {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!value || !Array.isArray(value.tabs)) return { tabs: [], activeId: "" };
    const seen = new Set<string>();
    const tabs: SavedTab[] = value.tabs
      .slice(0, 32)
      .filter((t: SavedTab) => {
        if (
          !t ||
          typeof t.id !== "string" ||
          !/^[a-zA-Z0-9_-]{1,150}$/.test(t.id) ||
          seen.has(t.id) ||
          !["muse", "codex", "antigravity"].includes(t.provider) ||
          typeof t.title !== "string" ||
          t.title.length > 200 ||
          (t.workspace !== undefined &&
            (typeof t.workspace !== "string" || t.workspace.length > 4096))
        )
          return false;
        seen.add(t.id);
        return true;
      })
      .map((t: SavedTab) => ({
        id: t.id,
        title: t.title,
        workspace: t.workspace,
        provider: t.provider,
        options: {
          model: typeof t.options?.model === "string" ? t.options.model : "",
          reasoning:
            typeof t.options?.reasoning === "string" ? t.options.reasoning : "",
        },
      }));
    return {
      tabs,
      activeId:
        typeof value.activeId === "string" &&
        tabs.some((t) => t.id === value.activeId)
          ? value.activeId
          : tabs[0]?.id || "",
    };
  } catch {
    return { tabs: [], activeId: "" };
  }
}
export function saveDesktop(tabs: SavedTab[], activeId: string) {
  const data = JSON.stringify({
    tabs: tabs.map(({ id, title, workspace, provider, options }) => ({
      id,
      title,
      workspace,
      provider,
      options,
    })),
    activeId,
  });
  if (localStorage.getItem(KEY) !== data) {
    localStorage.setItem(KEY, data);
    checkpoint();
  }
}
export function readDraft(id: string) {
  try {
    return (localStorage.getItem(DRAFT + id) || "").slice(0, 64000);
  } catch {
    return "";
  }
}
export function saveDraft(id: string, text: string) {
  if (readDraft(id) === text) return;
  if (text) localStorage.setItem(DRAFT + id, text.slice(0, 64000));
  else localStorage.removeItem(DRAFT + id);
  void invoke("history_draft_save", { tabId: id, text }).catch((error) => {
    window.dispatchEvent(
      new CustomEvent("velum:recovery-error", { detail: String(error) }),
    );
  });
}
