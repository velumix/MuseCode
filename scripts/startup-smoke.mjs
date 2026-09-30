import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";

// Run against the real Tauri page in an isolated native-smoke profile. Reloading
// exercises the packaged bootstrap without touching the user's open workspace.
export async function checkStartup(page, artifactDir) {
  await page.addInitScript(() => {
    const trace = window.__velumStartupProbe = {
      seenAt: null, readyAt: null, removedAt: null, leaving: false,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
    const observer = new MutationObserver(() => {
      const splash = document.getElementById("startup");
      const root = document.getElementById("root");
      const now = performance.now();
      if (splash) {
        trace.seenAt ??= now;
        trace.leaving ||= splash.hasAttribute("data-leaving");
      }
      if (root?.firstElementChild && !root.inert) trace.readyAt ??= now;
      if (!splash && trace.seenAt !== null) {
        trace.removedAt = now;
        observer.disconnect();
      }
    });
    observer.observe(document, { childList: true, subtree: true, attributes: true });
  });
  const results = [];
  for (const mode of ["normal", "keyboard", "pointer", "reduced"]) {
    await page.emulateMedia({ reducedMotion: mode === "reduced" ? "reduce" : "no-preference" });
    await page.reload({ waitUntil: "commit" });
    if (mode !== "reduced") {
      await expect(page.locator("#startup")).toBeVisible();
      if (mode === "normal") {
        // Wait inside the page for the actual animation completion. Polling can
        // skip the brief fully revealed state before the startup fade removes it.
        const opacity = await page.locator(".startup-wordmark").evaluate(async element => {
          await Promise.all(element.getAnimations().map(animation => animation.finished));
          if (!element.isConnected) throw new Error('Startup title was removed before its reveal finished');
          return getComputedStyle(element).opacity;
        });
        assert.equal(opacity, "1", "Startup title did not fully reveal");
        await page.screenshot({ path: path.join(artifactDir, "startup.png") });
      } else {
        // The desktop mount subscribes the skip handlers; the intro stays inert
        // until it is ready, so input cannot trigger an obscured app control.
        await page.locator(".app").waitFor();
        if (mode === "keyboard") await page.keyboard.press("Escape");
        else await page.locator("#startup").click({ position: { x: 10, y: 50 } });
      }
    }
    await expect(page.locator("#startup")).toHaveCount(0);
    await expect(page.locator("#root")).not.toHaveAttribute("inert", "");
    await expect(page.locator("#root")).not.toHaveAttribute("aria-busy", "true");
    const composer = page.locator(".chat-wrap:not(.hidden) textarea");
    await expect(composer).toBeEnabled();
    await expect(composer).toBeFocused();
    const trace = await page.evaluate(() => window.__velumStartupProbe);
    assert(trace.seenAt !== null && trace.readyAt !== null && trace.removedAt !== null, `${mode}: incomplete startup lifecycle`);
    assert.equal(trace.reducedMotion, mode === "reduced");
    assert.equal(trace.leaving, mode === "normal", `${mode}: incorrect fade/skip path`);
    if (mode === "normal") {
      assert(trace.removedAt >= 800, "Intro ended before the brief reveal");
      assert(trace.removedAt - trace.readyAt >= 100, "Intro did not fade out");
    } else {
      assert(trace.removedAt - trace.readyAt < 100, `${mode}: artificial fade delay`);
    }
    await composer.fill("Startup QA draft");
    await page.getByRole("button", { name: "Search commands and conversations" }).click();
    await page.keyboard.press("Escape");
    await expect(composer).toHaveValue("Startup QA draft");
    await composer.fill("");
    await expect(page.locator("#startup")).toHaveCount(0);
    results.push({ mode, ...trace });
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.screenshot({ path: path.join(artifactDir, "desktop-after-startup.png") });
  writeFileSync(path.join(artifactDir, "startup-results.json"), JSON.stringify({ url: page.url(), results }, null, 2));
  console.log("PASS: native packaged startup reveal, fade, keyboard/pointer skip, reduced motion, focus and draft-safe interaction");
}
