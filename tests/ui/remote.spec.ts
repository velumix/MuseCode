import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function boot(page: Page, paired = true, control = true, provider = "muse") {
  const remote = {
    paired, control, pending: false, failSend: false, revoked: false, sends: [] as string[],
    sessions: [{ provider, options: { model: "", reasoning: "" }, id: "session-one", title: "Review the project", workspace: "C:\\Projects\\VelumCode", running: false, status: "completed", revision: 3 }],
    entries: [
      { seq: 1, event: { kind: "turn_start", prompt: "Review the project", remote: false } },
      { seq: 2, event: { kind: "assistant_delta", text: "**Review complete.**\n\n```ts\nconst connected = true;\n```\n\n[Documentation](https://example.com)" } },
      { seq: 3, event: { kind: "turn_end", status: "completed" } },
    ] as { seq: number; event: Record<string, unknown> }[],
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const streams: EventTarget[] = [];
    class FixtureSource extends EventTarget {
      onerror = null;
      constructor() { super(); streams.push(this); }
      close() { const index = streams.indexOf(this); if (index >= 0) streams.splice(index, 1); }
    }
    (window as any).EventSource = FixtureSource;
    (window as any).remoteEvent = (name = "change") => streams.forEach((stream) => stream.dispatchEvent(new Event(name)));
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.method() === "POST" ? request.postDataJSON() : null;
    const answer = (value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (url.pathname === "/api/pair/claim") { remote.pending = true; return answer({ pending: { name: body.name, code: "482196", expires_at: Math.floor(Date.now() / 1000) + 120 } }); }
    if (url.pathname === "/api/pair/finish") return answer(remote.paired ? { status: "paired", device: { id: "phone", name: "My phone", control } } : { status: "pending", pending: { name: "My phone", code: "482196", expires_at: Math.floor(Date.now() / 1000) + 120 } });
    if (!remote.paired || remote.revoked) return answer({ error: "Pair again" }, 401);
    if (url.pathname === "/api/me") return answer({ device: { id: "phone", name: "My phone", control }, computer: "desktop.tail.ts.net" });
    if (url.pathname === "/api/sessions") return answer({ sessions: remote.sessions });
    if (url.pathname.endsWith("/models")) return answer({ models: [{ id: "phone-model", label: "Phone model", efforts: ["low", "high"], default_effort: "low", description: "Available on your desktop" }], notice: null });
    if (url.pathname.endsWith("/options")) {
      expect(request.headers()["x-muse-request"]).toBe("1");
      if (!remote.control || remote.sessions[0].running) return answer({ error: "Cannot change options now." }, 403);
      remote.sessions[0].options = body; return answer({ ok: true });
    }
    if (url.pathname.endsWith("/send")) {
      expect(request.headers()["x-muse-request"]).toBe("1");
      if (remote.failSend) return answer({ error: "Desktop could not start the task." }, 409);
      remote.sends.push(body.prompt);
      remote.entries.push({ seq: remote.entries.length + 1, event: { kind: "turn_start", prompt: body.prompt, remote: true } });
      remote.sessions[0] = { ...remote.sessions[0], running: true, status: "running", revision: remote.entries.length };
      return answer({ turn_id: "turn" });
    }
    if (url.pathname.endsWith("/stop")) {
      remote.entries.push({ seq: remote.entries.length + 1, event: { kind: "turn_end", status: "cancelled" } });
      remote.sessions[0] = { ...remote.sessions[0], running: false, status: "cancelled", revision: remote.entries.length };
      return answer({ ok: true });
    }
    if (url.pathname === "/api/logout") { remote.revoked = true; return answer({ ok: true }); }
    if (url.pathname === "/api/sessions/session-one") return answer({ session: remote.sessions[0], events: remote.entries.filter((e) => e.seq > Number(url.searchParams.get("after") || 0)), truncated: false });
    return answer({ error: "Not found" }, 404);
  });
  await page.goto(`/remote.html${paired ? "" : "#pair=one-use-test-invitation"}`);
  return remote;
}

test("phone model choices update the session without losing the draft", async ({ page }) => {
  const remote = await boot(page);
  await expect(page.locator(".phone-online")).toBeVisible();
  await page.getByLabel("Message your desktop agent").fill("Keep this phone draft");
  await page.getByRole("button", { name: "Model: CLI default", exact: true }).click();
  await page.getByRole("option", { name: /^Phone model/ }).click();
  await page.getByRole("button", { name: "Reasoning: Default", exact: true }).click();
  await page.getByRole("option", { name: /^High/ }).click();
  await expect(page.getByRole("button", { name: "Reasoning: High", exact: true })).toBeVisible();
  expect(remote.sessions[0].options).toEqual({ model: "phone-model", reasoning: "high" });
  await expect(page.getByLabel("Message your desktop agent")).toHaveValue("Keep this phone draft");
  await expect(page.locator(".md strong")).toHaveText("Review complete.");
  await page.screenshot({ path: ".qa/phone-model-controls.png", animations: "disabled" });
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("button", { name: "Model: Phone model", exact: true })).toBeDisabled();
});

test("view-only phones cannot edit model settings", async ({ page }) => {
  await boot(page, true, false);
  await expect(page.locator(".phone-online")).toBeVisible();
  await expect(page.getByRole("button", { name: "Model: CLI default", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reasoning: Default", exact: true })).toBeDisabled();
});

test("phone pairs with a matching code and waits for desktop approval", async ({ page }) => {
  const remote = await boot(page, false);
  await expect(page.getByLabel("Name this phone")).toBeVisible();
  expect(page.url()).not.toContain("pair=");
  await page.getByLabel("Name this phone").fill("Pixel");
  await page.getByRole("button", { name: "Pair with desktop" }).click();
  await expect(page.getByLabel("Pairing code")).toHaveText("482196");
  await expect(page.getByText("Waiting for desktop confirmation")).toBeVisible();
  expect(remote.pending).toBe(true);
  await expect(page.getByLabel("Message your desktop agent")).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Pairing code")).toHaveText("482196");
  remote.paired = true;
  await expect(page.getByLabel("Message your desktop agent")).toBeVisible();
  await expect(page.locator(".phone-online")).toBeVisible();
});

test("phone sends and stops real session actions while preserving multiline drafts", async ({ page }) => {
  const remote = await boot(page, true, true, "codex");
  await expect(page.locator(".phone-online")).toBeVisible();
  await expect(page.locator(".md strong")).toHaveText("Review complete.");
  await expect(page.locator(".phone-message.assistant .phone-message-label")).toHaveText("Codex");
  await page.screenshot({ path: ".qa/velum-phone.png", animations: "disabled" });
  const composer = page.getByLabel("Message your desktop agent");
  await composer.fill("Run the tests\nand report failures");
  await composer.press("Enter");
  expect(remote.sends).toHaveLength(0);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("button", { name: "Stop task" })).toBeVisible();
  expect(remote.sends).toEqual(["Run the tests\nand report failures"]);
  await expect(page.locator(".phone-message.user").last()).toContainText("Run the tests");
  await composer.fill("My follow-up draft");
  await page.getByRole("button", { name: "Stop task" }).click();
  await expect(page.getByText("Task stopped.", { exact: true })).toBeVisible();
  await expect(composer).toHaveValue("My follow-up draft");
});

test("send failures retain the phone draft and refresh restores history without duplicates", async ({ page }) => {
  const remote = await boot(page);
  await expect(page.locator(".phone-online")).toBeVisible();
  remote.failSend = true;
  await page.getByLabel("Message your desktop agent").fill("Keep this message");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("alert")).toContainText("Desktop could not start");
  await expect(page.getByLabel("Message your desktop agent")).toHaveValue("Keep this message");
  await page.evaluate(() => (window as any).remoteEvent());
  await expect(page.locator(".phone-message.user")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".phone-message.assistant")).toHaveCount(1);
});

test("revoking a phone immediately removes private data and controls", async ({ page }) => {
  const remote = await boot(page);
  await expect(page.locator(".phone-online")).toBeVisible();
  remote.revoked = true;
  await page.evaluate(() => (window as any).remoteEvent("revoked"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your desktop. In your pocket.");
  await expect(page.locator(".phone-message")).toHaveCount(0);
  await expect(page.getByLabel("Message your desktop agent")).toHaveCount(0);
});

test("view-only phone cannot send and mobile layout passes accessibility checks", async ({ page }) => {
  await boot(page, true, false);
  await expect(page.locator(".phone-online")).toBeVisible();
  await expect(page.getByText("View-only access", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Message your desktop agent")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send message" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("phone survives disconnects, follows desktop output and keeps control disabled offline", async ({ page }) => {
  const remote = await boot(page);
  await expect(page.locator(".phone-online")).toBeVisible();
  await page.getByLabel("Message your desktop agent").fill("Unsent thought");
  await page.route("**/api/sessions", (route) => route.abort());
  await page.evaluate(() => (window as any).remoteEvent());
  await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
  await expect(page.getByLabel("Message your desktop agent")).toHaveValue("Unsent thought");
  await page.unroute("**/api/sessions");
  remote.entries.push({ seq: 4, event: { kind: "turn_start", prompt: "From desktop", remote: false } }, { seq: 5, event: { kind: "turn_end", status: "completed", text: "Desktop result" } });
  remote.sessions[0].revision = 5;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Desktop result", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
});
