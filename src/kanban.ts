export const columns = [
  { id: "backlog", title: "Backlog" },
  { id: "progress", title: "In progress" },
  { id: "review", title: "Review" },
  { id: "done", title: "Done" },
] as const;
export type Column = (typeof columns)[number]["id"];
export interface Card {
  id: string;
  title: string;
  description: string;
  column: Column;
  priority: "low" | "normal" | "high";
}
export interface Board {
  revision: number;
  cards: Card[];
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
  | { action: "delete"; revision: number; id: string };
export function taskPrompt(card: Card) {
  return `Work on this task: ${card.title}${card.description ? `\n\n${card.description}` : ""}`;
}
