import type { Provider, RunOptions } from "./providers";
export interface BotIdentity {
  id: string;
  name: string;
  avatar: string;
  color: string;
}
export interface BotProfile extends BotIdentity {
  role: string;
  enabled: boolean;
  provider: Provider;
  options: RunOptions;
  soul: string;
  agent: string;
  shared_memory: boolean;
  memory_budget: number;
  default_cron: string;
  timezone: string;
  automatic: boolean;
  allow_handoffs: boolean;
  max_minutes: number;
  revision: string;
}
export interface BotView {
  profiles: BotProfile[];
  root: string;
  warnings: string[];
}
export type BotRequest =
  | { action: "list" }
  | { action: "save"; profile: BotProfile }
  | { action: "delete"; id: string; revision: string };
export interface Assignment {
  bot_id: string;
  cron: string;
  timezone: string;
  automatic: boolean;
}
export interface Job {
  id: string;
  workspace: string;
  card_id: string;
  title: string;
  assignment: Assignment;
  next_run: number;
  paused: boolean;
  status: string;
  last_error: string;
  failures: number;
  chain: number;
  handoff: string;
  day: number;
  day_runs: number;
}
export interface BotRun {
  id: string;
  job_id: string;
  session_id: string;
  bot_id: string;
  bot_name: string;
  provider: Provider;
  options: RunOptions;
  task: string;
  started_at: number;
  finished_at: number | null;
  status: string;
  output: string;
  detail: string;
  max_minutes: number;
}
export interface AutomationView {
  enabled: boolean;
  jobs: Job[];
  runs: BotRun[];
  warning: string | null;
}
export type AutomationRequest =
  | { action: "list" }
  | { action: "configure"; enabled: boolean }
  | { action: "pause"; id: string; paused: boolean }
  | { action: "run" | "stop"; id: string }
  | { action: "preview"; cron: string; timezone: string };
export const localTimezone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
export function newBot(provider: Provider, options: RunOptions): BotProfile {
  return {
    id: crypto.randomUUID(),
    name: "",
    role: "",
    avatar: "",
    color: "#79a9ff",
    enabled: true,
    provider,
    options: { ...options },
    soul: "You are {{name}}. Be thoughtful, direct, and clear. Keep your personality consistent regardless of the underlying provider. Be candid about uncertainty.",
    agent:
      "Work toward the requested outcome. Inspect before changing things, verify your work, and report what remains. Keep durable facts in memory. Use Kanban to track assigned work. Hand off to a suitable teammate when their expertise is needed, including context, evidence, and a concrete next step.",
    shared_memory: true,
    memory_budget: 3000,
    default_cron: "*/15 * * * *",
    timezone: localTimezone(),
    automatic: true,
    allow_handoffs: true,
    max_minutes: 20,
    revision: "",
  };
}
export function assignmentFor(bot: BotProfile): Assignment {
  return {
    bot_id: bot.id,
    cron: bot.default_cron,
    timezone: bot.timezone,
    automatic: bot.automatic,
  };
}
export function when(value: number) {
  return new Date(value * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
