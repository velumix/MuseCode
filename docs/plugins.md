# Plugins for Velum Code

Plugins add local commands to **Plugins** in the sidebar and to **Ctrl+K**. API v1 is deliberately small: read workspace text, inspect the current conversation with permission, process user input, and return a result. The user decides whether to add that result to their draft. Installing a plugin never runs its code.

## Try Project tools

1. Open **Plugins** in Velum Code.
2. Find **Project tools** in Browse and choose **Install**. You can also use **Install from GitHub** with `velumix/velum-plugin-project-tools`.
3. Review the publisher details and requested permissions, then **Allow and install**.
4. Choose **Create project brief** or **Prepare review checklist**, then **Run command**.

The example reads the current workspace's root directory and optional `package.json`. It does not make an AI request. **Add to draft** appends the result to your existing draft; you choose when to send it.

Every plugin must be a **public GitHub repository** with built `velum-plugin.json` and `index.js` at its root. Browse installs the commit listed in the community directory. Direct repository installs and **Check for updates** resolve the default branch to a commit. Velum downloads both files at that commit and caches the exact package for review. Installation uses those reviewed bytes even if the branch changes afterward. Files are copied into the app configuration directory; installed commands work offline.

Use **Check for updates** to fetch the latest default-branch commit. Review the version, source link, and permissions (new permissions are highlighted), then install. Updates preserve private settings and enabled state. A different repository cannot silently replace an installed plugin with the same ID. Remove the old plugin explicitly before changing repositories. Removing a plugin deletes its private settings.

The directory loads when you open Browse and is cached for one hour, with a Refresh button. If GitHub is unavailable, Velum keeps the saved list or shows its included starter list. There is no startup polling. Public repositories require no token. Private repositories, GitHub Enterprise, branch selectors and release archives are not supported in API v1. Installation review makes two bounded HTTPS requests for a listed commit, or three for a direct repository's current commit. GitHub rate limits are reported without affecting installed plugins. Redirected repositories require their current URL. Repository identity and commit pinning are provenance, not a publisher signature or endorsement.

Previously installed folder plugins are disabled until linked by reviewing and installing their GitHub repository. Their settings remain intact; enable them after migration. Local folder installation has been removed.

## Publish to the directory

1. Open **Plugins → Publish your plugin**.
2. Paste your public GitHub repository and choose **Check repository**.
3. Review the detected details, then choose **Continue on GitHub**.
4. GitHub opens a submission with the repository and exact commit already filled in. Sign in, confirm you maintain the plugin, and submit the form.
5. A maintainer reviews it and approves publication. GitHub Actions validates the pinned files and generates the directory the app reads.

The app does not collect your GitHub token and does not silently post submissions. Follow progress through **View submissions**. Publish an update through the same flow; existing installations remain pinned until their users review an update. Direct repository updates can be newer than the directory's listed version.

The directory is a separate public repository: [velumix/velum-code-plugins](https://github.com/velumix/velum-code-plugins). Approved snapshots are in `entries/`; `catalog.json` is generated automatically. Only a directory maintainer with write access can approve a submission. The workflow never executes submitted JavaScript, rejects duplicate IDs/repositories and malformed packages, and caps the directory at 500 entries / 1 MB. Removing an entry and regenerating the catalog removes its listing, without deleting users' installed plugins.

Listings mean a version was accepted into the directory; they are not a security audit or a verified publisher badge. Always review the permissions and source before installation.

## Create your first plugin

From this repository:

```sh
node packages/plugin-sdk/create.mjs my-plugin
```

This creates a repository-ready folder, README and .gitignore without overwriting an existing directory. Edit the author's name and details in `velum-plugin.json`, then edit `index.js`. There is no build step for this JavaScript starter.

Publish it as its own GitHub repository:

```sh
cd my-plugin
git init -b main
git add .
git commit -m "Added plugin"
gh repo create YOUR-USERNAME/my-plugin --public --source . --remote origin --push
```

Use **Install from GitHub** to try your repository, then **Publish your plugin** to share it in Browse. For subsequent changes, commit and push, then check for updates in Velum and submit the new version to the directory. Choose the license for your own repository before distributing your code.

```json
{
  "apiVersion": 1,
  "id": "yourname.project-tools",
  "name": "My project tools",
  "version": "1.0.0",
  "description": "A few useful project commands.",
  "author": "Your name",
  "entry": "index.js",
  "permissions": ["workspace.read"],
  "commands": [
    { "id": "read-readme", "title": "Read project README", "description": "Bring the project README into a draft." }
  ]
}
```

```js
self.VelumPlugin = {
  commands: {
    async 'read-readme'(api, input) {
      const text = await api.workspace.readText('README.md');
      return { title: input || 'Project README', text: text.slice(0, 8000) };
    }
  }
};
```

The built entry must define `self.VelumPlugin` with a `commands` object. Each manifest command ID maps to a function receiving `(api, input)` and returning `{ title?: string, text: string }`, or a promise for that object. Output is displayed as plain text, never evaluated as HTML. Dependencies must be bundled; runtime imports and Node APIs are unavailable.

IDs use lowercase letters, numbers, dots and hyphens, begin with a letter, and contain 3–64 characters. Use a publisher prefix to avoid collisions. API v1 rejects unknown manifest fields, unsupported permissions, duplicate command IDs, and unsupported API versions.

## TypeScript SDK

The dependency-free SDK lives in [`packages/plugin-sdk`](../packages/plugin-sdk). It includes API types, `definePlugin`, and the starter generator. It is **not yet published to npm**.

Install it from a checkout into your plugin project:

```sh
npm install /path/to/VelumCode/packages/plugin-sdk
npm install --save-dev esbuild typescript
```

Write `src/index.ts`:

```ts
import { definePlugin } from '@velum-code/plugin-sdk';

export default definePlugin({
  commands: {
    async 'read-readme'(api, input) {
      const text = await api.workspace.readText('README.md');
      return { title: input || 'Project README', text: text.slice(0, 8000) };
    }
  }
});
```

Bundle it as an IIFE with the global name `VelumPlugin`:

```sh
npx esbuild src/index.ts --bundle --platform=browser --format=iife --global-name=VelumPlugin --target=es2020 --outfile=index.js
```

Commit the built `index.js` alongside `velum-plugin.json` at your repository root, then push. Velum never runs npm, git hooks or build scripts. The host also accepts `VelumPlugin.default`, as emitted by this command. See [esbuild's global-name documentation](https://esbuild.github.io/api/#global-name) for other bundler configurations. Only developer builds need a bundler; Velum ships no JS engine or npm runtime for plugins.

## API and permissions

| API | Permission | Behavior |
| --- | --- | --- |
| `workspace.readText(path)` | `workspace.read` | UTF-8 text, at most 128 KB. Relative paths use forward slashes. |
| `workspace.listFiles(path = '.')` | `workspace.read` | Up to 200 immediate children: `{ name, directory, symlink }`. No recursive scan. |
| `conversation.messages()` | `conversation.read` | Last 40 user/assistant messages, each limited to 4,000 characters. No hidden provider reasoning. |
| `storage.get(key)` | `storage` | Plugin's own JSON value, or `null`. |
| `storage.set(key, value)` | `storage` | Persist a JSON value. Set `null` to delete it. Keys are 1–100 characters. |

Workspace access is confined to the workspace selected when the command starts. Absolute paths, parent traversal, Windows alternate data streams, and links outside that directory are rejected. The read permission covers text files in that workspace, so choose workspaces and plugins accordingly. Velum does not send these files anywhere on a plugin's behalf.

## Performance and isolation

| Limit | API v1 |
| --- | --- |
| Installed plugins / commands per plugin | 32 / 20 |
| Bundled source | 512 KB |
| Command execution | One at a time, 5 seconds including startup |
| Input / output | 16,000 characters / 32 KB UTF-8 |
| Host API calls | 64 total, 8 outstanding |
| Private storage | 32 KB per plugin |
| Background runtime while idle | None |

The manager and runtime are separate lazy-loaded frontend chunks. Startup reads manifest metadata only. A command gets a fresh Web Worker inside an opaque-origin, sandboxed iframe. A restrictive Content Security Policy blocks network access; the worker cannot access the app DOM, browser storage or Tauri IPC. Communication uses a private MessageChannel and a fixed host API allowlist. Native code independently checks filesystem and storage permissions. See the [browser sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox) and [worker CSP rules](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#content_security_policy).

Workers are discarded on completion, failure, cancellation, timeout, or panel close. API calls already accepted by the native backend may finish after cancellation; keep storage operations small and idempotent. Browser workers do not offer a hard memory quota: this is bounded command execution, not an operating-system resource sandbox. Install code from authors you trust. Packages are downloaded from GitHub and stored locally; publishers are not cryptographically verified. The review digest binds the manifest and code shown for installation and detects later edits; it is not an author signature.

There are no startup hooks, background daemons, shell commands, arbitrary network requests, file writes, custom UI injection, provider adapters or automatic AI tool calls in v1. Plugins do not consume model tokens unless you deliberately send their output. Plugins currently run on Windows desktop; paired phones retain their existing chat, memory and model controls.

## Test and distribute

- Test missing permissions, missing files, long input, cancellation, and errors in your command.
- Keep computation small; report useful errors by throwing `Error`.
- Commit `velum-plugin.json` and the built `index.js` at the root of a public GitHub repository. Users install by repository URL and review updates from the default branch.
- Use an appropriate license for your plugin and bundled dependencies.
- Velum's own browser tests exercise worker isolation, timeouts, permission rejection and UI responsiveness. Native smoke tests cover the actual Windows package and filesystem boundary.
