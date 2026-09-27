export interface AgentEvent { kind: string; [key: string]: unknown }
export interface Entry { seq: number; event: AgentEvent }
import type { Provider, RunOptions } from "../providers";
export interface Session { bot?: import('../bots').BotIdentity|null;options?: RunOptions; provider?: Provider; id: string; title: string; workspace: string; running: boolean; status: string; revision: number }
export interface Replay { session: Session; events: Entry[]; truncated: boolean }
export interface Block { id: number; kind: "user" | "assistant" | "tool" | "notice"; text: string; name?: string; task?: string; status?: string }

export function transcript(entries: Entry[]) {
  const blocks: Block[] = [];
  let todos: { text: string; status: string }[] = [];
  let activity = "";
  let assistant: Block | undefined;
  let seenAssistant = false;
  const tools = new Map<string, Block>();
  const text = (value: unknown) => typeof value === "string" ? value : "";
  for (const { seq, event: e } of entries) {
    const task = text(e.task_id);
    switch (e.kind) {
      case "turn_start":
        assistant = undefined; seenAssistant = false; activity = "Working…";
        blocks.push({ id: seq, kind: "user", text: text(e.prompt) }); break;
      case "assistant_delta":
        seenAssistant = true;
        if (!assistant) { assistant = { id: seq, kind: "assistant", text: "" }; blocks.push(assistant); }
        assistant.text += text(e.text); break;
      case "tool_start": {
        assistant = undefined;
        const tool: Block = { id: seq, kind: "tool", task, name: text(e.name), text: "", status: "running" };
        tools.set(task, tool); blocks.push(tool); break;
      }
      case "tool_delta": { const tool = tools.get(task); if (tool) tool.text = (tool.text + text(e.text)).slice(-12_000); break; }
      case "tool_result": {
        const tool = tools.get(task);
        if (tool) tool.text = (tool.text + (tool.text ? "\n" : "") + text(e.text)).slice(-12_000);
        else blocks.push({ id: seq, kind: "tool", name: "Tool result", text: text(e.text), status: "completed" });
        break;
      }
      case "tool_end": { const tool = tools.get(task); if (tool) { tool.status = text(e.status); if (e.reason) tool.text += `\n${text(e.reason)}`; } break; }
      case "todos": if (Array.isArray(e.items)) todos = e.items as typeof todos; break;
      case "activity": activity = text(e.text); break;
      case "notice": blocks.push({ id: seq, kind: "notice", text: text(e.text) }); break;
      case "approval": blocks.push({ id: seq, kind: "notice", text: `${text(e.tool) || "Approval"}: ${text(e.summary)} (${text(e.status)})` }); break;
      case "turn_end":
        activity = "";
        if (!seenAssistant && text(e.text)) blocks.push({ id: seq, kind: "assistant", text: text(e.text) });
        if (e.status === "failed" || e.status === "cancelled") blocks.push({ id: seq, kind: "notice", text: text(e.reason) || (e.status === "cancelled" ? "Task stopped." : "Task failed. Check the desktop for details.") });
        for (const tool of tools.values()) { if (tool.status === "running") tool.status = text(e.status); }
        assistant = undefined;
        break;
    }
  }
  return { blocks, todos, activity };
}
