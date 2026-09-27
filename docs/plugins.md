# Plugins for Velum Code

Plugins add local commands to **Plugins** in the sidebar and to **Ctrl+K**. API v1 is deliberately small: read workspace text, inspect the current conversation with permission, process user input, and return a result. The user decides whether to add that result to their draft. Installing a plugin never runs its code.

## Try Project tools

1. Clone or download this repository.
2. Open **Plugins**, paste the full path to `examples/project-tools`, and choose **Review plugin**.
3. Review the publisher details and requested permissions, then **Allow and install**.
4. Choose **Create project brief** or **Prepare review checklist**, then **Run command**.

The example reads the current workspace's root directory and optional `package.json`. It does not make an AI request. **Add to draft** appends the result to your existing draft; you choose when to send it.

Installed packages are copied into Velum's app configuration directory. Editing the original folder has no effect until you review and install it again. Updates are matched by plugin ID and require a fresh review. Disable or remove plugins from the same screen. Removing one also deletes its settings.

## Create your first plugin

From this repository:

```sh
node packages/plugin-sdk/create.mjs my-plugin
```

This creates a ready-to-install folder without overwriting an existing directory. Edit the author's name and details in `velum-plugin.json`, then edit `index.js`. There is no build step for this JavaScript starter.

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
npx esbuild src/index.ts --bundle --platform=browser --format=iife --global-name=VelumPlugin --target=es2020 --outfile=dist/index.js
```

Copy your `velum-plugin.json` into `dist`, then install that folder. The host also accepts `VelumPlugin.default`, as emitted by this command. See [esbuild's global-name documentation](https://esbuild.github.io/api/#global-name) for other bundler configurations. Only developer builds need a bundler; Velum ships no JS engine or npm runtime for plugins.

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

Workers are discarded on completion, failure, cancellation, timeout, or panel close. API calls already accepted by the native backend may finish after cancellation; keep storage operations small and idempotent. Browser workers do not offer a hard memory quota: this is bounded command execution, not an operating-system resource sandbox. Install code from authors you trust. Packages are local and publishers are not cryptographically verified. The review digest detects changes between review, install, and execution; it is not an author signature.

There are no startup hooks, background daemons, shell commands, arbitrary network requests, file writes, custom UI injection, provider adapters or automatic AI tool calls in v1. Plugins do not consume model tokens unless you deliberately send their output. Plugins currently run on Windows desktop; paired phones retain their existing chat, memory and model controls.

## Test and distribute

- Test missing permissions, missing files, long input, cancellation, and errors in your command.
- Keep computation small; report useful errors by throwing `Error`.
- Package `velum-plugin.json` and the built `index.js` together. A user can unzip your release into a folder, review, and install it.
- Use an appropriate license for your plugin and bundled dependencies.
- Velum's own browser tests exercise worker isolation, timeouts, permission rejection and UI responsiveness. Native smoke tests cover the actual Windows package and filesystem boundary.
