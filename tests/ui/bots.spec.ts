import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { boot } from "./fixture";
import {duplicateBot, newBot} from "../../src/bots";
test("duplicate names respect the native UTF-8 limit without splitting characters",()=>{
  const profile=newBot("muse",{model:"test",reasoning:"high"});
  profile.name="機器人🦉".repeat(5);
  const copy=duplicateBot(profile);
  expect(new TextEncoder().encode(copy.name).length).toBeLessThanOrEqual(80);
  expect(copy.name).toMatch(/ copy$/);expect(copy.name).not.toContain("\ufffd");
  expect(copy.id).not.toBe(profile.id);expect(copy.automatic).toBe(false);
});
test("bot presets retain provider choices and duplicates have fresh private memory",async({page})=>{
  await boot(page);await create(page,"Custom builder");
  await page.getByLabel("Bot preferred provider").selectOption("codex");
  await page.getByText("Start with a preset",{exact:true}).click();
  await page.getByRole("button",{name:/^Reviewer Code review/}).click();
  await expect(page.getByLabel("Bot preferred provider")).toHaveValue("codex");
  await expect(page.getByLabel("Bot name",{exact:true})).toHaveValue("Custom builder");
  await page.getByRole("button",{name:"Personality & instructions",exact:true}).click();
  await expect(page.getByLabel("soul.md",{exact:true})).toHaveValue(/calm, exacting reviewer/);
  await expect(page.getByLabel("agent.md",{exact:true})).toHaveValue(/reproduction evidence/);
  await page.getByRole("button",{name:"Save bot",exact:true}).click();
  const original=page.locator(".bot-card").filter({has:page.getByRole("heading",{name:"Custom builder",exact:true})});
  await original.getByRole("button",{name:"Memory",exact:true}).click();
  await page.getByRole("button",{name:"New note",exact:true}).click();
  await page.getByLabel("Memory title",{exact:true}).fill("Only for the original");
  await page.getByLabel("Memory note",{exact:true}).fill("Private context");
  await page.getByRole("button",{name:"Save note",exact:true}).click();
  await page.getByRole("button",{name:"Close memory"}).click();
  await original.getByRole("button",{name:"Duplicate",exact:true}).click();
  await expect(page.getByLabel("Bot name",{exact:true})).toHaveValue("Custom builder copy");
  await page.getByRole("button",{name:"Save bot",exact:true}).click();
  const copy=page.locator(".bot-card").filter({hasText:"Custom builder copy"});
  await copy.getByRole("button",{name:"Memory",exact:true}).click();
  await expect(page.getByText("Only for the original",{exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Close memory"}).click();
  const profiles=await page.evaluate(()=>JSON.parse(localStorage.getItem("qa-bots")!));
  expect(profiles).toHaveLength(2);expect(profiles[0].id).not.toBe(profiles[1].id);
  expect(profiles[1]).toMatchObject({provider:"codex",automatic:false,soul:profiles[0].soul,agent:profiles[0].agent,options:profiles[0].options});
});
test('scheduled-work notification opens bot activity',async({page})=>{
  await boot(page);
  await page.evaluate(()=>{const q=(window as any).qa;q.pendingNavigation='bot-run-00000000-0000-4000-8000-000000000000';q.emit('desktop-navigation',null);});
  await expect(page.getByRole('button',{name:'Activity',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByText('A clear record of the work.')).toBeVisible();
});
async function create(page: Page, name = "Grokbot") {
  await page.getByRole("button", { name: "Bots", exact: true }).click();
  await page.getByRole("button", { name: "New bot", exact: true }).click();
  await page.getByLabel("Bot name", { exact: true }).fill(name);
  await page
    .getByLabel("Bot specialty")
    .fill("Build, verify, and hand off clear results.");
  await expect(
    page
      .locator(".bots-panel")
      .getByRole("button", { name: "Model: Deep model", exact: true }),
  ).toBeEnabled();
}
test("bot profile edits, provider preferences, private memory, and avatar persist", async ({
  page,
}) => {
  await boot(page);
  await create(page);
  await page.getByLabel("Bot preferred provider").selectOption("codex");
  await page
    .locator(".bots-panel")
    .getByRole("button", { name: "Reasoning: High", exact: true })
    .click();
  await page.getByRole("option", { name: /^Maximum/ }).click();
  await page.evaluate(() => {
    const decode = window.createImageBitmap.bind(window);
    // A picker-backed Android file must remain selected during asynchronous reads.
    window.createImageBitmap = (async (...args: unknown[]) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const input = document.querySelector<HTMLInputElement>(".bot-file-button input");
      if (!input?.files?.length) throw new Error("Picture selection was released during decoding");
      return Reflect.apply(decode, window, args);
    }) as typeof createImageBitmap;
  });
  await page
    .locator(".bot-file-button input")
    .setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await expect(page.locator(".bot-picture img")).toBeVisible();
  await expect(page.locator(".bot-file-button input")).toHaveValue("");
  await page
    .getByRole("button", { name: "Personality & instructions", exact: true })
    .click();
  await page
    .getByLabel("soul.md", { exact: true })
    .fill("You are {{name}}. Be patient and precise.");
  await page
    .getByLabel("agent.md", { exact: true })
    .fill("Check the Kanban before choosing work. Verify and report evidence.");
  await page.getByLabel("Bot memory budget").selectOption("1000");
  await page.getByRole("button", { name: "Save bot", exact: true }).click();
  const card = page.locator(".bot-card").filter({ hasText: "Grokbot" });
  await expect(card).toContainText("Codex");
  await card.getByRole("button", { name: "Memory", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Grokbot's memory", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page
    .getByLabel("Memory title", { exact: true })
    .fill("Private preference");
  await page
    .getByLabel("Memory note", { exact: true })
    .fill("Always include verification evidence.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await page.getByRole("button", { name: "Close memory" }).click();
  expect(
    (await new AxeBuilder({ page }).include(".bots-panel").analyze())
      .violations,
  ).toEqual([]);
  await page.screenshot({ path: ".qa/bots-desktop.png" });
  await page.getByRole("button", { name: "Close bots" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Bots", exact: true }).click();
  await card.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(
    page.locator(".chat-wrap:not(.hidden) textarea"),
  ).toHaveAttribute("placeholder", /Grokbot/);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).qa.calls
            .filter((c: any) => c.cmd === "agent_new")
            .at(-1)?.args,
      ),
    )
    .toMatchObject({
      provider: "codex",
      options: { model: "codex-deep", reasoning: "max" },
    });
  await page.getByLabel("AI provider").selectOption("muse");
  const last = await page.evaluate(
    () =>
      (window as any).qa.calls.filter((c: any) => c.cmd === "agent_new").at(-1)
        ?.args,
  );
  expect(last.botId).toMatch(/^[a-f0-9-]{36}$/);
  expect(last.provider).toBe("muse");
  expect(
    await page.evaluate(
      () =>
        (window as any).qa.calls.filter((c: any) => c.cmd === "agent_send")
          .length,
    ),
  ).toBe(0);
});
test("bot conflicts keep edits, custom models do not submit the profile, and dirty closing is explicit", async ({
  page,
}) => {
  await boot(page);
  await create(page);
  await page
    .locator(".bots-panel")
    .getByRole("button", { name: "Model: Deep model", exact: true })
    .click();
  await page.getByRole("option", { name: /Enter model ID/ }).click();
  await page.getByLabel("Custom model ID").fill("custom/reviewer");
  await page.getByLabel("Custom model ID").press("Enter");
  await expect(page.getByLabel("Bot name", { exact: true })).toHaveValue(
    "Grokbot",
  );
  await page.evaluate(() => ((window as any).qa.botConflict = true));
  await page.getByRole("button", { name: "Save bot", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("edited elsewhere");
  await expect(page.getByLabel("Bot name", { exact: true })).toHaveValue(
    "Grokbot",
  );
  await page.getByRole("button", { name: "Close bots" }).click();
  await expect(page.getByText("Discard unsaved bot changes?")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByLabel("Bot name", { exact: true })).toBeVisible();
});
test("assignment exposes cron controls and scheduler actions do not silently send chats", async ({
  page,
}) => {
  await boot(page);
  await create(page);
  await page.getByRole("button", { name: "Save bot", exact: true }).click();
  await page.getByRole("button", { name: "Close bots" }).click();
  await page.getByRole("button", { name: "Kanban", exact: true }).click();
  await page.getByRole("button", { name: "Add task to Backlog" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Review implementation");
  await page
    .getByLabel("Assigned bot", { exact: true })
    .selectOption({ label: "Grokbot" });
  await page
    .getByRole("button", { name: "Schedule: Every 15 minutes", exact: true })
    .click();
  await page.getByRole("option", { name: "Every hour", exact: true }).click();
  await page.getByLabel("Run automatically on schedule").uncheck();
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(page.locator(".kanban-card")).toContainText("Approval");
  await page.getByRole("button", { name: "Close Kanban" }).click();
  await page.evaluate(() => {
    const w = window as any;
    const card = Object.keys(localStorage)
      .filter((k) => k.startsWith("qa-board:"))
      .map((k) => JSON.parse(localStorage.getItem(k)!))
      .flatMap((b) => b.cards)[0];
    w.qa.jobs = {
      enabled: true,
      jobs: [
        {
          id: "job1",
          title: card.title,
          assignment: card.assignment,
          status: "approval",
          next_run: 1800000000,
          paused: false,
        },
      ],
      runs: [],
      warning: null,
    };
  });
  await page.getByRole("button", { name: "Bots", exact: true }).click();
  await page.getByRole("button", { name: "Schedules", exact: true }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.locator(".bot-job")).toContainText("Paused");
  await page.getByRole("button", { name: "Run now", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator(".bot-job")).toContainText("cancelled");
  await page.getByRole("button", { name: "Pause scheduling" }).click();
  await expect(page.getByText("Scheduling is paused")).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include(".bots-panel").analyze())
      .violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        (window as any).qa.calls.filter((c: any) => c.cmd === "agent_send")
          .length,
    ),
  ).toBe(0);
});
test("handoff opens the target bot with context and keeps the source conversation", async ({
  page,
}) => {
  await boot(page);
  await create(page, "Reviewer");
  await page.getByRole("button", { name: "Save bot", exact: true }).click();
  await page.getByRole("button", { name: "Close bots" }).click();
  await page
    .locator(".chat-wrap:not(.hidden) textarea")
    .fill("Review the changes");
  await page.locator(".chat-wrap:not(.hidden) textarea").press("Enter");
  await page.evaluate(() => {
    const q = (window as any).qa;
    q.agent({
      kind: "assistant_delta",
      text: "The implementation is ready for review.",
    });
    q.agent({ kind: "turn_end", status: "completed" });
  });
  await page.getByRole("button", { name: "Hand off", exact: true }).click();
  await page
    .locator(".bot-card")
    .getByRole("button", { name: "Hand off", exact: true })
    .click();
  await expect(page.locator(".chat-wrap:not(.hidden) textarea")).toHaveValue(
    /Handoff from Muse.*Reviewer[\s\S]*implementation is ready/,
  );
  await expect(page.getByRole("tab")).toHaveCount(2);
  expect(
    await page.evaluate(
      () =>
        (window as any).qa.calls.filter((c: any) => c.cmd === "agent_send")
          .length,
    ),
  ).toBe(1);
});
