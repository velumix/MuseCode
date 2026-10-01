import { test, expect, type Page } from "@playwright/test";
import { boot } from "./fixture";

async function introBeforeBundle(page: Page) {
  // Load the shipped HTML/CSS, withholding only the application bootstrap.
  await page.route(/\/src\/main\.tsx(?:\?.*)?$/, route => route.fulfill({
    status: 200, contentType: "application/javascript", body: "",
  }));
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Starting Velum Code" })).toBeVisible();
  await expect(page.locator("#root")).toHaveAttribute("inert", "");
}

test("launch branding paints before the app bundle and blocks hidden controls", async ({ page }) => {
  await introBeforeBundle(page);
  await expect(page.locator(".startup-mark")).toBeVisible();
  expect(await page.locator(".startup-mark").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(page.locator(".startup-sweep")).toHaveCSS("animation-name", "startup-sweep");
  await expect(page.locator("#root")).toHaveAttribute("aria-busy", "true");
});

test("launch warms the provider CLI and reports readiness before the first prompt", async ({ page }) => {
  await boot(page);
  await expect(page.locator(".provider-bar")).toBeVisible();
  await expect(page.locator(".provider-bar")).toContainText("Muse CLI ready · Muse Code 1.4.2 · 2 models");
  await expect.poll(() => page.evaluate(() => (window as any).qa.calls.some((call: any) => call.cmd === "provider_warmup"))).toBe(true);
});

test("a silent provider CLI reports not-responding instead of hanging the controls", async ({ page }) => {
  await page.addInitScript(() => { (window as any).qaFailWarmup = true; });
  await boot(page);
  await expect(page.locator(".provider-bar")).toBeVisible();
  await expect(page.locator(".provider-bar")).toContainText("Muse CLI did not respond");
});

test("refresh retries a failed CLI warmup and updates readiness", async ({ page }) => {
  await page.addInitScript(() => { (window as any).qaFailWarmup = true; });
  await boot(page);
  await expect(page.locator(".provider-bar")).toBeVisible();
  await expect(page.locator(".provider-bar")).toContainText("Muse CLI did not respond");
  const count = await page.evaluate(() => (window as any).qa.calls.filter((call: any) => call.cmd === "provider_warmup").length);
  await page.evaluate(() => { (window as any).qaFailWarmup = false; });
  await page.getByRole("button", { name: "Refresh providers and models" }).click();
  await expect(page.locator(".provider-bar")).toContainText("Muse CLI ready · Muse Code 1.4.2 · 2 models");
  await expect.poll(() => page.evaluate(() => (window as any).qa.calls.filter((call: any) => call.cmd === "provider_warmup").length)).toBe(count + 1);
});

test("ready desktop dismisses the intro, focuses the composer and does not replay", async ({ page }) => {
  await boot(page);
  const composer = page.locator(".chat-wrap:not(.hidden) textarea");
  await expect(composer).toBeFocused();
  await composer.fill("Startup check draft");
  await page.getByRole("button", { name: "Search commands and conversations" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#startup")).toHaveCount(0);
  await expect(composer).toHaveValue("Startup check draft");
});

for (const method of ["pointer", "keyboard"] as const) {
  test(`${method} skips a ready intro without activating an obscured control`, async ({ page }) => {
    await introBeforeBundle(page);
    const result = await page.evaluate(async (method) => {
      const source = "/src/startup.ts";
      const { finishStartup } = await import(source);
      let ready = 0, leaked = 0;
      const cleanup = finishStartup(() => ready++);
      const type = method === "pointer" ? "pointerdown" : "keydown";
      const record = () => leaked++;
      window.addEventListener(type, record);
      const event = method === "pointer"
        ? new PointerEvent(type, { bubbles: true, cancelable: true })
        : new KeyboardEvent(type, { key: "Escape", bubbles: true, cancelable: true });
      document.getElementById("startup")!.dispatchEvent(event);
      const result = { ready, leaked, prevented: event.defaultPrevented,
        splash: !!document.getElementById("startup"), inert: document.getElementById("root")!.inert };
      window.removeEventListener(type, record);
      cleanup?.();
      return result;
    }, method);
    expect(result).toEqual({ ready: 1, leaked: 0, prevented: true, splash: false, inert: false });
  });
}

test("reduced motion removes animation and adds no artificial wait", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await introBeforeBundle(page);
  await expect(page.locator(".startup-mark")).toHaveCSS("animation-name", "none");
  await expect(page.locator(".startup-sweep")).toHaveCSS("animation-name", "none");
  const delay = await page.evaluate(async () => {
    const source = "/src/startup.ts";
    const { finishStartup } = await import(source);
    const schedule = window.setTimeout.bind(window);
    let firstDelay: number | undefined;
    window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
      firstDelay ??= delay;
      return schedule(callback, delay, ...args);
    }) as typeof window.setTimeout;
    finishStartup(() => {});
    window.setTimeout = schedule;
    return firstDelay;
  });
  expect(delay).toBe(0);
  await expect(page.locator("#startup")).toHaveCount(0);
  await expect(page.locator("#root")).not.toHaveAttribute("inert", "");
});

test("StrictMode resubscription and missing transition events still clean up once", async ({ page }) => {
  await introBeforeBundle(page);
  await page.addStyleTag({ content: ".startup { transition: none !important; }" });
  await page.evaluate(async () => {
    const source = "/src/startup.ts";
    const { finishStartup } = await import(source);
    document.body.dataset.readyCount = "0";
    const ready = () => { document.body.dataset.readyCount = String(Number(document.body.dataset.readyCount) + 1); };
    const cleanup = finishStartup(ready);
    cleanup();
    if (!document.getElementById("root")!.inert) throw new Error("Early cleanup exposed the desktop");
    finishStartup(ready);
  });
  await expect(page.locator("#startup")).toHaveCount(0);
  await expect(page.locator("body")).toHaveAttribute("data-ready-count", "1");
  await expect(page.locator("#root")).not.toHaveAttribute("inert", "");
  await expect(page.locator("#root")).not.toHaveAttribute("aria-busy", "true");
});
