import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Exercise the real React UI and xterm with a controlled IPC boundary.
// Native process/CLI behavior is covered separately; no provider calls here.
async function boot(page: Page, delay = 0) {
  await page.addInitScript(({ delay }) => {
    const w = window as any;
    w.isTauri = true;
    const callbacks = new Map();
    const listeners = new Map();
    let serial = 0;
    const api = w.qa = { calls: [] as any[], sessions: new Map(), failSend: false,
      remote: { enabled: false, url: null as string | null, error: null, devices: [] as any[], pending: null as any,
        tailscale: { installed: true, connected: true, hostname: "desktop.tail.ts.net", message: "Connected to your private network." } },
      desktop: { notifications_enabled: true, last_error: null }, pendingNavigation: null as string | null,
      emit(event: string, payload: unknown) {
        for (const [id, entry] of listeners) {
          if (entry.event === event) callbacks.get(entry.handler)?.({ event, id, payload });
        }
      },
      agent(event: unknown) {
        const last = api.calls.filter((c: any) => c.cmd === "agent_send").at(-1);
        api.emit("agent-event", { id: last.args.id, event });
      },
      listenerCount() { return listeners.size; },
    };
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback(fn: unknown) { const id = ++serial; callbacks.set(id, fn); return id; },
      unregisterCallback(id: number) { callbacks.delete(id); },
      async invoke(cmd: string, args: any = {}) {
        api.calls.push({ cmd, args });
        if (cmd === "remote_status" || cmd === "remote_check_tailscale") return { ...api.remote };
        if (cmd === "remote_enable") { api.remote.enabled = args.enabled; api.remote.url = args.enabled ? "https://desktop.tail.ts.net:8443" : null; return { ...api.remote }; }
        if (cmd === "remote_pair") return { url: "https://desktop.tail.ts.net:8443/#pair=test", code: "482196", expires_at: Math.floor(Date.now() / 1000) + 120, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="white"/></svg>' };
        if (cmd === "remote_approve") { api.remote.devices.push({ id: "phone", name: api.remote.pending.name, control: args.control, created_at: Math.floor(Date.now() / 1000) }); api.remote.pending = null; return; }
        if (cmd === "remote_cancel_pairing") { api.remote.pending = null; return; }
        if (cmd === "remote_revoke") { api.remote.devices = api.remote.devices.filter((d: any) => d.id !== args.id); return; }
        if (cmd === "desktop_status") return api.desktop;
        if (cmd === "desktop_set_notifications") { api.desktop.notifications_enabled = args.enabled; return { ...api.desktop }; }
        if (cmd === "desktop_take_navigation") { const id = api.pendingNavigation; api.pendingNavigation = null; return id; }
        if (cmd === "plugin:event|listen") {
          if (delay) await new Promise((r) => setTimeout(r, delay));
          const id = ++serial; listeners.set(id, args); return id;
        }
        if (cmd === "plugin:event|unlisten") { listeners.delete(args.eventId); return; }
        if (cmd === "agent_validate_workspace") {
          if (args.workspace?.includes("missing")) throw "workspace is not a directory";
          return args.workspace || "C:\\QA";
        }
        if (cmd === "agent_new") {
          if (delay) await new Promise((r) => setTimeout(r, delay));
          if (args.workspace?.includes("missing")) throw "workspace is not a directory";
          api.sessions.set(args.id, "agent");
          return { id: args.id, session_id: `native-${args.id}`, workspace: args.workspace || "C:\\QA" };
        }
        if (cmd === "agent_send") {
          if (api.failSend) throw "Could not launch muse";
          return { id: args.id, turn_id: "turn" };
        }
        if (cmd === "agent_stop") { api.emit("agent-event", { id: args.id, event: { kind: "turn_end", status: "cancelled" } }); return; }
        if (cmd === "agent_destroy" || cmd === "pty_kill") { api.sessions.delete(args.id); return; }
        if (cmd === "pty_spawn") {
          api.sessions.set(args.id, "terminal");
          setTimeout(() => api.emit("pty-data", { id: args.id, data: "hello terminal\r\nsearch target\r\n" }), 30);
          return { id: args.id, backend: "fixture muse" };
        }
        if (cmd === "plugin:window|is_maximized") return false;
      },
    };
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener(_event: string, id: number) { listeners.delete(id); } };
  }, { delay });
  await page.goto("/");
  await expect(page.locator(".chat-wrap:not(.hidden) textarea")).toBeEnabled();
}

const composer = (page: Page) => page.locator(".chat-wrap:not(.hidden) textarea");

test("desktop pairing offers QR, matching-code approval, view-only access and revocation", async ({ page }) => {
  await boot(page);
  await page.getByRole("button", { name: "Connect phone", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Connect your phone" });
  await panel.getByRole("button", { name: "Enable remote access" }).click();
  await panel.getByRole("button", { name: "Show pairing code" }).click();
  await expect(panel.getByRole("img")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await page.evaluate(() => {
    const qa = (window as any).qa;
    qa.remote.pending = { name: "My Pixel", code: "482196", expires_at: Math.floor(Date.now() / 1000) + 120 };
    qa.emit("remote-status", { ...qa.remote });
  });
  await expect(panel.getByText("482196")).toBeVisible();
  await panel.getByLabel("Allow sending messages and stopping tasks").uncheck();
  await panel.getByRole("button", { name: "Connect phone", exact: true }).click();
  await expect(panel.getByText(/View only · paired/)).toBeVisible();
  await panel.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(panel.getByText("My Pixel", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect phone", exact: true })).toBeFocused();
});

test("desktop reflects phone-originated messages without duplicating CLI echoes", async ({ page }) => {
  await boot(page);
  await composer(page).fill("Desktop draft");
  await page.evaluate(() => {
    const qa = (window as any).qa;
    const id = qa.calls.filter((c: any) => c.cmd === "agent_new").at(-1).args.id;
    qa.emit("agent-event", { id, event: { kind: "turn_start", prompt: "From my phone", remote: true } });
    qa.emit("agent-event", { id, event: { kind: "user_message", text: "From my phone" } });
    qa.emit("agent-event", { id, event: { kind: "assistant_delta", text: "Shared result" } });
    qa.emit("agent-event", { id, event: { kind: "turn_end", status: "completed" } });
  });
  await expect(page.locator(".msg.user")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("From my phone");
  await expect(page.locator(".msg.assistant")).toContainText("Shared result");
  await expect(composer(page)).toHaveValue("Desktop draft");
});

async function send(page: Page, text = "Review this project") {
  await composer(page).fill(text);
  await composer(page).press("Enter");
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
}
async function event(page: Page, value: object) { await page.evaluate((e) => (window as any).qa.agent(e), value); }

test("same-mode click and round-trip preserve conversation, draft, workspace and YOLO", async ({ page }) => {
  await boot(page);
  await send(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Review this project");
  await event(page, { kind: "assistant_delta", text: "Answer to preserve" });
  await event(page, { kind: "turn_end", status: "completed" });
  await composer(page).fill("unsent draft");
  await page.getByRole("button", { name: "YOLO mode" }).click();
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(page.getByText("Answer to preserve", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page.locator(".terminal-host:not(.hidden)")).toBeVisible();
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(page.getByText("Answer to preserve", { exact: true })).toBeVisible();
  await expect(composer(page)).toHaveValue("unsent draft");
  await expect(page.getByRole("button", { name: "YOLO mode" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Workspace directory")).toHaveValue("C:\\QA");
});

test("invalid workspace preserves transcript and can be corrected with Apply", async ({ page }) => {
  await boot(page);
  await send(page);
  await event(page, { kind: "assistant_delta", text: "Keep this conversation" });
  await event(page, { kind: "turn_end", status: "completed" });
  await page.getByLabel("Workspace directory").fill("C:\\missing");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".notice.error")).toContainText("workspace is not a directory");
  await expect(page.getByText("Keep this conversation", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeEnabled();
  await page.getByLabel("Workspace directory").fill("C:\\QA2");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByLabel("Workspace directory")).toHaveAttribute("title", "C:\\QA2");
  await expect(composer(page)).toBeEnabled();
});

test("workspace Enter cannot restart an active turn", async ({ page }) => {
  await boot(page);
  await send(page);
  await page.getByLabel("Workspace directory").fill("C:\\QA2");
  await page.getByLabel("Workspace directory").press("Enter");
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await expect(page.locator(".msg.user")).toContainText("Review this project");
});

test("terminal-only final answer and failures are visible; interrupted tools stop spinning", async ({ page }) => {
  await boot(page);
  await send(page);
  await event(page, { kind: "turn_end", status: "completed", text: "Final without deltas" });
  await expect(page.locator(".msg.assistant")).toContainText("Final without deltas");
  await send(page, "Another turn");
  await event(page, { kind: "tool_start", task_id: "tool-1", name: "powershell" });
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator(".tool-status")).toHaveText("cancelled");
  await send(page, "Fail this turn");
  await event(page, { kind: "turn_end", status: "failed" });
  await expect(page.locator(".notice.error")).toBeVisible();
  await expect(page.locator(".status-text")).not.toHaveText("Ready");
});

test("failed sends restore the prompt and IME Enter does not send", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { (window as any).qa.failSend = true; });
  await composer(page).fill("Retry this exact prompt");
  await composer(page).press("Enter");
  await expect(page.locator(".notice.error")).toContainText("Could not launch muse");
  await expect(composer(page)).toHaveValue("Retry this exact prompt");
  await page.evaluate(() => { (window as any).qa.failSend = false; });
  const before = await page.evaluate(() => (window as any).qa.calls.filter((c: any) => c.cmd === "agent_send").length);
  await composer(page).dispatchEvent("keydown", { key: "Enter", isComposing: true });
  expect(await page.evaluate(() => (window as any).qa.calls.filter((c: any) => c.cmd === "agent_send").length)).toBe(before);
});

test("StrictMode and closing during delayed initialization leave no ghost sessions/listeners", async ({ page }) => {
  await boot(page, 100);
  await page.waitForTimeout(450);
  const initial = await page.evaluate(() => ({ count: (window as any).qa.sessions.size, listeners: (window as any).qa.listenerCount() }));
  expect(initial.count).toBe(1);
  await page.getByRole("button", { name: "New session (Ctrl+T)", exact: true }).click();
  await page.getByTitle("Close muse 2", { exact: true }).click();
  await page.waitForTimeout(650);
  expect(await page.evaluate(() => (window as any).qa.sessions.size)).toBe(1);
  expect(await page.evaluate(() => (window as any).qa.listenerCount())).toBe(initial.listeners);
});

test("palette traps focus and restores it on Escape; tabs support arrow keys", async ({ page }) => {
  await boot(page);
  await composer(page).focus();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(composer(page)).toBeFocused();
  await page.keyboard.press("Control+t");
  await page.getByRole("tab").last().focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
});

test("tools, todos, markdown, multi-tab isolation and terminal search work", async ({ page }) => {
  await boot(page);
  await send(page);
  await event(page, { kind: "tool_start", task_id: "t1", name: "read_file" });
  await event(page, { kind: "tool_result", task_id: "t1", text: "a\nb\nc\nd\ne\nf\ng\nh" });
  await event(page, { kind: "tool_end", task_id: "t1", status: "completed" });
  await event(page, { kind: "todos", items: [{ text: "Check tests", status: "in_progress" }, { text: "Read files", status: "completed" }] });
  await event(page, { kind: "assistant_delta", text: "**Review complete**\n\n```js\nconst x = 1;\n```\n\n[Docs](https://example.com)" });
  await event(page, { kind: "turn_end", status: "completed" });
  await expect(page.locator(".md strong")).toHaveText("Review complete");
  await expect(page.locator(".todos")).toContainText("Check tests");
  await page.locator(".tool-head").click();
  await expect(page.locator(".tool-output.full")).toContainText("h");
  await page.getByRole("link", { name: "Docs" }).click();
  expect(await page.evaluate(() => (window as any).qa.calls.some((c: any) => c.cmd === "plugin:opener|open_url"))).toBe(true);
  await page.keyboard.press("Control+t");
  await expect(composer(page)).toBeEnabled();
  await expect(page.locator(".chat-wrap:not(.hidden) .msg")).toHaveCount(0);
  await page.keyboard.press("Control+Shift+Tab");
  await expect(page.locator(".chat-wrap:not(.hidden) .md strong")).toHaveText("Review complete");
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page.locator(".status-text")).toContainText("fixture muse");
  await page.keyboard.press("Control+f");
  await page.getByLabel("Find in terminal").fill("search target");
  await page.getByLabel("Find in terminal").press("Enter");
  await expect(page.locator(".xterm-selection div").first()).toBeVisible();
  await page.getByLabel("Find in terminal").press("Escape");
  await expect(page.getByRole("search")).toHaveCount(0);
  await expect(page.locator(".terminal-host:not(.hidden) .xterm-helper-textarea")).toBeFocused();
});

test("restart ignores stale events and closing the last tab creates a usable replacement", async ({ page }) => {
  await boot(page);
  await send(page);
  const oldId = await page.evaluate(() => (window as any).qa.calls.find((c: any) => c.cmd === "agent_send").args.id);
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await expect(composer(page)).toBeEnabled();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New conversation");
  await page.evaluate((id) => (window as any).qa.emit("agent-event", { id, event: { kind: "assistant_delta", text: "STALE OUTPUT" } }), oldId);
  await expect(page.locator(".msg")).toHaveCount(0);
  await page.getByRole("tab").focus();
  await page.keyboard.press("Delete");
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(composer(page)).toBeEnabled();
  await send(page, "Fresh tab");
  await event(page, { kind: "turn_end", status: "completed", text: "Fresh answer" });
  await expect(page.locator(".msg.assistant")).toContainText("Fresh answer");
});

test("multiline prompts, prompt history, code copy and palette commands", async ({ page }) => {
  await boot(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await composer(page).fill("First line");
  await composer(page).press("Shift+Enter");
  await composer(page).pressSequentially("Second line");
  await expect(page.locator(".msg.user")).toHaveCount(0);
  await composer(page).press("Enter");
  await event(page, { kind: "assistant_delta", text: "```js\nconst answer = 42;\n```" });
  await event(page, { kind: "turn_end", status: "completed", text: "```js\nconst answer = 42;\n```" });
  await expect(page.locator(".msg.assistant")).toHaveCount(1);
  await page.screenshot({ path: ".qa/ui-conversation.png", animations: "disabled" });
  await composer(page).press("ArrowUp");
  await expect(composer(page)).toHaveValue("First line\nSecond line");
  await composer(page).press("ArrowDown");
  await expect(composer(page)).toHaveValue("");
  await page.locator(".md-copy").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("const answer = 42;");
  await composer(page).focus();
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("zzzzzzzzzz");
  await expect(page.getByText("No matching commands")).toBeVisible();
  await page.getByRole("combobox").fill("new agent");
  await page.getByRole("combobox").press("Enter");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.keyboard.press("Control+1");
  await expect(page.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
});

test("initial and palette UI meet automated accessibility checks at minimum window size", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await boot(page);
  await page.screenshot({ path: ".qa/ui-empty.png", animations: "disabled" });
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 760, height: 480 });
  await page.screenshot({ path: ".qa/ui-compact.png", animations: "disabled" });
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press("Control+k");
  await page.screenshot({ path: ".qa/ui-palette.png", animations: "disabled" });
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
});

test("long drafts grow within the window and reading position survives streaming and tab switches", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await boot(page);
  const initialHeight = await composer(page).evaluate((el) => el.clientHeight);
  await composer(page).fill(Array.from({ length: 20 }, (_, i) => `Draft line ${i + 1}`).join("\n"));
  expect(await composer(page).evaluate((el) => el.clientHeight)).toBeGreaterThan(initialHeight);
  await page.setViewportSize({ width: 760, height: 480 });
  const draftBounds = await composer(page).boundingBox();
  expect(draftBounds!.height).toBeLessThanOrEqual(116);
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeInViewport();
  await composer(page).fill("");
  expect(await composer(page).evaluate((el) => el.clientHeight)).toBeLessThan(initialHeight + 1);
  await send(page, "Review the project structure");
  await event(page, { kind: "assistant_delta", text: Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}. This is a part of the project review.`).join("\n\n") });
  const feed = page.locator(".chat-wrap:not(.hidden) .chat-scroll");
  await expect.poll(() => feed.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(48);
  await feed.evaluate((el) => { el.scrollTop = 0; });
  await expect(page.getByRole("button", { name: "Back to latest" })).toBeVisible();
  await event(page, { kind: "assistant_delta", text: "\n\nMore output while you are reading earlier messages." });
  expect(await feed.evaluate((el) => el.scrollTop)).toBeLessThan(10);
  await page.keyboard.press("Control+t");
  await expect(composer(page)).toBeEnabled();
  await page.keyboard.press("Control+Shift+Tab");
  await expect(page.getByRole("button", { name: "Back to latest" })).toBeVisible();
  expect(await feed.evaluate((el) => el.scrollTop)).toBeLessThan(10);
  await page.getByRole("button", { name: "Back to latest" }).click();
  await expect(page.getByRole("button", { name: "Back to latest" })).toHaveCount(0);
  await expect.poll(() => feed.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(48);
  await event(page, { kind: "turn_end", status: "completed" });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.locator(".chat-wrap:not(.hidden) .msg.user").scrollIntoViewIfNeeded();
  await page.locator(".chat-wrap:not(.hidden) .msg.user").hover();
  await page.locator(".chat-wrap:not(.hidden) .msg.user").getByRole("button", { name: "Copy message", exact: true }).click();
  await expect(page.getByRole("button", { name: "Message copied", exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Review the project structure");
  expect(await page.locator(".msg.user").first().evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await expect(composer(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: "Back to latest" })).toHaveCount(0);
});

test("desktop notification controls and activation restore the intended conversation", async ({ page }) => {
  await boot(page);
  const firstId = await page.getByRole("tab").getAttribute("data-session-id");
  await send(page, "Original conversation");
  await event(page, { kind: "turn_end", status: "completed", text: "Result to return to" });
  await page.getByRole("button", { name: "Background notifications", exact: true }).click();
  await expect(page.getByRole("button", { name: "Background notifications", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Control+t");
  await expect(composer(page)).toBeEnabled();
  await page.evaluate((id) => { (window as any).qa.pendingNavigation = id; (window as any).qa.emit("desktop-navigation", null); }, firstId);
  await expect(page.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".chat-wrap:not(.hidden) .msg.assistant")).toContainText("Result to return to");
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("test Windows notification");
  await page.getByRole("combobox").press("Enter");
  await expect(page.getByText("Test notification sent to Windows.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss notification message", exact: true }).click();
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("Quit Muse");
  await page.getByRole("combobox").press("Enter");
  await expect.poll(() => page.evaluate(() => (window as any).qa.calls.some((c: any) => c.cmd === "desktop_quit"))).toBe(true);
});
