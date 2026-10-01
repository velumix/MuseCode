import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { boot } from "./fixture";
import { themes } from "../../src/appearance";

const composer = (page: Page) =>
  page.locator(".chat-wrap:not(.hidden) textarea");
const open = async (page: Page) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Make yourself at home" }),
  ).toBeVisible();
};
const section = (page: Page, name: string) =>
  page.getByRole("tab", { name, exact: true }).click();
async function input(page: Page, label: string, value: number | string) {
  await page.getByLabel(label, { exact: true }).evaluate((el, value) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}
const checks = (page: Page, include?: string) => {
  let axe = new AxeBuilder({ page }).withTags([
    "wcag2a",
    "wcag2aa",
    "wcag21aa",
  ]);
  if (include) axe = axe.include(include);
  return axe.analyze();
};

test("a multiline draft resizes immediately after a font or layout change", async ({
  page,
}) => {
  await boot(page);
  const draft = "First line\nSecond line\nThird line";
  await composer(page).fill(draft);
  const before = await composer(page).evaluate((el) => el.clientHeight);
  await open(page);
  await section(page, "Layout & text");
  await input(page, "Message text size", 22);
  await expect
    .poll(() => composer(page).evaluate((el) => el.clientHeight))
    .toBeGreaterThan(before);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(composer(page)).toHaveValue(draft);
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeInViewport();
});

test("light crystal glass and custom gray accents retain readable controls", async ({
  page,
}) => {
  test.setTimeout(60000);
  await boot(page);
  await open(page);
  for (const name of ["Daylight", "Linen", "Lavender", "Mint"]) {
    await section(page, "Appearance");
    await page
      .getByRole("button", { name: `${name} theme`, exact: true })
      .click();
    await section(page, "Glass & finish");
    await page.getByRole("button", { name: "Crystal", exact: true }).click();
    expect((await checks(page, ".settings-panel")).violations).toEqual([]);
  }
  await section(page, "Appearance");
  await page
    .getByRole("button", { name: "Graphite theme", exact: true })
    .click();
  await input(page, "Accent color", "#7a7a7a");
  expect((await checks(page, ".settings-panel")).violations).toEqual([]);
});

test("settings have a focused keyboard path, search all sections, and preserve the conversation", async ({
  page,
}) => {
  await boot(page);
  await composer(page).fill("Keep this draft while I customize");
  await page.keyboard.press("Control+,");
  await expect(page.getByLabel("Search settings")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByLabel("Close settings")).toBeFocused();
  await page.getByRole("button", { name: "Done", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Close settings")).toBeFocused();
  await page.getByLabel("Search settings").fill("blur");
  await expect(page.getByLabel("Backdrop blur", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("Message text size", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Search settings").fill("nothing-matches-this");
  await expect(page.locator(".settings-empty")).toBeVisible();
  await page.keyboard.press("Control+t");
  await expect(page.locator('.sidebar [role="tab"]')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(composer(page)).toHaveValue("Keep this draft while I customize");
  await expect(composer(page)).toBeFocused();
  await page.keyboard.press("Control+k");
  await page
    .getByRole("combobox", { name: "Command palette" })
    .fill("open settings");
  await page.keyboard.press("Enter");
  await expect(page.locator(".settings-panel")).toBeVisible();
});

test("all twelve themes update the whole app and persist across reloads", async ({
  page,
}) => {
  await boot(page);
  await open(page);
  await expect(page.locator(".theme-card")).toHaveCount(12);
  for (const theme of themes) {
    await page
      .getByRole("button", { name: `${theme.name} theme`, exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme.id);
    await expect(
      page.getByRole("button", { name: `${theme.name} theme`, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const palette = await page.evaluate(() => ({
      bg: document.documentElement.style.getPropertyValue("--bg"),
      scheme: getComputedStyle(document.documentElement).colorScheme,
    }));
    expect(palette.bg).toBe(theme.background);
    expect(palette.scheme).toBe(theme.dark ? "dark" : "light");
  }
  await page.getByRole("button", { name: "Aurora theme", exact: true }).click();
  await page.screenshot({
    path: ".qa/settings-aurora.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Linen theme", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).qa.preferences?.settings.theme),
    )
    .toBe("linen");
  await page.screenshot({
    path: ".qa/settings-linen.png",
    animations: "disabled",
  });
  await page.reload();
  await expect(page.locator("#startup")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "linen");
  await page.getByRole("button", { name: "Bots", exact: true }).click();
  await expect(page.locator(".bots-panel")).toBeVisible();
  expect((await checks(page, ".bots-panel")).violations).toEqual([]);
});

test("settings and conversations have readable dark and light themes", async ({
  page,
}) => {
  await boot(page);
  await composer(page).fill("Make the UI feel like home");
  await composer(page).press("Enter");
  await page.evaluate(() =>
    (window as any).qa.agent({
      kind: "turn_end",
      status: "completed",
      text: "### A calmer workspace\n\nPersonalize your theme, glass, and typography.\n\n```ts\nconst appearance = 'yours';\n```\n\n[Read the project](https://example.com)",
    }),
  );
  for (const name of ["Graphite", "Aurora", "Daylight", "Linen"]) {
    await open(page);
    await page
      .getByRole("button", { name: `${name} theme`, exact: true })
      .click();
    expect((await checks(page, ".settings-panel")).violations).toEqual([]);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    expect((await checks(page)).violations).toEqual([]);
    await page.screenshot({
      path: `.qa/theme-${name.toLowerCase()}-conversation.png`,
      animations: "disabled",
    });
  }
});

test("glass presets, live sliders, and solid mode change the actual surfaces", async ({
  page,
}) => {
  await boot(page);
  await open(page);
  await section(page, "Glass & finish");
  await page.getByRole("button", { name: "Crystal", exact: true }).click();
  expect(
    await page
      .locator(".sidebar")
      .evaluate((el) => getComputedStyle(el).backdropFilter),
  ).toContain("blur(32px)");
  await input(page, "Backdrop blur", 16);
  await input(page, "Panel opacity", 76);
  await input(page, "Corner radius", 6);
  expect(
    await page.locator(".composer").evaluate((el) => ({
      blur: getComputedStyle(el).backdropFilter,
      radius: getComputedStyle(el).borderRadius,
    })),
  ).toEqual({ blur: "blur(16px) saturate(1.5)", radius: "6px" });
  await page.getByLabel("Backdrop blur", { exact: true }).press("ArrowRight");
  await expect(page.getByLabel("Backdrop blur", { exact: true })).toHaveValue(
    "17",
  );
  await page.screenshot({
    path: ".qa/settings-glass.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Solid", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-glass", "false");
  expect(
    await page
      .locator(".sidebar")
      .evaluate((el) => getComputedStyle(el).backdropFilter),
  ).toBe("none");
  await expect(
    page.getByLabel("Backdrop blur", { exact: true }),
  ).toBeDisabled();
  expect(
    await page
      .locator(".composer")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgb(39, 41, 48)");
});

test("layout, fonts, display toggles, and custom colors preview without losing a draft", async ({
  page,
}) => {
  await boot(page);
  await composer(page).fill("Still here");
  await open(page);
  await input(page, "Accent color", "#f4b98b");
  await input(page, "Canvas color", "#201a19");
  await expect(page.getByLabel("Reset accent color")).toBeEnabled();
  await section(page, "Layout & text");
  await page.getByLabel("Sidebar style", { exact: true }).selectOption("rail");
  expect(
    await page
      .locator(".sidebar")
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBe(76);
  await page
    .getByLabel("Sidebar style", { exact: true })
    .selectOption("expanded");
  await input(page, "Sidebar width", 300);
  await input(page, "Conversation width", 960);
  await page
    .getByLabel("Interface font", { exact: true })
    .selectOption("rounded");
  await page.getByLabel("Message font", { exact: true }).selectOption("serif");
  await input(page, "Message text size", 18);
  await page
    .getByRole("switch", { name: "Conversation starters", exact: true })
    .click();
  await page
    .getByRole("switch", { name: "Keyboard hints", exact: true })
    .click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".chat-starters")).toBeHidden();
  await expect(page.locator(".composer-hint")).toBeHidden();
  await expect(composer(page)).toHaveValue("Still here");
  const style = await composer(page).evaluate((el) => ({
    size: getComputedStyle(el).fontSize,
    font: getComputedStyle(el).fontFamily,
  }));
  expect(style.size).toBe("18px");
  expect(style.font).toContain("Georgia");
  expect(
    await page
      .locator(".sidebar")
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBe(300);
  expect(
    await page
      .locator(".composer-dock")
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(960);
});

test("settings stay usable at minimum desktop size and maximum typography", async ({
  page,
}) => {
  await boot(page);
  await page.setViewportSize({ width: 760, height: 480 });
  await open(page);
  await section(page, "Layout & text");
  await input(page, "Interface text scale", 125);
  for (const title of [
    "Appearance",
    "Glass & finish",
    "Layout & text",
    "Terminal",
    "Preferences",
  ]) {
    await section(page, title);
    expect(
      await page
        .locator(".settings-content")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Done", exact: true }),
    ).toBeInViewport();
    await expect(page.getByLabel("Close settings")).toBeInViewport();
  }
  await page.screenshot({
    path: ".qa/settings-minimum-window.png",
    animations: "disabled",
  });
  expect((await checks(page, ".settings-panel")).violations).toEqual([]);
});

test("Enter preference, collapsed tools, and default provider apply to conversations", async ({
  page,
}) => {
  await boot(page);
  await open(page);
  await section(page, "Preferences");
  await page
    .getByLabel("Send message with", { exact: true })
    .selectOption("ctrl-enter");
  await page
    .getByLabel("Tool output by default", { exact: true })
    .selectOption("collapsed");
  await page
    .getByLabel("New conversation provider", { exact: true })
    .selectOption("codex");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await composer(page).fill("Enter keeps my line");
  await composer(page).press("Enter");
  await expect(page.locator(".msg.user")).toHaveCount(0);
  await expect(composer(page)).toHaveValue("Enter keeps my line\n");
  await composer(page).press("Control+Enter");
  await expect(page.locator(".msg.user")).toHaveCount(1);
  await page.evaluate(() => {
    const qa = (window as any).qa;
    qa.agent({ kind: "tool_start", task_id: "t", name: "Read" });
    qa.agent({ kind: "tool_delta", task_id: "t", text: "Hidden tool output" });
    qa.agent({ kind: "tool_end", task_id: "t", status: "completed" });
    qa.agent({ kind: "turn_end", status: "completed", text: "Done" });
  });
  await expect(page.locator(".tool-output")).toHaveCount(0);
  await page.locator('.activity-toggle').click();
  await expect(page.locator(".tool-output")).toHaveCount(0);
  await page.locator(".tool-head").click();
  await expect(page.locator(".tool-output")).toContainText(
    "Hidden tool output",
  );
  await page.keyboard.press("Control+t");
  await expect(page.getByLabel("AI provider")).toHaveValue("codex");
});

test("terminal changes preserve the live native process and output", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page.locator(".xterm")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).qa.calls.filter((c: any) => c.cmd === "pty_spawn")
            .length,
      ),
    )
    .toBeGreaterThan(0);
  const before = await page.evaluate(() =>
    (window as any).qa.calls
      .filter((c: any) => c.cmd === "pty_spawn" || c.cmd === "pty_kill")
      .map((c: any) => `${c.cmd}:${c.args.id}`),
  );
  await open(page);
  await page
    .getByRole("button", { name: "Daylight theme", exact: true })
    .click();
  await section(page, "Terminal");
  await input(page, "Terminal text size", 22);
  await page.getByLabel("Cursor style", { exact: true }).selectOption("block");
  await page
    .getByRole("switch", { name: "Blinking cursor", exact: true })
    .click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.keyboard.press("Control+0");
  await expect
    .poll(() =>
      page
        .locator(".xterm-char-measure-element")
        .first()
        .evaluate((el) => getComputedStyle(el).fontSize),
    )
    .toBe("22px");
  expect(
    await page.evaluate(() =>
      (window as any).qa.calls
        .filter((c: any) => c.cmd === "pty_spawn" || c.cmd === "pty_kill")
        .map((c: any) => `${c.cmd}:${c.args.id}`),
    ),
  ).toEqual(before);
  await page.keyboard.press("Control+f");
  await page.getByLabel("Find in terminal").fill("search target");
  await page.keyboard.press("Enter");
  await page.screenshot({
    path: ".qa/theme-daylight-terminal.png",
    animations: "disabled",
  });
});

test("system theme follows device changes and reduced motion removes animation", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await boot(page);
  await open(page);
  await page
    .getByRole("switch", { name: "Follow system theme", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "graphite");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "daylight");
  await section(page, "Layout & text");
  await page.getByLabel("Animations", { exact: true }).selectOption("reduced");
  await section(page, "Terminal");
  expect(
    await page
      .locator(".terminal-preview-cursor")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
});

test("native saves survive blocked browser storage and serialize quick choices", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "velum-preferences-v1")
        throw new Error("Browser preferences unavailable");
      return original.call(this, key, value);
    };
  });
  await boot(page);
  await open(page);
  await page.evaluate(() => {
    (window as any).qa.holdPreferences = true;
  });
  await page.getByRole("button", { name: "Aurora theme", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => !!(window as any).qa.releasePreferences))
    .toBe(true);
  await page.getByRole("button", { name: "Ocean theme", exact: true }).click();
  await page.getByRole("button", { name: "Ember theme", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as any).qa.calls.filter(
          (c: any) => c.cmd === "preferences_save",
        ).length,
    ),
  ).toBe(1);
  await page.evaluate(() => {
    const qa = (window as any).qa;
    qa.holdPreferences = false;
    qa.releasePreferences();
  });
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).qa.preferences?.settings.theme),
    )
    .toBe("ember");
  await expect(page.locator(".settings-footer")).toContainText(
    "All changes saved",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ember");
});

test("save failures are visible and retry preserves the selected appearance", async ({
  page,
}) => {
  await boot(page);
  await open(page);
  await page.evaluate(() => {
    (window as any).qa.failPreferences = true;
  });
  await page.getByRole("button", { name: "Orchid theme", exact: true }).click();
  await expect(page.locator(".settings-footer")).toContainText(
    "could not be saved",
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "orchid");
  await page.evaluate(() => {
    (window as any).qa.failPreferences = false;
  });
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(page.locator(".settings-footer")).toContainText(
    "All changes saved",
  );
  expect(
    await page.evaluate(() => (window as any).qa.preferences.settings.theme),
  ).toBe("orchid");
});

test("device reduced transparency removes glass while retaining the user's profile", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) =>
      query === "(prefers-reduced-transparency: reduce)"
        ? ({
            matches: true,
            media: query,
            addEventListener() {},
            removeEventListener() {},
          } as unknown as MediaQueryList)
        : original(query);
  });
  await boot(page);
  await open(page);
  await section(page, "Glass & finish");
  await expect(page.locator("html")).toHaveAttribute("data-glass", "false");
  await expect(
    page.getByRole("switch", { name: "Enable glass", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByLabel("Backdrop blur", { exact: true }),
  ).toBeDisabled();
  expect(
    await page
      .locator(".composer")
      .evaluate((el) => getComputedStyle(el).backdropFilter),
  ).toBe("none");
});

test("profiles export, validate imports, and restore defaults with an explicit choice", async ({
  page,
}) => {
  await boot(page);
  await open(page);
  await page.getByRole("button", { name: "Forest theme", exact: true }).click();
  await section(page, "Preferences");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("velum-settings.json");
  await page.locator('.settings-panel input[type="file"]').setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":2,"settings":{"theme":"linen"}}'),
  });
  await expect(page.getByRole("alert")).toContainText("version 1");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "forest");
  await page.locator('.settings-panel input[type="file"]').setInputFiles({
    name: "personal.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: 1,
        settings: {
          theme: "ocean",
          blur: 1000,
          chatFontSize: -4,
          customAccent: "url(javascript:alert(1))",
          terminalCursor: "invalid",
          untrusted: "discard this",
        },
      }),
    ),
  });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ocean");
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).qa.preferences?.settings.blur),
    )
    .toBe(40);
  const profile = await page.evaluate(
    () => (window as any).qa.preferences.settings,
  );
  expect(profile.chatFontSize).toBe(12);
  expect(profile.customAccent).toBe("");
  expect(profile.terminalCursor).toBe("bar");
  expect(profile.untrusted).toBeUndefined();
  await page.getByRole("button", { name: "Reset all", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Keep my settings", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ocean");
  await page.getByRole("button", { name: "Reset all", exact: true }).click();
  await page
    .getByRole("button", { name: "Restore defaults", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "graphite");
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).qa.preferences?.settings.blur),
    )
    .toBe(22);
});
