import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  appendFile,
  copyFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { generateCheckpoint, renderCheckpoint } from "./checkpoint.mjs";
import { createDefaultState, normalizeState, resolveLevels } from "./core.mjs";
import {
  commitReversibleMemory,
  inspectReversibleMemory,
  renderReversibleMemoryReference,
} from "./reversible-memory.mjs";

const HOSTS = new Set(["openclaw", "claude-code", "codex-cli", "cursor"]);
const LEVELS = new Set(["none", "some", "full"]);
const HOOK_MARKER = "scripts/context-hook.mjs";

export async function installNativeContextHooks(host, targetRoot) {
  assertHost(host);
  const root = path.resolve(targetRoot);
  await captureBaseline(host, root);

  if (host === "claude-code") {
    const configPath = path.join(root, ".claude", "settings.json");
    await mergeGroupedHooks(configPath, {
      PreCompact: [groupedHook("manual|auto", ".claude/skills/condiments", host, "pre-compact")],
      SessionStart: [groupedHook("compact", ".claude/skills/condiments", host, "restore")],
    });
    return { installed: true, configPath, events: ["PreCompact", "SessionStart:compact"] };
  }

  if (host === "codex-cli") {
    const hooksPath = path.join(root, ".codex", "hooks.json");
    const configPath = path.join(root, ".codex", "config.toml");
    await mergeGroupedHooks(hooksPath, {
      PreCompact: [groupedHook("manual|auto", ".agents/skills/condiments", host, "pre-compact")],
      PostCompact: [groupedHook("manual|auto", ".agents/skills/condiments", host, "post-compact")],
      SessionStart: [groupedHook("compact", ".agents/skills/condiments", host, "restore")],
    });
    await upsertTomlKey(configPath, "features", "hooks", "true");
    return { installed: true, configPath, hooksPath, events: ["PreCompact", "PostCompact", "SessionStart:compact"] };
  }

  if (host === "cursor") {
    const configPath = path.join(root, ".cursor", "hooks.json");
    await mergeDirectHooks(configPath, {
      preCompact: [directHook(".cursor/skills/condiments", host, "pre-compact")],
      sessionStart: [directHook(".cursor/skills/condiments", host, "restore")],
    });
    return { installed: true, configPath, events: ["preCompact", "sessionStart"] };
  }

  const patchPath = path.join(root, ".condiments", "native-context", "openclaw.patch.json");
  await atomicWriteJson(patchPath, openClawPatch("some"));
  return {
    installed: true,
    configPath: patchPath,
    events: ["native contextPruning", "native compaction"],
    note: "Applied by /cond through the OpenClaw owner CLI when available.",
  };
}

export async function applyNativeContextPolicy(host, targetRoot, level) {
  assertHost(host);
  if (!LEVELS.has(level)) throw new Error(`Unknown native context level '${level}'.`);
  const root = path.resolve(targetRoot);
  const baseline = await captureBaseline(host, root);
  let detail;

  if (host === "claude-code") {
    const configPath = path.join(root, ".claude", "settings.json");
    const settings = await readJson(configPath, {});
    settings.env = isObject(settings.env) ? settings.env : {};
    if (level === "none") restoreJsonKey(settings.env, "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE", baseline.value);
    else settings.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = level === "full" ? "70" : "85";
    if (Object.keys(settings.env).length === 0) delete settings.env;
    await atomicWriteJson(configPath, settings);
    detail = { configPath, autoCompactPercent: level === "none" ? baseline.value.value ?? null : Number(settings.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE) };
  } else if (host === "codex-cli") {
    const configPath = path.join(root, ".codex", "config.toml");
    const captured = normalizeCodexBaseline(baseline.value);
    if (level === "none") {
      await restoreTomlKey(configPath, "features", "context_management", captured.contextManagement);
      await restoreTopLevelTomlKey(configPath, "model_auto_compact_token_limit_scope", captured.autoCompactScope);
    } else {
      await upsertTomlKey(configPath, "features", "context_management", "true");
      await upsertTopLevelTomlKey(configPath, "model_auto_compact_token_limit_scope", '"body_after_prefix"');
    }
    detail = {
      configPath,
      contextManagement: level === "none" ? captured.contextManagement.value ?? null : true,
      autoCompactScope: level === "none" ? captured.autoCompactScope.value ?? null : "body_after_prefix",
      appliesOn: "next Codex session",
    };
  } else if (host === "openclaw") {
    if (level === "none" && baseline.value?.available === false) {
      detail = { applied: false, pending: false, reason: "no OpenClaw baseline was captured; existing configuration left unchanged" };
      const receipt = {
        version: 1,
        host,
        level,
        appliedAt: new Date().toISOString(),
        detail,
      };
      await atomicWriteJson(path.join(root, ".condiments", "native-context", "last-apply.json"), receipt);
      return receipt;
    }
    const patch = level === "none" ? baseline.value.patch : openClawPatch(level);
    const patchPath = path.join(root, ".condiments", "native-context", "openclaw.patch.json");
    await atomicWriteJson(patchPath, patch);
    const result = await runOpenClawPatch(patchPath);
    detail = { patchPath, ...result };
  } else {
    detail = { nativeSummarization: true, checkpointHookLevel: level };
  }

  const receipt = {
    version: 1,
    host,
    level,
    appliedAt: new Date().toISOString(),
    detail,
  };
  await atomicWriteJson(path.join(root, ".condiments", "native-context", "last-apply.json"), receipt);
  return receipt;
}

export async function handleContextHook(payload, options) {
  const host = options?.host;
  assertHost(host);
  const root = path.resolve(options.cwd || payload?.cwd || process.cwd());
  const state = await readState(options.statePath || path.join(root, ".condiments", "state.json"));
  const level = resolveLevels(state).ketchup;
  const event = normalizeEvent(options.event, payload);

  if (level === "none") {
    await logEvent(root, { host, event, level, action: "noop", payload });
    return { event, level, action: "noop", output: hookOutput(host, event, null) };
  }

  if (event === "pre-compact") {
    const throttle = await registerCompactionAttempt(root, payload, level);
    if (!throttle.allowed) {
      const reason = `Condiments stopped repeated compaction (${throttle.reason}); resume the turn with the saved checkpoint.`;
      await logEvent(root, { host, event, level, action: "throttled", payload, reason });
      return {
        event,
        level,
        action: "throttled",
        throttle,
        output: host === "codex-cli" ? { continue: false, stopReason: reason } : {},
      };
    }
    const checkpoint = await createHookCheckpoint(payload, { host, root, level });
    await logEvent(root, { host, event, level, action: "checkpoint", payload, checkpointPath: checkpoint.path });
    return { event, level, action: "checkpoint", checkpointPath: checkpoint.path, output: hookOutput(host, event, null) };
  }

  if (event === "restore") {
    const sessionId = payload?.session_id || payload?.conversation_id;
    const checkpoint = await loadCheckpointForSession(root, sessionId);
    let rendered = checkpoint ? renderCheckpoint(checkpoint) : null;
    if (rendered && sessionId) {
      const memory = await inspectReversibleMemory(root, String(sessionId));
      const latest = memory.memories.at(-1);
      if (latest) rendered = `${rendered}\n${renderReversibleMemoryReference(latest)}`;
    }
    await logEvent(root, { host, event, level, action: rendered ? "restore" : "missing", payload });
    return { event, level, action: rendered ? "restore" : "missing", output: hookOutput(host, event, rendered) };
  }

  await logEvent(root, { host, event, level, action: "observed", payload });
  return { event, level, action: "observed", output: hookOutput(host, event, null) };
}

async function createHookCheckpoint(payload, options) {
  const transcriptPath = payload?.transcript_path ? path.resolve(payload.transcript_path) : null;
  let archivePath = null;
  let transcript = "";
  if (transcriptPath && await exists(transcriptPath)) {
    transcript = await readFile(transcriptPath, "utf8");
    const digest = createHash("sha256").update(transcript).digest("hex");
    const extension = path.extname(transcriptPath) || ".jsonl";
    archivePath = path.join(
      options.root,
      ".condiments",
      "archives",
      `${safe(payload.session_id || payload.conversation_id || "session")}-${digest.slice(0, 16)}${extension}`,
    );
    await mkdir(path.dirname(archivePath), { recursive: true });
    if (!(await exists(archivePath))) await copyFile(transcriptPath, archivePath);
  }

  const facts = extractTranscriptFacts(transcript, options.level);
  const sessionId = String(payload?.session_id || payload?.conversation_id || "unknown-session");
  const checkpoint = generateCheckpoint({
    goal: facts.lastUser || `Continue compacted ${options.host} session ${sessionId}`,
    constraints: facts.constraints,
    decisions: unique([...facts.decisions, ...facts.recentAssistant]),
    changed_files: facts.paths,
    commands_and_results: facts.commands,
    known_failures: facts.failures,
    opaque_identifiers: unique([
      ...facts.identifiers,
      sessionId,
      payload?.turn_id,
      payload?.generation_id,
    ].filter(Boolean)),
    artifact_paths: archivePath ? [archivePath] : [],
    next_action: "Resume the active task from this checkpoint; retrieve archived transcript details only when required.",
  });
  const checkpointDirectory = path.join(options.root, ".condiments", "checkpoints");
  const checkpointPath = path.join(checkpointDirectory, `${safe(sessionId)}.json`);
  await atomicWriteJson(checkpointPath, checkpoint);
  await atomicWriteJson(path.join(checkpointDirectory, "latest.json"), checkpoint);
  const memory = await commitReversibleMemory(options.root, {
    sessionId,
    summary: checkpoint,
    ...(archivePath ? { rawPath: archivePath } : { rawText: transcript }),
  });
  return { path: checkpointPath, checkpoint, memory: memory.memory };
}

export function extractTranscriptFacts(transcript, level = "some") {
  const maxChars = level === "full" ? 160_000 : 80_000;
  const tail = String(transcript || "").slice(-maxChars);
  const user = [];
  const assistant = [];
  const commands = [];
  const failures = [];
  const paths = [];
  const identifiers = [];
  for (const line of tail.split(/\r?\n/).filter(Boolean)) {
    let record;
    try { record = JSON.parse(line); } catch { record = { text: line }; }
    const role = record.role || record.message?.role || record.payload?.role || record.type;
    const messageContent = record.payload?.type === "message"
      ? record.payload.content
      : record.message?.content ?? record.content;
    const text = ((role === "user" || role === "assistant") && messageContent
      ? collectMessageText(messageContent)
      : collectText(record))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) {
      if (role === "user") user.push(text);
      if (role === "assistant") assistant.push(text);
      if (/\b(error|failed|failure|fatal|exception|blocked)\b/i.test(text)) failures.push(clip(text, 900));
      for (const match of text.matchAll(/(?:[A-Za-z]:[\\/]|\.?\.?[\\/])?[\w.@+-]+(?:[\\/][\w.@+ -]+)+\.[A-Za-z0-9]+/g)) {
        paths.push(clip(match[0], 900));
      }
    }
    const command = record.command || record.tool_input?.command || record.input?.command;
    if (typeof command === "string") commands.push(clip(command, 1_500));
  }
  const constraints = user
    .filter((text) => /\b(must|never|required|without|only|do not|don't)\b/i.test(text))
    .slice(-8)
    .map((text) => clip(text, 900));
  const decisions = assistant
    .filter((text) => /\b(decid|chose|selected|implemented|changed)\w*/i.test(text))
    .slice(-6)
    .map((text) => clip(text, 900));
  const recentAssistant = assistant
    .slice(level === "full" ? -4 : -2)
    .map((text) => `Recent verified assistant result: ${clip(text, 850)}`);
  for (const text of [...user.slice(-2), ...assistant.slice(-4)]) {
    if (/^<(?:recommended_plugins|environment_context|skills_instructions)>/i.test(text)) continue;
    for (const match of text.matchAll(/\b(?=[A-Za-z0-9-]{7,}\b)(?=[A-Za-z0-9-]*\d)[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+\b/g)) {
      identifiers.push(match[0]);
    }
  }
  return {
    lastUser: clip(user.at(-1) || "", 1_200),
    constraints: unique(constraints.map((value) => clip(value, 400))).slice(-4),
    decisions: unique(decisions.map((value) => clip(value, 400))).slice(-3),
    recentAssistant: unique(recentAssistant).slice(level === "full" ? -4 : -2),
    paths: unique(paths.map((value) => clip(value, 300))).slice(-10),
    commands: unique(commands.map((value) => clip(value, 600))).slice(-5),
    failures: unique(failures.map((value) => clip(value, 500))).slice(-4),
    identifiers: unique(identifiers).slice(-30),
  };
}

async function captureBaseline(host, root) {
  const baselinePath = path.join(root, ".condiments", "native-context", `${host}-baseline.json`);
  if (await exists(baselinePath)) {
    const existing = await readJson(baselinePath, {});
    if (host === "codex-cli" && !existing.value?.contextManagement) {
      const config = await readOptional(path.join(root, ".codex", "config.toml"));
      existing.version = 2;
      existing.value = {
        contextManagement: existing.value,
        autoCompactScope: captureTopLevelTomlKey(config, "model_auto_compact_token_limit_scope"),
      };
      await atomicWriteJson(baselinePath, existing);
    }
    if (host !== "openclaw" || existing.value?.available !== false) return existing;
    const refreshed = await captureOpenClawBaseline();
    if (!refreshed.available) return existing;
    const baseline = { version: 1, host, capturedAt: new Date().toISOString(), value: refreshed };
    await atomicWriteJson(baselinePath, baseline);
    return baseline;
  }
  let value;
  if (host === "claude-code") {
    const settings = await readJson(path.join(root, ".claude", "settings.json"), {});
    value = captureJsonKey(settings.env, "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE");
  } else if (host === "codex-cli") {
    const config = await readOptional(path.join(root, ".codex", "config.toml"));
    value = {
      contextManagement: captureTomlKey(config, "features", "context_management"),
      autoCompactScope: captureTopLevelTomlKey(config, "model_auto_compact_token_limit_scope"),
    };
  } else if (host === "openclaw") {
    value = await captureOpenClawBaseline();
  } else {
    value = { present: false };
  }
  const baseline = { version: 1, host, capturedAt: new Date().toISOString(), value };
  await atomicWriteJson(baselinePath, baseline);
  return baseline;
}

async function captureOpenClawBaseline() {
  try {
    const stdout = await runCommand("openclaw", ["config", "get", "agents.defaults", "--json"]);
    const defaults = JSON.parse(stdout);
    return {
      available: true,
      patch: {
        agents: {
          defaults: {
            contextPruning: defaults.contextPruning ?? null,
            compaction: defaults.compaction ?? null,
          },
        },
      },
    };
  } catch (error) {
    return { available: false, reason: error.code === "ENOENT" ? "openclaw command unavailable" : error.message };
  }
}

function openClawPatch(level) {
  return {
    agents: {
      defaults: {
        contextPruning: {
          mode: "cache-ttl",
          ttl: level === "full" ? "5m" : "1h",
        },
        compaction: {
          enabled: true,
          keepRecentTokens: level === "full" ? 12_000 : 20_000,
          midTurnPrecheck: { enabled: true },
          ...(level === "full" ? { maxActiveTranscriptBytes: "8mb" } : {}),
        },
      },
    },
  };
}

async function runOpenClawPatch(patchPath) {
  try {
    await runCommand("openclaw", ["config", "patch", "--file", patchPath, "--dry-run"]);
    await runCommand("openclaw", ["config", "patch", "--file", patchPath]);
    return { applied: true, via: "openclaw config patch" };
  } catch (error) {
    if (error.code === "ENOENT") return { applied: false, pending: true, reason: "openclaw command unavailable" };
    return { applied: false, pending: true, reason: error.message };
  }
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
      else reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `${command} exited ${code}`));
    });
  });
}

async function mergeGroupedHooks(filePath, additions) {
  const config = await readJson(filePath, {});
  config.hooks = isObject(config.hooks) ? config.hooks : {};
  for (const [event, groups] of Object.entries(additions)) {
    const existing = Array.isArray(config.hooks[event]) ? config.hooks[event] : [];
    config.hooks[event] = [...existing.filter((group) => !containsCondimentsHook(group)), ...groups];
  }
  await atomicWriteJson(filePath, config);
}

async function mergeDirectHooks(filePath, additions) {
  const config = await readJson(filePath, { version: 1 });
  config.version = config.version ?? 1;
  config.hooks = isObject(config.hooks) ? config.hooks : {};
  for (const [event, hooks] of Object.entries(additions)) {
    const existing = Array.isArray(config.hooks[event]) ? config.hooks[event] : [];
    config.hooks[event] = [...existing.filter((hook) => !containsCondimentsHook(hook)), ...hooks];
  }
  await atomicWriteJson(filePath, config);
}

function groupedHook(matcher, skillRoot, host, event) {
  return {
    matcher,
    hooks: [{
      type: "command",
      command: `node \"${skillRoot}/scripts/context-hook.mjs\" --host ${host} --event ${event}`,
      timeout: 10,
      statusMessage: event === "restore" ? "Restoring Condiments checkpoint" : "Saving Condiments compaction checkpoint",
    }],
  };
}

function directHook(skillRoot, host, event) {
  return { command: `node \"${skillRoot}/scripts/context-hook.mjs\" --host ${host} --event ${event}` };
}

function containsCondimentsHook(value) {
  return JSON.stringify(value).includes(HOOK_MARKER);
}

async function loadCheckpointForSession(root, sessionId) {
  const directory = path.join(root, ".condiments", "checkpoints");
  const candidate = sessionId ? path.join(directory, `${safe(sessionId)}.json`) : null;
  if (candidate && await exists(candidate)) return readJson(candidate, null);
  return readJson(path.join(directory, "latest.json"), null);
}

function hookOutput(host, event, context) {
  if (event !== "restore" || !context) return {};
  if (host === "cursor") return { additional_context: context };
  return {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: context,
    },
  };
}

function normalizeEvent(explicit, payload = {}) {
  if (explicit) return explicit;
  const event = String(payload.hook_event_name || "").toLowerCase();
  if (event === "precompact") return "pre-compact";
  if (event === "postcompact") return "post-compact";
  if (event === "sessionstart") return "restore";
  return event || "unknown";
}

async function logEvent(root, event) {
  const logPath = path.join(root, ".condiments", "native-context", "events.jsonl");
  await mkdir(path.dirname(logPath), { recursive: true });
  const record = {
    version: 1,
    timestamp: new Date().toISOString(),
    host: event.host,
    event: event.event,
    level: event.level,
    action: event.action,
    session_id: event.payload?.session_id || event.payload?.conversation_id || null,
    trigger: event.payload?.trigger || null,
    checkpoint_path: event.checkpointPath || null,
    reason: event.reason || null,
  };
  await appendFile(logPath, `${JSON.stringify(record)}\n`, "utf8");
}

async function registerCompactionAttempt(root, payload, level) {
  const policy = level === "full"
    ? { maxPerTurn: 1, cooldownMs: 30_000 }
    : { maxPerTurn: 2, cooldownMs: 10_000 };
  const statePath = path.join(root, ".condiments", "native-context", "compaction-state.json");
  const now = Date.now();
  const sessionId = String(payload?.session_id || payload?.conversation_id || "unknown-session");
  const turnId = String(payload?.turn_id || "unknown-turn");
  const previous = await readJson(statePath, {});
  const sameTurn = previous.session_id === sessionId && previous.turn_id === turnId;
  const count = sameTurn ? Number(previous.count || 0) : 0;
  const elapsedMs = sameTurn ? Math.max(0, now - Number(previous.last_attempt_ms || 0)) : null;
  const overMaximum = count >= policy.maxPerTurn;
  const inCooldown = count > 0 && elapsedMs < policy.cooldownMs;
  const allowed = !overMaximum && !inCooldown;
  const next = {
    version: 1,
    session_id: sessionId,
    turn_id: turnId,
    count: allowed ? count + 1 : count,
    last_attempt_ms: allowed ? now : Number(previous.last_attempt_ms || now),
    max_per_turn: policy.maxPerTurn,
    cooldown_ms: policy.cooldownMs,
  };
  await atomicWriteJson(statePath, next);
  return {
    allowed,
    count: next.count,
    maxPerTurn: policy.maxPerTurn,
    cooldownMs: policy.cooldownMs,
    elapsedMs,
    reason: overMaximum ? "maximum per turn reached" : inCooldown ? "cooldown active" : null,
  };
}

function collectText(value, output = [], depth = 0) {
  if (depth > 6 || value === null || value === undefined) return output;
  if (typeof value === "string") {
    if (value.length > 2) output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, output, depth + 1);
    return output;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (["thinking", "encrypted_content", "signature"].includes(key)) continue;
      collectText(item, output, depth + 1);
    }
  }
  return output;
}

function collectMessageText(content) {
  const items = Array.isArray(content) ? content : [content];
  const output = [];
  for (const item of items) {
    if (typeof item === "string") output.push(item);
    else if (typeof item?.text === "string") output.push(item.text);
    else collectText(item, output);
  }
  return output;
}

async function upsertTomlKey(filePath, table, key, value) {
  const current = await readOptional(filePath);
  const lines = current ? current.replace(/\r\n/g, "\n").split("\n") : [];
  const header = `[${table}]`;
  let start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) {
    if (lines.length && lines.at(-1) !== "") lines.push("");
    lines.push(header, `${key} = ${value}`, "");
  } else {
    let end = lines.findIndex((line, index) => index > start && /^\s*\[/.test(line));
    if (end < 0) end = lines.length;
    const keyPattern = new RegExp(`^\\s*${escapeRegex(key)}\\s*=`);
    const index = lines.findIndex((line, index) => index > start && index < end && keyPattern.test(line));
    if (index >= 0) lines[index] = `${key} = ${value}`;
    else lines.splice(end, 0, `${key} = ${value}`);
  }
  await atomicWriteText(filePath, `${lines.join("\n").replace(/\n+$/, "")}\n`);
}

async function restoreTomlKey(filePath, table, key, captured) {
  if (captured?.present) return upsertTomlKey(filePath, table, key, captured.value);
  const current = await readOptional(filePath);
  if (!current) return;
  const lines = current.replace(/\r\n/g, "\n").split("\n");
  const header = `[${table}]`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) return;
  let end = lines.findIndex((line, index) => index > start && /^\s*\[/.test(line));
  if (end < 0) end = lines.length;
  const keyPattern = new RegExp(`^\\s*${escapeRegex(key)}\\s*=`);
  const index = lines.findIndex((line, index) => index > start && index < end && keyPattern.test(line));
  if (index >= 0) lines.splice(index, 1);
  await atomicWriteText(filePath, `${lines.join("\n").replace(/\n+$/, "")}\n`);
}

async function upsertTopLevelTomlKey(filePath, key, value) {
  const current = await readOptional(filePath);
  const lines = current ? current.replace(/\r\n/g, "\n").split("\n") : [];
  const firstTable = lines.findIndex((line) => /^\s*\[/.test(line));
  const end = firstTable < 0 ? lines.length : firstTable;
  const pattern = new RegExp(`^\\s*${escapeRegex(key)}\\s*=`);
  const index = lines.findIndex((line, index) => index < end && pattern.test(line));
  if (index >= 0) lines[index] = `${key} = ${value}`;
  else lines.splice(end, 0, `${key} = ${value}`);
  await atomicWriteText(filePath, `${lines.join("\n").replace(/\n+$/, "")}\n`);
}

async function restoreTopLevelTomlKey(filePath, key, captured) {
  if (captured?.present) return upsertTopLevelTomlKey(filePath, key, captured.value);
  const current = await readOptional(filePath);
  if (!current) return;
  const lines = current.replace(/\r\n/g, "\n").split("\n");
  const firstTable = lines.findIndex((line) => /^\s*\[/.test(line));
  const end = firstTable < 0 ? lines.length : firstTable;
  const pattern = new RegExp(`^\\s*${escapeRegex(key)}\\s*=`);
  const index = lines.findIndex((line, index) => index < end && pattern.test(line));
  if (index >= 0) lines.splice(index, 1);
  await atomicWriteText(filePath, `${lines.join("\n").replace(/\n+$/, "")}\n`);
}

function captureTopLevelTomlKey(text, key) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const firstTable = lines.findIndex((line) => /^\s*\[/.test(line));
  const end = firstTable < 0 ? lines.length : firstTable;
  const pattern = new RegExp(`^\\s*${escapeRegex(key)}\\s*=\\s*(.+?)\\s*$`);
  for (let index = 0; index < end; index += 1) {
    const match = lines[index].match(pattern);
    if (match) return { present: true, value: match[1] };
  }
  return { present: false };
}

function normalizeCodexBaseline(value) {
  if (value?.contextManagement) return value;
  return { contextManagement: value || { present: false }, autoCompactScope: { present: false } };
}

function captureTomlKey(text, table, key) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === `[${table}]`);
  if (start < 0) return { present: false };
  let end = lines.findIndex((line, index) => index > start && /^\s*\[/.test(line));
  if (end < 0) end = lines.length;
  const pattern = new RegExp(`^\\s*${escapeRegex(key)}\\s*=\\s*(.+?)\\s*$`);
  for (let index = start + 1; index < end; index += 1) {
    const match = lines[index].match(pattern);
    if (match) return { present: true, value: match[1] };
  }
  return { present: false };
}

function captureJsonKey(object, key) {
  return isObject(object) && Object.hasOwn(object, key)
    ? { present: true, value: object[key] }
    : { present: false };
}

function restoreJsonKey(object, key, captured) {
  if (captured?.present) object[key] = captured.value;
  else delete object[key];
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

async function readOptional(filePath) {
  try { return await readFile(filePath, "utf8"); }
  catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

async function atomicWriteJson(filePath, value) {
  return atomicWriteText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function atomicWriteText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, value, "utf8");
  await rename(temporaryPath, filePath);
}

async function exists(filePath) {
  try { await access(filePath); return true; }
  catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function assertHost(host) {
  if (!HOSTS.has(host)) throw new Error(`Unknown native-context host '${host}'.`);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safe(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 120) || "session";
}

function clip(value, max) {
  const text = String(value || "").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
