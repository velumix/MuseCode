import { useEffect, useRef, useState } from "react";
import type { MemoryNote, MemoryRequest, MemoryView } from "../memory";
import Icon from "./Icon";
import "./MemoryPanel.css";
const empty = (): MemoryNote => ({
  id: "",
  revision: "",
  title: "",
  body: "",
  tags: [],
  scope: "project",
  status: "active",
  pinned: false,
  source: "Saved by you",
  created_at: 0,
  updated_at: 0,
});
function seedExcerpt(text: string) {
  let bytes = 0,
    result = "";
  const encoder = new TextEncoder();
  for (const char of text) {
    bytes += encoder.encode(char).length;
    if (bytes > 6000) break;
    result += char;
  }
  return result;
}
export default function MemoryPanel({
  request,
  onClose,
  readOnly = false,
  openVault,
  seed,
}: {
  request: (request: MemoryRequest) => Promise<MemoryView>;
  onClose: () => void;
  readOnly?: boolean;
  openVault?: () => Promise<unknown>;
  seed?: string;
}) {
  const [view, setView] = useState<MemoryView | null>(null);
  const [excerpt] = useState(() => seedExcerpt(seed || ""));
  const [note, setNote] = useState<MemoryNote | null>(
    seed ? { ...empty(), body: excerpt } : null,
  );
  const [dirty, setDirty] = useState(!!seed);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<"discard" | "delete" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const focus = useRef<HTMLElement | null>(null);
  const confirmation = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!confirm) return;
    const previous = document.activeElement as HTMLElement;
    confirmation.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus();
  }, [confirm]);
  const requestRef = useRef(request);
  requestRef.current = request;
  const change = (patch: Partial<MemoryNote>) => {
    setNote((n) => (n ? { ...n, ...patch } : n));
    setDirty(true);
  };
  const close = () => {
    if (dirty) setConfirm("discard");
    else onClose();
  };
  useEffect(() => {
    let disposed = false;
    focus.current = document.activeElement as HTMLElement;
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    void requestRef
      .current({ action: "list", query: "" })
      .then((v) => {
        if (!disposed) setView(v);
      })
      .catch((e) => {
        if (!disposed) setError(String(e));
      });
    return () => {
      disposed = true;
      focus.current?.focus();
    };
  }, []);
  const run = async (
    value: MemoryRequest,
    after?: (view: MemoryView) => void,
  ) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await requestRef.current(value);
      setView(result);
      after?.(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const select = (next: MemoryNote) => {
    if (dirty) {
      setError("Save or cancel your changes before opening another note.");
      return;
    }
    setNote({ ...next, tags: [...next.tags] });
    setError("");
  };
  const save = (status = note?.status) => {
    if (!note || readOnly) return;
    void run(
      {
        action: "save",
        id: note.id || null,
        revision: note.revision || null,
        title: note.title,
        body: note.body,
        tags: note.tags,
        scope: note.scope,
        status: status || "active",
        pinned: note.pinned,
      },
      (result) => {
        setDirty(false);
        setNote(
          result.notes.find((n) => n.id === note.id) ||
            result.notes.find((n) => n.title === note.title.trim()) ||
            null,
        );
        setFilter(status || "active");
      },
    );
  };
  const notes =
    view?.notes.filter(
      (n) =>
        n.status === filter &&
        `${n.title} ${n.body} ${n.tags.join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ) || [];
  return (
    <div
      className="memory-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialog}
        className="memory-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="memory-title"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (confirm) setConfirm(null);
            else close();
          }
          if (e.key === "Tab") {
            const items = Array.from(
              (confirm
                ? confirmation
                : dialog
              ).current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
              ) || [],
            ).filter((el) => el.getClientRects().length);
            const first = items[0],
              last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header className="memory-header">
          <div>
            <span className="memory-eyebrow">Your local vault</span>
            <h2 id="memory-title">Memory</h2>
          </div>
          <button
            type="button"
            aria-label="Memory settings"
            onClick={() => setSettingsOpen((v) => !v)}
          >
            <Icon name="settings" />
          </button>
          <button type="button" aria-label="Close memory" onClick={close}>
            <Icon name="close" />
          </button>
        </header>
        <p className="memory-intro">
          Useful context, carried forward. Only relevant excerpts reach your
          agent.
        </p>
        {seed && excerpt !== seed && !note?.id && (
          <p className="memory-warning">
            This message was shortened. Keep the lasting fact or decision, then
            save it.
          </p>
        )}
        {error && (
          <div className="memory-error" role="alert">
            {error}
            {!view && error.includes("settings") && !readOnly && (
              <button
                type="button"
                onClick={() =>
                  void run({
                    action: "configure",
                    settings: {
                      enabled: true,
                      capture: "review",
                      budget_bytes: 3000,
                    },
                  })
                }
              >
                Reset memory settings
              </button>
            )}
          </div>
        )}
        {view?.warning && <p className="memory-warning">{view.warning}</p>}
        {!view && !error && (
          <p className="memory-loading" role="status">
            Opening your vault…
          </p>
        )}
        {settingsOpen && view && (
          <section className="memory-settings" aria-label="Memory settings">
            <label className="memory-check">
              <input
                type="checkbox"
                checked={view.settings.enabled}
                disabled={busy || readOnly}
                onChange={(e) =>
                  void run({
                    action: "configure",
                    settings: { ...view.settings, enabled: e.target.checked },
                  })
                }
              />
              Use memory for this project
            </label>
            <label>
              Learning
              <select
                aria-label="Memory learning"
                value={view.settings.capture}
                disabled={busy || readOnly}
                onChange={(e) =>
                  void run({
                    action: "configure",
                    settings: {
                      ...view.settings,
                      capture: e.target
                        .value as MemoryView["settings"]["capture"],
                    },
                  })
                }
              >
                <option value="review">Suggest notes for review</option>
                <option value="automatic">Save new notes automatically</option>
                <option value="manual">Only notes I save myself</option>
              </select>
            </label>
            <label>
              Context limit
              <select
                aria-label="Memory context limit"
                value={view.settings.budget_bytes}
                disabled={busy || readOnly}
                onChange={(e) =>
                  void run({
                    action: "configure",
                    settings: {
                      ...view.settings,
                      budget_bytes: Number(e.target.value),
                    },
                  })
                }
              >
                <option value={1000}>1 KB · smallest</option>
                <option value={3000}>3 KB · balanced</option>
                <option value={8000}>8 KB · more context</option>
              </select>
            </label>
            <p>
              The limit includes memory instructions. Unchanged excerpts are
              reused for up to 8 turns. No embeddings or extra AI calls.
              Selected notes are sent to the CLI you choose.
            </p>
            <p>
              Automatic learning adds project notes. Conflicting titles wait for
              review. Turning memory off stops new context; start a fresh
              conversation to clear earlier context.
            </p>
            {openVault && (
              <button
                type="button"
                onClick={() =>
                  void openVault().catch((e) => setError(String(e)))
                }
              >
                <Icon name="folder" size={15} />
                Open vault folder
              </button>
            )}
            <small>{view.root}</small>
          </section>
        )}
        <div className={`memory-layout${note ? " has-note" : ""}`}>
          <aside className="memory-library" aria-label="Memory notes">
            <div className="memory-search">
              <Icon name="search" size={16} />
              <input
                aria-label="Search memories"
                value={query}
                placeholder="Find a note…"
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div
              className="memory-filters"
              role="group"
              aria-label="Note status"
            >
              {["active", "pending", "archived"].map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {value === "pending"
                    ? "Review"
                    : value === "active"
                      ? "Saved"
                      : "Archived"}
                  <span>
                    {view?.notes.filter((n) => n.status === value).length || 0}
                  </span>
                </button>
              ))}
            </div>
            <div className="memory-library-actions">
              <button
                type="button"
                disabled={readOnly || busy}
                onClick={() => select(empty())}
              >
                <Icon name="plus" size={15} />
                New note
              </button>
              <button
                type="button"
                aria-label="Refresh memories"
                disabled={busy || dirty}
                onClick={() =>
                  void run({ action: "list", query: "" }, () => setNote(null))
                }
              >
                <Icon name="reset" size={15} />
              </button>
            </div>
            <div className="memory-list">
              {notes.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  aria-pressed={note?.id === n.id}
                  onClick={() => select(n)}
                >
                  <strong>{n.title}</strong>
                  <p>{n.body.slice(0, 110)}</p>
                  <small>
                    {n.scope === "shared"
                      ? "Shared preference"
                      : "This project"}
                    {n.pinned ? " · Pinned" : ""}
                  </small>
                </button>
              ))}
              {view && !notes.length && (
                <p className="memory-empty">
                  {query
                    ? "No notes match your search."
                    : filter === "pending"
                      ? "Suggested memories will appear here after a successful turn."
                      : filter === "archived"
                        ? "Archived notes stay out of agent context."
                        : "Save a preference, project decision or useful detail. Your next conversation can recall it."}
                </p>
              )}
            </div>
          </aside>
          <section className="memory-editor" aria-label="Memory editor">
            {note ? (
              <>
                <button
                  className="memory-back"
                  type="button"
                  onClick={() => {
                    if (dirty) setError("Save or cancel your changes first.");
                    else setNote(null);
                  }}
                >
                  ← All notes
                </button>
                <label>
                  Title
                  <input
                    aria-label="Memory title"
                    value={note.title}
                    maxLength={160}
                    disabled={readOnly || busy}
                    onChange={(e) => change({ title: e.target.value })}
                    placeholder="What should carry forward?"
                  />
                </label>
                <label className="memory-body-label">
                  Note
                  <textarea
                    aria-label="Memory note"
                    value={note.body}
                    maxLength={8000}
                    disabled={readOnly || busy}
                    onChange={(e) => change({ body: e.target.value })}
                    placeholder="One useful fact or decision. Keep it concise."
                  />
                </label>
                <label>
                  Tags
                  <input
                    aria-label="Memory tags"
                    value={note.tags.join(", ")}
                    disabled={readOnly || busy}
                    onChange={(e) =>
                      change({
                        tags: e.target.value
                          .split(",")
                          .map((t) => t.trimStart())
                          .slice(0, 12),
                      })
                    }
                    placeholder="deployment, preferences, database"
                  />
                </label>
                <div className="memory-note-options">
                  <label>
                    Scope
                    <select
                      aria-label="Memory scope"
                      value={note.scope}
                      disabled={readOnly || busy}
                      onChange={(e) =>
                        change({ scope: e.target.value as MemoryNote["scope"] })
                      }
                    >
                      <option value="project">This project</option>
                      <option value="shared">Shared across projects</option>
                    </select>
                  </label>
                  <label className="memory-check">
                    <input
                      type="checkbox"
                      checked={note.pinned}
                      disabled={readOnly || busy}
                      onChange={(e) => change({ pinned: e.target.checked })}
                    />
                    Pin for regular recall
                  </label>
                </div>
                <p className="memory-source">
                  {note.source}
                  {note.updated_at
                    ? ` · ${new Date(note.updated_at * 1000).toLocaleDateString()}`
                    : ""}{" "}
                  · Plain Markdown
                </p>
                {note.status === "pending" && (
                  <p className="memory-warning">
                    This suggestion is not used until you save it.
                  </p>
                )}
                {!readOnly && (
                  <div className="memory-editor-actions">
                    <button
                      className="memory-primary"
                      type="button"
                      disabled={busy || !note.title.trim() || !note.body.trim()}
                      onClick={() =>
                        save(note.status === "pending" ? "active" : note.status)
                      }
                    >
                      {busy
                        ? "Saving…"
                        : note.status === "pending"
                          ? "Approve & save"
                          : "Save note"}
                    </button>
                    {dirty && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setDirty(false);
                          setNote(
                            view?.notes.find((n) => n.id === note.id) || null,
                          );
                          setError("");
                        }}
                      >
                        Cancel edits
                      </button>
                    )}
                    {note.id && !dirty && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            save(
                              note.status === "archived"
                                ? "active"
                                : "archived",
                            )
                          }
                        >
                          {note.status === "archived" ? "Restore" : "Archive"}
                        </button>
                        <button
                          type="button"
                          className="memory-delete"
                          disabled={busy}
                          onClick={() => setConfirm("delete")}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="memory-placeholder">
                <Icon name="memory" size={36} />
                <h3>A little context goes a long way.</h3>
                <p>
                  Select a note to read or edit it. Your vault works across
                  Muse, Codex and Antigravity in Agent mode.
                </p>
                <p>
                  Open the folder in Obsidian to browse the same Markdown files.
                </p>
                {readOnly && <small>This phone has view-only access.</small>}
              </div>
            )}
          </section>
        </div>
        {confirm && (
          <div className="memory-confirm-backdrop">
            <div
              ref={confirmation}
              className="memory-confirm"
              role="alertdialog"
              aria-modal="true"
              aria-label={
                confirm === "delete" ? "Delete memory" : "Discard changes"
              }
            >
              <p>
                {confirm === "delete"
                  ? "Permanently delete this note from the vault?"
                  : "Discard your unsaved changes?"}
              </p>
              <button type="button" onClick={() => setConfirm(null)}>
                Keep editing
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (confirm === "discard") onClose();
                  else if (note)
                    void run(
                      {
                        action: "delete",
                        id: note.id,
                        revision: note.revision,
                      },
                      () => {
                        setNote(null);
                        setDirty(false);
                        setConfirm(null);
                      },
                    );
                }}
              >
                {confirm === "delete" ? "Delete permanently" : "Discard"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
