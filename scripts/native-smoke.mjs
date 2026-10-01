import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { checkStartup } from "./startup-smoke.mjs";

if (process.platform !== "win32") throw new Error("This smoke test requires Windows/WebView2.");
async function revealAssistant(page) {
  const control=page.getByRole('button',{name:'Assistant settings',exact:true});
  if(await control.count() && await control.getAttribute('aria-expanded')==='false') await control.click();
}
async function revealWorkspace(page) {
  const chat=page.locator('.chat-wrap:not(.hidden)');
  if(!await chat.getByLabel('Workspace directory').isVisible()) await chat.getByRole('button',{name:'Project folder',exact:true}).click();
}
async function pickProvider(page,provider) {
  await revealAssistant(page); await page.getByLabel('AI provider').selectOption(provider);
  await expect(page.getByLabel('AI provider')).toHaveValue(provider);
  await revealAssistant(page); await revealWorkspace(page);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installed = process.argv.includes("--installed");
const release = installed || process.argv.includes("--release");
const notifications = process.argv.includes("--notifications");
// Native notification checks require the bundle's COM registration. A running
// debug build can serve that same class; --installed also verifies the packaged app.
const existing = execFileSync("powershell.exe", ["-NoProfile", "-Command",
  "@(Get-Process velum-code -ErrorAction SilentlyContinue).Count"], { encoding: "utf8", windowsHide: true }).trim();
assert.equal(existing, "0", "Quit Velum Code before native tests; single-instance tests must not attach to your conversations");
let vite;
if (!release) {
  try {
    const response = await fetch("http://127.0.0.1:1420", { signal: AbortSignal.timeout(1000) });
    assert(response.ok, "Existing Vite server is unavailable");
  } catch {
    vite = spawn(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1"], {
      cwd: root, windowsHide: true, stdio: "ignore",
    });
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch("http://127.0.0.1:1420")).ok) break; } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}
const runDir = path.join(root, ".qa", `native ${Date.now()} & workspace`);
const fixtureTag = `--velum-qa-run=${randomUUID()}`;
mkdirSync(runDir, { recursive: true });
const logPath = path.join(runDir, "children.jsonl");
writeFileSync(logPath, "");
writeFileSync(path.join(runDir, "muse.cmd"), `@echo off\r\n"${process.execPath}" "${path.join(root, "tests/fixtures/muse-cli.cjs")}" ${fixtureTag} %*\r\n`);
for (const [provider, command] of [["codex", "codex"], ["antigravity", "agy"]]) {
  writeFileSync(path.join(runDir, `${command}.cmd`), `@echo off\r\n"${process.execPath}" "${path.join(root, "tests/fixtures/provider-cli.cjs")}" ${provider} ${fixtureTag} %*\r\n`);
}
const port = 19422;
const appPath = installed ? path.join(process.env.LOCALAPPDATA, "Velum Code/velum-code.exe")
  : path.join(root, `src-tauri/target/${release ? "release" : "debug"}/velum-code.exe`);
const appEnv = { ...process.env, PATH: `${runDir};${process.env.PATH}`, MUSE_QA_LOG: logPath,
  MUSE_CODE_CONFIG_DIR: path.join(runDir, "settings"),
  XDG_DATA_HOME: path.join(runDir, 'provider-data'), CODEX_HOME: path.join(runDir, 'codex-data'),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  WEBVIEW2_USER_DATA_FOLDER: path.join(runDir, "webview") };
const app = spawn(appPath, [], {
  cwd: root, windowsHide: true, stdio: "ignore",
  env: appEnv,
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const records = () => readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const appAlive = () => app.exitCode === null && app.signalCode === null;
// Windows can reuse a historical PID for an unrelated process. Identify all
// fixture processes (including unlogged catalog helpers) by this run's marker.
const ownedFixturePids = () => execFileSync("powershell.exe", ["-NoProfile", "-Command",
  `Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like '*${fixtureTag}*' } | Select-Object -ExpandProperty ProcessId`],
  {encoding:"utf8",windowsHide:true}).trim().split(/\s+/).filter(Boolean).map(Number);
let browser;
let page;
const errors = [];
try {
  for (let i = 0; i < 100; i++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch { await sleep(100); }
  }
  assert(browser, "WebView2 debug connection unavailable");
  for (let i = 0; i < 100; i++) {
    page = browser.contexts()[0]?.pages()[0];
    if (page) break;
    await sleep(100);
  }
  assert(page, "No native webview page");
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.locator("#startup")).toHaveCount(0);
  await expect(page.locator("#root")).not.toHaveAttribute("inert", "");
  await page.waitForSelector("textarea:enabled");
  await checkStartup(page, runDir);
  const invoke = (cmd, args = {}) => page.evaluate(({ cmd, args }) => window.__TAURI_INTERNALS__.invoke(cmd, args), { cmd, args });
  const notificationProbe = (action, conversation) => execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", path.join(root, "tests/fixtures/windows-notifications.ps1"), "-Action", action,
    ...(conversation ? ["-Conversation", conversation] : [])], { encoding: "utf8", windowsHide: true, timeout: 15000 }).trim();
  async function waitForNotification(title, conversation) {
    for (let i = 0; i < 20; i++) {
      const items = JSON.parse(notificationProbe("History"));
      const toast = items.find((item) => item.xml.includes(title) && item.xml.includes(`conversation:${conversation}`));
      if (toast) return toast;
      const state = await invoke("desktop_status");
      assert.equal(state.last_error, null, "Windows notification delivery failed");
      await sleep(250);
    }
    throw new Error(`Notification Center did not contain: ${title}`);
  }
  const desktop = await invoke("desktop_status");
  assert.equal(desktop.last_error, null, "Native notification activator did not initialize");
  await invoke("desktop_set_notifications", { enabled: false });
  // WebView2 can defer controlled-input updates while minimized. Exercise
  // input with the window shown; background behavior is checked explicitly below.
  await invoke("desktop_show");
  const composer = page.locator(".chat-wrap:not(.hidden) .composer textarea");
  const status = page.locator(".status-text");
  // Settings use the real atomic Rust store even when WebView storage is full.
  const preferencePath = path.join(runDir, 'settings/appearance.json');
  const readPreferences = () => { try { return JSON.parse(readFileSync(preferencePath, 'utf8')); } catch { return null; } };
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    window.__qaRestorePreferenceStorage = () => { Storage.prototype.setItem = set; delete window.__qaRestorePreferenceStorage; };
    Storage.prototype.setItem = function(key, value) {
      if (key === 'velum-preferences-v1') throw new DOMException('Storage full', 'QuotaExceededError');
      return set.call(this, key, value);
    };
  });
  try {
    await composer.fill('Settings keep my native draft');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Aurora theme', exact: true }).click();
    await page.getByRole('tab', { name: 'Glass & finish', exact: true }).click();
    await page.getByRole('button', { name: 'Crystal', exact: true }).click();
    await expect.poll(() => readPreferences()?.settings.theme).toBe('aurora');
    await expect.poll(() => readPreferences()?.settings.blur).toBe(32);
    assert.equal(readPreferences().settings.opacity, 68);
    await expect(page.locator('.settings-footer')).toContainText('All changes saved');
    await page.screenshot({ path: path.join(runDir, 'settings-glass.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    assert.equal(await composer.inputValue(), 'Settings keep my native draft');
    assert.equal((await invoke('preferences_load')).settings.theme, 'aurora');
  } finally {
    await page.evaluate(() => window.__qaRestorePreferenceStorage?.());
  }
  await page.reload();
  await expect(page.locator('#startup')).toHaveCount(0);
  await expect(composer).toBeEnabled();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'aurora');
  await expect(composer).toHaveValue('Settings keep my native draft');
  await composer.fill('');
  console.log('PASS: live themes and glass save atomically despite blocked browser storage and restore after WebView reload');
  // Validate the actual native atomic writer under Windows sharing locks.
  // A brief lock must save successfully; a persistent one must preserve the
  // previous profile and leave no temporary snapshots behind.
  async function lockPreferences() {
    const locker = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(root, 'tests/fixtures/windows-file-lock.ps1'), '-Path', preferencePath],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', failure = '';
    locker.stderr.on('data', (chunk) => { failure += chunk; });
    const exited = new Promise((resolve) => locker.once('exit', resolve));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { locker.kill(); reject(new Error('Windows file lock did not initialize')); }, 10000);
      const fail = (error) => { clearTimeout(timer); reject(error); };
      locker.once('error', fail);
      locker.once('exit', (code) => { if (!output.includes('LOCKED')) fail(new Error(`File lock exited ${code}: ${failure}`)); });
      locker.stdout.on('data', (chunk) => {
        output += chunk;
        if (output.includes('LOCKED')) { clearTimeout(timer); resolve(); }
      });
    });
    let release;
    return () => {
      if (!release) {
        locker.stdin.end('\n');
        release = exited.then((code) => assert.equal(code, 0, failure));
      }
      return release;
    };
  }
  const originalProfile = readPreferences();
  const latestProfile = { ...originalProfile, settings: { ...originalProfile.settings, blur: 31 } };
  const releaseBriefLock = await lockPreferences();
  const startedSaving = Date.now();
  const unlockTimer = setTimeout(() => { releaseBriefLock().catch(() => {}); }, 75);
  try {
    await invoke('preferences_save', { profile: latestProfile });
    assert(Date.now() - startedSaving >= 60, 'Atomic writer did not wait for the reader lock');
    assert.deepEqual(readPreferences(), latestProfile);
  } finally {
    clearTimeout(unlockTimer);
    // This also releases the lock on early failure.
    await releaseBriefLock();
  }
  const releasePersistentLock = await lockPreferences();
  try {
    await assert.rejects(invoke('preferences_save', {
      profile: { ...latestProfile, settings: { ...latestProfile.settings, blur: 30 } },
    }).catch((error) => { throw new Error(String(error)); }),
    /Access is denied|sharing violation|being used by another process/i);
    assert.deepEqual(readPreferences(), latestProfile);
    assert(!readdirSync(path.dirname(preferencePath)).some((name) => /^appearance\..*\.tmp$/.test(name)),
      'Failed atomic write leaked a temporary snapshot');
  } finally {
    await releasePersistentLock();
    await invoke('preferences_save', { profile: originalProfile });
  }
  console.log('PASS: atomic preferences recover from a brief Windows reader lock and preserve the saved profile on a persistent lock');
  async function send(text) {
    await composer.fill(text);
    await composer.press("Enter");
  }
  async function done() { await status.filter({ hasText: "Done" }).waitFor(); }
  async function watchTurns() {
    await page.evaluate(async()=>{
      window.__qaTurns=[];
      const handler=window.__TAURI_INTERNALS__.transformCallback(event=>window.__qaTurns.push(event.payload));
      await window.__TAURI_INTERNALS__.invoke('plugin:event|listen',{event:'agent-event',target:{kind:'Any'},handler});
    });
  }
  await watchTurns();
  const turnEvents=()=>page.evaluate(()=>window.__qaTurns);
  async function usageFor(prompt) {
    const entries=await turnEvents();
    const start=entries.findLastIndex(e=>e.event.kind==='turn_start'&&e.event.prompt===prompt);
    assert(start>=0,`No native turn start: ${prompt}`);
    const id=entries[start].id;
    const events=entries.slice(start).filter(e=>e.id===id).map(e=>e.event);
    const stop=events.findIndex(e=>e.kind==='turn_end');
    assert(stop>=0,`No native completion: ${prompt}`);
    return events.slice(0,stop).findLast(e=>e.kind==='usage'&&e.turn)?.turn;
  }
  async function checkUsage(provider, prompt, output) {
    const usage=await usageFor(prompt);
    assert.equal(usage.output_tokens,output,`${provider} current-turn output counters`);
    assert.equal(usage.cached_input_tokens,200);
    assert.equal(usage.reasoning_output_tokens,20);
    assert.equal(usage.input_tokens,provider==='antigravity'?511:501);
    assert(usage.elapsed_ms>=350,'Duration omitted the child process exit delay');
    const rate=(output*1000/usage.elapsed_ms).toLocaleString(undefined,{maximumFractionDigits:1});
    await expect(page.locator('.chat-wrap:not(.hidden) .usage-speed strong')).toHaveText(rate);
  }
  async function checkQueue(provider) {
    await send('QUEUE_HOLD');
    await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible();
    await expect.poll(async()=> (await turnEvents()).some(e=>e.event.kind==='turn_start'&&e.event.prompt==='QUEUE_HOLD')).toBe(true);
    const id=(await turnEvents()).findLast(e=>e.event.kind==='turn_start'&&e.event.prompt==='QUEUE_HOLD').id;
    const completedBefore=(await turnEvents()).filter(e=>e.id===id&&e.event.kind==='turn_end').length;
    const request=request=>invoke('agent_queue',{id,request});
    await send('QUEUE_ONE');await send('QUEUE_REMOVE');await send('QUEUE_LAST');
    const original=await request({action:'load'});
    assert.deepEqual(original.items.map(m=>m.prompt),['QUEUE_ONE','QUEUE_REMOVE','QUEUE_LAST']);
    await request({action:'pause'});
    await request({action:'edit',message_id:original.items[0].id,prompt:'QUEUE_EDITED'});
    await request({action:'remove',message_id:original.items[1].id});
    await expect(status).toContainText('Queue paused');
    assert.equal((await request({action:'load'})).paused,true);
    await request({action:'resume'});
    await expect.poll(async()=> (await turnEvents()).filter(e=>e.id===id&&e.event.kind==='turn_end').length).toBe(completedBefore+3);
    await done();
    const starts=(await turnEvents()).filter(e=>e.id===id&&e.event.kind==='turn_start').map(e=>e.event.prompt);
    assert.deepEqual(starts.slice(-3),['QUEUE_HOLD','QUEUE_EDITED','QUEUE_LAST']);
    assert.equal((await request({action:'load'})).items.length,0);
    const trace=records().filter(r=>provider==='muse'?!r.provider:r.provider===provider);
    for(const [previous,next] of [['QUEUE_HOLD','QUEUE_EDITED'],['QUEUE_EDITED','QUEUE_LAST']]){
      const exit=trace.findLastIndex(r=>r.kind==='exit'&&r.prompt===previous);
      const launch=trace.findLastIndex(r=>['turn','provider-turn'].includes(r.kind)&&r.prompt===next);
      assert(exit>=0&&launch>exit,'Queue launched before the previous process exited');
    }
    await checkUsage(provider,'QUEUE_LAST',provider==='antigravity'?125:120);
    await send('QUEUE_HOLD');await send('QUEUE_AFTER_STOP');
    await page.getByRole('button',{name:'Stop',exact:true}).click();
    await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
    const stopped=await request({action:'load'});assert(stopped.paused);assert.equal(stopped.items[0].prompt,'QUEUE_AFTER_STOP');
    await request({action:'resume'});await done();
    await send('QUEUE_HOLD');await send('FAIL');await send('QUEUE_AFTER_FAIL');
    await expect.poll(async()=> (await request({action:'load'})).paused,{timeout:10000}).toBe(true);
    const failed=await request({action:'load'});assert.equal(failed.items[0].prompt,'QUEUE_AFTER_FAIL');
    await request({action:'resume'});await done();
    console.log(`PASS: ${provider} native queue FIFO, edit/remove, pause/resume, process exit ordering, Stop/failure retention and numeric tok/s`);
  }
  // Exercise recovery against the real Rust checkpoint while WebView storage fails.
  await page.evaluate(() => {
    const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
    window.__qaRestoreRecoveryStorage = () => {
      Storage.prototype.setItem = set;
      Storage.prototype.removeItem = remove;
      delete window.__qaRestoreRecoveryStorage;
    };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('velum-desktop')) throw new DOMException('Storage full', 'QuotaExceededError');
      return set.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
      if (key.startsWith('velum-desktop')) throw new DOMException('Storage unavailable', 'SecurityError');
      return remove.call(this, key);
    };
  });
  const recoveryDraft = 'Native draft survives browser quota failure';
  const checkpointDrafts = () => {
    try { return Object.values(JSON.parse(readFileSync(path.join(runDir, 'settings/history/desktop.json'), 'utf8')).drafts); }
    catch { return []; }
  };
  try {
    await composer.fill(recoveryDraft);
    await expect.poll(() => checkpointDrafts().includes(recoveryDraft), { timeout: 10000 }).toBe(true);
    assert.equal(await composer.inputValue(), recoveryDraft);
    await composer.fill('');
    await expect.poll(() => checkpointDrafts().includes(recoveryDraft), { timeout: 10000 }).toBe(false);
  } finally {
    await page.evaluate(() => window.__qaRestoreRecoveryStorage?.());
  }
  console.log('PASS: browser storage failures still save and clear drafts in the real native recovery checkpoint');
  const access=await invoke('workspace_check',{workspace:runDir,write:true});
  assert(access.readable && access.writable, 'Workspace probe failed in writable fixture');
  const diagnostic=await invoke('app_diagnostics',{workspace:runDir});
  assert.equal(diagnostic.workspace_access.host.checks[0].status,'pass');
  assert(diagnostic.workspace_access.agent.checks.every(c=>c.status==='untested'));
  assert(!JSON.stringify(diagnostic).includes(runDir),'Diagnostics leaked the workspace path');

  // Validate workspace in the actual Rust backend, including a rejected path.
  await revealWorkspace(page);
  await page.getByLabel("Workspace directory").fill(path.join(runDir, "missing"));
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.getByRole("alert").waitFor();
  await page.getByLabel("Workspace directory").fill(runDir);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.waitForFunction((dir) => document.querySelector('[aria-label="Workspace directory"]')?.title === dir, runDir);

  async function chooseModel(label, effort = "High") {
    await revealAssistant(page);
    await page.getByRole("button", { name: /^Model:/ }).click();
    await page.getByRole("option").getByText(label, { exact: true }).click();
    await page.getByRole("button", { name: /^Reasoning:/ }).click();
    await page.getByRole("option", { name: new RegExp(`^${effort} `) }).click();
    await page.getByRole("button", { name: `Reasoning: ${effort}`, exact: true }).waitFor();
  }
  await chooseModel("Fixture Muse");
  for (const prompt of ["First native turn", "Second native turn", "FINAL_ONLY"]) {
    if (prompt === "Second native turn") await chooseModel("Fixture Muse Fast", "Low");
    if (prompt === "FINAL_ONLY") await chooseModel("Fixture Muse");
    await send(prompt);
    await done();
    assert((await page.locator(".msg.assistant").last().innerText()).includes(`Reply: ${prompt}`));
  }
  const museTurns = records().filter((r) => r.kind === "turn");
  for (const turn of museTurns) {
    const changed = turn.prompt === "Second native turn";
    assert(turn.args.includes(changed ? "fixture-muse-fast" : "fixture-muse"));
    assert.equal(turn.args[turn.args.indexOf("--reasoning-effort") + 1], changed ? "low" : "high");
  }
  assert.equal(new Set(museTurns.map((r) => r.args[r.args.indexOf("--session-id") + 1])).size, 1);
  console.log("PASS: native model catalog, reasoning argv, workspace validation, consecutive turns, final-only answers");
  await checkUsage('muse','FINAL_ONLY',120);
  await send('METRICS_RESUME');await done();await checkUsage('muse','METRICS_RESUME',80);

  await send('NO_COMPLETION');
  await page.locator('.notice.error').filter({hasText:'Muse ended without a completion event'}).waitFor();
  await send('RETRY_RECOVER');
  await page.locator('.provider-wait').filter({hasText:'HTTP 503'}).waitFor();
  await page.getByRole('button',{name:'Project context and diagnostics',exact:true}).click();
  await page.getByLabel('Velum diagnostics preview').filter({visible:true}).waitFor();
  await expect.poll(async () => JSON.parse(await page.getByLabel('Velum diagnostics preview').inputValue() || '{}').provider_runtime?.last_retry?.http_status).toBe(503);
  const retryReport=JSON.parse(await page.getByLabel('Velum diagnostics preview').inputValue());
  assert.equal(retryReport.provider_runtime.last_retry.attempt,2);
  assert(!JSON.stringify(retryReport).includes('PRIVATE_'),'Provider metadata leaked into diagnostics');
  await page.getByRole('button',{name:'Close diagnostics',exact:true}).click();
  await done();
  assert((await page.locator('.msg.assistant').last().innerText()).includes('Recovered after service retry'));
  assert.equal(await page.locator('.provider-wait').count(),0);
  console.log('PASS: incomplete zero-exit Muse run fails; service retry, recovery and sanitized diagnostics reach the native UI');

  // Exercise memory through the actual Rust store and streaming CLI bridge.
  const memory = (request) => invoke("memory_request", { workspace: runDir, request });
  async function checkReviewedLesson(provider) {
    const lesson='Before editing '+provider+' work, keep unrelated changes outside the requested scope.';
    const draft='Keep my next '+provider+' idea';
    await composer.fill(draft);
    await page.locator('.chat-wrap:not(.hidden)').getByRole('button',{name:'Correct response',exact:true}).last().click();
    await page.getByLabel('What should change?',{exact:true}).fill('Keep the existing layout and focus on the requested change.');
    await page.getByRole('checkbox',{name:'Remember a lesson for this project',exact:true}).check();
    await page.getByLabel('Lesson for next time',{exact:true}).fill(lesson);
    await page.getByRole('button',{name:'Send & save lesson',exact:true}).click();
    await expect(page.locator('.chat-wrap:not(.hidden) .correction-composer')).toContainText('Lesson saved');
    await done();
    assert.equal(await composer.inputValue(),draft,'Correction replaced a newer draft');
    const before=await memory({action:'list'});const note=before.notes.find(n=>n.body===lesson);
    assert(note && note.pinned && note.status==='active' && note.scope==='project','Reviewed lesson was not active and scoped');
    const repeated=await memory({action:'save_lesson',title:note.title,body:lesson});
    assert.equal(repeated.notes.length,before.notes.length,'Repeated lesson created a duplicate');
    assert.equal(repeated.notes.find(n=>n.id===note.id).revision,note.revision);
    await page.getByRole('button',{name:'Back to the conversation',exact:true}).click();
    await send('Recall reviewed lesson '+provider);await done();
    const turn=records().find(r=>r.prompt==='Recall reviewed lesson '+provider);
    assert(turn.input.includes(lesson),'Saved guidance did not reach '+provider+' input');
    console.log('PASS: '+provider+' native correction, preserved draft, reviewed project lesson, idempotent save and future-turn recall');
  }

  await send("MEMORY_FAIL");
  await page.locator(".notice.error").filter({hasText:"Muse exited unexpectedly (code Some(7))"}).waitFor();
  assert.equal((await memory({ action: "list" })).notes.length, 0, "Failed turn saved a memory");
  await send("MEMORY_PROPOSAL"); await done();
  assert(!(await page.locator(".msg.assistant").last().innerText()).includes("velum-memory"));
  let vault = await memory({ action: "list" });
  assert.equal(vault.notes.length, 1); assert.equal(vault.notes[0].status, "pending");
  const note = vault.notes[0];
  vault = await memory({ action: "save", id: note.id, revision: note.revision, title: note.title, body: note.body, tags: note.tags, scope: "project", status: "active", pinned: true });
  assert.equal(vault.notes[0].status, "active");
  await send("Recall database"); await done();
  assert(records().find(r => r.prompt === "Recall database").input.includes("SQLite with WAL"));
  await send("Recall database again"); await done();
  assert(!records().find(r => r.prompt === "Recall database again").input.includes("SQLite with WAL"));
  await send("MEMORY_PROPOSAL"); await done();
  assert.equal((await memory({ action: "list" })).notes.length, 1, "Duplicate proposal saved twice");
  await memory({ action: "configure", settings: { enabled: true, capture: "manual", budget_bytes: 3000 } });
  await send("Manual capture check"); await done();
  assert(!records().find(r => r.prompt === "Manual capture check").input.includes("Velum memory:"));
  await memory({ action: "configure", settings: { enabled: true, capture: "review", budget_bytes: 3000 } });
  console.log("PASS: failed turns cannot save memory; streamed suggestions stay hidden; approval, retrieval, reuse and deduplication work");

  await send("FAIL");
  await page.locator(".notice.error").filter({ hasText: "QA fixture failed deliberately" }).waitFor();
  await page.getByRole("button", { name: "YOLO mode" }).click();
  await send("YOLO fixture");
  await done();
  assert(records().find((r) => r.prompt === "YOLO fixture").args.includes("--yolo"));
  assert(records().find(r => r.prompt === "YOLO fixture").input.includes("SQLite with WAL"), "Failed turn did not reset memory reuse");
  for (const r of records().filter((r) => r.kind === "turn")) assert(!existsSync(r.file), "prompt staging file leaked");
  console.log("PASS: stderr failures, recovery, YOLO argv, prompt cleanup");

  await send("HOLD");
  for (let i = 0; i < 100 && !records().some((r) => r.kind === "descendant"); i++) await sleep(50);
  const descendant = records().find((r) => r.kind === "descendant");
  assert(descendant && alive(descendant.pid));
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByText("Stopped.", { exact: true }).waitFor();
  assert(!alive(descendant.pid), "Stop left a descendant running");
  await send("After stop");
  await done();
  console.log("PASS: Stop kills descendants and accepts the next turn");
  await checkQueue('muse');
  await checkReviewedLesson('muse');

  await composer.fill("draft preserved");
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await status.filter({ hasText: "muse.cmd" }).waitFor();
  for (let i = 0; i < 100 && !records().some((r) => r.kind === "terminal"); i++) await sleep(50);
  const terminal = records().find((r) => r.kind === "terminal");
  assert(terminal, "ConPTY fixture never launched");
  assert(terminal.args.includes("fixture-muse") && terminal.args.includes("high"));
  assert.equal(terminal.cwd.toLowerCase(), runDir.toLowerCase());
  await page.keyboard.press("Control+f");
  await page.getByLabel("Find in terminal").fill("search target");
  await page.getByLabel("Find in terminal").press("Enter");
  await page.getByLabel("Find in terminal").press("Escape");
  await page.keyboard.press("Control+=");
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  assert.equal(await composer.inputValue(), "draft preserved");
  await page.screenshot({ path: path.join(runDir, "native.png"), animations: "disabled" });
  console.log("PASS: ConPTY starts in selected workspace, search/zoom controls, mode preservation");

  const backgroundTab = await page.getByRole("tab", { selected: true }).getAttribute("data-session-id");
  if (notifications) await invoke("desktop_set_notifications", { enabled: true });
  await send("BACKGROUND");
  await composer.fill("background draft survives");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(() => invoke("plugin:window|is_visible", { label: "main" })).toBe(false);
  assert(alive(app.pid), "Close exited instead of hiding to tray");
  await done();
  assert((await page.locator(".msg.assistant").last().innerText()).includes("Reply: BACKGROUND"));
  assert.equal(await invoke("plugin:window|is_visible", { label: "main" }), false);
  if (notifications) {
    const toast = await waitForNotification("Your response is ready", backgroundTab);
    assert.equal(toast.group, "VelumCode");
    assert(!toast.xml.includes("BACKGROUND") && !toast.xml.includes(runDir), "Notification leaked task content");
    writeFileSync(path.join(runDir, "completion-toast.xml"), toast.xml);
  }
  await invoke("desktop_show");
  assert.equal(await invoke("plugin:window|is_visible", { label: "main" }), true);
  assert.equal(await composer.inputValue(), "background draft survives");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const second = spawn(appPath, [], { cwd: root, windowsHide: true, stdio: "ignore", env: appEnv });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { second.kill(); reject(new Error("Second instance did not exit")); }, 10000);
    second.once("exit", (code) => { clearTimeout(timeout); assert.equal(code, 0); resolve(); });
    second.once("error", reject);
  });
  for (let i = 0; i < 100 && !await invoke("plugin:window|is_visible", { label: "main" }); i++) await sleep(50);
  assert.equal(await invoke("plugin:window|is_visible", { label: "main" }), true);
  assert.equal(await composer.inputValue(), "background draft survives");
  console.log("PASS: close-to-tray preserves active work and drafts; reopening restores the existing instance");

  if (notifications) {
    await page.keyboard.press("Control+t");
    await composer.waitFor({ state: "visible" });
    await page.waitForFunction((id) => document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-session-id") !== id, backgroundTab);
    const otherTab = await page.getByRole("tab", { selected: true }).getAttribute("data-session-id");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    notificationProbe("Activate", backgroundTab);
    await page.waitForFunction((id) => document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-session-id") === id, backgroundTab);
    assert.equal(await invoke("plugin:window|is_visible", { label: "main" }), true);
    assert.equal(await composer.inputValue(), "background draft survives");
    await page.locator(`[data-session-id="${otherTab}"] .tab-close`).click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await send("FAIL");
    const failed = await waitForNotification("Velum Code needs your attention", backgroundTab);
    assert(!failed.xml.includes("QA fixture failed deliberately"), "Notification leaked CLI output");
    writeFileSync(path.join(runDir, "failure-toast.xml"), failed.xml);
    await invoke("desktop_set_notifications", { enabled: false });
    assert.equal(JSON.parse(readFileSync(path.join(runDir, "settings/desktop.json"))).notifications_enabled, false);
    await invoke("desktop_show");
    console.log("PASS: real Windows Notification Center delivery, native COM activation to the correct conversation, failure notifications, saved mute preference");
  }

  await send("HOLD");
  for (let i = 0; i < 100 && records().filter((r) => r.kind === "descendant").length < 2; i++) await sleep(50);
  await page.getByRole("tab", { selected: true }).locator(".tab-close").click();
  await composer.waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector("textarea")?.disabled);
  for (let i = 0; i < 100 && records().some((r) => alive(r.pid)); i++) await sleep(50);
  assert(records().every((r) => !alive(r.pid)), "Closing the tab left native children running");
  console.log("PASS: closing a busy tab cleans up both sessions and opens a usable replacement");
  // Exercise the real ConPTY login bridge, nonce handling and account check.
  await pickProvider(page,"antigravity");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Paste your authorization code").waitFor();
  await page.getByLabel("Paste your authorization code").fill("4/invalid-fixture-code");
  await page.getByRole("button", { name: "Connect account", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Google could not accept" }).waitFor();
  await page.getByRole("button", { name: "Start again", exact: true }).click();
  await page.getByLabel("Paste your authorization code").waitFor();
  await page.getByLabel("Paste your authorization code").fill("4/valid-fixture-code");
  await page.getByRole("button", { name: "Connect account", exact: true }).click();
  await page.getByRole("button", { name: "Back to conversation", exact: true }).click();
  for (let i = 0; i < 100 && records().filter((r) => r.kind === "auth").some((r) => alive(r.pid)); i++) await sleep(50);
  assert(records().filter((r) => r.kind === "auth").every((r) => !alive(r.pid)), "Login child survived success/retry");
  assert(!readFileSync(logPath, "utf8").includes("fixture-code"), "Login code was logged");
  console.log("PASS: dedicated Antigravity login, rejected code, fresh retry, verified success and process cleanup");
  for (const provider of ["codex", "antigravity"]) {
    await pickProvider(page,provider);
    await composer.waitFor({ state: "visible" });
    await page.locator(".chat-wrap:not(.hidden)").getByLabel("Workspace directory").fill(runDir);
    if (await page.getByRole("button", { name: "Apply", exact: true }).count()) await page.getByRole("button", { name: "Apply", exact: true }).click();
    await page.waitForFunction((dir) => document.querySelector('.chat-wrap:not(.hidden) [aria-label="Workspace directory"]')?.title === dir, runDir);
    await chooseModel(provider === "codex" ? "Fixture Codex" : "Fixture Antigravity");
    for (const prompt of ["First provider turn & $quoted", "Second provider turn"]) {
      await send(prompt); await done();
      assert((await page.locator(".chat-wrap:not(.hidden) .msg.assistant").last().innerText()).includes(`Reply: ${prompt}`));
    }
    const turns = records().filter((r) => r.kind === "provider-turn" && r.provider === provider);
    assert.equal(turns.length, 2);
    assert(turns[0].input.includes("SQLite with WAL"), "New provider conversation did not recall project memory");
    assert(!turns[1].input.includes("SQLite with WAL"), "Unchanged memory was injected again");
    for (const turn of turns) {
      assert(turn.input.includes('<velum-app-context>'),'Provider did not receive app context');
      assert(turn.input.includes('"workspace_access":'));
      assert(turn.input.includes('Velum host process'));
      assert(turn.input.includes('"status":"untested"'));
      assert(turn.args.includes(provider === "codex" ? "fixture-codex" : "fixture-agy-high"));
      assert(turn.args.includes(provider === "codex" ? "model_reasoning_effort='high'" : "high"));
    }
    assert.equal(turns[0].cwd.toLowerCase(), runDir.toLowerCase());
    assert(!turns[0].args.includes("resume") && !turns[0].args.includes("--conversation"));
    assert(turns[1].args.includes(provider === "codex" ? "62c2d305-9dd5-4c94-b4c0-667eb612f401" : "ae283c22-1851-4d5c-a5c5-d14d53c23b72"));
    assert(!turns[1].args.some((arg) => arg.includes("dangerously")));
    await checkUsage(provider,'Second provider turn',provider==='antigravity'?125:120);
    await send('METRICS_RESUME');await done();await checkUsage(provider,'METRICS_RESUME',provider==='antigravity'?85:80);
    if(provider==='codex'){
      await send('METRICS_CUMULATIVE');await done();await checkUsage(provider,'METRICS_CUMULATIVE',120);
      console.log('PASS: Codex per-turn and cumulative completion schemas both exclude earlier turns');
    }
    assert(turns[0].input.includes("Before editing muse work"),"New provider did not receive the reviewed Muse lesson");
    await checkReviewedLesson(provider);
    await send("FAIL");
    await page.locator(".chat-wrap:not(.hidden) .notice.error").filter({ hasText: "Provider fixture failure" }).waitFor();
    if(provider==='antigravity') {
      await send('DENIED');
      await page.locator('.chat-wrap:not(.hidden) .notice.error').filter({hasText:'Antigravity blocked a tool'}).waitFor();
      await page.locator('.chat-wrap:not(.hidden) .agent-activity').filter({hasText:'An action needs attention'}).last().locator('.activity-toggle').click();
      assert.equal(await page.locator('.chat-wrap:not(.hidden) .tool-status').last().innerText(),'blocked');
      assert((await page.locator('.chat-wrap:not(.hidden) .msg.assistant').last().innerText()).includes('Reply: DENIED'));
      assert(!records().find(r=>r.prompt==='DENIED').args.includes('--dangerously-skip-permissions'));
    }
    await send("HOLD");
    for (let i = 0; i < 100 && !records().some((r) => r.provider === provider && r.kind === "descendant"); i++) await sleep(50);
    const child = records().find((r) => r.provider === provider && r.kind === "descendant");
    assert(child, "Provider child never launched");
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await page.locator(".chat-wrap:not(.hidden)").getByText("Stopped.", { exact: true }).waitFor();
    assert(!alive(child.pid), "Provider Stop left a descendant running");
    await page.getByRole("button", { name: "YOLO mode" }).click();
    await send("YOLO provider"); await done();
    assert(records().find((r) => r.provider === provider && r.prompt === "YOLO provider").args.includes(provider === "codex" ? "--dangerously-bypass-approvals-and-sandbox" : "--dangerously-skip-permissions"));
    await checkQueue(provider);
    await page.getByRole("button", { name: "Terminal", exact: true }).click();
    for (let i = 0; i < 100 && !records().some((r) => r.provider === provider && r.kind === "terminal"); i++) await sleep(50);
    const providerTerminal = records().find((r) => r.provider === provider && r.kind === "terminal");
    assert(providerTerminal);
    assert(providerTerminal.args.includes(provider === "codex" ? "fixture-codex" : "fixture-agy-high"));
    assert(providerTerminal.args.includes(provider === "codex" ? "model_reasoning_effort='high'" : "high"));
    await page.getByRole("tab", { selected: true }).locator(".tab-close").click();
    console.log(`PASS: ${provider} native stdin, resume isolation, failures, Stop, permissions and ConPTY`);
  }
  await pickProvider(page,"muse");
  await send("HOLD");
  for (let i = 0; i < 100 && records().filter((r) => r.kind === "descendant").length < 3; i++) await sleep(50);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  assert(alive(app.pid), "Closing a busy window terminated background work");
  assert.equal(await invoke("plugin:window|is_visible", { label: "main" }), false);
  await invoke("desktop_quit").catch(() => {});
  for (let i = 0; i < 100 && appAlive(); i++) await sleep(50);
  assert(!appAlive(), "Application did not exit");
  let remaining = ownedFixturePids();
  for (let i = 0; i < 20 && remaining.length; i++) { await sleep(50); remaining = ownedFixturePids(); }
  assert.deepEqual(remaining, [], "App exit left this run's fixture children running");
  if (notifications) assert.deepEqual(JSON.parse(notificationProbe("History")), [], "Quit left stale conversation notifications");
  for (const r of records().filter((r) => r.kind === "turn")) assert(!existsSync(r.file), "app exit leaked a staged prompt");
  assert.deepEqual(errors, []);
  console.log("PASS: explicit Quit terminates all agent, terminal and descendant processes");
  console.log(`Artifacts: ${runDir}`);
} catch (error) {
  if (page && !page.isClosed()) {
    console.error("Native page failure:", page.url(), await page.locator("body").innerText().catch(() => ""), errors);
    await page.screenshot({ path: path.join(runDir, "failure.png"), animations: "disabled" }).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close().catch(() => {});
  if (appAlive()) execFileSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  // A PID in the historical log alone never authorizes killing a process.
  for (const pid of ownedFixturePids()) {
    try { execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {}
  }
  if (vite && alive(vite.pid)) vite.kill();
}
