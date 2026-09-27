import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Markdown from "./Markdown";
import { providerNames, type Provider } from "../providers";
import { copyText } from "./clip";
import Icon, { VelumMark, type IconName } from "./Icon";

export type AgentStatus =
  | { kind: "starting" }
  | { kind: "idle" }
  | { kind: "running"; detail?: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

type Block =
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "assistant"; text: string; open: boolean }
  | {
      id: number;
      kind: "tool";
      taskId: string;
      name: string;
      status: string;
      policy?: string;
      output: string;
      result?: string;
      reason?: string;
    }
  | { id: number; kind: "notice"; text: string; tone: "info" | "error" }
  | { id: number; kind: "approval"; tool?: string; summary: string; status: string };

interface TodoEntry {
  text: string;
  status: string;
}

interface AgentEventEnvelope {
  id: string;
  event: { kind: string; [key: string]: unknown };
}

interface NewInfo {
  id: string;
  session_id: string;
  workspace: string;
}

interface ChatViewProps {
  initialWorkspace?: string;
  provider: Provider;
  sessionId: string;
  active: boolean;
  /** Bump to drop the conversation and start a fresh agent session. */
  sessionKey: number;
  onStatus: (sessionId: string, status: AgentStatus) => void;
  onWorkspace: (sessionId: string, workspace: string) => void;
  onTitle: (sessionId: string, title: string) => void;
}

const FRIENDLY_TOOLS: Record<string, string> = {
  powershell: "Shell",
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  search: "Search",
  read_memory: "Memory",
  add_memory: "Memory",
  edit_memory: "Memory",
  request_user_input: "Question",
  write_todos: "Todos",
  web_fetch: "Web",
  web_search: "Web",
};

const PREVIEW_LINES = 6;
const RENDER_CAP = 4000;

function friendlyTool(name: string): string {
  return FRIENDLY_TOOLS[name] ?? name;
}

function isPlainAllow(decision: string): boolean {
  return decision === "not_applicable" || decision.startsWith("allow:");
}

function statusTone(status: string): "ok" | "bad" | "busy" {
  if (status === "completed") return "ok";
  if (status === "failed" || status === "rejected" || status === "cancelled") return "bad";
  return "busy";
}

function preview(text: string): { head: string; rest: number } {
  const lines = text.split("\n");
  if (lines.length <= PREVIEW_LINES) return { head: text, rest: 0 };
  return { head: lines.slice(0, PREVIEW_LINES).join("\n"), rest: lines.length - PREVIEW_LINES };
}

function capped(text: string): string {
  return text.length > RENDER_CAP ? `${text.slice(0, RENDER_CAP)}\n…[${text.length - RENDER_CAP} more chars]` : text;
}

function boundedOutput(text: string): string {
  return text.length > 12_000 ? `${text.slice(0, 12_000)}\n…[truncated]` : text;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function SendIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}

function YoloIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

const STARTERS: { label: string; description: string; icon: IconName; prompt: string }[] = [
  {
    label: "Explore a project",
    description: "See how it all fits together",
    icon: "folder",
    prompt: "Give me a high-level map of this codebase: main components and how they connect.",
  },
  {
    label: "Find the rough edges",
    description: "Catch bugs before they grow",
    icon: "search",
    prompt: "What are the riskiest or most fragile parts of this code? List them briefly.",
  },
  {
    label: "Understand the code",
    description: "Take a closer look",
    icon: "code",
    prompt: "Pick the most important file in this project and explain what it does.",
  },
];

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`msg-copy${copied ? " copied" : ""}`}
      aria-label={copied ? "Message copied" : "Copy message"}
      title={copied ? "Copied" : "Copy message"}
      onClick={() => {
        void copyText(text).then((ok) => {
          if (!ok) return;
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={15} />
      {copied && <span className="copy-feedback" role="status">Copied</span>}
    </button>
  );
}

function ToolBlock({ block }: { block: Extract<Block, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const tone = statusTone(block.status);
  const body = [block.output, block.result].filter((s) => s && s.length > 0).join("\n");
  const { head, rest } = preview(body || (block.status === "running" ? "…" : ""));
  return (
    <div className={`tool-card ${tone}`}>
      <button type="button" className="tool-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`tool-dot ${tone}`} aria-hidden="true" />
        <span className="tool-name" title={block.name}>
          {friendlyTool(block.name)}
        </span>
        <span className="tool-status">{block.status}</span>
        <span className="tool-caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {block.policy && !isPlainAllow(block.policy) && <div className="tool-policy">policy: {block.policy}</div>}
      {block.reason && <div className="tool-reason">{block.reason}</div>}
      {body ? (
        open ? (
          <pre className="tool-output full">{capped(body)}</pre>
        ) : (
          <pre className="tool-output">
            {capped(head)}
            {rest > 0 && <span className="tool-more">{`\n…${rest} more lines`}</span>}
          </pre>
        )
      ) : null}
    </div>
  );
}

export default function ChatView({ provider, initialWorkspace, sessionId, active, sessionKey, onStatus, onWorkspace, onTitle }: ChatViewProps) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [todos, setTodos] = useState<TodoEntry[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [ready, setReady] = useState(false);
  const [activity, setActivity] = useState("");
  const [yolo, setYolo] = useState(false);
  // Workspace bound to this tab's session at creation; null selects the
  // backend default (home). Changing it restarts the session via the effect
  // below, so a session never straddles two directories.
  const [workspace, setWorkspace] = useState<string | null>(initialWorkspace || null);
  const [draft, setDraft] = useState("");
  const [effective, setEffective] = useState("");
  // Bump to retry session creation with the same workspace (e.g. the
  // directory was fixed externally after a failed Apply).
  const [retry, setRetry] = useState(0);
  // Prompt-history cursor; null means the composer holds a fresh draft.
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [applying, setApplying] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [showLatest, setShowLatest] = useState(false);

  const idRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  const runningRef = useRef(false);
  runningRef.current = running;
  // Latest teardown promise; the next mount awaits it so a restart's
  // destroy always lands before its replacement agent_new.
  const destroyRef = useRef<Promise<unknown>>(Promise.resolve());
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<string[]>([]);
  const draftRef = useRef("");
  const turnStartRef = useRef(0);
  const nativeIdRef = useRef<string | null>(null);
  const assistantSeenRef = useRef(false);
  const applyingRef = useRef(false);
  const titleAssignedRef = useRef(false);

  const setStatus = useCallback(
    (s: AgentStatus) => {
      statusRef.current(sessionId, s);
    },
    [sessionId],
  );

  // Mount: subscribe, then register the agent session. Unmount: stop the
  // turn (via destroy) and drop the subscription.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    // A fresh native identity prevents old readers/events from touching a
    // replacement session, including StrictMode's mount/cleanup replay.
    const nativeId = `${sessionId}-agent-${crypto.randomUUID()}`;
    nativeIdRef.current = null;
    idRef.current = 0;
    setBlocks([]);
    setTodos([]);
    setInput("");
    setRunning(false);
    runningRef.current = false;
    assistantSeenRef.current = false;
    historyRef.current = [];
    setHistIdx(null);
    stickRef.current = true;
    setShowLatest(false);
    titleAssignedRef.current = false;
    setActivity("");
    setReady(false);
    setStatus({ kind: "starting" });

    const applyEvent = (envelope: AgentEventEnvelope) => {
      if (disposed || envelope.id !== nativeId) return;
      const e = envelope.event;
      switch (e.kind) {
        case "turn_start": {
          if (!e.remote) break;
          const prompt = asString(e.prompt) ?? "";
          assistantSeenRef.current = false;
          runningRef.current = true;
          turnStartRef.current = Date.now();
          setRunning(true);
          setActivity("Sent from your phone");
          setStatus({ kind: "running", detail: "Sent from your phone" });
          if (!titleAssignedRef.current) {
            titleAssignedRef.current = true;
            onTitle(sessionId, prompt.replace(/\s+/g, " ").slice(0, 48));
          }
          historyRef.current = [...historyRef.current.slice(-49), prompt];
          setBlocks((prev) => [...prev, { id: ++idRef.current, kind: "user", text: prompt }]);
          break;
        }
        case "user_message":
          // Local echo already shows the sent prompt; the stream copy would duplicate it.
          break;
        case "assistant_delta": {
          const text = asString(e.text) ?? "";
          if (!text) break;
          assistantSeenRef.current = true;
          setBlocks((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.kind === "assistant" && last.open) {
              return [...prev.slice(0, -1), { ...last, text: last.text + text }];
            }
            return [...prev, { id: ++idRef.current, kind: "assistant", text, open: true }];
          });
          break;
        }
        case "turn_end": {
          const status = asString(e.status) ?? "completed";
          const reason = asString(e.reason);
          const finalText = asString(e.text);
          const needsFinal = !assistantSeenRef.current && !!finalText;
          setBlocks((prev) => {
            const next: Block[] = prev.map((b) => b.kind === "assistant" ? { ...b, open: false }
              : b.kind === "tool" && b.status === "running" ? { ...b, status } : b);
            if (needsFinal) next.push({ id: ++idRef.current, kind: "assistant", text: finalText!, open: false });
            if (status === "failed" || status === "cancelled") {
              return [
                ...next,
                {
                  id: ++idRef.current,
                  kind: "notice",
                  text: status === "cancelled" ? `Stopped.${reason ? ` ${reason}` : ""}` : reason || "The turn failed without an error description. Try again or check the terminal.",
                  tone: status === "cancelled" ? ("info" as const) : ("error" as const),
                },
              ];
            }
            return next;
          });
          setRunning(false);
          runningRef.current = false;
          setActivity("");
          setStatus(status === "completed" ? { kind: "done" } : status === "failed"
            ? { kind: "error", message: reason || "Turn failed" } : { kind: "idle" });
          break;
        }
        case "tool_start": {
          const taskId = asString(e.task_id);
          const name = asString(e.name) ?? "tool";
          if (!taskId) break;
          setBlocks((prev) => {
            if (prev.some((b) => b.kind === "tool" && b.taskId === taskId)) return prev;
            return [
              ...prev,
              { id: ++idRef.current, kind: "tool", taskId, name, status: "running", output: "" },
            ];
          });
          break;
        }
        case "tool_policy": {
          const taskId = asString(e.task_id);
          const decision = asString(e.decision) ?? "";
          if (!taskId || !decision) break;
          setBlocks((prev) =>
            prev.map((b) => (b.kind === "tool" && b.taskId === taskId ? { ...b, policy: decision } : b)),
          );
          break;
        }
        case "tool_delta": {
          const taskId = asString(e.task_id);
          const text = asString(e.text) ?? "";
          if (!taskId || !text) break;
          setBlocks((prev) =>
            prev.map((b) => (b.kind === "tool" && b.taskId === taskId ? { ...b, output: boundedOutput(b.output + text) } : b)),
          );
          break;
        }
        case "tool_end": {
          const taskId = asString(e.task_id);
          const status = asString(e.status) ?? "completed";
          const reason = asString(e.reason);
          if (!taskId) break;
          setBlocks((prev) =>
            prev.map((b) =>
              b.kind === "tool" && b.taskId === taskId ? { ...b, status, reason } : b,
            ),
          );
          break;
        }
        case "tool_result": {
          const text = asString(e.text) ?? "";
          if (!text) break;
          const taskId = asString(e.task_id);
          setBlocks((prev) => {
            if (taskId && prev.some((b) => b.kind === "tool" && b.taskId === taskId)) {
              return prev.map((b) =>
                b.kind === "tool" && b.taskId === taskId
                  ? { ...b, result: boundedOutput(b.result ? `${b.result}\n${text}` : text) }
                  : b,
              );
            }
            const name = asString(e.call_id) ?? "tool";
            return [
              ...prev,
              {
                id: ++idRef.current,
                kind: "tool",
                taskId: taskId ?? `detached-${idRef.current}`,
                name,
                status: "completed",
                output: "",
                result: text,
              },
            ];
          });
          break;
        }
        case "todos": {
          const items = Array.isArray(e.items) ? (e.items as TodoEntry[]) : [];
          setTodos(items.filter((t) => t && typeof t.text === "string"));
          break;
        }
        case "approval": {
          const summary = asString(e.summary) ?? "approval requested";
          const tool = asString(e.tool);
          const status = asString(e.status) ?? "requested";
          setBlocks((prev) => [...prev, { id: ++idRef.current, kind: "approval", tool, summary, status }]);
          break;
        }
        case "notice": {
          const text = asString(e.text) ?? "";
          if (text) {
            setBlocks((prev) => [...prev, { id: ++idRef.current, kind: "notice", text, tone: "info" }]);
          }
          break;
        }
        case "activity": {
          // Fleeting progress detail for the running indicator. Guarded by
          // the live running flag so a late duplicate can never flip an
          // idle tab back to running.
          if (!runningRef.current) break;
          const text = asString(e.text) ?? "";
          if (!text) break;
          setActivity(text);
          setStatus({ kind: "running", detail: text });
          break;
        }
        default:
          break;
      }
    };

    const setup = (async () => {
      try {
        await destroyRef.current;
        if (disposed) return;
        unlisten = await listen<AgentEventEnvelope>("agent-event", (e) => {
          applyEvent(e.payload);
        });
        // The listener above filters by session id; register after attaching
        // so no event from our own session can slip past.
        if (disposed) return;
        const info = await invoke<NewInfo>("agent_new", { id: nativeId, workspace, tabId: sessionId, provider });
        if (!disposed) {
          nativeIdRef.current = nativeId;
          setEffective(info.workspace);
          setDraft(info.workspace);
          setReady(true);
          setStatus({ kind: "idle" });
          onWorkspace(sessionId, info.workspace);
        }
      } catch (err) {
        if (!disposed) {
          const message = err instanceof Error ? err.message : String(err);
          setStatus({ kind: "error", message });
          setBlocks((prev) => [...prev, { id: ++idRef.current, kind: "notice", text: message, tone: "error" }]);
        }
      }
    })();

    return () => {
      disposed = true;
      nativeIdRef.current = null;
      unlisten?.();
      destroyRef.current = setup.then(async () => {
        unlisten?.();
        await invoke("agent_destroy", { id: nativeId });
      }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, sessionKey, workspace, retry, provider]);

  // Focus requests from App (palette / Ctrl+L), targeted by session id.
  useEffect(() => {
    if (!active || !ready) return;
    const frame = requestAnimationFrame(() => composerRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [active, ready]);

  useEffect(() => {
    const onFocus = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== sessionId) return;
      composerRef.current?.focus();
    };
    window.addEventListener("muse:focus-composer", onFocus);
    return () => window.removeEventListener("muse:focus-composer", onFocus);
  }, [sessionId]);

  // Live turn timer for the running indicator.
  useEffect(() => {
    if (!running) return;
    setElapsed(0);
    const t0 = turnStartRef.current || Date.now();
    const t = window.setInterval(() => setElapsed(Date.now() - t0), 500);
    return () => window.clearInterval(t);
  }, [running]);

  // Let a multiline draft grow without crowding out the transcript. CSS caps
  // its height for the available window; hidden tabs are sized when activated.
  useLayoutEffect(() => {
    if (!active) return;
    const resize = () => {
      const el = composerRef.current;
      if (!el) return;
      el.style.height = "0px";
      el.style.height = `${el.scrollHeight}px`;
      if (stickRef.current && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [input, active]);

  // Follow new output only when the reader is already at the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (active && el && stickRef.current) {
      el.scrollTop = el.scrollHeight;
      setShowLatest(false);
    }
  }, [blocks, todos, active, running]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !active) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setShowLatest(!stickRef.current);
  }, [active]);

  const jumpToLatest = useCallback(() => {
    stickRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setShowLatest(false);
  }, []);

  const sendText = useCallback(
    (text: string) => {
      const prompt = text.trim();
      const nativeId = nativeIdRef.current;
      if (!prompt || !ready || !nativeId || runningRef.current || applyingRef.current) return;
      stickRef.current = true;
      setShowLatest(false);
      runningRef.current = true;
      assistantSeenRef.current = false;
      if (!titleAssignedRef.current) {
        onTitle(sessionId, prompt.replace(/\s+/g, " ").slice(0, 48));
        titleAssignedRef.current = true;
      }
      setInput("");
      setHistIdx(null);
      historyRef.current = [...historyRef.current.slice(-49), prompt];
      turnStartRef.current = Date.now();
      const userId = ++idRef.current;
      setBlocks((prev) => [...prev, { id: userId, kind: "user", text: prompt }]);
      setRunning(true);
      setActivity("");
      setStatus({ kind: "running" });
      invoke("agent_send", { id: nativeId, prompt, yolo }).catch((err: unknown) => {
        if (nativeIdRef.current !== nativeId) return;
        const message = err instanceof Error ? err.message : String(err);
        setBlocks((prev) => [...prev.filter((b) => b.id !== userId), { id: ++idRef.current, kind: "notice", text: message, tone: "error" }]);
        setInput((draft) => draft || prompt);
        setRunning(false);
        runningRef.current = false;
        setStatus({ kind: "error", message });
      });
    },
    [ready, sessionId, setStatus, yolo, onTitle],
  );

  const send = useCallback(() => sendText(input), [sendText, input]);

  const stop = useCallback(() => {
    const nativeId = nativeIdRef.current;
    if (!nativeId) return;
    invoke("agent_stop", { id: nativeId }).catch((err: unknown) => {
      if (nativeIdRef.current !== nativeId) return;
      setBlocks((prev) => [...prev, { id: ++idRef.current, kind: "notice", text: `Could not stop: ${String(err)}`, tone: "error" }]);
    });
  }, [sessionId]);

  const applyWorkspace = useCallback(async () => {
    if (runningRef.current || applyingRef.current) return;
    applyingRef.current = true;
    setApplying(true);
    setWorkspaceError("");
    const nativeId = nativeIdRef.current;
    try {
      const next = await invoke<string>("agent_validate_workspace", { workspace: draft.trim() || null });
      if (nativeIdRef.current !== nativeId) return;
      if (next === workspace && !ready) setRetry((r) => r + 1);
      else if (next !== effective) setWorkspace(next);
      else if (!ready) setRetry((r) => r + 1);
    } catch (err) {
      if (nativeIdRef.current === nativeId) setWorkspaceError(String(err));
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  }, [draft, effective, workspace, ready]);

  const openTodos = todos.filter((t) => t.status !== "completed");
  const doneTodos = todos.filter((t) => t.status === "completed");

  return (
    <div className={active ? "chat-wrap" : "chat-wrap hidden"}>
      <div ref={scrollRef} className="chat-scroll" onScroll={onScroll}>
        {blocks.length === 0 && (
          <div className="chat-empty">
            <div className="welcome-mark"><VelumMark size={100} /></div>
            <span className="welcome-eyebrow">A fresh conversation</span>
            <h2>What are we building?</h2>
            <p>A fresh set of eyes for your code.<br />Start with an idea. We’ll take it from there.</p>
            <div className="chat-starters">
              {STARTERS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  className="starter-btn"
                  disabled={!ready || running || applying}
                  onClick={() => sendText(s.prompt)}
                >
                  <span className="starter-icon"><Icon name={s.icon} size={21} /></span>
                  <strong>{s.label}</strong>
                  <span>{s.description}</span>
                  <Icon name="arrow" className="starter-arrow" size={15} />
                </button>
              ))}
            </div>
          </div>
        )}
        {blocks.map((b) => {
          switch (b.kind) {
            case "user":
              return (
                <div key={b.id} className="msg user">
                  <div className="message-header">
                    <span className="message-avatar user-avatar">Y</span>
                    <div className="message-author"><strong>You</strong></div>
                    <CopyButton text={b.text} />
                  </div>
                  <pre>{b.text}</pre>
                </div>
              );
            case "assistant":
              return (
                <div key={b.id} className="msg assistant">
                  <div className="message-header">
                    <span className="message-avatar muse-avatar"><VelumMark size={38} /></span>
                    <div className="message-author"><strong>{providerNames[provider]}<span className="assistant-badge">AI</span></strong></div>
                    <CopyButton text={b.text} />
                  </div>
                  <Markdown text={b.text} />
                </div>
              );
            case "tool":
              return <ToolBlock key={b.id} block={b} />;
            case "notice":
              return (
                <div key={b.id} className={`notice ${b.tone}`}>
                  {b.text}
                </div>
              );
            case "approval":
              return (
                <div key={b.id} className="approval-card">
                  <span className="approval-head">
                    Approval {b.status}
                    {b.tool ? ` · ${friendlyTool(b.tool)}` : ""}
                  </span>
                  <pre>{capped(b.summary)}</pre>
                  <div className="approval-hint">
                    Read-only: headless turns resolve approvals per policy and auto-cancel questions.
                    For interactive prompts, start a separate conversation in Terminal mode.
                  </div>
                </div>
              );
          }
        })}
        {running && (
          <div className="chat-running" role="status">
            <span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span>
            Working…{elapsed >= 1000 ? ` ${fmtElapsed(elapsed)}` : ""}
            {activity ? ` · ${activity}` : ""}
          </div>
        )}
      </div>
      <div className="composer-dock">
      {showLatest && <div className="latest-wrap"><button type="button" className="latest-btn" onClick={jumpToLatest}><Icon name="down" size={14} />Back to latest</button></div>}
      {todos.length > 0 && (
        <div className="todos">
          <span className="todos-title">Tasks</span>
          {openTodos.map((t, i) => (
            <span key={`o${i}`} className={`todo ${t.status}`}>
              {t.status === "in_progress" ? "◐" : "○"} {t.text}
            </span>
          ))}
          {doneTodos.length > 0 && <span className="todo done">✓ {doneTodos.length} done</span>}
        </div>
      )}
      {workspaceError && <div className="notice error" role="alert">{workspaceError}</div>}
      <div className={`composer${running ? " is-running" : ""}${input.trim() ? " has-draft" : ""}`}>
        <textarea
          ref={composerRef}
          value={input}
          rows={2}
          placeholder={ready ? `What’s on your mind? Ask ${providerNames[provider]}…` : "Getting ready…"}
          aria-label={`Message ${providerNames[provider]}`}
          disabled={!ready || applying}
          onChange={(e) => {
            setHistIdx(null);
            setInput(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              const h = historyRef.current;
              if (h.length === 0) return;
              if (histIdx === null) {
                // Only hijack Up on an empty composer; editing text keeps caret keys.
                if (e.key === "ArrowDown" || input !== "") return;
                e.preventDefault();
                draftRef.current = input;
                setHistIdx(h.length - 1);
                setInput(h[h.length - 1]);
              } else {
                e.preventDefault();
                const next = histIdx + (e.key === "ArrowUp" ? -1 : 1);
                if (next < 0) return;
                if (next >= h.length) {
                  setHistIdx(null);
                  setInput(draftRef.current);
                } else {
                  setHistIdx(next);
                  setInput(h[next]);
                }
              }
            }
          }}
        />
        <div className="composer-actions">
        <button type="button" className={yolo ? "yolo-btn on" : "yolo-btn"} onClick={() => setYolo((v) => !v)} aria-pressed={yolo} aria-label="YOLO mode" title={yolo ? "YOLO is on: turns skip approvals and sandboxing" : "Turn on YOLO: skip approvals and sandboxing"}>
          {yolo ? <YoloIcon /> : <Icon name="shield" size={16} />}<span>{yolo ? "YOLO on" : "Standard"}</span>
        </button>
        <span className="composer-hint">Shift + Enter for a new line</span>
        {running ? (
          <button type="button" className="composer-btn stop" onClick={stop} aria-label="Stop" title="Stop">
            <StopIcon />
          </button>
        ) : (
          <button
            type="button"
            className="composer-btn"
            onClick={send}
            disabled={!ready || !input.trim()}
            aria-label="Send"
            title="Send"
          >
            <SendIcon />
          </button>
        )}
        </div>
      </div>
      <div className="workspace-bar">
        <Icon name="folder" size={14} />
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void applyWorkspace(); }
        }} placeholder={effective || "Choose a workspace"} aria-label="Workspace directory" title={effective || "default (home)"} spellCheck={false} />
        {(draft !== effective || !ready || workspaceError) && <button type="button" className="workspace-btn" onClick={applyWorkspace} disabled={running || applying} title="Apply workspace (restarts this tab's session)">Apply</button>}
        <span className="workspace-label">Workspace</span>
      </div>
      </div>
    </div>
  );
}
