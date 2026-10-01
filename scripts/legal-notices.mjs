import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const target = "x86_64-pc-windows-msvc";
const read = (file) => fs.readFileSync(path.join(root, file));
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const inputHash = (file) => hash(read(file).toString("utf8").replace(/\r\n/g, "\n"));
const json = (file) => JSON.parse(read(file).toString("utf8").replace(/^\uFEFF/, ""));
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const upstream = json("legal/upstream.json");
const lock = json("package-lock.json");
const app = json("package.json");
const cargoLock = read("src-tauri/Cargo.lock").toString("utf8").split("[[package]]").slice(1);

function within(base, relative) {
  const result = path.resolve(base, relative);
  const part = path.relative(base, result);
  if (part.startsWith("..") || path.isAbsolute(part)) throw new Error(`Path escapes base: ${relative}`);
  return result;
}

const metadata = JSON.parse(execFileSync("cargo", [
  "metadata", "--locked", "--offline", "--format-version", "1",
  "--filter-platform", target, "--manifest-path", "src-tauri/Cargo.toml",
], { cwd: root, windowsHide: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
const nodes = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
const reached = new Set();
function visit(id) {
  if (reached.has(id)) return;
  reached.add(id);
  for (const dep of nodes.get(id)?.deps ?? []) {
    if (dep.dep_kinds.some((k) => k.kind !== "dev")) visit(dep.pkg);
  }
}
visit(metadata.resolve.root);

const noticeTexts = new Map();
function notice(file, label, sourceUrl = "", encoding = "utf-8") {
  const bytes = fs.readFileSync(file);
  // Do not silently damage copyright symbols or other attribution text.
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  if (!text.trim() || bytes.length > 4 * 1024 * 1024) throw new Error(`Invalid notice: ${label}`);
  const sha256 = hash(bytes);
  noticeTexts.set(sha256, text);
  return { path: label, sha256, ...(sourceUrl ? { sourceUrl } : {}),
    ...(encoding !== "utf-8" ? { encoding } : {}) };
}

const isNotice = (name) => /^(licen[cs]e|copying|copyright|notice)([._-]|$)/i.test(name);
function packageNotices(base) {
  const files = [];
  function scan(directory, depth = 0, licenseDirectory = false) {
    if (depth > 8) throw new Error(`Notice scan exceeded depth in ${path.basename(base)}`);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory() && ![".git", "node_modules", "target"].includes(entry.name)) {
        scan(full, depth + 1, licenseDirectory || /^licenses?$/i.test(entry.name));
      } else if (entry.isFile() && (isNotice(entry.name) || (licenseDirectory && /\.(txt|md)$/i.test(entry.name)))) {
        files.push(notice(full, path.relative(base, full).split(path.sep).join("/")));
      }
    }
  }
  scan(base);
  return files.sort((a, b) => compare(a.path, b.path));
}

function pinnedNotices(files) {
  return files.map((item) => {
    const full = within(root, item.path);
    if (hash(fs.readFileSync(full)) !== item.sha256) throw new Error(`Pinned notice changed: ${item.path}`);
    return notice(full, item.path, item.sourceUrl, item.encoding);
  });
}

const packages = [];
for (const [installed, pkg] of Object.entries(lock.packages)) {
  if (!installed.startsWith("node_modules/") || pkg.dev || pkg.link) continue;
  const base = within(root, installed);
  const actual = JSON.parse(fs.readFileSync(path.join(base, "package.json"), "utf8"));
  if (actual.version !== pkg.version) throw new Error(`Run npm ci: stale ${installed}`);
  const notices = packageNotices(base);
  if (!notices.length || !pkg.license) throw new Error(`Missing npm notice/license: ${installed}`);
  packages.push({ ecosystem: "npm", name: actual.name, version: pkg.version,
    license: pkg.license, sourceUrl: pkg.resolved, integrity: pkg.integrity,
    installPath: installed, notices });
}

const rust = metadata.packages.filter((p) => reached.has(p.id) && p.source);
for (const pkg of rust) {
  const base = path.dirname(pkg.manifest_path);
  let notices = packageNotices(base);
  const override = upstream.rustOverrides.find((p) => p.name === pkg.name && p.version === pkg.version);
  if (override) notices = [...notices, ...pinnedNotices(override.files)];
  if (!notices.length || !pkg.license) throw new Error(`Missing Rust notice/license: ${pkg.name}@${pkg.version}`);
  const block = cargoLock.find((b) => b.match(/^name = "([^"]+)"/m)?.[1] === pkg.name
    && b.match(/^version = "([^"]+)"/m)?.[1] === pkg.version);
  const checksum = block?.match(/^checksum = "([a-f0-9]{64})"/m)?.[1];
  if (!checksum) throw new Error(`No locked checksum: ${pkg.name}@${pkg.version}`);
  packages.push({ ecosystem: "cargo", name: pkg.name, version: pkg.version,
    license: pkg.license, repository: pkg.repository, checksum,
    sourceUrl: `https://crates.io/api/v1/crates/${pkg.name}/${pkg.version}/download`,
    ...(override ? { noticeOverrideReason: override.reason } : {}), notices });
}

for (const extra of upstream.extras) {
  if (extra.toolchainVerification) {
    const v = extra.toolchainVerification;
    const channel = read(v.file).toString("utf8").match(/^channel\s*=\s*"([^"]+)"/m)?.[1];
    if (channel !== v.channel) throw new Error(`Review ${extra.name}: toolchain version changed`);
  }
  if (extra.binaryVerification) {
    const v = extra.binaryVerification;
    const pkg = rust.find((p) => p.name === v.crate && p.version === v.version);
    if (!pkg || hash(fs.readFileSync(within(path.dirname(pkg.manifest_path), v.path))) !== v.sha256) {
      throw new Error(`Review ${extra.name}: loader version/hash changed`);
    }
  }
  packages.push({ ecosystem: extra.ecosystem, name: extra.name, version: extra.version,
    license: extra.license, repository: extra.repository, notices: pinnedNotices(extra.files),
    ...(extra.additionalMaterials ? { additionalMaterials: extra.additionalMaterials.map((item) => {
      if (hash(read(item.path)) !== item.sha256) throw new Error(`Pinned copyright report changed: ${item.path}`);
      return item;
    }) } : {}) });
}

const tauri = json("src-tauri/tauri.conf.json");
const nsis = upstream.extras.find((p) => p.name === "NSIS");
if (process.platform === "win32") {
  const compiler = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "tauri", "NSIS", "makensis.exe");
  if (compiler && fs.existsSync(compiler)) {
    const version = execFileSync(compiler, ["/VERSION"], { windowsHide: true, encoding: "utf8" }).trim();
    if (version !== `v${nsis.version}`) throw new Error(`Review NSIS ${version}: source archive/notices are for ${nsis.version}`);
  }
}
if (tauri.bundle.windows.nsis.compression !== "lzma") throw new Error("Review installer licensing after compression changes");

for (const source of upstream.coveredSources) {
  const full = within(root, source.path);
  if (hash(fs.readFileSync(full)) !== source.sha256) throw new Error(`Covered source changed: ${source.path}`);
  if (source.name !== "NSIS") {
    const pkg = packages.find((p) => p.ecosystem === "cargo" && p.name === source.name && p.version === source.version);
    if (!pkg || pkg.checksum !== source.sha256) throw new Error(`Covered source differs from Cargo.lock: ${source.name}`);
  }
}
for (const pkg of packages.filter((p) => p.ecosystem === "cargo" && p.license.includes("MPL"))) {
  if (!upstream.coveredSources.some((s) => s.name === pkg.name && s.version === pkg.version)) {
    throw new Error(`Missing MPL covered-source archive: ${pkg.name}@${pkg.version}`);
  }
}

packages.sort((a, b) => compare(`${a.ecosystem}/${a.name}/${a.version}/${a.installPath ?? ""}`,
  `${b.ecosystem}/${b.name}/${b.version}/${b.installPath ?? ""}`));
const scope = "Conservative Windows x64 inventory: installed npm non-dev packages; Cargo normal and build dependency closure (including host/procedural-macro tools); pinned NSIS, WebView2 SDK and Rust standard-library notices. Not a byte-level binary SBOM. Android has its own inventory. External provider CLIs, Tailscale, ADB and the separately installed WebView2 Runtime are not included as Velum-bundled packages.";
const inventory = {
  schemaVersion: 1, appVersion: app.version, target, scope,
  inputNormalization: "UTF-8 text with LF line endings; upstream notice/archive hashes use original bytes",
  inputs: { "package-lock.json": inputHash("package-lock.json"),
    "src-tauri/Cargo.lock": inputHash("src-tauri/Cargo.lock"),
    "rust-toolchain.toml": inputHash("rust-toolchain.toml"),
    "legal/upstream.json": inputHash("legal/upstream.json") },
  packages, coveredSources: upstream.coveredSources,
};
let text = `Velum Code ${app.version} — third-party software notices\n\n${scope}\n\nThese notices preserve upstream permissions and disclaimers. They do not grant a license to Velum-owned source or replace each component's license. Any additional promise or term offered by Velum's publisher is offered by that publisher alone.\n\nSOURCE AVAILABILITY\n\nUnmodified MPL-2.0 covered source and NSIS 3.11 source (including its CPL-1.0 LZMA component) accompany this distribution in legal/covered-sources. Original source headers are retained. The inventory records archive SHA-256 hashes and upstream download locations. The source files and their respective licenses remain available to you under those licenses. Obtain the accompanying archives directly from that folder, including when the app is distributed in object-code form. See legal/covered-sources/README.md for extraction instructions.\n\nTo the extent permitted by applicable law, upstream NSIS contributors disclaim all warranties and conditions, including title, non-infringement, merchantability and fitness, and all liability for direct, indirect, special, incidental and consequential damages, including lost profits. Any terms differing from the Common Public License are offered by Velum's publisher alone. Mandatory rights and component licenses remain applicable.\n\nPACKAGE INDEX\n\n`;
for (const pkg of packages) {
  text += `${pkg.ecosystem}: ${pkg.name} ${pkg.version}\nLicense metadata: ${pkg.license}\n`;
  if (pkg.repository || pkg.sourceUrl) text += `Upstream: ${pkg.repository || pkg.sourceUrl}\n`;
  if (pkg.noticeOverrideReason) text += `Notice provenance: ${pkg.noticeOverrideReason}\n`;
  for (const n of pkg.notices) text += `  ${n.path}: TEXT ${n.sha256}${n.sourceUrl ? ` (${n.sourceUrl})` : ""}\n`;
  for (const n of pkg.additionalMaterials ?? []) text += `  Additional copyright/license report: ${n.path} (SHA-256 ${n.sha256}; provided in its original format)\n`;
  text += "\n";
}
text += "LICENSE AND NOTICE TEXTS\n\nIdentical texts are reproduced once and referenced by their full SHA-256 in the index above.\n\n";
for (const [sha256, body] of [...noticeTexts.entries()].sort(([a], [b]) => compare(a, b))) {
  text += `===============================================================================\nTEXT ${sha256}\n===============================================================================\n${body}${body.endsWith("\n") ? "" : "\n"}\n`;
}

function output(file, value) {
  if (check) {
    if (!fs.existsSync(path.join(root, file)) || !read(file).equals(Buffer.from(value))) {
      throw new Error(`Stale generated file: ${file}. Run npm run legal:notices.`);
    }
  } else fs.writeFileSync(path.join(root, file), value);
}
output("legal/dependencies.json", JSON.stringify(inventory, null, 2) + "\n");
output("THIRD_PARTY_NOTICES.txt", text);
console.log(`${check ? "Verified" : "Generated"} notices: ${packages.filter((p) => p.ecosystem === "npm").length} npm, ${rust.length} Rust, ${upstream.extras.length} additional components; ${noticeTexts.size} distinct texts, ${upstream.coveredSources.length} source archives.`);
