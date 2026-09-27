import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import Icon from "./Icon";
import "./PluginDirectory.css";
import {
  permissionLabels,
  submissionUrl,
  type InstalledPlugin,
  type PluginCatalog,
  type PluginPreview,
} from "../plugins";

export function PluginDirectory({
  plugins,
  busy,
  onReview,
  onManage,
  onAdd,
}: {
  plugins: InstalledPlugin[];
  busy: boolean;
  onReview: (repo: string, id?: string, commit?: string) => void;
  onManage: () => void;
  onAdd: () => void;
}) {
  const [view, setView] = useState<PluginCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const flight = useRef(false);
  const alive = useRef(true);
  const load = async (refresh: boolean) => {
    if (flight.current) return;
    flight.current = true;
    setLoading(true);
    setError("");
    try {
      const next = await invoke<PluginCatalog>("plugins_catalog", { refresh });
      if (alive.current) setView(next);
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      flight.current = false;
      if (alive.current) setLoading(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    void load(false);
    return () => {
      alive.current = false;
    };
  }, []);
  const list =
    view?.catalog.plugins.filter((p) =>
      `${p.manifest.name} ${p.manifest.description} ${p.manifest.author} ${p.repository}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) || [];
  return (
    <section className="plugin-directory" aria-label="Plugin directory">
      <div className="plugin-directory-tools">
        <label className="plugin-search">
          <Icon name="search" size={17} />
          <input
            aria-label="Search plugins"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search plugins…"
            type="search"
          />
        </label>
        <button
          disabled={loading || busy}
          onClick={() => void load(true)}
          aria-label="Refresh plugin directory"
        >
          <Icon name="reset" size={16} />
        </button>
      </div>
      {view?.notice && (
        <p className="plugin-catalog-notice" role="status">
          {view.notice}
        </p>
      )}
      {error && (
        <p className="plugin-error" role="alert">
          {error}
        </p>
      )}
      <div className="plugin-directory-heading">
        <span>
          {loading
            ? "Loading directory…"
            : `${list.length} ${list.length === 1 ? "plugin" : "plugins"}`}
        </span>
        <span>Community built · GitHub hosted</span>
      </div>
      <div className="plugin-directory-grid" aria-busy={loading}>
        {list.map((p) => {
          const installed = plugins.find(
            (i) => i.manifest.id === p.manifest.id,
          );
          const same = installed?.origin?.repository === p.repository;
          const exact = same && installed?.origin?.commit === p.commit;
          return (
            <article className="plugin-listing" key={p.manifest.id}>
              <div className="plugin-listing-heading">
                <span className="plugin-listing-icon">
                  <Icon name="code" size={22} />
                </span>
                <div>
                  <h3>{p.manifest.name}</h3>
                  <span>By {p.manifest.author}</span>
                </div>
                <span className="plugin-listing-version">
                  v{p.manifest.version}
                </span>
              </div>
              <p>{p.manifest.description}</p>
              <span className="plugin-listing-meta">
                {p.manifest.commands.length}{" "}
                {p.manifest.commands.length === 1 ? "command" : "commands"} ·{" "}
                {p.manifest.permissions.includes("workspace.read")
                  ? "Reads workspace files"
                  : p.manifest.permissions.length
                    ? "Uses requested permissions"
                    : "No extra permissions"}
              </span>
              <div className="plugin-listing-actions">
                <button
                  className={exact ? "" : "plugin-primary"}
                  disabled={busy || loading}
                  onClick={() =>
                    exact
                      ? onManage()
                      : onReview(p.repository, p.manifest.id, p.commit)
                  }
                >
                  {exact
                    ? "Installed"
                    : installed
                      ? "Review listed version"
                      : "Install"}
                </button>
                <button
                  className="plugin-source-link"
                  onClick={() =>
                    void openUrl(
                      `https://github.com/${p.repository}/tree/${p.commit}`,
                    ).catch((e) => setError(String(e)))
                  }
                >
                  View on GitHub ↗
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {!loading && !list.length && (
        <div className="plugin-empty">
          <Icon name="search" size={27} />
          <strong>
            {search
              ? "No matching plugins"
              : "The directory is getting started"}
          </strong>
          <p>
            {search
              ? "Try a different name or author."
              : "Publish a plugin to help the community get more done."}
          </p>
        </div>
      )}
      <div className="plugin-directory-note">
        <span>Already have a repository link?</span>
        <button onClick={onAdd} disabled={busy}>
          Install from GitHub
        </button>
      </div>
    </section>
  );
}

export function PublishPlugin() {
  const [repository, setRepository] = useState("");
  const [preview, setPreview] = useState<PluginPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState(false);
  const nextButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (preview) {
      nextButton.current?.scrollIntoView({ block: "nearest" });
      nextButton.current?.focus();
    }
  }, [preview]);
  const check = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setPreview(null);
    setOpened(false);
    try {
      setPreview(
        await invoke<PluginPreview>("plugins_preview", {
          repository: repository.trim(),
        }),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="plugin-publish" aria-label="Publish your plugin">
      <span className="plugin-eyebrow">Made something useful?</span>
      <h3>Share it with everyone.</h3>
      <p>
        Your plugin stays in your own GitHub repository. Submit it once, and
        people can find and install it right here.
      </p>
      {!preview && (
        <ol className="plugin-publish-steps">
          <li>
            <strong>Check your repository</strong>
            <span>We read its plugin details and permissions.</span>
          </li>
          <li>
            <strong>Submit on GitHub</strong>
            <span>Sign in and send the prefilled submission.</span>
          </li>
          <li>
            <strong>Appear in the directory</strong>
            <span>A maintainer reviews it before it goes live.</span>
          </li>
        </ol>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void check();
        }}
      >
        <input
          aria-label="Your plugin repository"
          placeholder="https://github.com/you/your-plugin"
          value={repository}
          disabled={busy}
          onChange={(e) => {
            setRepository(e.target.value);
            setPreview(null);
            setOpened(false);
          }}
        />
        <button
          className="plugin-primary"
          disabled={busy || !repository.trim()}
        >
          {busy ? "Checking…" : "Check repository"}
        </button>
      </form>
      {error && (
        <p className="plugin-error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <div className="plugin-review">
          <div className="plugin-card-heading">
            <strong>{preview.manifest.name}</strong>
            <span>v{preview.manifest.version}</span>
          </div>
          <p>{preview.manifest.description}</p>
          <p>
            {preview.origin.repository} · {preview.origin.commit.slice(0, 7)}
          </p>
          <h4>Requested permissions</h4>
          <ul>
            {preview.manifest.permissions.map((p) => (
              <li key={p}>{permissionLabels[p]}</li>
            ))}
            {!preview.manifest.permissions.length && (
              <li>No extra permissions</li>
            )}
          </ul>
          <p>
            {preview.manifest.commands.length}{" "}
            {preview.manifest.commands.length === 1 ? "command" : "commands"} ·
            Repository checks passed
          </p>
          <button
            ref={nextButton}
            className="plugin-primary"
            onClick={() => {
              void openUrl(submissionUrl(preview))
                .then(() => setOpened(true))
                .catch((e) => setError(String(e)));
            }}
          >
            Continue on GitHub ↗
          </button>
          <p className="plugin-publish-hint">
            GitHub opens with your repository and version filled in. Review the
            form and choose Submit new issue. Nothing is posted until you submit
            it there.
          </p>
        </div>
      )}
      {opened && (
        <p role="status" className="plugin-catalog-notice">
          Submission opened on GitHub. After you submit it, you can follow its
          review there.
        </p>
      )}
      <div className="plugin-directory-note">
        <button
          onClick={() =>
            void openUrl(
              "https://github.com/velumix/velum-code-plugins/issues",
            ).catch((e) => setError(String(e)))
          }
        >
          View submissions ↗
        </button>
        <button
          onClick={() =>
            void openUrl(
              "https://github.com/velumix/VelumCode/blob/main/docs/plugins.md",
            ).catch((e) => setError(String(e)))
          }
        >
          Create your first plugin ↗
        </button>
      </div>
    </section>
  );
}
