export type Provider = "muse" | "codex" | "antigravity";
export const providerNames: Record<Provider, string> = { muse: "Muse", codex: "Codex", antigravity: "Antigravity" };
export function preferredProvider(): Provider {
  try { const value = localStorage.getItem("velum-provider"); if (value === "codex" || value === "antigravity") return value; } catch { /* Storage is optional. */ }
  return "muse";
}
