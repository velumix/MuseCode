import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
assert.equal(process.platform, "win32");
assert.equal(
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "@(Get-Process velum-code -ErrorAction SilentlyContinue).Count",
    ],
    { encoding: "utf8", windowsHide: true },
  ).trim(),
  "0",
  "Quit Velum before running this isolated fixture.",
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const release = process.argv.includes("--release");
const dir = path.join(root, ".qa", "bots-" + Date.now()),
  config = path.join(dir, "settings"),
  workspace = path.join(dir, "project");
mkdirSync(workspace, { recursive: true });
const log = path.join(dir, "turns.jsonl");
writeFileSync(log, "");
writeFileSync(log + ".auth", "fixture");
for (const [provider, command] of [
  ["muse", "muse"],
  ["codex", "codex"],
  ["antigravity", "agy"],
])
  writeFileSync(
    path.join(dir, command + ".cmd"),
    `@echo off\r\n"${process.execPath}" "${path.join(root, "tests/fixtures/bot-cli.cjs")}" ${provider} %*\r\n`,
  );
const env = {
  ...process.env,
  PATH: `${dir};${process.env.PATH}`,
  MUSE_CODE_CONFIG_DIR: config,
  MUSE_QA_LOG: log,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=19426",
  WEBVIEW2_USER_DATA_FOLDER: path.join(dir, "webview"),
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let app, browser, page, vite;
const errors = [];
const invoke = (cmd, args = {}) =>
  page.evaluate(
    ({ cmd, args }) => window.__TAURI_INTERNALS__.invoke(cmd, args),
    { cmd, args },
  );
const records = () =>
  readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const request = (q) => invoke("automation_request", { request: q });
const board = () =>
  invoke("kanban_request", { workspace, request: { action: "load" } });
async function start() {
  app = spawn(
    path.join(
      root,
      `src-tauri/target/${release ? "release" : "debug"}/velum-code.exe`,
    ),
    [],
    { cwd: root, env, windowsHide: true, stdio: "ignore" },
  );
  for (let i = 0; i < 150; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:19426");
      break;
    } catch {}
    await pause(100);
  }
  assert(browser, "Native app unavailable");
  page = browser.contexts()[0].pages()[0];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.locator(".chat-wrap:not(.hidden) textarea")).toBeEnabled();
  await invoke("desktop_set_notifications", { enabled: false });
  await page.evaluate(() => {
    window.botEvents = [];
    window.__TAURI_INTERNALS__.invoke("plugin:event|listen", {
      event: "agent-event",
      target: { kind: "Any" },
      handler: window.__TAURI_INTERNALS__.transformCallback((e) =>
        window.botEvents.push(e.payload),
      ),
    });
  });
}
async function quit() {
  await invoke("desktop_quit").catch((e) => {
    if (!/closed/i.test(String(e))) throw e;
  });
  await browser.close().catch(() => {});
  browser = null;
  if (app.exitCode === null) await new Promise((r) => app.once("exit", r));
  await pause(500);
}
async function savedBot(name, provider) {
  const profile = {
    id: randomUUID(),
    name,
    role: "Fixture verification",
    avatar: "",
    color: "#79a9ff",
    enabled: true,
    provider,
    options: {
      model: provider === "antigravity" ? "fixture-agy" : "fixture-" + provider,
      reasoning: "high",
    },
    soul: "You are {{name}}. Speak clearly and keep the identity orchid-sentinel.",
    agent: "Verify changes. Use Kanban and hand off with evidence.",
    shared_memory: true,
    memory_budget: 1000,
    default_cron: "*/15 * * * *",
    timezone: "UTC",
    automatic: true,
    allow_handoffs: true,
    max_minutes: 1,
    revision: "",
  };
  const v = await invoke("bots_request", {
    request: { action: "save", profile },
  });
  return v.profiles.find((b) => b.id === profile.id);
}
async function card(bot, title, automatic = false) {
  const current = await board();
  const c = {
    id: randomUUID(),
    title,
    description: "Verify fixture behavior.",
    column: "backlog",
    priority: "normal",
    assignment: {
      bot_id: bot.id,
      cron: "*/15 * * * *",
      timezone: "UTC",
      automatic,
    },
  };
  await invoke("kanban_request", {
    workspace,
    request: { action: "save", revision: current.revision, card: c },
  });
  return c;
}
const jobFor = async (c) =>
  (await request({ action: "list" })).jobs.find((j) => j.card_id === c.id);
async function manual(bot, provider, prompt) {
  const id = "manual-" + randomUUID();
  await invoke("agent_new", {
    id,
    tabId: id,
    workspace,
    provider,
    options: bot.options,
    botId: bot.id,
    resume: false,
  });
  await invoke("agent_send", { id, prompt, yolo: false, remote: false });
  await expect
    .poll(
      () =>
        page.evaluate(
          (id) =>
            window.botEvents.some(
              (e) => e.id === id && e.event.kind === "turn_end",
            ),
          id,
        ),
      { timeout: 12000 },
    )
    .toBe(true);
  return id;
}
try {
  if (!release) {
    vite = spawn(
      process.execPath,
      [path.join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1"],
      { cwd: root, windowsHide: true, stdio: "ignore" },
    );
    await pause(1200);
  }
  await start();
  const grok = await savedBot("Grokbot", "muse"),
    reviewer = await savedBot("Reviewer", "codex"),
    research = await savedBot("Researcher", "antigravity");
  const memory = (q) =>
    invoke("bots_memory", { id: grok.id, workspace, request: q });
  await memory({
    action: "save",
    id: null,
    revision: null,
    title: "Private convention",
    body: "private-pebble is the Grokbot convention.",
    tags: ["convention"],
    scope: "shared",
    status: "active",
    pinned: true,
  });
  await invoke("memory_request", {
    workspace,
    request: {
      action: "save",
      id: null,
      revision: null,
      title: "Project convention",
      body: "shared-spruce is the project convention.",
      tags: [],
      scope: "shared",
      status: "active",
      pinned: true,
    },
  });
  const museSession = await manual(grok, "muse", "BOT_MEMORY");
  const privateNotes = (await memory({ action: "list", query: "" })).notes;
  assert(
    privateNotes.some(
      (n) => n.title === "Private deployment detail" && n.status === "pending",
    ),
  );
  await manual(
    { ...grok, options: reviewer.options },
    "codex",
    "Check conventions",
  );
  await manual(
    { ...grok, options: research.options },
    "antigravity",
    "Check conventions",
  );
  for (const r of records().slice(-3)) {
    assert(r.input.includes("You are Grokbot"));
    assert(r.input.includes("orchid-sentinel"));
    assert(r.input.includes("private-pebble"));
    assert(r.input.includes("shared-spruce"));
    assert(!r.input.includes("indigo-fern"), "Pending memory was recalled");
  }
  await manual(reviewer, "codex", "Check conventions");
  assert(!records().at(-1).input.includes("private-pebble"));
  assert(records().at(-1).input.includes("shared-spruce"));
  const usage = await page.evaluate(
    (id) =>
      window.botEvents
        .filter((e) => e.id === id && e.event.kind === "memory_context")
        .map((e) => e.event),
    museSession,
  );
  assert(usage.length);
  assert(usage.every((u) => u.bytes <= 1000));
  console.log(
    "PASS: soul.md/agent.md identity across all three providers; isolated private recall, pending capture and combined memory budget",
  );
  const chain = await card(grok, "BOT_CHAIN handoff", true);
  const first = await jobFor(chain);
  await request({ action: "run", id: first.id });
  await expect
    .poll(
      async () => (await board()).cards.find((c) => c.id === chain.id)?.column,
      { timeout: 25000 },
    )
    .toBe("review");
  const final = await board();
  assert.equal(
    final.cards.find((c) => c.id === chain.id).assignment.bot_id,
    research.id,
  );
  await expect
    .poll(
      async () =>
        (await request({ action: "list" })).runs.filter(
          (r) => r.job_id === first.id && r.status === "completed",
        ).length,
    )
    .toBe(3);
  const runs = (await request({ action: "list" })).runs.filter(
    (r) => r.job_id === first.id,
  );
  assert.deepEqual(
    runs.map((r) => r.provider),
    ["muse", "codex", "antigravity"],
  );
  assert(runs.every((r) => !r.output.includes("velum-action")));
  assert.equal((await jobFor(chain)).status, "complete");
  console.log(
    "PASS: Muse → Codex → Antigravity scheduled handoffs; bounded summaries, fresh sessions, applied board actions, review stops work",
  );
  const stale = await card(grok, "BOT_STALE revision test");
  const staleJob = await jobFor(stale);
  await request({ action: "run", id: staleJob.id });
  await expect
    .poll(() => records().some((r) => r.prompt.includes("BOT_STALE")))
    .toBe(true);
  const edit = await board();
  await invoke("kanban_request", {
    workspace,
    request: {
      action: "save",
      revision: edit.revision,
      card: {
        ...edit.cards.find((c) => c.id === stale.id),
        description: "A person edited this while the bot worked.",
      },
    },
  });
  await expect
    .poll(
      async () =>
        (await request({ action: "list" })).runs.find(
          (r) => r.job_id === staleJob.id,
        )?.status,
    )
    .toBe("review");
  assert((await jobFor(stale)).paused);
  assert.equal(
    (await board()).cards.find((c) => c.id === stale.id).column,
    "backlog",
  );
  const hold = await card(grok, "BOT_HOLD cancellation");
  const heldJob = await jobFor(hold);
  await request({ action: "run", id: heldJob.id });
  await expect
    .poll(() => records().some((r) => r.prompt.includes("BOT_HOLD")))
    .toBe(true);
  await assert.rejects(
    request({ action: "run", id: staleJob.id }),
    /Another|already active/,
  );
  let b = await board();
  await invoke("kanban_request", {
    workspace,
    request: {
      action: "save",
      revision: b.revision,
      card: { ...b.cards.find((c) => c.id === hold.id), assignment: null },
    },
  });
  await expect
    .poll(
      async () =>
        (await request({ action: "list" })).runs.find(
          (r) => r.job_id === heldJob.id,
        )?.status,
      { timeout: 10000 },
    )
    .toBe("cancelled");
  console.log(
    "PASS: stale board actions are rejected and paused, overlapping runs are blocked, removing an assignment cancels the old process",
  );
  const noAction = await card(grok, "BOT_NO_ACTION review fallback");
  await request({ action: "run", id: (await jobFor(noAction)).id });
  await expect
    .poll(
      async () =>
        (await board()).cards.find((c) => c.id === noAction.id).column,
    )
    .toBe("review");
  const before = records().length;
  await quit();
  await start();
  assert.equal(
    (await invoke("bots_request", { request: { action: "list" } })).profiles
      .length,
    3,
  );
  assert(
    (await memory({ action: "list", query: "" })).notes.some((n) =>
      n.body.includes("private-pebble"),
    ),
  );
  assert.equal((await jobFor(chain)).status, "complete");
  await pause(6000);
  assert.equal(records().length, before, "Restart reran completed work");
  assert(
    !readdirSync(path.join(config, "history")).some((n) =>
      n.startsWith("bot-run-"),
    ),
    "Background runs accumulated conversation checkpoints",
  );
  // Exercise the actual desktop profile UI and capture it with native data.
  await page.getByRole("button", { name: "Bots", exact: true }).click();
  await expect(page.locator(".bot-card")).toHaveCount(3);
  await page
    .locator(".bots-panel")
    .screenshot({ path: path.join(root, "docs/images/bots.png") });
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.locator(".bot-run-row").first()).toBeVisible();
  await page
    .locator(".bots-panel")
    .screenshot({ path: path.join(root, "docs/images/bot-activity.png") });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: profiles, private notes and schedules survive restart without replay; background history stays bounded",
  );
  await quit();
} finally {
  if (browser) {
    await invoke("desktop_quit").catch(() => {});
    await browser.close().catch(() => {});
  }
  if (app?.exitCode === null) {
    await pause(1000);
    if (app.exitCode === null)
      execFileSync("taskkill.exe", ["/PID", String(app.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
  }
  if (vite?.exitCode === null) vite.kill();
}
