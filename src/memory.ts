export interface MemorySettings {
  enabled: boolean;
  capture: "review" | "automatic" | "manual";
  budget_bytes: number;
}
export interface MemoryNote {
  id: string;
  revision: string;
  title: string;
  body: string;
  tags: string[];
  scope: "project" | "shared";
  status: "active" | "pending" | "archived";
  pinned: boolean;
  source: string;
  created_at: number;
  updated_at: number;
}
export interface MemoryView {
  root: string;
  settings: MemorySettings;
  notes: MemoryNote[];
  warning: string | null;
}
export type MemoryRequest =
  | { action: "list"; query: string }
  | ({ action: "save"; id: string | null; revision: string | null } & Pick<
      MemoryNote,
      "title" | "body" | "tags" | "scope" | "status" | "pinned"
    >)
  | { action: "delete"; id: string; revision: string }
  | { action: "configure"; settings: MemorySettings };
