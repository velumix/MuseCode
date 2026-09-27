import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  readdirSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

if (process.platform !== "win32")
  throw new Error("Windows/WebView2 is required.");
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
  "Quit Velum Code before this isolated test.",
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installed = process.argv.includes("--installed");
const release = installed || process.argv.includes("--release");
const appPath = installed
  ? path.join(process.env.LOCALAPPDATA, "Velum Code/velum-code.exe")
  : path.join(
      root,
      `src-tauri/target/${release ? "release" : "debug"}/velum-code.exe`,
    );
const runDir = path.join(root, ".qa", `extensions-${Date.now()}`);
const config = path.join(runDir, "settings"),
  project = path.join(runDir, "project"),
  pluginDir = path.join(runDir, "plugin");
for (const dir of [runDir, project, pluginDir])
  mkdirSync(dir, { recursive: true });
const logPath = path.join(runDir, "children.jsonl");
writeFileSync(logPath, "");
writeFileSync(
  path.join(project, "package.json"),
  JSON.stringify({
    name: "velum-plugin-demo",
    version: "1.0.0",
    scripts: { test: "node --test", build: "tsc" },
  }),
);
writeFileSync(
  path.join(project, "README.md"),
  "An example workspace for plugin verification.",
);
for (const file of ["index.js", "velum-plugin.json"])
  copyFileSync(
    path.join(root, "examples/project-tools", file),
    path.join(pluginDir, file),
  );
writeFileSync(
  path.join(runDir, "muse.cmd"),
  `@echo off\r\n"${process.execPath}" "${path.join(root, "tests/fixtures/muse-cli.cjs")}" %*\r\n`,
);
writeFileSync(
  path.join(runDir, "codex.cmd"),
  `@echo off\r\n"${process.execPath}" "${path.join(root, "tests/fixtures/provider-cli.cjs")}" codex %*\r\n`,
);
// Seed isolated storage fixtures directly; production installs require GitHub review.
mkdirSync(path.join(config, "plugins"), { recursive: true });
for (const id of ["qa.storage-one", "qa.storage-two"]) {
  const manifest = {
    ...JSON.parse(
      readFileSync(path.join(pluginDir, "velum-plugin.json"), "utf8"),
    ),
    id,
    permissions: ["storage"],
  };
  const source = readFileSync(path.join(pluginDir, "index.js"), "utf8");
  const digest = createHash("sha256")
    .update(JSON.stringify(manifest))
    .update(source)
    .digest("hex");
  writeFileSync(path.join(config, "plugins", digest + ".js"), source);
  writeFileSync(
    path.join(config, "plugins", id + ".json"),
    JSON.stringify({
      manifest,
      digest,
      enabled: true,
      origin: { repository: "qa/fixtures", commit: "a".repeat(40) },
    }),
  );
}
const repository = "velumix/velum-plugin-project-tools";
let savedBoard;
const env = {
  ...process.env,
  PATH: `${runDir};${process.env.PATH}`,
  MUSE_QA_LOG: logPath,
  MUSE_CODE_CONFIG_DIR: config,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=19425",
  WEBVIEW2_USER_DATA_FOLDER: path.join(runDir, "webview"),
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const records = () =>
  readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
let app, browser, page, vite;
const errors = [];
const invoke = (cmd, args = {}) =>
  page.evaluate(
    ({ cmd, args }) => window.__TAURI_INTERNALS__.invoke(cmd, args),
    { cmd, args },
  );
const composer = () => page.locator(".chat-wrap:not(.hidden) textarea");
async function start() {
  const started = Date.now();
  app = spawn(appPath, [], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: "ignore",
  });
  for (let i = 0; i < 150; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:19425");
      break;
    } catch {
      await sleep(100);
    }
  }
  assert(browser, "No CDP connection");
  for (let i = 0; i < 100; i++) {
    page = browser.contexts()[0]?.pages()[0];
    if (page) break;
    await sleep(100);
  }
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(composer()).toBeEnabled();
  await invoke("desktop_set_notifications", { enabled: false });
  await invoke("desktop_show");
  console.log(`Ready in ${Date.now() - started} ms`);
}
async function quit() {
  try {
    await invoke("desktop_quit");
  } catch (e) {
    if (!/closed/i.test(String(e))) throw e;
  }
  await browser?.close().catch(() => {});
  browser = null;
  if (app.exitCode === null)
    await new Promise((resolve) => app.once("exit", resolve));
  await sleep(600);
}
async function send(text) {
  await composer().fill(text);
  await composer().press("Enter");
  await expect(page.locator(".status-text")).toHaveText(/Done/);
}
async function waitSaved(prompt) {
  for (let i = 0; i < 60; i++) {
    try {
      if (
        readdirSync(path.join(config, "history"))
          .filter((file) => file !== "desktop.json")
          .some((file) =>
            readFileSync(path.join(config, "history", file), "utf8").includes(
              prompt,
            ),
          )
      )
        return;
    } catch {}
    await sleep(100);
  }
  throw new Error("History checkpoint did not persist");
}
try {
  if (!release) {
    vite = spawn(
      process.execPath,
      [path.join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1"],
      { cwd: root, windowsHide: true, stdio: "ignore" },
    );
    await sleep(1200);
  }
  await start();
  await page.getByLabel("Workspace directory").fill(project);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByLabel("Workspace directory")).toHaveAttribute(
    "title",
    project,
  );
  await assert.rejects(
    invoke("plugins_preview", { repository: pluginDir }),
    /public GitHub repository/,
  );
  const preview = await invoke("plugins_preview", { repository });
  assert.equal(preview.origin.repository, repository);
  assert.match(preview.origin.commit, /^[a-f0-9]{40}$/);
  await assert.rejects(
    invoke("plugins_install", {
      repository: "other/repo",
      reviewedDigest: preview.digest,
    }),
    /Repository changed/,
  );
  await assert.rejects(
    invoke("plugins_install", { repository, reviewedDigest: "unreviewed" }),
    /Review this plugin/,
  );
  await page.getByRole("button", { name: "Plugins", exact: true }).click();
  const listing = page.locator(".plugin-listing").filter({hasText:"Project tools"});
  await expect(listing).toBeVisible();
  await listing.getByRole("button", {name:"Install", exact:true}).click();
  await expect(page.locator(".plugin-review")).toContainText("Read text files");
  await page
    .getByRole("button", { name: "Allow and install", exact: true })
    .click();
  await page
    .locator(".plugin-card").filter({hasText:repository})
    .getByRole("button", { name: "Create project brief", exact: false })
    .click();
  await page.getByRole("button", { name: "Run command", exact: true }).click();
  await expect(page.locator(".plugin-result")).toContainText(
    "velum-plugin-demo",
  );
  assert.equal(
    await page.locator('iframe[title="Plugin command sandbox"]').count(),
    0,
  );
  await page
    .locator(".plugin-panel")
    .screenshot({ path: path.join(root, "docs/images/plugins.png") });
  const call = (method, args) =>
    invoke("plugins_call", {
      id: preview.manifest.id,
      workspace: project,
      method,
      args,
    });
  await assert.rejects(
    call("workspace.readText", { path: "../children.jsonl" }),
    /relative path/,
  );
  await assert.rejects(
    call("storage.get", { key: "secret" }),
    /Permission required/,
  );
  const outside = path.join(runDir, "outside");
  mkdirSync(outside);
  writeFileSync(path.join(outside, "private.txt"), "outside");
  symlinkSync(outside, path.join(project, "escape"), "junction");
  await assert.rejects(
    call("workspace.readText", { path: "escape/private.txt" }),
    /leaves the workspace/,
  );
  await invoke("plugins_enable", { id: preview.manifest.id, enabled: false });
  await assert.rejects(
    call("workspace.readText", { path: "README.md" }),
    /disabled/,
  );
  await invoke("plugins_enable", { id: preview.manifest.id, enabled: true });
  await page.getByRole("button", { name: "Add to draft" }).click();
  assert((await composer().inputValue()).includes("velum-plugin-demo"));
  assert.equal(records().filter((r) => r.kind === "turn").length, 0);
  const installedSource = path.join(config, "plugins", `${preview.digest}.js`);
  const source = readFileSync(installedSource, "utf8");
  writeFileSync(installedSource, source + "\n// unexpected edit");
  await assert.rejects(
    invoke("plugins_source", {
      id: preview.manifest.id,
      command: "project-brief",
    }),
    /files have changed/,
  );
  writeFileSync(installedSource, source);
  const storage = (id, method, args) =>
    invoke("plugins_call", {
      id,
      workspace: project,
      method: `storage.${method}`,
      args,
    });
  await storage("qa.storage-one", "set", { key: "count", value: 1 });
  assert.equal(await storage("qa.storage-one", "get", { key: "count" }), 1);
  assert.equal(await storage("qa.storage-two", "get", { key: "count" }), null);
  await assert.rejects(
    storage("qa.storage-one", "set", {
      key: "large",
      value: "x".repeat(40000),
    }),
    /32 KB/,
  );
  for (const id of ["qa.storage-one", "qa.storage-two"])
    await invoke("plugins_remove", { id });
  console.log(
    "PASS: native plugin review/install, worker execution, file boundary, permission denial, disable and draft handoff",
  );

  const boardCard = {
    id: randomUUID(),
    title: "Verify packaged board",
    description: "Survives a full quit",
    column: "backlog",
    priority: "high",
  };
  savedBoard = await invoke("kanban_request", {
    workspace: project,
    request: { action: "save", revision: 0, card: boardCard },
  });
  await assert.rejects(
    invoke("kanban_request", {
      workspace: project,
      request: { action: "delete", revision: 0, id: boardCard.id },
    }),
    /changed on another screen/,
  );
  await page.getByRole("button", { name: "Kanban", exact: true }).click();
  await expect(
    page.getByRole("button", { name: boardCard.title, exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Move " + boardCard.title, { exact: true })
    .selectOption("review");
  await expect(page.locator(".review .kanban-card-title")).toHaveText(
    boardCard.title,
  );
  await page.getByRole("button", { name: "Close Kanban" }).click();
  console.log("PASS: native board save, stale-edit rejection and UI move");
  await send("Before restart");
  await composer().fill("Unsent Muse draft");
  const museId = records().find((r) => r.kind === "turn").args;
  const museSession = museId[museId.indexOf("--session-id") + 1];
  await page.getByLabel("AI provider").selectOption("codex");
  await expect(composer()).toBeEnabled();
  await send("Codex before restart");
  await composer().fill("Unsent Codex draft");
  const count = records().filter(
    (r) => r.kind === "turn" || r.kind === "provider-turn",
  ).length;
  await quit();
  await start();
  await expect(page.getByRole("tab")).toHaveCount(2);
  const restoredBoard = await invoke("kanban_request", {
    workspace: project,
    request: { action: "load" },
  });
  assert.equal(restoredBoard.cards[0].column, "review");
  assert.equal(restoredBoard.cards[0].id, savedBoard.cards[0].id);
  console.log("PASS: workspace board survives complete app restart");
  await expect(composer()).toHaveValue("Unsent Codex draft");
  await expect(
    page.locator(".chat-wrap:not(.hidden) .msg.assistant"),
  ).toContainText("Reply: Codex before restart");
  assert.equal(
    records().filter((r) => r.kind === "turn" || r.kind === "provider-turn")
      .length,
    count,
    "Recovery started a provider process",
  );
  const sources = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((r) => r.name),
  );
  assert(
    !sources.some((s) => /pluginRuntime|PluginPanel|KanbanPanel/.test(s)),
    "Plugin runtime loaded at startup",
  );
  await send("Codex after restart");
  const codex = records()
    .filter((r) => r.kind === "provider-turn")
    .at(-1);
  assert(codex.args.includes("resume"));
  assert(codex.args.includes("62c2d305-9dd5-4c94-b4c0-667eb612f401"));
  await page.getByRole("tab").first().click();
  await expect(composer()).toHaveValue("Unsent Muse draft");
  await send("After restart");
  const muse = records()
    .filter((r) => r.kind === "turn")
    .at(-1);
  assert.equal(muse.args[muse.args.indexOf("--session-id") + 1], museSession);
  console.log(
    "PASS: full quit restores tabs, drafts and transcripts; Muse and Codex continue their original CLI sessions; no plugin code loads at startup",
  );
  await composer().fill("HOLD");
  await composer().press("Enter");
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await composer().fill("Crash recovery draft");
  await waitSaved("HOLD");
  await expect
    .poll(() => readFileSync(path.join(config, "history/desktop.json"), "utf8"))
    .toContain("Crash recovery draft");
  const beforeCrash = records().filter(
    (r) => r.kind === "turn" || r.kind === "provider-turn",
  ).length;
  // Kill only the app process launched by this test, with its fixture children.
  execFileSync("taskkill.exe", ["/PID", String(app.pid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore",
  });
  await browser.close().catch(() => {});
  browser = null;
  await sleep(1200);
  await start();
  await expect(composer()).toHaveValue("Crash recovery draft");
  await expect(page.locator(".chat-wrap:not(.hidden) .notice")).toContainText(
    "closed during this response",
  );
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
  assert.equal(
    records().filter((r) => r.kind === "turn" || r.kind === "provider-turn")
      .length,
    beforeCrash,
  );
  assert.equal((await invoke("plugins_list"))[0].enabled, true);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: forced crash restores checkpoint and draft, marks interrupted turn, and never reruns it",
  );
  await quit();
} finally {
  if (browser) {
    try {
      await invoke("desktop_quit");
    } catch {}
    await browser.close().catch(() => {});
  }
  if (app && app.exitCode === null) {
    await sleep(1000);
    if (app.exitCode === null)
      execFileSync("taskkill.exe", ["/PID", String(app.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
  }
  if (vite && vite.exitCode === null) vite.kill();
}
