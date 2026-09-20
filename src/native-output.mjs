import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDefaultState, normalizeState, resolveLevels } from "./core.mjs";
import { offloadToolResult } from "./result-envelope.mjs";
import { COMMAND_GUARD_PROFILES } from "./command-guard.mjs";
import { recordToolResult } from "./tool-state.mjs";

const HOSTS = new Set(["openclaw", "claude-code", "codex-cli", "cursor"]);
const LEVELS = new Set(["none", "some", "full"]);
const HOOK_MARKER = "scripts/result-hook.mjs";
const COMMAND_GUARD_MARKER = "scripts/command-guard-hook.mjs";

export const NATIVE_OUTPUT_PROFILES = Object.freeze({
  some: Object.freeze({
    thresholdChars: 80_000,
    previewChars: 2_000,
    maxErrorMatches: 20,
    maxErrorChars: 8_000,
  }),
  full: Object.freeze({
    thresholdChars: 20_000,
    previewChars: 1_000,
    maxErrorMatches: 12,
    maxErrorChars: 4_000,
  }),
});

export async function installNativeOutputHooks(host, targetRoot) {
  assertHost(host);
  const root = path.resolve(targetRoot);

  if (host === "claude-code") {
    const configPath = path.join(root, ".claude", "settings.json");
    await mergeGroupedHooks(configPath, {
      PostToolUse: [groupedHook(".*", ".claude/skills/condiments", host)],
    });
    return { installed: true, supported: true, configPath, scope: "compatible tool outputs" };
  }

  if (host === "cursor") {
    const configPath = path.join(root, ".cursor", "hooks.json");
    await mergeDirectHooks(configPath, {
      postToolUse: [directHook("MCP:.*", ".cursor/skills/condiments", host)],
    });
    return { installed: true, supported: true, configPath, scope: "MCP tool outputs" };
  }

  if (host === "openclaw") {
    const baseline = await captureOpenClawBaseline(root);
    return {
      installed: true,
      supported: true,
      scope: "exec and bash through Tokenjuice middleware",
      baselinePath: baseline.path,
      activation: "applied by /cond when OpenClaw is available",
    };
  }

  if (host === "codex-cli") {
    const configPath = path.join(root, ".codex", "hooks.json");
    await mergeGroupedHooks(configPath, {
      PreToolUse: [groupedCommandGuardHook("^Bash$", ".agents/skills/condiments")],
    });
    return {
      installed: true,
      supported: true,
      configPath,
      scope: "oversized literal whole-file shell reads and tool-heavy round enforcement",
      event: "PreToolUse:Bash",
      limitation: "PostToolUse replacement remains unavailable",
    };
  }

  return {
    installed: false,
    supported: false,
    scope: "observation only",
    reason: "Codex PostToolUse cannot replace native tool output",
  };
}

export async function applyNativeOutputPolicy(host, targetRoot, level) {
  assertHost(host);
  if (!LEVELS.has(level)) throw new Error(`Unknown native output level '${level}'.`);
  const root = path.resolve(targetRoot);
  let detail;

  if (host === "claude-code") {
    detail = {
      applied: true,
      mode: level === "none" ? "pass-through" : "PostToolUse replacement",
      scope: "compatible tool outputs",
      profile: profileFor(level),
    };
  } else if (host === "cursor") {
    detail = {
      applied: true,
      mode: level === "none" ? "pass-through" : "postToolUse replacement",
      scope: "MCP tool outputs",
      profile: profileFor(level),
    };
  } else if (host === "codex-cli") {
    detail = {
      applied: true,
      supported: true,
      mode: level === "none" ? "pass-through" : "PreToolUse large-read and tool-round guard",
      scope: "oversized literal whole-file shell reads and tool-heavy round enforcement",
      profile: level === "none" ? null : COMMAND_GUARD_PROFILES[level],
      limitation: "Codex PostToolUse cannot replace output already produced",
    };
  } else {
    detail = await applyOpenClawTokenjuice(root, level);
  }

  const receipt = {
    version: 1,
    host,
    level,
    appliedAt: new Date().toISOString(),
    detail,
  };
  await atomicWriteJson(path.join(root, ".condiments", "native-output", "last-apply.json"), receipt);
  return receipt;
}

export async function interceptNativeToolOutput(payload, options = {}) {
  const host = options.host;
  assertHost(host);
  const root = path.resolve(options.cwd || payload?.cwd || process.cwd());
  const state = await readState(options.statePath || path.join(root, ".condiments", "state.json"));
  const level = resolveLevels(state).ranch;
  if (level === "none") return { action: "noop", level, output: {} };

  if (host === "codex-cli" || host === "openclaw") {
    return { action: "unsupported-hook", level, output: {} };
  }

  const tool = String(payload?.tool_name || "tool");
  const isCursorMcp = host === "cursor" && /^MCP:/i.test(tool);
  if (host === "cursor" && !isCursorMcp) {
    return { action: "unsupported-tool", level, output: {} };
  }

  const original = extractToolOutput(payload, host);
  if (original === undefined) return { action: "missing-output", level, output: {} };
  const serialized = serializeToolOutput(original);
  const toolState = await captureToolState(root, payload, tool, serialized, original);
  const profile = NATIVE_OUTPUT_PROFILES[level];
  const envelope = await offloadToolResult({
    tool,
    request_summary: summarizeRequest(payload?.tool_input),
    exit_status: exitStatus(original),
    content: serialized,
  }, {
    artifactDirectory: path.join(root, ".condiments", "artifacts"),
    ...profile,
  });

  if (!envelope.truncated) return { action: "pass", level, toolState, output: {} };
  const replacement = replacementFor(original, envelope, {
    allowWholeObject: isCursorMcp || isMcpTool(tool),
    targetChars: profile.thresholdChars,
  });
  if (!replacement.changed) {
    await logEvent(root, { host, level, tool, envelope, action: "archived-unreplaceable", replacementChars: serialized.length });
    return { action: "archived-unreplaceable", level, envelope, toolState, output: {} };
  }

  const output = host === "claude-code"
    ? {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          updatedToolOutput: replacement.value,
        },
      }
    : { updated_mcp_tool_output: asCursorMcpObject(replacement.value, envelope) };
  await logEvent(root, {
    host,
    level,
    tool,
    envelope,
    action: "intercepted",
    replacementChars: JSON.stringify(output).length,
  });
  return { action: "intercepted", level, envelope, toolState, output };
}

async function captureToolState(root, payload, tool, serialized, original) {
  const sessionId = payload?.session_id ?? payload?.sessionId ?? payload?.conversation_id ?? payload?.conversationId;
  const prompt = payload?.user_prompt ?? payload?.userPrompt ?? payload?.prompt ?? payload?.task;
  const turnId = payload?.turn_id ?? payload?.turnId ?? (prompt ? `prompt:${String(prompt)}` : null);
  const toolInput = payload?.tool_input;
  const call = typeof toolInput?.command === "string"
    ? toolInput.command
    : typeof toolInput?.cmd === "string"
      ? toolInput.cmd
      : toolInput === undefined ? tool : `${tool}:${stableJson(toolInput)}`;
  if (!sessionId || !turnId || !call) return { recorded: false, reason: "identity-unavailable" };
  try {
    const result = await recordToolResult(root, {
      sessionId: String(sessionId),
      turnId: String(turnId),
      tool,
      call,
      inputFingerprint: toolInput?.workspace_fingerprint ?? payload?.workspace_fingerprint ?? "",
      exitStatus: exitStatus(original),
      content: serialized,
    });
    return { recorded: true, record: result.record };
  } catch (error) {
    return { recorded: false, reason: error.message };
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function replacementFor(original, envelope, options) {
  const envelopeText = JSON.stringify({ condiments_result_envelope: envelope });
  if (typeof original === "string") {
    return { changed: true, value: envelopeText };
  }

  if (original && typeof original === "object") {
    const clone = structuredClone(original);
    const leaves = [];
    collectStringLeaves(clone, [], leaves);
    leaves.sort((a, b) => b.value.length - a.value.length);
    let first = true;
    for (const leaf of leaves) {
      if (leaf.value.length < 256) continue;
      setAtPath(clone, leaf.path, first
        ? envelopeText
        : `[offloaded ${envelope.content_hash}; artifact ${envelope.artifact_path}]`);
      first = false;
      if (JSON.stringify(clone).length <= options.targetChars) {
        return { changed: true, value: clone };
      }
    }
    if (!first && JSON.stringify(clone).length < serializeToolOutput(original).length) {
      return { changed: true, value: clone };
    }
    if (options.allowWholeObject) {
      return { changed: true, value: { condiments_result_envelope: envelope } };
    }
  }
  return { changed: false, value: original };
}

function collectStringLeaves(value, currentPath, output, depth = 0) {
  if (depth > 12 || value === null || value === undefined) return;
  if (typeof value === "string") {
    output.push({ path: currentPath, value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStringLeaves(item, [...currentPath, index], output, depth + 1));
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      collectStringLeaves(item, [...currentPath, key], output, depth + 1);
    }
  }
}

function setAtPath(root, valuePath, value) {
  if (valuePath.length === 0) return;
  let cursor = root;
  for (const part of valuePath.slice(0, -1)) cursor = cursor[part];
  cursor[valuePath.at(-1)] = value;
}

function extractToolOutput(payload, host) {
  if (host === "claude-code") return payload?.tool_response;
  const raw = payload?.tool_output;
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw); } catch { return raw; }
}

function serializeToolOutput(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function asCursorMcpObject(value, envelope) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : { condiments_result_envelope: envelope };
}

function isMcpTool(tool) {
  return /^mcp(?::|__)/i.test(tool);
}

function summarizeRequest(input) {
  if (input === undefined) return "";
  const text = typeof input === "string" ? input : JSON.stringify(input);
  return text.length <= 500 ? text : `${text.slice(0, 499)}…`;
}

function exitStatus(value) {
  if (!value || typeof value !== "object") return null;
  return value.exitCode ?? value.exit_code ?? value.status ?? value.code ?? null;
}

function profileFor(level) {
  return level === "none" ? null : NATIVE_OUTPUT_PROFILES[level];
}

async function applyOpenClawTokenjuice(root, level) {
  const baseline = await captureOpenClawBaseline(root);
  if (level === "none") {
    if (baseline.value.commandAvailable === false) {
      return { applied: false, pending: false, reason: "OpenClaw unavailable; existing plugin state left unchanged" };
    }
    try {
      if (!baseline.value.installed) {
        const current = await inspectTokenjuice();
        if (current.installed && current.enabled) {
          await runCommand("openclaw", ["plugins", "disable", "tokenjuice"]);
        }
        return {
          applied: true,
          mode: "pass-through",
          enabled: false,
          reason: "Tokenjuice was absent before Condiments; any Condiments-enabled copy is disabled",
        };
      }
      const action = baseline.value.enabled ? "enable" : "disable";
      await runCommand("openclaw", ["plugins", action, "tokenjuice"]);
      return { applied: true, mode: "restored", enabled: baseline.value.enabled };
    } catch (error) {
      return {
        applied: false,
        pending: true,
        reason: error.code === "ENOENT" ? "openclaw command unavailable" : error.message,
      };
    }
  }

  try {
    let inspection = await inspectTokenjuice();
    if (!inspection.installed) {
      await runCommand("openclaw", ["plugins", "install", "clawhub:@openclaw/tokenjuice"]);
      inspection = await inspectTokenjuice();
    }
    if (!inspection.enabled) await runCommand("openclaw", ["plugins", "enable", "tokenjuice"]);
    return {
      applied: true,
      mode: "Tokenjuice middleware",
      scope: "exec and bash",
      profile: level,
    };
  } catch (error) {
    return {
      applied: false,
      pending: true,
      reason: error.code === "ENOENT" ? "openclaw command unavailable" : error.message,
      requiredCommand: "openclaw plugins install clawhub:@openclaw/tokenjuice && openclaw plugins enable tokenjuice",
    };
  }
}

async function captureOpenClawBaseline(root) {
  const baselinePath = path.join(root, ".condiments", "native-output", "openclaw-baseline.json");
  try {
    const existing = JSON.parse(await readFile(baselinePath, "utf8"));
    if (existing.value?.commandAvailable !== false) return { ...existing, path: baselinePath };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  let value;
  try {
    value = { commandAvailable: true, ...await inspectTokenjuice() };
  } catch (error) {
    value = error.code === "ENOENT"
      ? { commandAvailable: false, installed: false, enabled: false }
      : { commandAvailable: true, installed: false, enabled: false };
  }
  const baseline = { version: 1, host: "openclaw", capturedAt: new Date().toISOString(), value };
  await atomicWriteJson(baselinePath, baseline);
  return { ...baseline, path: baselinePath };
}

async function inspectTokenjuice() {
  try {
    const stdout = await runCommand("openclaw", ["plugins", "inspect", "tokenjuice", "--json"]);
    const parsed = JSON.parse(stdout);
    return { installed: true, enabled: findEnabled(parsed) };
  } catch (error) {
    if (error.code === "ENOENT") throw error;
    return { installed: false, enabled: false };
  }
}

function findEnabled(value) {
  if (typeof value?.enabled === "boolean") return value.enabled;
  if (typeof value?.plugin?.enabled === "boolean") return value.plugin.enabled;
  if (typeof value?.entry?.enabled === "boolean") return value.entry.enabled;
  return false;
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString("utf8"));
      else {
        const error = new Error(Buffer.concat(stderr).toString("utf8").trim() || `${command} exited ${code}`);
        error.exitCode = code;
        reject(error);
      }
    });
  });
}

async function mergeGroupedHooks(filePath, additions) {
  const config = await readJson(filePath, {});
  config.hooks = isObject(config.hooks) ? config.hooks : {};
  for (const [event, groups] of Object.entries(additions)) {
    const existing = Array.isArray(config.hooks[event]) ? config.hooks[event] : [];
    config.hooks[event] = [...existing.filter((group) => !containsHook(group)), ...groups];
  }
  await atomicWriteJson(filePath, config);
}

async function mergeDirectHooks(filePath, additions) {
  const config = await readJson(filePath, { version: 1 });
  config.version = config.version ?? 1;
  config.hooks = isObject(config.hooks) ? config.hooks : {};
  for (const [event, hooks] of Object.entries(additions)) {
    const existing = Array.isArray(config.hooks[event]) ? config.hooks[event] : [];
    config.hooks[event] = [...existing.filter((hook) => !containsHook(hook)), ...hooks];
  }
  await atomicWriteJson(filePath, config);
}

function groupedHook(matcher, skillRoot, host) {
  return {
    matcher,
    hooks: [{
      type: "command",
      command: `node \"${skillRoot}/scripts/result-hook.mjs\" --host ${host}`,
      timeout: 10,
      statusMessage: "Compacting oversized tool output",
    }],
  };
}

function groupedCommandGuardHook(matcher, skillRoot) {
  return {
    matcher,
    hooks: [{
      type: "command",
      command: `node "${skillRoot}/scripts/command-guard-hook.mjs"`,
      timeout: 10,
      statusMessage: "Checking large-file output",
    }],
  };
}

function directHook(matcher, skillRoot, host) {
  return {
    matcher,
    command: `node \"${skillRoot}/scripts/result-hook.mjs\" --host ${host}`,
    timeout: 10,
  };
}

function containsHook(value) {
  const serialized = JSON.stringify(value);
  return serialized.includes(HOOK_MARKER) || serialized.includes(COMMAND_GUARD_MARKER);
}

async function logEvent(root, event) {
  const logPath = path.join(root, ".condiments", "native-output", "events.jsonl");
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify({
    version: 1,
    timestamp: new Date().toISOString(),
    host: event.host,
    level: event.level,
    tool: event.tool,
    action: event.action,
    original_chars: event.envelope.original_chars,
    replacement_chars: event.replacementChars,
    content_hash: event.envelope.content_hash,
    artifact_path: event.envelope.artifact_path,
    dictionary_codec: event.envelope.dictionary_compression?.codec ?? null,
    dictionary_saved_bytes: event.envelope.dictionary_compression?.saved_bytes ?? 0,
    dictionary_reduction_rate: event.envelope.dictionary_compression?.reduction_rate ?? null,
  })}\n`, "utf8");
}

async function readState(statePath) {
  try { return normalizeState(JSON.parse(await readFile(statePath, "utf8"))); }
  catch (error) {
    if (error?.code === "ENOENT") return createDefaultState();
    throw error;
  }
}

async function readJson(filePath, fallback) {
  try { return JSON.parse(await readFile(filePath, "utf8")); }
  catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function atomicWriteJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertHost(host) {
  if (!HOSTS.has(host)) throw new Error(`Unknown native-output host '${host}'.`);
}
