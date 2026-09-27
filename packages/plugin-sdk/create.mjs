#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const id = process.argv[2];
if (
  !id ||
  !/^[a-z][a-z0-9-]{2,63}$/.test(id) ||
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(id)
) {
  console.error(
    "Usage: create-velum-plugin my-plugin (3–64 lowercase letters, numbers and hyphens)",
  );
  process.exit(1);
}
const root = resolve(process.cwd(), id);
// Never overwrite an existing folder or any user files.
await mkdir(root);
await writeFile(
  resolve(root, "velum-plugin.json"),
  JSON.stringify(
    {
      apiVersion: 1,
      id,
      name: id
        .split("-")
        .map((s) => s[0].toUpperCase() + s.slice(1))
        .join(" "),
      version: "1.0.0",
      description: "A useful command for Velum Code.",
      author: "Your name",
      entry: "index.js",
      permissions: [],
      commands: [
        {
          id: "hello",
          title: "Say hello",
          description: "Try your first plugin command.",
        },
      ],
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  resolve(root, "index.js"),
  `/** @type {import('@velum-code/plugin-sdk').Plugin} */
const plugin = {
  commands: {
    hello(_api, input) { return { title: 'Hello from your plugin', text: input || 'Your plugin is working.' }; }
  }
};
self.VelumPlugin = plugin;
`,
);
console.log(
  `Created ${root}\nOpen Plugins in Velum Code, paste this folder, and choose Review plugin.`,
);
