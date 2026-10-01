import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const release = process.argv.includes("--release");
const read = (name) => fs.readFileSync(path.join(root, name));
const json = (name) => JSON.parse(read(name).toString("utf8").replace(/^\uFEFF/, ""));
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const errors = [];
const requireThat = (condition, message) => { if (!condition) errors.push(message); };
const publisher = json("legal/publisher.json");
const inventory = json("legal/dependencies.json");
const android = json("legal/android-dependencies.json");
const config = json("src-tauri/tauri.conf.json");
requireThat(inventory.appVersion === json("package.json").version, "Regenerate notices for the current app version.");
requireThat(publisher.reviewedAppVersion === json("package.json").version, "Review privacy/terms for the current app version.");
for (const model of [inventory, android]) {
  for (const [file, hash] of Object.entries(model.inputs)) {
    requireThat(sha(read(file).toString("utf8").replace(/\r\n/g, "\n")) === hash, `Stale dependency inventory input: ${file}`);
  }
  requireThat(model.packages.length > 0, "Empty dependency inventory.");
  requireThat(model.packages.every((p) => p.license && p.notices?.length), "A dependency lacks license notices.");
}
const notices = read("THIRD_PARTY_NOTICES.txt").toString("utf8");
const androidNotices = read("android/app/src/main/assets/third-party-notices.txt").toString("utf8");
for (const [model, text] of [[inventory, notices], [android, androidNotices]]) {
  for (const pkg of model.packages) for (const n of pkg.notices) {
    requireThat(text.includes(`TEXT ${n.sha256}`), `Notice missing for ${pkg.name}: ${n.sha256}`);
  }
}
for (const source of inventory.coveredSources) {
  requireThat(sha(read(source.path)) === source.sha256, `Covered-source archive changed: ${source.path}`);
  requireThat(config.bundle.resources[`../${source.path}`] === source.path, `Installer does not bundle ${source.path}`);
}
for (const pkg of inventory.packages) for (const item of pkg.additionalMaterials ?? []) {
  requireThat(sha(read(item.path)) === item.sha256, `Copyright report changed: ${item.path}`);
  requireThat(config.bundle.resources[`../${item.path}`] === item.path, `Installer lacks ${item.path}`);
}
for (const name of ["THIRD_PARTY_NOTICES.txt", "LEGAL.md", "TERMS.md", "PRIVACY.md", "SECURITY.md"]) {
  requireThat(config.bundle.resources[`../${name}`] === `legal/${name}`, `Installer lacks ${name}`);
}

const documents = ["README.md", "LEGAL.md", "TERMS.md", "PRIVACY.md", "SECURITY.md", "CONTRIBUTING.md",
  ...fs.readdirSync(path.join(root, "docs")).filter((n) => n.endsWith(".md")).map((n) => `docs/${n}`),
  "legal/covered-sources/README.md"];
for (const name of documents) {
  const body = read(name).toString("utf8");
  // Local file links only. External URLs and page anchors are not fetched.
  for (const match of body.matchAll(/\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1].replace(/^<|>$/g, "").split("#")[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    requireThat(fs.existsSync(path.resolve(root, path.dirname(name), decodeURIComponent(target))), `Broken local link in ${name}: ${target}`);
  }
}

if (release) {
  requireThat(publisher.status === "final", "Publisher/legal documents are still drafts.");
  for (const key of ["effectiveDate", "publisherLegalName", "publisherCountryAndState", "legalContactEmail",
    "privacyContactEmail", "securityContactEmail", "projectLicense", "sdkLicense", "liabilityCapAndCurrency",
    "governingLawAndVenue", "supportRetentionPolicy"]) {
    requireThat(typeof publisher[key] === "string" && publisher[key].trim().length > 0, `Complete publisher field: ${key}`);
  }
  for (const key of ["legalContactEmail", "privacyContactEmail", "securityContactEmail"]) {
    requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(publisher[key]), `Provide a monitored public email: ${key}`);
  }
  requireThat(/^\d{4}-\d{2}-\d{2}$/.test(publisher.effectiveDate), "Use an ISO effective date.");
  requireThat(["open-source", "proprietary", "freemium"].includes(publisher.distributionModel), "Choose a distribution model.");
  for (const key of ["ownerApproved", "legalReviewCompleted", "acceptanceImplemented",
    "androidDependenciesReviewed", "installerComponentsReviewed"]) {
    requireThat(publisher[key] === true, `Release review incomplete: ${key}`);
  }
  for (const file of ["LEGAL.md", "TERMS.md", "PRIVACY.md", "SECURITY.md"]) {
    const body = read(file).toString("utf8");
    requireThat(!/\[[A-Z][A-Z_]+\]|DRAFT FOR OWNER|Status: drafts|Private contact pending/i.test(body), `Finalize draft text in ${file}`);
  }
  for (const file of ["LICENSE", "packages/plugin-sdk/LICENSE"]) {
    requireThat(fs.existsSync(path.join(root, file)), `Publish the approved license: ${file}`);
  }
}

if (errors.length) {
  console.error(`${release ? "PUBLIC RELEASE NOT READY" : "LEGAL DOCUMENTATION CHECK FAILED"}\n` +
    [...new Set(errors)].map((e) => `- ${e}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Legal documentation files, local links, dependency inputs, notice references and source archives are consistent. Status: ${publisher.status}.`);
  if (!release) console.log("This check does not establish enforceability, user acceptance, or legal clearance. Use legal:release after owner/legal review.");
}
