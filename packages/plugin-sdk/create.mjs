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
await writeFile(resolve(root, ".gitignore"), "node_modules/\n.env\n.env.*\n");
await writeFile(
  resolve(root, "README.md"),
  `# ${id}\n\nA plugin for [Velum Code](https://github.com/velumix/VelumCode).\n\n## Install\n\nIn Velum Code, open **Plugins → Install from GitHub**, paste this public GitHub repository URL, and review its permissions.\n\n## Develop\n\nEdit the author and details in \`velum-plugin.json\`, then edit \`index.js\`. Keep both files in this repository's root on its default branch. Publish built JavaScript; Velum does not run build scripts.\n\nPush changes to GitHub, then use **Check for updates** in Velum to review and install the new commit. [SDK guide](https://github.com/velumix/VelumCode/blob/main/docs/plugins.md).\n\n## Share in the directory\n\nOpen **Plugins → Publish your plugin**, paste this repository URL, and choose **Check repository**. Continue on GitHub to submit the prefilled form. After review, the plugin appears in Browse. Use the same flow to submit a new version.\n`,
);
console.log(
  `Created ${root}\nCreate a public GitHub repository and push this folder. In Velum Code, use Plugins → Install from GitHub to try it, or Publish your plugin to submit it to the directory.`,
);
