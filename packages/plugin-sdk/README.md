# Velum Code plugin SDK

Small, typed command plugins. No runtime dependencies or always-running plugin processes.

Create a plugin from the repository:

```sh
node packages/plugin-sdk/create.mjs my-plugin
```

For TypeScript types in your own project, install this local SDK package with `npm install /path/to/VelumCode/packages/plugin-sdk` and import `definePlugin` or the `Plugin` type. Bundle runtime imports into one IIFE named `index.js`, exporting the global `VelumPlugin`, before installation. Plain JavaScript plugins can set `self.VelumPlugin` directly and need no build step.

See [the authoring guide](../../docs/plugins.md) and [Project tools](../../examples/project-tools) for the complete contract, permissions, limits and examples. The SDK is included in this repository; it has not been published to npm.
