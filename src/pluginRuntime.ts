import { invoke } from "@tauri-apps/api/core";
import type { PluginManifest, PluginResult } from "./plugins";

import bridge from "./pluginBridge.js?raw";
let occupied = false;
export async function runPlugin({
  id,
  command,
  input,
  workspace,
  messages,
  signal,
}: {
  id: string;
  command: string;
  input: string;
  workspace: string;
  messages: () => { role: string; text: string }[];
  signal: AbortSignal;
}): Promise<PluginResult> {
  if (occupied) throw new Error("Another plugin command is running.");
  if (signal.aborted) throw new Error("Command cancelled.");
  if (input.length > 16_000)
    throw new Error("Command input is limited to 16,000 characters.");
  occupied = true;
  try {
    const { manifest, source } = await invoke<{
      manifest: PluginManifest;
      source: string;
    }>("plugins_source", { id, command });
    if (signal.aborted) throw new Error("Command cancelled.");
    return await new Promise<PluginResult>((resolve, reject) => {
      const frame = document.createElement("iframe");
      frame.hidden = true;
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("aria-hidden", "true");
      frame.title = "Plugin command sandbox";
      const nonce = crypto.randomUUID().replace(/-/g, "");
      frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' blob:; worker-src blob:; connect-src 'none'; img-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><script nonce="${nonce}">${bridge}<\/script>`;
      const channel = new MessageChannel();
      let finished = false,
        requests = 0,
        outstanding = 0;
      const finish = (error?: Error, result?: PluginResult) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        channel.port1.postMessage({ stop: true });
        channel.port1.close();
        frame.remove();
        if (error) reject(error);
        else resolve(result!);
      };
      const cancel = () => finish(new Error("Command cancelled."));
      const timer = window.setTimeout(
        () =>
          finish(new Error("Command stopped after the 5-second time limit.")),
        5000,
      );
      signal.addEventListener("abort", cancel, { once: true });
      channel.port1.onmessage = async ({ data }) => {
        if (finished) return;
        if (!data || typeof data !== "object")
          return finish(new Error("Invalid plugin response."));
        if (data.type === "error")
          return finish(new Error(String(data.error).slice(0, 1000)));
        if (data.type === "result") {
          const r = data.result;
          if (
            !r ||
            typeof r.text !== "string" ||
            new TextEncoder().encode(r.text).length > 32_768 ||
            (r.title !== undefined &&
              (typeof r.title !== "string" || r.title.length > 120))
          )
            return finish(
              new Error(
                "Plugin output must contain text, up to 32 KB, and an optional short title.",
              ),
            );
          return finish(undefined, { text: r.text, title: r.title });
        }
        if (
          data.type !== "call" ||
          !Number.isSafeInteger(data.id) ||
          ++requests > 64 ||
          ++outstanding > 8
        )
          return finish(new Error("Plugin exceeded its API request limit."));
        try {
          if (JSON.stringify(data.args).length > 34_000)
            throw new Error("Plugin request is too large.");
          let value: unknown;
          if (data.method === "conversation.messages") {
            if (!manifest.permissions.includes("conversation.read"))
              throw new Error("Permission required: conversation.read");
            value = messages()
              .slice(-40)
              .map((m) => ({ role: m.role, text: m.text.slice(0, 4000) }));
          } else if (
            [
              "workspace.readText",
              "workspace.listFiles",
              "storage.get",
              "storage.set",
            ].includes(data.method)
          ) {
            const permission = data.method.startsWith("workspace.")
              ? "workspace.read"
              : "storage";
            if (!manifest.permissions.includes(permission))
              throw new Error(`Permission required: ${permission}`);
            if (permission === "workspace.read" && !workspace)
              throw new Error("Open a workspace before running this command.");
            value = await invoke("plugins_call", {
              id,
              workspace,
              method: data.method,
              args: data.args,
            });
          } else throw new Error("Unsupported plugin API method.");
          if (!finished) channel.port1.postMessage({ id: data.id, value });
        } catch (error) {
          if (!finished)
            channel.port1.postMessage({
              id: data.id,
              error: String(error).slice(0, 1000),
            });
        } finally {
          outstanding--;
        }
      };
      frame.onload = () =>
        frame.contentWindow?.postMessage({ source, command, input }, "*", [
          channel.port2,
        ]);
      document.body.append(frame);
    });
  } finally {
    occupied = false;
  }
}
