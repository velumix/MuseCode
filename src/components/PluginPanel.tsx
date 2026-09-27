import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import Icon from "./Icon";
import {
  permissionLabels,
  type InstalledPlugin,
  type PluginPreview,
  type PluginResult,
} from "../plugins";
import "./PluginPanel.css";

export interface PluginSelection {
  id: string;
  command: string;
}
export default function PluginPanel({
  plugins,
  selection,
  onRefresh,
  onClose,
  workspace,
  messages,
  onInsert,
}: {
  plugins: InstalledPlugin[];
  selection?: PluginSelection;
  onRefresh: () => Promise<void>;
  onClose: () => void;
  workspace: string;
  messages: () => { role: string; text: string }[];
  onInsert: (text: string) => void;
}) {
  const [repository, setRepository] = useState("");
  const [preview, setPreview] = useState<PluginPreview | null>(null);
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<PluginSelection | undefined>(
    selection,
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PluginResult | null>(null);
  const [duration, setDuration] = useState(0);
  const [remove, setRemove] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const plugin = plugins.find((p) => p.manifest.id === selected?.id);
  const command = plugin?.manifest.commands.find(
    (c) => c.id === selected?.command,
  );
  useEffect(() => {
    if (result)
      panel.current
        ?.querySelector(".plugin-result")
        ?.scrollIntoView({ block: "nearest" });
  }, [result]);
  useEffect(() => {
    const body = panel.current?.querySelector(".plugin-body");
    if (body) body.scrollTop = 0;
  }, [selected?.id, selected?.command]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    panel.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      controller.current?.abort();
      previous?.focus();
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const execute = () =>
    void run(async () => {
      if (!selected) return;
      setResult(null);
      const abort = new AbortController();
      controller.current = abort;
      const start = performance.now();
      try {
        const { runPlugin } = await import("../pluginRuntime");
        setResult(
          await runPlugin({
            ...selected,
            input,
            workspace,
            messages,
            signal: abort.signal,
          }),
        );
        setDuration(Math.round(performance.now() - start));
      } finally {
        controller.current = null;
      }
    });
  const review = (repo: string, expectedId?: string) =>
    void run(async () => {
      setNotice("");
      setPreview(null);
      const next = await invoke<PluginPreview>("plugins_preview", {
        repository: repo,
      });
      if (expectedId && next.manifest.id !== expectedId)
        throw new Error(
          "This repository changed its plugin ID. Review it as a new installation.",
        );
      const current = plugins.find((p) => p.manifest.id === next.manifest.id);
      if (
        current?.origin?.commit === next.origin.commit &&
        current.digest === next.digest
      ) {
        setNotice(`${next.manifest.name} is up to date.`);
        return;
      }
      setRepository(next.origin.repository);
      setPreview(next);
      requestAnimationFrame(() =>
        panel.current
          ?.querySelector(".plugin-install")
          ?.scrollIntoView({ block: "start" }),
      );
    });
  return (
    <div
      className="plugin-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="plugin-panel"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugins-title"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
          if (e.key !== "Tab") return;
          const nodes = Array.from(
            panel.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input, textarea, a[href]",
            ) || [],
          ).filter((el) => el.offsetParent !== null);
          const first = nodes[0],
            last = nodes[nodes.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          }
          if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="plugin-header">
          <div>
            <span className="plugin-eyebrow">Make it your own</span>
            <h2 id="plugins-title">Plugins</h2>
          </div>
          <button
            className="plugin-close"
            aria-label="Close plugins"
            onClick={onClose}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <p className="plugin-intro">
          Small tools, right where you work. Commands run only when you ask and
          stop when they finish.
        </p>
        {error && (
          <p className="plugin-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="plugin-notice" role="status">
            {notice}
          </p>
        )}
        <div className="plugin-body">
          {selected && plugin?.enabled ? (
            <button
              className="plugin-back"
              onClick={() => {
                controller.current?.abort();
                setSelected(undefined);
                setResult(null);
              }}
            >
              ← All plugins
            </button>
          ) : (
            <>
              <section className="plugin-install" aria-label="Install a plugin">
                <h3>Install from GitHub</h3>
                <p>
                  Every plugin is a repository. Paste its public GitHub URL to
                  review its commands and permissions.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    review(repository.trim());
                  }}
                >
                  <input
                    aria-label="GitHub repository"
                    placeholder="owner/repository or GitHub URL"
                    value={repository}
                    onChange={(e) => {
                      setRepository(e.target.value);
                      setPreview(null);
                      setNotice("");
                    }}
                    disabled={busy}
                  />
                  <button disabled={busy || !repository.trim()}>
                    {busy ? "Please wait…" : "Review plugin"}
                  </button>
                </form>
                <button
                  className="plugin-example"
                  disabled={busy}
                  onClick={() => review("velumix/velum-plugin-project-tools")}
                >
                  Try Project tools by Velumix
                </button>
                {preview && (
                  <div className="plugin-review">
                    <div className="plugin-card-heading">
                      <strong>{preview.manifest.name}</strong>
                      <span>
                        v{preview.manifest.version} ·{" "}
                        {Math.ceil(preview.bytes / 1024)} KB
                      </span>
                    </div>
                    <p>{preview.manifest.description}</p>
                    <p>By {preview.manifest.author} · Publisher not verified</p>
                    <p className="plugin-origin">
                      {preview.origin.repository} · Commit{" "}
                      {preview.origin.commit.slice(0, 7)}{" "}
                      <button
                        disabled={busy}
                        onClick={() =>
                          void openUrl(
                            `https://github.com/${preview.origin.repository}/tree/${preview.origin.commit}`,
                          ).catch((e) => setError(String(e)))
                        }
                      >
                        View source ↗
                      </button>
                    </p>
                    {plugins.some(
                      (p) => p.manifest.id === preview.manifest.id,
                    ) && (
                      <p>
                        Update from v
                        {
                          plugins.find(
                            (p) => p.manifest.id === preview.manifest.id,
                          )?.manifest.version
                        }
                        . Existing settings and enabled state are kept.
                      </p>
                    )}
                    <h4>This plugin can</h4>
                    <ul>
                      {preview.manifest.permissions.map((p) => (
                        <li key={p}>
                          {permissionLabels[p]}
                          {plugins.some(
                            (old) =>
                              old.manifest.id === preview.manifest.id &&
                              !old.manifest.permissions.includes(p),
                          ) && (
                            <strong className="plugin-new-permission">
                              {" "}
                              New permission
                            </strong>
                          )}
                        </li>
                      ))}
                      {!preview.manifest.permissions.length && (
                        <li>Process only the text you enter</li>
                      )}
                    </ul>
                    <p>
                      No network, shell, file writes, or automatic AI requests.
                    </p>
                    <div className="plugin-actions">
                      <button
                        className="plugin-primary"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await invoke("plugins_install", {
                              repository: preview.origin.repository,
                              reviewedDigest: preview.digest,
                            });
                            setPreview(null);
                            setRepository("");
                            await onRefresh();
                          })
                        }
                      >
                        Allow and install
                        {plugins.some(
                          (p) => p.manifest.id === preview.manifest.id,
                        )
                          ? " update"
                          : ""}
                      </button>
                      <button disabled={busy} onClick={() => setPreview(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </section>
              <section aria-label="Installed plugins">
                <div className="plugin-section-title">
                  <h3>Installed</h3>
                  <span>{plugins.length} / 32</span>
                </div>
                {!plugins.length && (
                  <div className="plugin-empty">
                    <Icon name="code" size={28} />
                    <strong>A few useful extras.</strong>
                    <p>
                      Install a plugin to add commands here and in your command
                      menu.
                    </p>
                  </div>
                )}
                {plugins.map((p) => (
                  <article className="plugin-card" key={p.manifest.id}>
                    <div className="plugin-card-heading">
                      <strong>{p.manifest.name}</strong>
                      <span>v{p.manifest.version}</span>
                      <button
                        disabled={busy || !p.origin}
                        role="switch"
                        aria-checked={p.enabled}
                        aria-label={`Enable ${p.manifest.name}`}
                        onClick={() =>
                          void run(async () => {
                            await invoke("plugins_enable", {
                              id: p.manifest.id,
                              enabled: !p.enabled,
                            });
                            await onRefresh();
                          })
                        }
                      >
                        {p.enabled ? "Enabled" : "Disabled"}
                      </button>
                    </div>
                    <p>{p.manifest.description}</p>
                    <small>By {p.manifest.author}</small>
                    {p.origin ? (
                      <div className="plugin-origin">
                        <button
                          onClick={() =>
                            void openUrl(
                              `https://github.com/${p.origin!.repository}/tree/${p.origin!.commit}`,
                            ).catch((e) => setError(String(e)))
                          }
                        >
                          {p.origin.repository} ↗
                        </button>
                        <span>{p.origin.commit.slice(0, 7)}</span>
                        <button
                          disabled={busy}
                          onClick={() =>
                            review(p.origin!.repository, p.manifest.id)
                          }
                        >
                          Check for updates
                        </button>
                      </div>
                    ) : (
                      <p className="plugin-legacy">
                        Link this plugin to its GitHub repository above to
                        enable it. Saved settings are kept.
                      </p>
                    )}
                    <details>
                      <summary>Permissions</summary>
                      <ul>
                        {p.manifest.permissions.map((permission) => (
                          <li key={permission}>
                            {permissionLabels[permission]}
                          </li>
                        ))}
                        {!p.manifest.permissions.length && (
                          <li>No additional permissions</li>
                        )}
                      </ul>
                    </details>
                    <div className="plugin-commands">
                      {p.manifest.commands.map((c) => (
                        <button
                          key={c.id}
                          disabled={busy || !p.enabled}
                          aria-pressed={
                            selected?.id === p.manifest.id &&
                            selected.command === c.id
                          }
                          onClick={() => {
                            setSelected({ id: p.manifest.id, command: c.id });
                            setResult(null);
                            setError("");
                          }}
                          title={c.description}
                        >
                          {c.title}
                          <span>↗</span>
                        </button>
                      ))}
                    </div>
                    <button
                      className="plugin-remove"
                      disabled={busy}
                      onClick={() => setRemove(p.manifest.id)}
                    >
                      Remove
                    </button>
                    {remove === p.manifest.id && (
                      <div className="plugin-remove-confirm">
                        <span>Remove this plugin and its saved settings?</span>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await invoke("plugins_remove", {
                                id: p.manifest.id,
                              });
                              setRemove(null);
                              if (selected?.id === p.manifest.id) {
                                setSelected(undefined);
                                setResult(null);
                              }
                              await onRefresh();
                            })
                          }
                        >
                          Remove plugin
                        </button>
                        <button onClick={() => setRemove(null)}>Keep</button>
                      </div>
                    )}
                  </article>
                ))}
              </section>
            </>
          )}
          {plugin?.enabled && command && (
            <section className="plugin-run" aria-label="Run plugin command">
              <span className="plugin-eyebrow">{plugin.manifest.name}</span>
              <h3>{command.title}</h3>
              <p>{command.description}</p>
              <label>
                Input <span>(optional)</span>
                <textarea
                  aria-label="Command input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={busy}
                  maxLength={16000}
                  placeholder="Add any details for this command…"
                />
              </label>
              <div className="plugin-actions">
                <button
                  className="plugin-primary"
                  disabled={busy}
                  onClick={execute}
                >
                  {busy ? "Running…" : "Run command"}
                </button>
                {busy && (
                  <button onClick={() => controller.current?.abort()}>
                    Cancel command
                  </button>
                )}
                <small>5-second limit · Runs locally</small>
              </div>
              {result && (
                <div className="plugin-result" role="status">
                  <div className="plugin-card-heading">
                    <h4>{result.title || command.title}</h4>
                    <span>{duration} ms · Worker stopped</span>
                  </div>
                  <pre>{result.text}</pre>
                  <button
                    disabled={busy || !result.text}
                    onClick={() => {
                      try {
                        onInsert(result.text);
                        onClose();
                      } catch (error) {
                        setError(String(error));
                      }
                    }}
                  >
                    Add to draft
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
        <div className="plugin-footer">
          <span>Build your own</span>
          <button
            onClick={() =>
              void openUrl(
                "https://github.com/velumix/VelumCode/blob/main/docs/plugins.md",
              ).catch((e) => setError(String(e)))
            }
          >
            SDK guide & example ↗
          </button>
        </div>
      </div>
    </div>
  );
}
