export interface FileEntry {
  name: string;
  directory: boolean;
  symlink: boolean;
}
export interface Message {
  role: "user" | "assistant";
  text: string;
}
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export interface PluginAPI {
  /** Requires workspace.read. Paths use forward slashes and stay in the active workspace. */
  readonly workspace: {
    readText(path: string): Promise<string>;
    listFiles(path?: string): Promise<FileEntry[]>;
  };
  /** Requires conversation.read. At most 40 messages, 4,000 characters each. */
  readonly conversation: { messages(): Promise<Message[]> };
  /** Requires storage. 32 KB total per plugin; set null to remove a key. */
  readonly storage: {
    get(key: string): Promise<Json>;
    set(key: string, value: Json): Promise<void>;
  };
}
export interface CommandResult {
  title?: string;
  text: string;
}
export interface Plugin {
  commands: Record<
    string,
    (api: PluginAPI, input: string) => CommandResult | Promise<CommandResult>
  >;
}
export interface PluginManifest {
  apiVersion: 1;
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  entry: "index.js";
  permissions: ("workspace.read" | "conversation.read" | "storage")[];
  commands: { id: string; title: string; description?: string }[];
}
export declare function definePlugin<T extends Plugin>(plugin: T): T;
