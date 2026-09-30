import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { boot } from "./fixture";
import { newBot } from "../../src/bots";

const composer = (page: Page) => page.locator(".chat-wrap:not(.hidden) textarea");

test("native recovery restores tabs and drafts when browser storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).qaRecovery = {
      tabs: [
        { id: "recovered-one", title: "First recovered conversation", workspace: "C:\\Recovered", provider: "muse", options: { model: "", reasoning: "" } },
        { id: "recovered-two", title: "Second recovered conversation", workspace: "C:\\Recovered", provider: "muse", options: { model: "", reasoning: "" } },
      ],
      activeId: "recovered-two",
      drafts: { "recovered-one": "First unsent prompt", "recovered-two": "Second unsent prompt" },
    };
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key.startsWith("velum-desktop")) throw new DOMException("Storage disabled", "SecurityError");
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("velum-desktop")) throw new DOMException("Storage full", "QuotaExceededError");
      return set.call(this, key, value);
    };
  });
  await boot(page);
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Second recovered conversation");
  await expect(composer(page)).toHaveValue("Second unsent prompt");
  await page.getByRole("tab").first().click();
  await expect(composer(page)).toHaveValue("First unsent prompt");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("draft saves still reach native recovery after a browser storage write failure", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    const remove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("velum-desktop")) throw new DOMException("Storage full", "QuotaExceededError");
      return set.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
      if (key.startsWith("velum-desktop")) throw new DOMException("Storage disabled", "SecurityError");
      return remove.call(this, key);
    };
  });
  await composer(page).fill("Keep this prompt even with browser storage full");
  await expect.poll(() => page.evaluate(() => (window as any).qa.calls
    .filter((call: any) => call.cmd === "history_draft_save").at(-1)?.args.text))
    .toBe("Keep this prompt even with browser storage full");
  await page.getByLabel("Workspace directory").fill("C:\\AnotherProject");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(composer(page)).toBeEnabled();
  await expect(page.getByLabel("Workspace directory")).toHaveAttribute("title", "C:\\AnotherProject");
  await expect(composer(page)).toHaveValue("Keep this prompt even with browser storage full");
  await composer(page).fill("");
  await expect.poll(() => page.evaluate(() => (window as any).qa.calls
    .filter((call: any) => call.cmd === "history_draft_save").at(-1)?.args.text)).toBe("");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("new tabs checkpoint natively when browser storage cannot save the tab list", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "velum-desktop-tabs-v1") throw new DOMException("Storage full", "QuotaExceededError");
      return set.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "New session (Ctrl+T)", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => (window as any).qa.calls
    .filter((call: any) => call.cmd === "history_desktop_save").at(-1)?.args.snapshot.tabs.length)).toBe(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a delayed send failure keeps the original prompt and the newer draft", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { (window as any).qa.holdSend = true; });
  await composer(page).fill("Original prompt that must not disappear");
  await composer(page).press("Enter");
  await expect.poll(() => page.evaluate(() => typeof (window as any).qa.releaseSend)).toBe("function");
  await composer(page).fill("My newer follow-up draft");
  await page.evaluate(() => { const qa = (window as any).qa; qa.failSend = true; qa.releaseSend(); });
  await expect(page.locator(".notice.error")).toContainText("Could not launch muse");
  await expect(composer(page)).toHaveValue("My newer follow-up draft");
  const failed = page.locator(".msg.user").filter({ hasText: "Original prompt that must not disappear" });
  await expect(failed).toBeVisible();
  await expect(failed).toContainText("Not sent");
  await expect(failed.getByRole("button", { name: "Copy message" })).toBeEnabled();
  await failed.getByRole("button", { name: "Copy message" }).click();
  await expect(failed.getByRole("button", { name: "Message copied" })).toBeVisible();
  const feedback = await failed.locator(".copy-feedback").boundingBox();
  expect(feedback!.height).toBeLessThan(32);
  expect(feedback!.width).toBeGreaterThan(40);
  expect((await new AxeBuilder({ page }).include(".msg.user").analyze()).violations).toEqual([]);
  await page.screenshot({ path: ".qa/review-failed-send.png", animations: "disabled" });
});

test("a delayed native tab checkpoint cannot overwrite a newer draft", async ({ page }) => {
  await boot(page);
  await expect.poll(() => page.evaluate(() => (window as any).qa.recovery?.tabs.length)).toBe(1);
  const tabId = await page.evaluate(async () => {
    const history = await import("/src/desktopHistory.ts");
    const desktop = history.loadDesktop();
    (window as any).qa.holdHistorySave = true;
    history.saveDesktop(desktop.tabs.map((tab: any) => ({ ...tab, title: "Recovery order check" })), desktop.activeId);
    return desktop.activeId;
  });
  await expect.poll(() => page.evaluate(() => typeof (window as any).qa.releaseHistorySave)).toBe("function");
  await composer(page).fill("Newer draft typed while the checkpoint was pending");
  await page.evaluate(() => { const qa = (window as any).qa; qa.holdHistorySave = false; qa.releaseHistorySave(); });
  await expect.poll(() => page.evaluate(id => (window as any).qa.recovery?.drafts[id], tabId))
    .toBe("Newer draft typed while the checkpoint was pending");
});

test("native recovery failures remain visible and do not block editing", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { (window as any).qa.failHistory = true; });
  await composer(page).fill("Still available for copying");
  await expect(page.getByRole("alert")).toContainText("Recovery disk unavailable");
  await expect(composer(page)).toHaveValue("Still available for copying");
  await composer(page).fill("I can continue editing");
  await expect(composer(page)).toHaveValue("I can continue editing");
});

test("bot handoffs include accepted conversation messages and exclude rejected sends", async ({ page }) => {
  const reviewer = newBot("muse", { model: "muse-deep", reasoning: "high" });
  reviewer.name = "Reviewer";
  await page.addInitScript(profile => localStorage.setItem("qa-bots", JSON.stringify([profile])), reviewer);
  await boot(page);
  await composer(page).fill("Accepted conversation context");
  await composer(page).press("Enter");
  await page.evaluate(() => (window as any).qa.agent({ kind: "turn_end", status: "completed", text: "Accepted answer" }));
  await page.evaluate(() => { (window as any).qa.failSend = true; });
  await composer(page).fill("Rejected prompt must not become handoff context");
  await composer(page).press("Enter");
  await expect(page.locator(".notice.error")).toBeVisible();
  await page.getByRole("button", { name: "Hand off", exact: true }).click();
  await page.locator(".bot-card").filter({ hasText: "Reviewer" }).getByRole("button", { name: "Hand off", exact: true }).click();
  await expect(composer(page)).toHaveValue(/Accepted conversation context/);
  await expect(composer(page)).toHaveValue(/Accepted answer/);
  expect(await composer(page).inputValue()).not.toContain("Rejected prompt");
});
