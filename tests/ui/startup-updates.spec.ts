import { test, expect, type Page } from "@playwright/test";
import { boot } from "./fixture";

async function pendingLaunch(page: Page) {
  await page.addInitScript(() => {
    (window as any).qaHoldStartup = true;
    (window as any).qaStartupStatus = { supported: true };
  });
  await boot(page, 0, false, false);
  await expect.poll(() => page.evaluate(() => typeof (window as any).qa.releaseStartup)).toBe("function");
}

async function expectUnopened(page: Page) {
  await expect(page.locator("#root")).toBeEmpty();
  await expect(page.locator("#root")).toHaveAttribute("inert", "");
  expect(await page.evaluate(() => (window as any).qa.calls.filter((c: any) =>
    ["history_desktop_load", "history_desktop_save", "history_draft_save", "preferences_load", "agent_new", "provider_warmup", "pty_spawn"].includes(c.cmd)))).toEqual([]);
}

test("update check is part of the first animation, before workspace or provider recovery", async ({ page }) => {
  await pendingLaunch(page);
  await expect(page.locator("#startup-message")).toHaveText("Checking for updates…");
  await expect(page.getByRole("button", { name: "Open current version" })).toBeVisible();
  await expectUnopened(page);
  // The ordinary intro skip is armed only after startup finishes.
  await page.keyboard.press("Escape");
  await page.locator(".startup-mark").click();
  await expectUnopened(page);
  expect(await page.evaluate(() => (window as any).qa.calls.filter((c: any) => c.cmd === "updates_startup").length)).toBe(1);
  await page.evaluate(() => { (window as any).qa.update({ phase: "current" }); (window as any).qa.releaseStartup(); });
  await expect(page.locator("#startup")).toHaveCount(0);
  await expect(page.locator("#root")).not.toHaveAttribute("inert", "");
  const calls = await page.evaluate(() => (window as any).qa.calls.map((c: any) => c.cmd));
  expect(calls.indexOf("history_desktop_load")).toBeGreaterThan(calls.indexOf("updates_startup"));
});

test("verified startup update shows download progress then installation without opening the workspace", async ({ page }) => {
  await pendingLaunch(page);
  const brandPosition = await page.locator(".startup-emblem").boundingBox();
  await page.evaluate(() => (window as any).qa.update({ phase: "downloading", version: "0.6.10", downloaded: 40, total: 100 }));
  await expect(page.locator("#startup-message")).toHaveText("Downloading Velum Code 0.6.10…");
  await expect(page.getByRole("progressbar", { name: "Startup update progress" })).toHaveAttribute("aria-valuenow", "40");
  await expect(page.locator("#startup-detail")).toHaveText("40%");
  await expect(page.locator(".startup-sweep")).toHaveCSS("animation-name", "none");
  await expect.poll(() => page.locator(".startup-sweep").evaluate(element =>
    element.getBoundingClientRect().width / element.parentElement!.getBoundingClientRect().width)).toBeCloseTo(.4, 2);
  // A late event must not rewind the current progress.
  await page.evaluate(() => (window as any).qa.emit("app-update-status", { ...(window as any).qa.updateStatus, revision: 0, downloaded: 5 }));
  await expect(page.locator("#startup-detail")).toHaveText("40%");
  await expectUnopened(page);
  await page.evaluate(() => (window as any).qa.update({ phase: "ready", downloaded: 100 }));
  await expect(page.locator("#startup-message")).toHaveText("Update verified");
  await page.evaluate(() => { (window as any).qa.update({ phase: "installing" }); (window as any).qa.releaseStartup(true); });
  await expect(page.locator("#startup-message")).toHaveText("Installing update…");
  await expect(page.locator("#startup-detail")).toHaveText("Velum Code will reopen automatically");
  await expect(page.getByRole("button", { name: "Open current version" })).toBeHidden();
  expect((await page.locator(".startup-emblem").boundingBox())!.y).toBeCloseTo(brandPosition!.y, 1);
  await expectUnopened(page);
  expect(await page.evaluate(() => (window as any).qa.calls.some((c: any) => c.cmd === "updates_install"))).toBe(false);
});

test("offline startup opens the current version and preserves recovered drafts", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).qaRecovery = {
      tabs: [{ id: "startup-recovered", title: "Recovered work", provider: "muse", workspace: "C:\\QA", options: { model: "muse-spark", reasoning: "medium", personality: "", fast_mode: false } }],
      activeId: "startup-recovered", drafts: { "startup-recovered": "Unsaved before update" },
    };
  });
  await pendingLaunch(page);
  await expectUnopened(page);
  await page.evaluate(() => {
    const api = (window as any).qa;
    api.update({ phase: "error", error: "GitHub did not respond within 8 seconds. Try again later." });
    api.releaseStartup();
  });
  await expect(page.locator("#startup")).toHaveCount(0);
  await expect(page.locator(".chat-wrap:not(.hidden) textarea")).toHaveValue("Unsaved before update");
  expect(await page.evaluate(() => (window as any).qa.calls.filter((c: any) => c.cmd === "updates_startup").length)).toBe(1);
});

test("opening the current version cancels the startup operation before recovery", async ({ page }) => {
  await pendingLaunch(page);
  await page.evaluate(() => (window as any).qa.update({ phase: "downloading", version: "0.6.10", downloaded: 10, total: 100 }));
  await page.getByRole("button", { name: "Open current version" }).click();
  await expect(page.locator("#startup")).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).qa.calls.map((c: any) => c.cmd));
  expect(calls.indexOf("updates_skip_startup")).toBeLessThan(calls.indexOf("history_desktop_load"));
  expect(calls).not.toContain("updates_install");
});

for (const status of [
  { supported: false, automatic: true },
  { supported: true, automatic: false },
  { supported: true, automatic: true, phase: "available", version: "0.6.10", error: "Previous installer did not finish; retry in Settings" },
]) {
  test(`startup proceeds for ${JSON.stringify(status)}`, async ({ page }) => {
    await page.addInitScript(status => { (window as any).qaStartupStatus = status; }, status);
    await boot(page);
    expect(await page.evaluate(() => (window as any).qa.calls.filter((c: any) => c.cmd === "updates_startup").length)).toBe(1);
    expect(await page.evaluate(() => (window as any).qa.calls.some((c: any) => c.cmd === "updates_install"))).toBe(false);
  });
}

test("reduced motion still waits for the real startup update decision", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await pendingLaunch(page);
  await expect(page.locator(".startup-mark")).toHaveCSS("animation-name", "none");
  await expectUnopened(page);
  await page.evaluate(() => (window as any).qa.releaseStartup());
  await expect(page.locator("#startup")).toHaveCount(0);
});

test("failed startup IPC releases the native work gate before opening", async ({ page }) => {
  await page.addInitScript(() => { (window as any).qaStartupIPCFailure = true; });
  await boot(page);
  const calls = await page.evaluate(() => (window as any).qa.calls.map((c: any) => c.cmd));
  expect(calls.indexOf("updates_skip_startup")).toBeGreaterThan(calls.indexOf("updates_startup"));
  expect(calls.indexOf("updates_skip_startup")).toBeLessThan(calls.indexOf("history_desktop_load"));
});
