export type Provider = "muse" | "codex" | "antigravity";
export const providerNames: Record<Provider, string> = { muse: "Muse", codex: "Codex", antigravity: "Antigravity" };
export interface RunOptions { model: string; reasoning: string }
export const defaultOptions: RunOptions = { model: "", reasoning: "" };
export interface ModelInfo { id: string; label: string; description: string; efforts: string[]; default_effort: string }
export interface ModelCatalog { models: ModelInfo[]; notice: string | null }
export function preferredOptions(provider: Provider): RunOptions {
  try { const value = JSON.parse(localStorage.getItem(`velum-options-${provider}`) || "{}"); return { model: typeof value.model === "string" ? value.model : "", reasoning: typeof value.reasoning === "string" ? value.reasoning : "" }; } catch { return { ...defaultOptions }; }
}
export function saveOptions(provider: Provider, options: RunOptions) {
  try { localStorage.setItem(`velum-options-${provider}`, JSON.stringify(options)); } catch { /* Preferences are optional. */ }
}
export function preferredProvider(): Provider {
  try { const value = localStorage.getItem("velum-provider"); if (value === "codex" || value === "antigravity") return value; } catch { /* Storage is optional. */ }
  return "muse";
}
