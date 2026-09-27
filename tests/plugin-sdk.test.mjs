import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import vm from "node:vm";
import { definePlugin } from "../packages/plugin-sdk/index.js";

test("SDK scaffolds an installable plugin and refuses to overwrite existing work", async () => {
  mkdirSync(".qa", { recursive: true });
  const dir = mkdtempSync(path.resolve(".qa/sdk-"));
  const script = path.resolve("packages/plugin-sdk/create.mjs");
  const create = () =>
    spawnSync(process.execPath, [script, "example-plugin"], {
      cwd: dir,
      encoding: "utf8",
      windowsHide: true,
    });
  assert.equal(create().status, 0);
  const manifest = JSON.parse(
    readFileSync(path.join(dir, "example-plugin/velum-plugin.json"), "utf8"),
  );
  assert.equal(manifest.apiVersion, 1);
  assert.equal(manifest.entry, "index.js");
  assert.deepEqual(manifest.permissions, []);
  assert.match(readFileSync(path.join(dir,"example-plugin/README.md"),"utf8"),/public GitHub repository URL/);
  assert.match(readFileSync(path.join(dir,"example-plugin/.gitignore"),"utf8"),/node_modules/);
  const source = readFileSync(
    path.join(dir, "example-plugin/index.js"),
    "utf8",
  );
  const sandbox = { self: {} };
  vm.runInNewContext(source, sandbox);
  const plugin = sandbox.self.VelumPlugin;
  assert.equal(definePlugin(plugin), plugin);
  assert.equal(
    (await plugin.commands.hello({}, "example input")).text,
    "example input",
  );
  assert.notEqual(create().status, 0);
  assert.equal(
    readFileSync(path.join(dir, "example-plugin/index.js"), "utf8"),
    source,
  );
  assert.notEqual(
    spawnSync(process.execPath, [script, "../escape"], {
      cwd: dir,
      windowsHide: true,
    }).status,
    0,
  );
  const sdk = path
    .relative(dir, path.resolve("packages/plugin-sdk/index.js"))
    .replaceAll("\\", "/");
  const typed = path.join(dir, "typed.mts");
  writeFileSync(
    typed,
    `import {definePlugin} from ${JSON.stringify(sdk)};\nexport default definePlugin({commands:{async example(api,input){const files=await api.workspace.listFiles();return {text:input+files[0]?.name};}}});\n`,
  );
  const check = spawnSync(
    process.execPath,
    [
      path.resolve("node_modules/typescript/bin/tsc"),
      "--ignoreConfig",
      "--strict",
      "--noEmit",
      "--skipLibCheck",
      "--target",
      "es2020",
      "--module",
      "nodenext",
      "--moduleResolution",
      "nodenext",
      typed,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(check.status, 0, check.stdout + check.stderr);
});
