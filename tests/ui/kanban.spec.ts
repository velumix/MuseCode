import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { boot } from "./fixture";
async function add(page: Page, title: string, column = "Backlog") {
  await page
    .getByRole("button", { name: `Add task to ${column}`, exact: true })
    .click();
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page
    .getByLabel("Details", { exact: true })
    .fill("Acceptance criteria and useful context.");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toBeVisible();
}
test("Kanban creates, edits, moves, reorders, searches and persists tasks", async ({
  page,
}) => {
  await boot(page);
  expect(
    await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .some((r) => r.name.includes("KanbanPanel")),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Kanban", exact: true }).click();
  await add(page, "Improve onboarding");
  await add(page, "Fix reconnect");
  await page
    .getByRole("button", { name: "Move Fix reconnect up", exact: true })
    .click();
  await expect(page.locator(".backlog .kanban-card-title").first()).toHaveText(
    "Fix reconnect",
  );
  await page
    .getByLabel("Move Fix reconnect", { exact: true })
    .selectOption("progress");
  await expect(page.locator(".progress .kanban-card-title")).toHaveText(
    "Fix reconnect",
  );
  await page
    .getByRole("button", { name: "Fix reconnect", exact: true })
    .click();
  await page.getByLabel("Task priority").selectOption("high");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await page.getByLabel("Search tasks").fill("reconnect");
  await expect(page.locator(".kanban-card")).toHaveCount(1);
  await page.getByLabel("Search tasks").fill("");
  expect(
    (await new AxeBuilder({ page }).include(".kanban-panel").analyze())
      .violations,
  ).toEqual([]);
  await page.screenshot({
    path: ".qa/kanban-desktop.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Close Kanban" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Kanban", exact: true }).click();
  await expect(page.locator(".progress .kanban-priority")).toHaveText(
    "high priority",
  );
  await page.locator(".progress .kanban-card").dragTo(page.locator(".done"));
  await expect(page.locator(".done .kanban-card-title")).toHaveText(
    "Fix reconnect",
  );
  await page
    .getByRole("button", { name: "Fix reconnect", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete task", exact: true }).click();
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await expect(page.locator(".kanban-card")).toHaveCount(1);
});
test("Kanban preserves unsaved edits through a conflict and protects dismissal", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "Kanban", exact: true }).click();
  await add(page, "Keep edits");
  await page.getByRole("button", { name: "Keep edits", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("New title");
  await page.evaluate(() => ((window as any).qa.boardConflict = true));
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "changed on another screen",
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "New title",
  );
  await page.keyboard.press("Escape");
  await expect(
    page.getByText("Discard your unsaved card changes?"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await page.evaluate(() => ((window as any).qa.boardConflict = false));
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "New title", exact: true }),
  ).toBeVisible();
});
test("Work on this opens a fresh draft without sending or changing the old one", async ({
  page,
}) => {
  await boot(page);
  await page
    .locator(".chat-wrap:not(.hidden) textarea")
    .fill("Existing conversation draft");
  await page.getByRole("button", { name: "Kanban", exact: true }).click();
  await add(page, "Implement search");
  await page
    .getByRole("button", { name: "Work on this", exact: false })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.locator(".chat-wrap:not(.hidden) textarea")).toHaveValue(
    /Work on this task: Implement search/,
  );
  expect(
    await page.evaluate(() =>
      (window as any).qa.calls.some((c: any) => c.cmd === "agent_send"),
    ),
  ).toBe(false);
  await page.getByRole("tab").first().click();
  await expect(page.locator(".chat-wrap:not(.hidden) textarea")).toHaveValue(
    "Existing conversation draft",
  );
});
