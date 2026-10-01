import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { UpdateStatus } from "./updates";

interface StartupResult {
  restarting: boolean;
  status: UpdateStatus;
}

/** Runs in the small entry bundle, before React, history or providers load. */
export async function runStartupUpdates(): Promise<boolean> {
  const message = document.getElementById("startup-message");
  const detail = document.getElementById("startup-detail");
  const progress = document.getElementById("startup-progress");
  const skip = document.getElementById("startup-skip") as HTMLButtonElement | null;
  let latestRevision = -1;
  let unlisten: UnlistenFn | undefined;
  let installing = false;
  const opening = () => {
    if (message) message.textContent = "Opening your workspace…";
    if (detail) detail.textContent = "";
    if (progress) { delete progress.dataset.percent; progress.removeAttribute("aria-valuenow"); }
    if (skip) skip.hidden = true;
  };
  const paint = (status: UpdateStatus) => {
    if (!status || status.revision < latestRevision) return;
    latestRevision = status.revision;
    installing = status.phase === "installing";
    if (skip) skip.hidden = !status.supported || !status.automatic || installing;
    let title = "Checking for updates…";
    let subtitle = "";
    let percent: number | undefined;
    if (status.phase === "downloading") {
      title = `Downloading Velum Code ${status.version}…`;
      if (status.total && status.total > 0) {
        percent = Math.min(100, Math.max(0, Math.floor(status.downloaded / status.total * 100)));
        subtitle = `${percent}%`;
      }
    } else if (status.phase === "ready" || installing) {
      title = installing ? "Installing update…" : "Update verified";
      subtitle = "Velum Code will reopen automatically";
      percent = 100;
    }
    if (message) message.textContent = title;
    if (detail) detail.textContent = subtitle;
    if (progress) {
      if (percent === undefined) {
        delete progress.dataset.percent;
        progress.removeAttribute("aria-valuenow");
      } else {
        progress.dataset.percent = String(percent);
        progress.style.setProperty("--startup-progress", `${percent}%`);
        progress.setAttribute("aria-valuenow", String(percent));
      }
    }
  };
  const continueWithCurrent = async () => {
    if (!skip || skip.disabled || installing) return;
    skip.disabled = true;
    try {
      await invoke("updates_skip_startup");
      // Wait for the startup command to cancel and release its network work.
      opening();
    } catch {
      skip.disabled = false;
    }
  };
  if (!isTauri()) { opening(); return true; }
  skip?.addEventListener("click", continueWithCurrent);
  try {
    // A missing event listener must not prevent the native startup gate running.
    unlisten = await listen<UpdateStatus>("app-update-status", event => paint(event.payload)).catch(() => undefined);
    paint(await invoke<UpdateStatus>("updates_status"));
    const result = await invoke<StartupResult>("updates_startup");
    paint(result.status);
    if (result.restarting) return false;
    opening();
    return true;
  } catch {
    // If IPC failed before the command ran, release the native work gate too.
    // Native installation is irreversible once admitted; keep the screen then.
    try { await invoke("updates_skip_startup"); }
    catch { return false; }
    opening();
    return true;
  } finally {
    unlisten?.();
    skip?.removeEventListener("click", continueWithCurrent);
  }
}
