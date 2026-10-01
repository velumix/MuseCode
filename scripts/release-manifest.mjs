// Build the static, signed update feed consumed by the installed Windows app.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = JSON.parse(read("package.json"));
const config = JSON.parse(read("src-tauri/tauri.conf.json"));
const npmLock = JSON.parse(read("package-lock.json"));
const cargoVersion = read("src-tauri/Cargo.toml").match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const tag = process.env.RELEASE_TAG || `v${app.version}`;
if (!/^v\d+\.\d+\.\d+$/.test(tag) || tag !== `v${app.version}` ||
    [config.version, cargoVersion, npmLock.version, npmLock.packages[""].version].some((version) => version !== app.version)) {
  throw new Error("Use a stable vMAJOR.MINOR.PATCH tag matching package.json, package-lock.json, Cargo.toml and tauri.conf.json.");
}
if (process.argv.includes("--version-only")) {
  console.log(`Release versions match ${tag}.`);
  process.exit(0);
}

const repository = "velumix/VelumCode";
const fileName = `VelumCode_${app.version}_x64-setup.exe`;
const bundleName = `${config.productName}_${app.version}_x64-setup.exe`;
const installer = path.join(root, "src-tauri/target/release/bundle/nsis", bundleName);
const signatureFile = `${installer}.sig`;
const signature = fs.readFileSync(signatureFile, "utf8").trim();
if (!signature || !/^[A-Za-z0-9+/=\r\n]+$/.test(signature)) {
  throw new Error("A signed NSIS installer is required; never publish an unsigned update feed.");
}
const output = path.join(root, "artifacts/release", tag);
fs.mkdirSync(output, { recursive: true });
fs.copyFileSync(installer, path.join(output, fileName));
fs.copyFileSync(signatureFile, path.join(output, `${fileName}.sig`));
const notesFile = path.join(root, "docs/releases", `${app.version}.md`);
const notes = fs.existsSync(notesFile)
  ? fs.readFileSync(notesFile, "utf8").trim()
  : `Velum Code ${app.version}. See the GitHub release for details.`;
const manifest = {
  version: app.version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(fileName)}`,
    },
  },
};
fs.writeFileSync(path.join(output, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
fs.writeFileSync(path.join(output, "release-notes.md"), notes + "\n");
const names = [fileName, `${fileName}.sig`, "latest.json"];
const checksums = names.map((name) => {
  const digest = createHash("sha256").update(fs.readFileSync(path.join(output, name))).digest("hex");
  return `${digest}  ${name}`;
});
fs.writeFileSync(path.join(output, "SHA256SUMS.txt"), checksums.join("\n") + "\n");
console.log(`Prepared signed ${tag} installer, latest.json and SHA-256 checksums in artifacts/release/${tag}.`);
