# Velum Code plugin SDK

Small, typed command plugins. No runtime dependencies or always-running plugin processes.

## License status

The SDK has not yet been assigned a project license or published to npm. Public
source is not an open source grant; review [legal status](../../LEGAL.md) before
redistributing SDK code. The publisher must approve the SDK license and include
it in the package before publication. Your own plugin and any included
dependencies need their own appropriate licenses and retained notices.

## Use the SDK

Create a plugin from the repository:

```sh
node packages/plugin-sdk/create.mjs my-plugin
```

For TypeScript types in your own project, install this local SDK package with `npm install /path/to/VelumCode/packages/plugin-sdk` and import `definePlugin` or the `Plugin` type. Bundle runtime imports into one IIFE named `index.js`, exporting the global `VelumPlugin`, before installation. Plain JavaScript plugins can set `self.VelumPlugin` directly and need no build step.

See [the authoring guide](../../docs/plugins.md) and [Project tools](../../examples/project-tools) for the complete contract, permissions, limits and examples. The SDK is included in this repository; it has not been published to npm.

Push your plugin to a public GitHub repository. In Velum, **Plugins → Publish your plugin** checks the repository and opens a prefilled submission for the [community directory](https://github.com/velumix/velum-code-plugins). Approved versions appear in Browse. You can try a repository directly using **Install from GitHub**.
