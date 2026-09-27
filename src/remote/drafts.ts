const KEY = "velum-phone-drafts-v1";
const TTL = 7 * 24 * 60 * 60 * 1000;
export function loadDrafts(): Record<string, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (
      !saved ||
      typeof saved.time !== "number" ||
      Date.now() - saved.time > TTL ||
      typeof saved.drafts !== "object"
    )
      return {};
    return Object.fromEntries(
      Object.entries(saved.drafts)
        .filter(
          ([id, text]) =>
            id.length < 200 && typeof text === "string" && text.length <= 16000,
        )
        .slice(-20),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}
export function saveDrafts(drafts: Record<string, string>) {
  try {
    const entries = Object.entries(drafts)
      .filter(([, text]) => text.trim())
      .slice(-20);
    if (entries.length) {
      const content = Object.fromEntries(entries);
      const previous = JSON.parse(localStorage.getItem(KEY) || "null");
      if (
        previous &&
        JSON.stringify(previous.drafts) === JSON.stringify(content)
      )
        return;
      localStorage.setItem(
        KEY,
        JSON.stringify({
          time: Date.now(),
          drafts: content,
        }),
      );
    } else localStorage.removeItem(KEY);
  } catch {
    /* In-memory drafts remain available if storage is full. */
  }
}
export function loadSelection() {
  try {
    return (localStorage.getItem("velum-phone-session") || "").slice(0, 200);
  } catch {
    return "";
  }
}
export function saveSelection(id: string) {
  try {
    localStorage.setItem("velum-phone-session", id);
  } catch {
    /* Optional storage. */
  }
}
export function clearDrafts() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem("velum-phone-session");
  } catch {
    /* Optional storage. */
  }
}
