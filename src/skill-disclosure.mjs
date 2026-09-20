import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const DISCLOSURE_CONTROLS = Object.freeze(["mayo", "mustard", "ketchup", "ranch", "hot"]);
export const DISCLOSURE_HOSTS = Object.freeze(["openclaw", "claude-code", "codex-cli", "cursor"]);
export const SKILL_ENTRYPOINT_MAX_BYTES = 5_000;

const CORE_MODULES = Object.freeze([
  "references/policy-core.md",
  "references/policy-protocol.md",
  "references/savings-policy.md",
]);

export function selectSkillModules(options = {}) {
  const host = normalizeHost(options.host, true);
  const controls = normalizeControls(options.controls);
  const modules = [...CORE_MODULES];
  if (host) modules.push(`references/hosts/${host}.md`);
  for (const control of DISCLOSURE_CONTROLS) {
    if (controls[control] !== "none") modules.push(`references/controls/${control}.md`);
  }
  return {
    version: 1,
    host,
    controls,
    modules: [...new Set(modules)],
  };
}

export async function compileSkillSlice(root, options = {}) {
  const base = path.resolve(root);
  const plan = selectSkillModules(options);
  const parts = [];
  let bytes = 0;
  for (const relativePath of plan.modules) {
    const absolutePath = path.join(base, relativePath);
    const content = (await readFile(absolutePath, "utf8")).trim();
    bytes += Buffer.byteLength(content, "utf8");
    parts.push(`<!-- condiments-module:${relativePath} -->\n${content}`);
  }
  const content = `${parts.join("\n\n")}\n`;
  return {
    ...plan,
    bytes,
    estimatedTokens: Math.ceil(content.length / 4),
    sha256: createHash("sha256").update(content).digest("hex"),
    content,
  };
}

export async function auditSkillDisclosure(root) {
  const base = path.resolve(root);
  const errors = [];
  const checkedModules = new Set();
  for (const host of DISCLOSURE_HOSTS) {
    const plan = selectSkillModules({ host, controls: Object.fromEntries(DISCLOSURE_CONTROLS.map((control) => [control, "full"])) });
    for (const relativePath of plan.modules) checkedModules.add(relativePath);
  }
  for (const relativePath of checkedModules) {
    try {
      const details = await stat(path.join(base, relativePath));
      if (!details.isFile()) errors.push(`${relativePath} is not a file`);
    } catch (error) {
      if (error?.code === "ENOENT") errors.push(`missing ${relativePath}`);
      else throw error;
    }
  }

  const entrypoints = ["SKILL.md", ...DISCLOSURE_HOSTS.map((host) => `adapters/${host}/condiments.SKILL.md`)];
  const sizes = {};
  for (const relativePath of entrypoints) {
    const absolutePath = path.join(base, relativePath);
    try {
      const content = await readFile(absolutePath, "utf8");
      const bytes = Buffer.byteLength(content, "utf8");
      sizes[relativePath] = bytes;
      if (bytes > SKILL_ENTRYPOINT_MAX_BYTES) errors.push(`${relativePath} exceeds ${SKILL_ENTRYPOINT_MAX_BYTES} bytes`);
      if (/read (?:\[[^\]]+\]\()?references\/policy\.md/i.test(content)) {
        errors.push(`${relativePath} eagerly loads legacy references/policy.md`);
      }
    } catch (error) {
      if (error?.code === "ENOENT") errors.push(`missing ${relativePath}`);
      else throw error;
    }
  }
  return { valid: errors.length === 0, errors, entrypointBytes: sizes, modules: [...checkedModules].sort() };
}

function normalizeControls(value) {
  const controls = Object.fromEntries(DISCLOSURE_CONTROLS.map((control) => [control, "none"]));
  if (typeof value === "string") {
    for (const name of value.split(",").map((item) => item.trim()).filter(Boolean)) {
      if (!DISCLOSURE_CONTROLS.includes(name)) throw new Error(`Unknown disclosure control '${name}'.`);
      controls[name] = "full";
    }
    return controls;
  }
  for (const control of DISCLOSURE_CONTROLS) {
    const level = String(value?.[control] ?? "none").toLowerCase();
    if (!["none", "some", "full"].includes(level)) throw new Error(`Unknown level '${value?.[control]}' for ${control}.`);
    controls[control] = level;
  }
  return controls;
}

function normalizeHost(value, optional = false) {
  if ((value === undefined || value === null || value === "") && optional) return null;
  const host = String(value).trim().toLowerCase();
  if (!DISCLOSURE_HOSTS.includes(host)) throw new Error(`Unknown disclosure host '${value}'.`);
  return host;
}
