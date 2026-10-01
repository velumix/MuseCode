import { useEffect, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { flushDesktop } from "./desktopHistory";
import { flushPreferences } from "./preferences";

export interface UpdateStatus {
  revision: number;
  supported: boolean;
  automatic: boolean;
  current_version: string;
  phase: "idle" | "checking" | "current" | "available" | "downloading" | "ready" | "installing" | "error";
  version: string | null;
  downloaded: number;
  total: number | null;
  checked_at: string | null;
  error: string | null;
}

let status: UpdateStatus | null = null;
let initialization: Promise<void> | undefined;
const subscribers = new Set<() => void>();
function accept(next: UpdateStatus) {
  if (!next || (status && next.revision < status.revision)) return;
  status = next;
  for (const subscriber of subscribers) subscriber();
}
function initialize() {
  if (initialization) return initialization;
  initialization = (async () => {
    // Subscribe before loading the snapshot, then use the native revision to
    // reject responses overtaken by progress or preference events.
    await listen<UpdateStatus>("app-update-status", (event) => accept(event.payload));
    accept(await invoke<UpdateStatus>("updates_status"));
  })().catch(() => { /* Browser previews do not have an updater. */ });
  return initialization;
}

export function useUpdates() {
  const current = useSyncExternalStore(
    (subscriber) => { subscribers.add(subscriber); return () => subscribers.delete(subscriber); },
    () => status,
  );
  useEffect(() => { void initialize(); }, []);
  return current;
}
async function command(name: string, args?: Record<string, unknown>) {
  accept(await invoke<UpdateStatus>(name, args));
}
export const checkForUpdates = () => command("updates_check");
export const downloadUpdate = () => command("updates_download");
export const setAutomaticUpdates = (automatic: boolean) => command("updates_set_automatic", { automatic });
export async function restartToUpdate() {
  // Submit current drafts, tab state and pending preferences before the native
  // history flush. A failed save keeps the current app open.
  await Promise.all([flushDesktop(), flushPreferences()]);
  await invoke("updates_install");
}

export function updateMessage(status: UpdateStatus | null) {
  if (!status) return "Update status unavailable";
  switch (status.phase) {
    case "idle": return "Ready to check for updates";
    case "checking": return "Checking for updates…";
    case "current": return "You’re up to date";
    case "available": return `Velum Code ${status.version} is available`;
    case "downloading": return `Downloading Velum Code ${status.version}…`;
    case "ready": return `Velum Code ${status.version} is ready to install`;
    case "installing": return "Restarting to update…";
    case "error": return "Couldn’t finish the update";
  }
}
