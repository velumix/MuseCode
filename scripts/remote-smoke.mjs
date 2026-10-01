// Native end-to-end test through real Tailscale HTTPS. Requires a signed-in
// Tailscale client and an unused Serve port 8443. No real Muse/provider calls.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const usb = process.argv.includes("--usb-fixture");
const installed = process.argv.includes("--installed");
const release = installed || process.argv.includes("--release");
const count = execFileSync("powershell.exe", ["-NoProfile", "-Command", "@(Get-Process velum-code -ErrorAction SilentlyContinue).Count"], { encoding: "utf8", windowsHide: true }).trim();
assert.equal(count, "0", "Quit VelumCode before testing; tests must not attach to your conversations.");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = path.join(root, ".qa", `remote-${Date.now()}`);
mkdirSync(run, { recursive: true });
const log = path.join(run, "children.jsonl");
writeFileSync(log, "");
const sdk = path.join(run, "sdk");
if (usb) {
  mkdirSync(path.join(sdk, "platform-tools"), { recursive: true });
  const compiler = path.join(process.env.WINDIR || "C:/Windows", "Microsoft.NET/Framework64/v4.0.30319/csc.exe");
  execFileSync(compiler, ["/nologo", "/target:exe", `/out:${path.join(sdk, "platform-tools/adb.exe")}`, path.join(root, "tests/fixtures/adb.cs")], { windowsHide: true });
}
writeFileSync(path.join(run, "muse.cmd"), `@echo off\r\n"${process.execPath}" "${path.join(root, "tests/fixtures/muse-cli.cjs")}" %*\r\n`);
let vite, app, native, phoneBrowser, phone, desktop;
const errors = [];
const invoke = (cmd, args = {}) => desktop.evaluate(({ cmd, args }) => window.__TAURI_INTERNALS__.invoke(cmd, args), { cmd, args });
try {
  if (!release) {
    try { await fetch("http://127.0.0.1:1420", { signal: AbortSignal.timeout(1000) }); }
    catch { vite = spawn(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1"], { cwd: root, windowsHide: true, stdio: "ignore" }); }
    for (let i = 0; i < 100; i++) { try { if ((await fetch("http://127.0.0.1:1420")).ok) break; } catch {} await sleep(100); }
  }
  const executable = installed ? path.join(process.env.LOCALAPPDATA, "Velum Code/velum-code.exe") : path.join(root, `src-tauri/target/${release ? "release" : "debug"}/velum-code.exe`);
  app = spawn(executable, [], { cwd: root, windowsHide: true, stdio: "ignore", env: { ...process.env,
    PATH: `${run};${process.env.PATH}`, MUSE_QA_LOG: log, MUSE_CODE_CONFIG_DIR: path.join(run, "settings"),
    XDG_DATA_HOME:path.join(run,'provider-data'),CODEX_HOME:path.join(run,'codex-data'),
    ...(usb ? { ANDROID_HOME: sdk, MUSE_QA_ADB_DIR: run } : {}),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=19423", WEBVIEW2_USER_DATA_FOLDER: path.join(run, "webview"),
  } });
  for (let i = 0; i < 120; i++) {
    if (app.exitCode !== null) throw new Error(`Native app exited (${app.exitCode}).`);
    try { native = await chromium.connectOverCDP("http://127.0.0.1:19423"); break; } catch {} await sleep(100);
  }
  assert(native, "Native WebView was unavailable.");
  desktop = native.contexts()[0].pages()[0];
  desktop.on("pageerror", (e) => errors.push(e.message));
  await expect(desktop.locator('#startup')).toHaveCount(0);
  await expect(desktop.locator('#root')).not.toHaveAttribute('inert','');
  await expect(desktop.locator("textarea")).toBeEnabled();
  await invoke("desktop_set_notifications", { enabled: false });
  // WebView2 needs a shown window for simulated input. Background activity is tested below.
  await invoke("desktop_show");
  await desktop.locator("textarea").fill("Desktop fixture");
  await desktop.locator("textarea").press("Enter");
  await expect(desktop.locator(".status-text")).toContainText("Done");
  let invitation;
  if (usb) {
    const devices = await invoke("remote_usb_devices");
    assert.equal(devices[0].serial, "USB_FIXTURE");
    const status = await invoke("remote_usb_connect", { serial: devices[0].serial });
    assert.equal(status.enabled, false);
    assert.equal(status.usb.serial, "USB_FIXTURE");
    invitation = { url: readFileSync(path.join(run, "invitation.txt"), "utf8") };
    assert(invitation.url.startsWith("http://127.0.0.1:43827/#pair="));
    console.log("PASS: USB listener starts independently of Tailscale; fixture ADB receives the app launch");
  } else {
    const status = await invoke("remote_enable", { enabled: true });
    assert(status.enabled && status.url.startsWith("https://"));
    console.log("PASS: app-owned Tailscale Serve route provides private HTTPS");
    invitation = await invoke("remote_pair");
    assert(invitation.svg.includes("<svg"));
  }
  phoneBrowser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync), headless: true });
  const context = await phoneBrowser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  phone = await context.newPage();
  phone.on("pageerror", (e) => errors.push(e.message));
  if (release) {
    // Seed the cache left by the former phone app before the new worker starts.
    await phone.goto(new URL("/manifest.webmanifest", invitation.url).href);
    await phone.evaluate(async () => {
      const old = await caches.open("muse-phone-v2");
      await old.put("/", new Response("<title>Muse Code</title><main>Old phone shell</main>"));
    });
  }
  await phone.goto(invitation.url);
  if (release) {
    await phone.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    const workerCache=readFileSync(path.join(root,'public/sw.js'),'utf8').match(/const CACHE\s*=\s*["']([^"']+)["']/)?.[1];
    assert(workerCache,'Service worker cache name missing');
    await expect.poll(() => phone.evaluate(() => caches.keys())).toEqual([workerCache]);
    await context.setOffline(true);
    const offline = await context.newPage();
    await offline.goto(new URL("/", invitation.url).href);
    assert((await offline.title()).includes("Velum Code"), "Offline launch used the old brand shell");
    assert(!(await offline.locator("body").innerText()).includes("Old phone shell"));
    await offline.close();
    await context.setOffline(false);
    const cached = await phone.evaluate(async (name) => (await (await caches.open(name)).keys()).map((r) => r.url),workerCache);
    assert(cached.every((url) => !url.includes("/api/") && !url.includes("pair=")), "Phone cache contains private data");
    console.log("PASS: old phone cache migrates, offline launch has current branding, private data stays uncached");
  }
  await expect(phone.getByLabel("Name this phone")).toBeVisible();
  assert(!phone.url().includes("pair="), "Pairing token stayed in the browser address");
  await phone.getByLabel("Name this phone").fill("QA phone");
  await phone.getByRole("button", { name: "Pair with desktop" }).click();
  await expect(phone.getByLabel("Pairing code")).toHaveText(invitation.code || /^\d{6}$/);
  await desktop.getByRole("button", { name: "Connect phone", exact: true }).click();
  await expect(desktop.getByRole("region", { name: "Confirm phone pairing" })).toContainText("QA phone");
  await desktop.getByRole("dialog").getByRole("button", { name: "Connect phone", exact: true }).click();
  await expect(phone.locator(".phone-online")).toBeVisible();
  await expect(phone.getByText("Reply: Desktop fixture", { exact: true })).toBeVisible();
  const cookies = await context.cookies();
  const cookie = cookies.find((c) => c.name === (usb ? "muse-usb" : "__Host-muse"));
  assert(cookie?.httpOnly && cookie.secure === !usb && cookie.sameSite === "Strict");
  assert(!readFileSync(path.join(run, "settings/remote.json"), "utf8").includes(cookie.value));
  console.log("PASS: QR pairing requires desktop confirmation; phone replays desktop history; credentials are hashed at rest");
  await desktop.getByRole("button", { name: "Close remote access" }).click();
  await phone.locator(".phone-assistant-controls > summary").click();
  await desktop.getByRole("button", { name: "Assistant settings", exact: true }).click();
  await phone.getByRole("button", { name: /^Model:/ }).click();
  await phone.getByRole("option").getByText("Fixture Muse", { exact: true }).click();
  await phone.getByRole("button", { name: /^Reasoning:/ }).click();
  await phone.getByRole("option", { name: /^High / }).click();
  await expect(desktop.getByRole("button", { name: "Model: Fixture Muse", exact: true })).toBeVisible();
  await expect(desktop.getByRole("button", { name: "Reasoning: High", exact: true })).toBeVisible();
  await expect.poll(() => desktop.evaluate(() => JSON.parse(localStorage.getItem("velum-options-muse") || "null"))).toEqual({ model: "fixture-muse", reasoning: "high" });
  await desktop.getByRole("button", { name: "Close", exact: true }).click();
  assert.equal(await invoke("plugin:window|is_visible", { label: "main" }), false);
  const contextReport=await phone.evaluate(async()=>{
    const list=await (await fetch('/api/sessions')).json();
    const response=await fetch('/api/sessions/'+encodeURIComponent(list.sessions[0].id)+'/diagnostics');
    return {status:response.status,cache:response.headers.get('cache-control'),report:await response.json()};
  });
  assert.equal(contextReport.status,200);
  assert.equal(contextReport.cache,'no-store');
  assert.equal(contextReport.report.workspace.path,'<selected-project>');
  assert(!JSON.stringify(contextReport.report).includes('Desktop fixture'));
  await phone.getByRole('button',{name:'Project context & diagnostics'}).click();
  await expect(phone.getByLabel('Velum diagnostics preview')).toContainText('not checked');
  await phone.getByRole('button',{name:'Chat layout',exact:true}).click();
  assert.equal(JSON.parse(await phone.getByLabel('Chat layout snapshot preview').inputValue()).source,'phone');
  await phone.getByLabel('Close diagnostics').click();
  console.log('PASS: native paired-phone diagnostics are sanitized, uncached and previewed with the phone layout');
  await phone.getByLabel("Message your desktop agent").fill("From phone in tray");
  await phone.getByRole("button", { name: "Send message" }).click();
  await expect(phone.getByText("Reply: From phone in tray", { exact: true })).toBeVisible();
  await expect(desktop.locator(".msg.user").last()).toContainText("From phone in tray");
  assert.equal(await invoke("plugin:window|is_visible", { label: "main" }), false);
  await phone.reload();
  await expect(phone.getByText("Reply: From phone in tray", { exact: true })).toBeVisible();
  await expect(phone.locator(".phone-message.user")).toHaveCount(2);
  console.log("PASS: phone controls the actual background runner; desktop stays hidden; reload restores the conversation");
  await phone.getByLabel("Message your desktop agent").fill("Recover this phone draft");
  await phone.reload();
  await expect(phone.getByLabel("Message your desktop agent")).toHaveValue("Recover this phone draft");
  await phone.getByRole("button", { name: "Memory", exact: true }).click();
  await phone.getByRole("button", { name: "New note", exact: true }).click();
  await phone.getByLabel("Memory title", { exact: true }).fill("Phone preference");
  await phone.getByLabel("Memory note", { exact: true }).fill("Use concise deployment instructions.");
  await phone.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(phone.getByRole("button", { name: "Archive", exact: true })).toBeVisible();
  const sessions = await phone.evaluate(async () => (await (await fetch("/api/sessions")).json()).sessions);
  const vault = await invoke("memory_request", { workspace: sessions[0].workspace, request: { action: "list" } });
  assert(vault.notes.some(n => n.title === "Phone preference"));
  await phone.screenshot({ path: path.join(run, "memory-phone.png") });
  await phone.getByRole("button", { name: "Close memory" }).click();
  await expect(phone.getByLabel("Message your desktop agent")).toHaveValue("Recover this phone draft");
  console.log("PASS: phone drafts survive reload; authenticated phone editor writes the same desktop Markdown vault");
  const phoneLesson='Before presenting a result, state what changed and the next useful action.';
  await phone.getByRole('button',{name:'Correct response',exact:true}).last().click();
  await phone.getByLabel('What should change?',{exact:true}).fill('Start with the outcome.');
  await phone.getByRole('checkbox',{name:'Remember a lesson for this project',exact:true}).check();
  await phone.getByLabel('Lesson for next time',{exact:true}).fill(phoneLesson);
  await phone.getByRole('button',{name:'Send & save lesson',exact:true}).click();
  await expect(phone.locator('.correction-composer')).toContainText('Lesson saved');
  await expect(phone.getByRole('button',{name:'Stop task',exact:true})).toHaveCount(0);
  await expect(phone.getByLabel('Message your desktop agent')).toHaveValue('Recover this phone draft');
  const reviewed=await invoke('memory_request',{workspace:sessions[0].workspace,request:{action:'list'}});
  assert(reviewed.notes.some(n=>n.body===phoneLesson && n.pinned && n.scope==='project' && n.status==='active'));
  await phone.getByRole('button',{name:'Back to the conversation',exact:true}).click();
  await phone.getByLabel('Message your desktop agent').fill('Recall reviewed phone lesson');
  await phone.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(phone.getByText('Reply: Recall reviewed phone lesson',{exact:true})).toBeVisible();
  const recalled=readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line)).find(r=>r.prompt==='Recall reviewed phone lesson');
  assert(recalled.input.includes(phoneLesson),'Reviewed phone guidance did not reach the native provider');
  await phone.getByLabel('Message your desktop agent').fill('Recover this phone draft');
  console.log('PASS: paired phone correction preserves its draft, saves a scoped lesson and supplies it to the next native turn');

  await phone.getByRole("button",{name:"Kanban",exact:true}).click();
  await phone.getByRole("button",{name:"Add task to Backlog",exact:true}).click();
  await phone.getByLabel("Title",{exact:true}).fill("From phone board");
  await phone.getByLabel("Details",{exact:true}).fill("Shared with the desktop");
  await phone.getByRole("button",{name:"Save task",exact:true}).click();
  await expect(phone.getByRole("button",{name:"From phone board",exact:true})).toBeVisible();
  const sharedBoard=await invoke("kanban_request",{workspace:sessions[0].workspace,request:{action:"load"}});
  assert.equal(sharedBoard.cards[0].title,"From phone board");
  await invoke("kanban_request",{workspace:sessions[0].workspace,request:{action:"move",revision:sharedBoard.revision,id:sharedBoard.cards[0].id,column:"review",before:null}});
  await phone.getByRole("button",{name:"Refresh",exact:true}).click();
  await expect(phone.locator(".review .kanban-card-title")).toHaveText("From phone board");
  await phone.getByRole("button",{name:"Close Kanban"}).click();
  console.log("PASS: paired phone and desktop edit the same persistent Kanban board");
  await phone.getByRole('button',{name:'Bots',exact:true}).click();
  await phone.getByRole('button',{name:'New bot',exact:true}).click();
  await phone.getByLabel('Bot name',{exact:true}).fill('Phone teammate');
  await expect(phone.locator('.bots-panel').getByRole('button',{name:/^Model: Fixture Muse$/})).toBeEnabled();
  await phone.getByRole('button',{name:'Automation',exact:true}).click();
  await phone.getByLabel('Run automatically on schedule').uncheck();
  await expect(phone.getByText(/Next runs:/)).toBeVisible();
  await phone.getByRole('button',{name:'Save bot',exact:true}).click();
  const savedBots=await invoke('bots_request',{request:{action:'list'}});
  assert.equal(savedBots.profiles[0].name,'Phone teammate');assert.equal(savedBots.profiles[0].automatic,false);
  await phone.locator('.bot-card').getByRole('button',{name:'Memory',exact:true}).click();
  await phone.getByRole('button',{name:'New note',exact:true}).click();await phone.getByLabel('Memory title',{exact:true}).fill('Private phone note');await phone.getByLabel('Memory note',{exact:true}).fill('This memory belongs to Phone teammate.');await phone.getByRole('button',{name:'Save note',exact:true}).click();await phone.getByRole('button',{name:'Close memory'}).click();
  const botVault=await invoke('bots_memory',{id:savedBots.profiles[0].id,workspace:sessions[0].workspace,request:{action:'list',query:''}});assert(botVault.notes.some(n=>n.title==='Private phone note'));
  await phone.locator('.bot-card').getByRole('button',{name:'Chat',exact:true}).click();
  await expect(phone.locator('.bots-panel')).toHaveCount(0);await expect(phone.locator('.phone-session-select')).toContainText('Phone teammate');await expect(phone.locator('.phone-online')).toBeVisible();
  assert.equal((await phone.evaluate(async()=>(await (await fetch('/api/sessions')).json()).sessions)).length,2);
  await phone.screenshot({path:path.join(run,'bot-phone.png')});
  await phone.locator('.phone-session-select').click();await phone.locator('.phone-sessions button').filter({hasText:'Desktop fixture'}).click();await expect(phone.getByLabel('Message your desktop agent')).toHaveValue('Recover this phone draft');
  console.log('PASS: paired phone creates native bot profiles/private memories, previews cron, and opens the correct desktop bot conversation without sending');
  if (usb) {
    await invoke("remote_usb_disconnect");
    await expect(phone.getByLabel("Message your desktop agent")).toHaveCount(0);
    assert.equal(existsSync(path.join(run, "route.txt")), false);
    await invoke("remote_usb_connect", { serial: "USB_FIXTURE" });
    await phone.goto("http://127.0.0.1:43827/");
    // Explicit disconnect clears local selection. A new bot may sort before
    // the original conversation; verify recovery by selecting that conversation.
    await expect(phone.locator('.phone-online')).toBeVisible();
    await phone.locator('.phone-session-select').click();
    await phone.locator('.phone-sessions button').filter({hasText:'Desktop fixture'}).click();
    await expect(phone.getByText("Reply: From phone in tray", { exact: true })).toBeVisible();
    console.log("PASS: USB disconnect closes access and removes its mapping; reconnect preserves the paired login");
  }
  await phone.getByLabel("Message your desktop agent").fill("HOLD");
  await phone.getByRole("button", { name: "Send message" }).click();
  await expect(phone.getByRole("button", { name: "Stop task" })).toBeVisible();
  await expect.poll(() => readFileSync(log, "utf8").includes('"kind":"descendant"')).toBe(true);
  await phone.getByRole("button", { name: "Stop task" }).click();
  await expect(phone.getByText("Task stopped.", { exact: true })).toBeVisible();
  await invoke("desktop_show");
  await desktop.locator(".activity-toggle").last().click();
  await expect(desktop.locator(".tool-status")).toHaveText("cancelled");
  await desktop.getByRole("button",{name:"Close",exact:true}).click();
  const primary=(await phone.evaluate(async()=>(await (await fetch('/api/sessions')).json()).sessions)).find(s=>s.title==='Desktop fixture');
  assert(primary,'Primary desktop conversation missing');
  await invoke('agent_send',{id:primary.id,prompt:'HOLD',yolo:false});
  await expect(phone.getByRole('button',{name:'Stop task',exact:true})).toBeVisible();
  await phone.getByLabel('Message your desktop agent').fill('Phone queued work');
  await phone.getByRole('button',{name:'Queue message',exact:true}).click();
  await invoke('agent_send',{id:primary.id,prompt:'Desktop queued work',yolo:false});
  await expect(phone.getByRole('region',{name:'Message queue'})).toContainText('2 queued');
  await expect(desktop.getByRole('region',{name:'Message queue'})).toContainText('Phone queued work');
  const pending=await invoke('agent_queue',{id:primary.id,request:{action:'load'}});
  assert.equal(pending.items[0].remote,true);assert.equal(pending.items[0].yolo,false);
  assert.deepEqual(pending.items.map(m=>m.prompt),['Phone queued work','Desktop queued work']);
  await phone.getByRole('button',{name:'Pause queue',exact:true}).click();
  await phone.getByRole('button',{name:'Edit queued message 1',exact:true}).click();
  await phone.getByRole('textbox',{name:'Edit queued message 1',exact:true}).fill('Phone edited pending work');
  await phone.getByRole('button',{name:'Save queued message',exact:true}).click();
  await phone.getByRole('button',{name:'Remove queued message 2',exact:true}).click();
  await phone.getByRole('button',{name:'Stop task',exact:true}).click();
  await expect(phone.getByRole('button',{name:'Stop task',exact:true})).toHaveCount(0);
  await expect(phone.getByRole('region',{name:'Message queue'})).toContainText('Paused');
  await phone.getByRole('button',{name:'Resume queue',exact:true}).click();
  await expect(phone.getByText('Reply: Phone edited pending work',{exact:true})).toBeVisible();
  await expect(phone.getByRole('button',{name:'Stop task',exact:true})).toHaveCount(0);
  await expect(phone.locator('.usage-speed')).not.toContainText('—');
  const replay=await phone.evaluate(async id=> (await (await fetch('/api/sessions/'+encodeURIComponent(id))).json()),primary.id);
  assert.equal(replay.events.findLast(e=>e.event.kind==='usage').event.turn.output_tokens,120);
  assert.equal((await invoke('agent_queue',{id:primary.id,request:{action:'load'}})).items.length,0);
  assert.equal(await invoke('plugin:window|is_visible',{label:'main'}),false);
  console.log('PASS: authenticated phone and desktop share queue order, edit/remove, Pause/Stop/Resume, standard permissions and measured tok/s while the desktop stays in tray');
  const records = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
  assert(records.filter((r) => r.kind === "turn").every((r) => !r.args.includes("--yolo")));
  await phone.screenshot({ path: path.join(run, "phone.png") });
  const manifest = await phone.evaluate(async () => (await fetch("/manifest.webmanifest")).json());
  assert.equal(manifest.display, "standalone");
  await expect.poll(() => phone.evaluate(async () => !!(await navigator.serviceWorker.getRegistration("/"))?.active)).toBe(true);
  console.log("PASS: phone Stop terminates the process tree; standard permissions remain enforced; installable app shell is served");
  const devices = (await invoke("remote_status")).devices;
  await invoke("remote_revoke", { id: devices[0].id });
  await expect(phone.getByLabel("Message your desktop agent")).toHaveCount(0);
  await expect(phone.locator(".phone-message")).toHaveCount(0);
  await invoke(usb ? "remote_usb_disconnect" : "remote_enable", { enabled: false });
  assert.equal((await invoke("remote_status")).enabled, false);
  assert.deepEqual(errors, []);
  console.log("PASS: revocation clears the phone and disables control immediately; turning access off closes its listener");
} catch (error) {
  await phone?.screenshot({ path: path.join(run, "phone-failure.png") }).catch(() => {});
  await desktop?.screenshot({ path: path.join(run, "desktop-failure.png") }).catch(() => {});
  throw error;
} finally {
  if (desktop && !desktop.isClosed()) { await invoke(usb ? "remote_usb_disconnect" : "remote_enable", { enabled: false }).catch(() => {}); await invoke("desktop_quit").catch(() => {}); }
  await phoneBrowser?.close();
  await native?.close().catch(() => {});
  if (app && app.exitCode === null) { await sleep(500); if (app.exitCode === null) app.kill(); }
  vite?.kill();
}
