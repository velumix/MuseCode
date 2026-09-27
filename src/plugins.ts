export type Permission = "workspace.read" | "conversation.read" | "storage";
export interface PluginCommand {
  id: string;
  title: string;
  description: string;
}
export interface PluginManifest {
  apiVersion: 1;
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  entry: string;
  permissions: Permission[];
  commands: PluginCommand[];
}
export interface InstalledPlugin {
  origin?: PluginOrigin | null;
  manifest: PluginManifest;
  enabled: boolean;
  digest: string;
}
export interface PluginPreview {
  origin: PluginOrigin;
  manifest: PluginManifest;
  digest: string;
  bytes: number;
}
export interface PluginOrigin {
  repository: string;
  commit: string;
}
export interface CatalogEntry extends PluginOrigin {
  manifest: PluginManifest;
}
export interface PluginCatalog {
  catalog: { schemaVersion: 1; plugins: CatalogEntry[] };
  fetched_at: number;
  notice: string | null;
}
export function submissionUrl(preview: PluginPreview): string {
  const url = new URL(
    "https://github.com/velumix/velum-code-plugins/issues/new",
  );
  url.searchParams.set("template", "plugin.yml");
  url.searchParams.set("title", `Plugin: ${preview.origin.repository}`);
  url.searchParams.set("repository", preview.origin.repository);
  url.searchParams.set("commit", preview.origin.commit);
  return url.toString();
}
export interface PluginResult {
  title?: string;
  text: string;
}
export interface PluginChatHandle {
  messages: () => { role: string; text: string }[];
  insert: (text: string) => void;
}
export const permissionLabels: Record<Permission, string> = {
  "workspace.read": "Read text files and list folders in the current workspace",
  "conversation.read": "Read the current conversation’s messages",
  storage: "Keep up to 32 KB of its own settings on this computer",
};
