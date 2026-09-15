#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = path.join(root, "package.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const errors = [];

if (packageJson.private === true) errors.push("package remains private");
if (packageJson.license !== "MIT") errors.push("license must be MIT");
if (packageJson.publishConfig?.access !== "public") errors.push("publishConfig.access must be public");
if (packageJson.publishConfig?.registry !== "https://registry.npmjs.org/") errors.push("registry must be npmjs");
if (packageJson.bin?.[packageJson.name] !== "scripts/install-adapter.mjs") errors.push("package-name npx entry must run installer");

for (const required of ["README.md", "LICENSE", "SKILL.md", "scripts/install-adapter.mjs", "adapters/codex-cli/condiments.SKILL.md"]) {
  try { await access(path.join(root, required)); } catch { errors.push(`missing ${required}`); }
}

const forbidden = ["node_modules/", ".condiments/", ".eval-workspaces/", "evals/results/", "test/"];
for (const entry of packageJson.files ?? []) {
  if (forbidden.some((item) => String(entry).startsWith(item))) errors.push(`files allowlist exposes ${entry}`);
}

if (errors.length) {
  process.stderr.write(`${errors.map((error) => `package check: ${error}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({ name: packageJson.name, version: packageJson.version, public: true, entry: packageJson.bin[packageJson.name] })}\n`);
}
