import { readFile } from "node:fs/promises";
import path from "node:path";

export const COMPLETION_STRATEGIES = Object.freeze([
  "answer",
  "direct-edit",
  "fim",
  "changed-block",
  "unified-diff",
]);

const EDIT_ACTION = /\b(?:add|change|convert|create|delete|edit|fix|implement|insert|migrate|modify|move|patch|refactor|remove|rename|replace|update|write)\b/i;
const STRONG_EDIT_ACTION = /\b(?:implement|refactor|patch|migrate|rename|delete|remove|insert|replace)\b/i;
const EDIT_TARGET = /(?:^|[\s`'"(])(?:[\w@.-]+[\\/])+[\w@.()-]+|\b(?:file|function|method|class|module|component|test|config|source|codebase|repository)\b|\.(?:c|cc|cpp|cs|css|go|h|html|java|js|json|jsx|md|mjs|php|py|rb|rs|sh|sql|ts|tsx|toml|yaml|yml)\b/i;
const NO_EDIT = /\b(?:do not|don't|dont|without)\s+(?:edit|change|modify|write|apply|touch)\b|\b(?:review|explain|describe|analy[sz]e)\s+(?:only|without editing)\b/i;
const FULL_FILE = /\b(?:full|complete|entire|whole)\s+(?:file|source|contents?)\b|\brewrite\s+(?:the\s+)?(?:file|source)\b/i;

export function detectEditTask(task) {
  const text = String(task ?? "").trim();
  const blocked = NO_EDIT.test(text);
  const action = EDIT_ACTION.test(text);
  const target = EDIT_TARGET.test(text);
  const explicitFullFile = FULL_FILE.test(text);
  const strongAction = STRONG_EDIT_ACTION.test(text);
  const signals = [];
  if (action) signals.push("edit-action");
  if (target) signals.push("edit-target");
  if (blocked) signals.push("no-edit");
  if (explicitFullFile) signals.push("full-file-request");
  return {
    isEdit: !blocked && action && (target || strongAction),
    confidence: !blocked && action && (target || strongAction) ? "high" : !blocked && action ? "medium" : "low",
    explicitFullFile,
    signals,
  };
}

export function resolveCompletionStrategy(options = {}) {
  const task = detectEditTask(options.task);
  const level = normalizeLevel(options.level);
  const capabilities = normalizeCompletionCapabilities(options.capabilities);
  if (level === "none" || !task.isEdit) {
    return result("answer", task, capabilities, "inactive-or-not-edit");
  }
  if (capabilities.directFileEdit) {
    return result("direct-edit", task, capabilities, "host-edit-tool");
  }
  if (capabilities.nativeFimCompletion && hasFimContext(options.fim)) {
    return result("fim", task, capabilities, "native-fim");
  }
  if (options.exactRegion === true) {
    return result("changed-block", task, capabilities, "exact-region");
  }
  if (capabilities.unifiedDiffCompletion) {
    return result("unified-diff", task, capabilities, "portable-patch");
  }
  return result("changed-block", task, capabilities, "minimum-text-fallback");
}

export function normalizeCompletionCapabilities(candidate = {}) {
  return {
    directFileEdit: candidate.directFileEdit === true,
    nativeFimCompletion: candidate.nativeFimCompletion === true,
    unifiedDiffCompletion: candidate.unifiedDiffCompletion !== false,
  };
}

export function createFimEnvelope(options = {}) {
  const prefix = String(options.prefix ?? "");
  const suffix = String(options.suffix ?? "");
  if (!prefix && !suffix) throw new Error("FIM requires a prefix or suffix.");
  return {
    version: 1,
    strategy: "fim",
    path: options.path ? String(options.path) : null,
    prefix,
    suffix,
    instruction: String(options.instruction ?? "Complete only missing middle text."),
  };
}

export function validateCompletionOutput(options = {}) {
  const output = String(options.output ?? "");
  const strategy = COMPLETION_STRATEGIES.includes(options.strategy) ? options.strategy : "answer";
  const requestedFullFile = options.requestedFullFile === true;
  const originals = normalizeOriginals(options.originalFiles);
  const failures = [];

  if (!requestedFullFile) {
    for (const [file, source] of Object.entries(originals)) {
      if (source.length >= 40 && reproducesFullFile(output, source)) {
        failures.push({ code: "full-file-reproduction", file });
      }
    }
  }
  if (strategy === "fim") {
    const prefix = String(options.fim?.prefix ?? "");
    const suffix = String(options.fim?.suffix ?? "");
    if (prefix && output.includes(prefix)) failures.push({ code: "fim-prefix-repeated" });
    if (suffix && output.includes(suffix)) failures.push({ code: "fim-suffix-repeated" });
  }
  if (strategy === "unified-diff" && output.trim() && !isUnifiedDiff(output)) {
    failures.push({ code: "invalid-unified-diff" });
  }
  return { valid: failures.length === 0, failures };
}

export async function verifyFilesExact(root, expectedFiles, unchangedFiles = {}) {
  const expected = normalizeOriginals(expectedFiles);
  const unchanged = normalizeOriginals(unchangedFiles);
  const failures = [];
  for (const [relative, wanted] of Object.entries({ ...expected, ...unchanged })) {
    let actual;
    try {
      actual = await readFile(safePath(root, relative), "utf8");
    } catch (error) {
      failures.push({ file: relative, code: "read-failed", detail: error.code ?? error.message });
      continue;
    }
    if (actual !== wanted) failures.push({ file: relative, code: expected[relative] === undefined ? "unchanged-file-modified" : "content-mismatch" });
  }
  return {
    valid: failures.length === 0,
    checked: Object.keys(expected).length + Object.keys(unchanged).length,
    failures,
  };
}

function result(strategy, task, capabilities, reason) {
  return {
    version: 1,
    editTask: task.isEdit,
    explicitFullFile: task.explicitFullFile,
    strategy,
    reason,
    capabilities,
  };
}

function normalizeLevel(value) {
  const level = String(value ?? "full").toLowerCase();
  if (!["none", "some", "full"].includes(level)) throw new Error(`Unknown completion level '${value}'.`);
  return level;
}

function hasFimContext(value) {
  return Boolean(value && typeof value === "object" && (String(value.prefix ?? "") || String(value.suffix ?? "")));
}

function normalizeOriginals(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([file, source]) => [file, String(source)]));
}

function reproducesFullFile(output, source) {
  const normalizedOutput = normalizeText(output);
  const normalizedSource = normalizeText(source);
  if (!normalizedSource || normalizedOutput === normalizedSource) return normalizedOutput === normalizedSource;
  return normalizedOutput.includes(normalizedSource);
}

function normalizeText(value) {
  return String(value).replace(/\r\n/g, "\n").trim();
}

function isUnifiedDiff(value) {
  const text = String(value);
  return /(?:^|\n)---\s+\S+/.test(text) && /(?:^|\n)\+\+\+\s+\S+/.test(text) && /(?:^|\n)@@/.test(text);
}

function safePath(root, relative) {
  const base = path.resolve(root);
  const candidate = path.resolve(base, relative);
  const relation = path.relative(base, candidate);
  if (!relation || relation.startsWith("..") || path.isAbsolute(relation)) throw new Error(`Unsafe file path '${relative}'.`);
  return candidate;
}
