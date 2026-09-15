import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createDefaultState, normalizeState, resolveLevels } from "./core.mjs";

export const COMMAND_GUARD_PROFILES = Object.freeze({
  some: Object.freeze({ thresholdBytes: 320_000, previewLines: 400 }),
  full: Object.freeze({ thresholdBytes: 80_000, previewLines: 200 }),
});

const BYPASS_MARKER = "condiments:allow-large-output";
const BOUNDED_PATTERNS = Object.freeze([
  /\b(?:rg|grep|select-string)\b/i,
  /\b(?:head|tail)\b/i,
  /\bsed\s+-n\b/i,
  /\bget-content\b[^|;]*(?:-totalcount|-tail)\b/i,
  /\bselect-object\s+-(?:first|last)\b/i,
  /\bmeasure-object\b/i,
  /(?:^|\s)(?:>|>>|\d?>)\s*[^&|]+$/,
]);

export async function guardCodexCommand(payload, options = {}) {
  const root = path.resolve(options.cwd || payload?.cwd || process.cwd());
  const state = await readState(options.statePath || path.join(root, ".condiments", "state.json"));
  const level = resolveLevels(state).ranch;
  if (level === "none") return { action: "noop", level, output: {} };
  if (String(payload?.tool_name ?? "") !== "Bash") {
    return { action: "unsupported-tool", level, output: {} };
  }

  const command = extractCommand(payload?.tool_input);
  if (!command) return { action: "missing-command", level, output: {} };
  const analysis = await analyzeFileRead(command, {
    cwd: root,
    ...COMMAND_GUARD_PROFILES[level],
  });
  if (!analysis.risky) return { action: analysis.action, level, analysis, output: {} };

  const reason = buildBlockReason(analysis);
  await logBlock(root, { level, command, analysis });
  return {
    action: "blocked",
    level,
    analysis,
    output: {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    },
  };
}

export async function analyzeFileRead(command, options = {}) {
  const text = String(command ?? "").trim();
  const thresholdBytes = positiveInteger(options.thresholdBytes ?? 80_000, "thresholdBytes");
  const previewLines = positiveInteger(options.previewLines ?? 200, "previewLines");
  if (!text) return base("empty", thresholdBytes, previewLines);
  if (text.toLowerCase().includes(BYPASS_MARKER)) return base("explicit-bypass", thresholdBytes, previewLines);
  if (!hasWholeFileReader(text)) return base("not-file-reader", thresholdBytes, previewLines);
  if (BOUNDED_PATTERNS.some((pattern) => pattern.test(text))) return base("already-bounded", thresholdBytes, previewLines);

  const tokens = shellTokens(text);
  const literals = unique(tokens.flatMap(splitPathToken).filter(isLiteralCandidate));
  const files = [];
  for (const literal of literals) {
    const filePath = path.isAbsolute(literal) ? path.normalize(literal) : path.resolve(options.cwd || process.cwd(), literal);
    try {
      const details = await stat(filePath);
      if (details.isFile()) files.push({ path: filePath, bytes: details.size });
    } catch {
      // Non-path command tokens and missing paths are irrelevant to literal-size checks.
    }
  }
  const totalBytes = files.reduce((total, file) => total + file.bytes, 0);
  const wildcard = tokens.find((token) => /[*?\[]/.test(token) && !token.startsWith("-")) ?? null;
  const risky = totalBytes > thresholdBytes || Boolean(wildcard);
  const primary = files.sort((left, right) => right.bytes - left.bytes)[0] ?? null;
  return {
    action: risky ? "unbounded-large-read" : "below-threshold",
    risky,
    thresholdBytes,
    previewLines,
    totalBytes,
    files,
    wildcard,
    suggestedCommand: risky ? boundedSuggestion(text, primary?.path ?? wildcard, previewLines, thresholdBytes) : null,
    searchCommand: risky ? searchSuggestion(text, primary?.path ?? wildcard) : null,
  };
}

function buildBlockReason(analysis) {
  const target = analysis.files[0]
    ? `${displayPath(analysis.files[0].path)} (${analysis.files[0].bytes} bytes)`
    : `wildcard ${analysis.wildcard}`;
  return [
    `Condiments blocked unbounded large-file read: ${target}; limit ${analysis.thresholdBytes} bytes.`,
    `Retry bounded: ${analysis.suggestedCommand}`,
    `For exact evidence: ${analysis.searchCommand}`,
    `Override only when full output is required: add comment '${BYPASS_MARKER}'.`,
  ].join(" ");
}

function boundedSuggestion(command, filePath, lines, thresholdBytes) {
  const target = String(filePath ?? "<path>");
  const isLog = /\.(?:log|out|trace|txt)$/i.test(target);
  if (/\bget-content\b/i.test(command) || process.platform === "win32") {
    const quoted = powershellQuote(target);
    return isLog
      ? `Get-Content -LiteralPath ${quoted} -Tail ${lines}`
      : `Get-Content -LiteralPath ${quoted} -TotalCount ${lines}`;
  }
  const quoted = posixQuote(target);
  return isLog
    ? `tail -n ${lines} -- ${quoted} | head -c ${thresholdBytes}`
    : `head -n ${lines} -- ${quoted} | head -c ${thresholdBytes}`;
}

function searchSuggestion(command, filePath) {
  const target = String(filePath ?? "<path>");
  const quoted = /\bget-content\b/i.test(command) || process.platform === "win32"
    ? powershellQuote(target)
    : posixQuote(target);
  return `rg -n '<pattern>' -- ${quoted}`;
}

function hasWholeFileReader(command) {
  return /\bget-content\b/i.test(command)
    || /(?:^|[;&|]\s*|\s)(?:gc|cat|type)\s+(?!-)/i.test(command);
}

function shellTokens(command) {
  return command.match(/"(?:[^"`]|`.)*"|'(?:[^']|'')*'|[^\s|;]+/g)?.map(unquote) ?? [];
}

function splitPathToken(token) {
  return String(token).split(",").map((part) => part.trim()).filter(Boolean);
}

function isLiteralCandidate(token) {
  if (!token || token.startsWith("-") || token.startsWith("$")) return false;
  if (/^(?:get-content|gc|cat|type|cmd(?:\.exe)?|powershell|pwsh|\/c)$/i.test(token)) return false;
  if (/^[a-z]+:\/\//i.test(token) || /[<>`]/.test(token)) return false;
  return true;
}

function unquote(value) {
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).replace(/`(["`$])/g, "$1");
  return value;
}

function extractCommand(input) {
  if (typeof input?.command === "string") return input.command;
  if (typeof input?.cmd === "string") return input.cmd;
  return "";
}

function base(action, thresholdBytes, previewLines) {
  return { action, risky: false, thresholdBytes, previewLines, totalBytes: 0, files: [], wildcard: null, suggestedCommand: null, searchCommand: null };
}

function powershellQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function posixQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function displayPath(value) {
  return String(value).replaceAll("\\", "/");
}

function unique(values) {
  return [...new Set(values)];
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

async function readState(statePath) {
  try { return normalizeState(JSON.parse(await readFile(statePath, "utf8"))); }
  catch (error) {
    if (error?.code === "ENOENT") return createDefaultState();
    throw error;
  }
}

async function logBlock(root, event) {
  const logPath = path.join(root, ".condiments", "command-guard", "events.jsonl");
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify({
    version: 1,
    timestamp: new Date().toISOString(),
    level: event.level,
    action: "blocked",
    command_hash: createHash("sha256").update(event.command).digest("hex"),
    threshold_bytes: event.analysis.thresholdBytes,
    total_bytes: event.analysis.totalBytes,
    files: event.analysis.files.map((file) => ({ path: displayPath(file.path), bytes: file.bytes })),
    wildcard: event.analysis.wildcard,
  })}\n`, "utf8");
}
