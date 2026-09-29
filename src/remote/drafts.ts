const KEY = "velum-phone-drafts-v1";
const DATABASE = "velum-phone-drafts";
const TTL = 7 * 24 * 60 * 60 * 1000;
interface Saved { time: number; drafts: Record<string, string> }
let writes: Promise<void> = Promise.resolve();
let latest = 0;
let lastContent = "";
let generation = 0;

function valid(value: unknown): Saved | null {
  if (!value || typeof value !== "object") return null;
  const saved = value as Saved;
  if (!Number.isFinite(saved.time) || Date.now() - saved.time > TTL || !saved.drafts || typeof saved.drafts !== "object" || Array.isArray(saved.drafts)) return null;
  return { time: saved.time, drafts: Object.fromEntries(Object.entries(saved.drafts)
    .filter(([id, text]) => id.length < 200 && typeof text === "string" && text.length <= 16000).slice(-20)) };
}
function local(): Saved | null {
  try { return valid(JSON.parse(localStorage.getItem(KEY) || "null")); } catch { return null; }
}
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    // Fall back instead of locking the composer if storage is unavailable.
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error("Draft storage unavailable")); }, 2000);
    request.onupgradeneeded = () => request.result.createObjectStore("state");
    request.onsuccess = () => { clearTimeout(timer); if (expired) request.result.close(); else resolve(request.result); };
    request.onerror = () => { clearTimeout(timer); reject(request.error); };
  });
}
async function read(): Promise<Saved | null> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("state", "readonly");
      const request = tx.objectStore("state").get(KEY);
      tx.oncomplete = () => resolve(valid(request.result));
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
function persist(saved: Saved) {
  // Keep deletion ordered after edits. Strict durability asks WebView to
  // flush before commit, unlike its delayed localStorage disk writes.
  writes = writes.then(async () => {
    const db = await open();
    try {
      await new Promise<void>((resolve, reject) => {
        let tx: IDBTransaction;
        try { tx = db.transaction("state", "readwrite", { durability: "strict" }); }
        catch { tx = db.transaction("state", "readwrite"); }
        tx.objectStore("state").put(saved, KEY);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }).catch(() => { /* Local storage and the in-memory draft remain available. */ });
}

export async function loadDrafts(): Promise<Record<string, string>> {
  const revision = generation;
  const fallback = local();
  const durable = await read().catch(() => null);
  if (generation !== revision) return {}; // Access was revoked during hydration.
  const saved = durable && (!fallback || durable.time >= fallback.time) ? durable : fallback;
  latest = Math.max(latest, saved?.time || 0);
  lastContent = JSON.stringify(saved?.drafts || {});
  if (saved) {
    try { if (Object.keys(saved.drafts).length) localStorage.setItem(KEY, JSON.stringify(saved)); else localStorage.removeItem(KEY); } catch { /* Optional fallback. */ }
    if (saved !== durable) persist(saved); // Migrate existing phone drafts.
  }
  return saved?.drafts || {};
}
export function saveDrafts(drafts: Record<string, string>) {
  const content = Object.fromEntries(Object.entries(drafts).filter(([, text]) => text.trim()).slice(-20));
  const serialized = JSON.stringify(content);
  if (serialized === lastContent) return;
  lastContent = serialized;
  const saved = { time: latest = Math.max(Date.now(), latest + 1), drafts: content };
  try { if (Object.keys(content).length) localStorage.setItem(KEY, JSON.stringify(saved)); else localStorage.removeItem(KEY); } catch { /* Durable storage may still succeed. */ }
  persist(saved);
}
export function loadSelection() {
  try { return (localStorage.getItem("velum-phone-session") || "").slice(0, 200); } catch { return ""; }
}
export function saveSelection(id: string) {
  try { localStorage.setItem("velum-phone-session", id); } catch { /* Optional storage. */ }
}
export function clearDrafts() {
  generation++;
  try { localStorage.removeItem(KEY); localStorage.removeItem("velum-phone-session"); } catch { /* Optional fallback. */ }
  lastContent = "{}";
  // A durable empty record prevents an older fallback from resurrecting
  // revoked drafts after Android terminates the process.
  persist({ time: latest = Math.max(Date.now(), latest + 1), drafts: {} });
}
