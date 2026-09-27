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
  manifest: PluginManifest;
  enabled: boolean;
  digest: string;
}
export interface PluginPreview {
  manifest: PluginManifest;
  digest: string;
  bytes: number;
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
