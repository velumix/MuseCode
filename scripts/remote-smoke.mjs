// Native end-to-end test through real Tailscale HTTPS. Requires a signed-in
// Tailscale client and an unused Serve port 8443. No real Muse/provider calls.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installed = process.argv.includes("--installed");
const release = installed || process.argv.includes("--release");
const count = execFileSync("powershell.exe", ["-NoProfile", "-Command", "@(Get-Process muse-code-app -ErrorAction SilentlyContinue).Count"], { encoding: "utf8", windowsHide: true }).trim();
assert.equal(count, "0", "Quit MuseCode before testing; tests must not attach to your conversations.");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = path.join(root, ".qa", `remote-${Date.now()}`);
mkdirSync(run, { recursive: true });
const log = path.join(run, "children.jsonl");
writeFileSync(log, "");
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
  const executable = installed ? path.join(process.env.LOCALAPPDATA, "Muse Code/muse-code-app.exe") : path.join(root, `src-tauri/target/${release ? "release" : "debug"}/muse-code-app.exe`);
  app = spawn(executable, [], { cwd: root, windowsHide: true, stdio: "ignore", env: { ...process.env,
    PATH: `${run};${process.env.PATH}`, MUSE_QA_LOG: log, MUSE_CODE_CONFIG_DIR: path.join(run, "settings"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=19423", WEBVIEW2_USER_DATA_FOLDER: path.join(run, "webview"),
  } });
  for (let i = 0; i < 120; i++) {
    if (app.exitCode !== null) throw new Error(`Native app exited (${app.exitCode}).`);
    try { native = await chromium.connectOverCDP("http://127.0.0.1:19423"); break; } catch {} await sleep(100);
  }
  assert(native, "Native WebView was unavailable.");
  desktop = native.contexts()[0].pages()[0];
  desktop.on("pageerror", (e) => errors.push(e.message));
  await expect(desktop.locator("textarea")).toBeEnabled();
  await invoke("desktop_set_notifications", { enabled: false });
  await desktop.locator("textarea").fill("Desktop fixture");
  await desktop.locator("textarea").press("Enter");
  await expect(desktop.locator(".status-text")).toContainText("Done");
  const status = await invoke("remote_enable", { enabled: true });
  assert(status.enabled && status.url.startsWith("https://"));
  console.log("PASS: app-owned Tailscale Serve route provides private HTTPS");
  const invitation = await invoke("remote_pair");
  assert(invitation.svg.includes("<svg"));
  phoneBrowser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync), headless: true });
  const context = await phoneBrowser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  phone = await context.newPage();
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.goto(invitation.url);
  await expect(phone.getByLabel("Name this phone")).toBeVisible();
  assert(!phone.url().includes("pair="), "Pairing token stayed in the browser address");
  await phone.getByLabel("Name this phone").fill("QA phone");
  await phone.getByRole("button", { name: "Pair with desktop" }).click();
  await expect(phone.getByLabel("Pairing code")).toHaveText(invitation.code);
  await desktop.getByRole("button", { name: "Connect phone", exact: true }).click();
  await expect(desktop.getByRole("region", { name: "Confirm phone pairing" })).toContainText("QA phone");
  await desktop.getByRole("dialog").getByRole("button", { name: "Connect phone", exact: true }).click();
  await expect(phone.locator(".phone-online")).toBeVisible();
  await expect(phone.getByText("Reply: Desktop fixture", { exact: true })).toBeVisible();
  const cookies = await context.cookies();
  const cookie = cookies.find((c) => c.name === "__Host-muse");
  assert(cookie?.httpOnly && cookie.secure && cookie.sameSite === "Strict");
  assert(!readFileSync(path.join(run, "settings/remote.json"), "utf8").includes(cookie.value));
  console.log("PASS: QR pairing requires desktop confirmation; phone replays desktop history; credentials are hashed at rest");
  await desktop.getByRole("button", { name: "Close remote access" }).click();
  await desktop.getByRole("button", { name: "Close", exact: true }).click();
  assert.equal(await invoke("plugin:window|is_visible", { label: "main" }), false);
  await phone.getByLabel("Message your desktop agent").fill("From phone in tray");
  await phone.getByRole("button", { name: "Send message" }).click();
  await expect(phone.getByText("Reply: From phone in tray", { exact: true })).toBeVisible();
  await expect(desktop.locator(".msg.user").last()).toContainText("From phone in tray");
  assert.equal(await invoke("plugin:window|is_visible", { label: "main" }), false);
  await phone.reload();
  await expect(phone.getByText("Reply: From phone in tray", { exact: true })).toBeVisible();
  await expect(phone.locator(".phone-message.user")).toHaveCount(2);
  console.log("PASS: phone controls the actual background runner; desktop stays hidden; reload restores the conversation");
  await phone.getByLabel("Message your desktop agent").fill("HOLD");
  await phone.getByRole("button", { name: "Send message" }).click();
  await expect(phone.getByRole("button", { name: "Stop task" })).toBeVisible();
  await expect.poll(() => readFileSync(log, "utf8").includes('"kind":"descendant"')).toBe(true);
  await phone.getByRole("button", { name: "Stop task" }).click();
  await expect(phone.getByText("Task stopped.", { exact: true })).toBeVisible();
  await expect(desktop.locator(".tool-status")).toHaveText("cancelled");
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
  await invoke("remote_enable", { enabled: false });
  assert.equal((await invoke("remote_status")).enabled, false);
  assert.deepEqual(errors, []);
  console.log("PASS: revocation clears the phone and disables control immediately; turning access off closes its listener");
} catch (error) {
  await phone?.screenshot({ path: path.join(run, "phone-failure.png") }).catch(() => {});
  await desktop?.screenshot({ path: path.join(run, "desktop-failure.png") }).catch(() => {});
  throw error;
} finally {
  if (desktop && !desktop.isClosed()) { await invoke("remote_enable", { enabled: false }).catch(() => {}); await invoke("desktop_quit").catch(() => {}); }
  await phoneBrowser?.close();
  await native?.close().catch(() => {});
  if (app && app.exitCode === null) { await sleep(500); if (app.exitCode === null) app.kill(); }
  vite?.kill();
}
