import path from "node:path";

export const ADAPTER_ORDER = Object.freeze([
  "openclaw",
  "claude-code",
  "codex-cli",
  "cursor",
]);

export const ADAPTERS = Object.freeze({
  openclaw: Object.freeze({
    host: "openclaw",
    installRelative: "skills",
    invocations: Object.freeze(["/cond", "/condiments", "/skill cond", "/skill condiments"]),
    baseDirectoryToken: "{baseDir}",
  }),
  "claude-code": Object.freeze({
    host: "claude-code",
    installRelative: ".claude/skills",
    invocations: Object.freeze(["/cond", "/condiments"]),
    baseDirectoryToken: "${CLAUDE_SKILL_DIR}",
  }),
  "codex-cli": Object.freeze({
    host: "codex-cli",
    installRelative: ".agents/skills",
    invocations: Object.freeze(["$cond", "$condiments"]),
    baseDirectoryToken: ".",
  }),
  cursor: Object.freeze({
    host: "cursor",
    installRelative: ".cursor/skills",
    invocations: Object.freeze(["/cond", "/condiments"]),
    baseDirectoryToken: ".",
  }),
});

export function getAdapter(host) {
  const adapter = ADAPTERS[host];
  if (!adapter) {
    throw new Error(`Unknown host '${host}'. Use ${ADAPTER_ORDER.join(", ")}.`);
  }
  return adapter;
}

export function getInstallPaths(host, targetRoot) {
  const adapter = getAdapter(host);
  const skillsRoot = path.resolve(targetRoot, adapter.installRelative);
  return {
    skillsRoot,
    main: path.join(skillsRoot, "condiments"),
    alias: path.join(skillsRoot, "cond"),
  };
}

