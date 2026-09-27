export const columns = [
  { id: "backlog", title: "Backlog" },
  { id: "progress", title: "In progress" },
  { id: "review", title: "Review" },
  { id: "done", title: "Done" },
] as const;
export type Column = (typeof columns)[number]["id"];
export interface Card {
  due_date?: string | null;
  dependencies?: string[];
  assignment?: import("./bots").Assignment | null;
  last_summary?: string;
  last_run?: string | null;
  id: string;
  title: string;
  description: string;
  column: Column;
  priority: "low" | "normal" | "high";
}
export interface Board {
  revision: number;
  cards: Card[];
  trash?: { card: Card; deleted_at: number }[];
}
export type BoardRequest =
  | { action: "load" }
  | { action: "save"; revision: number; card: Card }
  | {
      action: "move";
      revision: number;
      id: string;
      column: Column;
      before: string | null;
    }
  | { action: "delete"; revision: number; id: string }
  | TrashRequest;
export type TrashRequest = {
  action: "restore" | "purge";
  revision: number;
  id: string;
};

export function taskBlockers(card: Card, cards: Card[]) {
  return (card.dependencies || []).flatMap((id) => {
    const dependency = cards.find((c) => c.id === id);
    return dependency?.column === "done"
      ? []
      : [dependency?.title || "Deleted prerequisite"];
  });
}
export function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function isOverdue(card: Card, today = localDate()) {
  return card.column !== "done" && !!card.due_date && card.due_date < today;
}
export function needsAttention(card: Card, cards: Card[], today = localDate()) {
  return (
    card.column !== "done" &&
    (card.column === "review" ||
      isOverdue(card, today) ||
      taskBlockers(card, cards).length > 0)
  );
}
export function formatDue(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
export function taskPrompt(card: Card) {
  return `Work on this task: ${card.title}\nTask ID: ${card.id}${card.due_date ? `\nDue date: ${card.due_date}` : ""}${card.dependencies?.length ? `\nPrerequisite task IDs (verify these are Done first): ${card.dependencies.join(", ")}` : ""}${card.description ? `\n\n${card.description}` : ""}`;
}
