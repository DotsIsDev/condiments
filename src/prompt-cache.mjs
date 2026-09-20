import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDefaultState, normalizeState, resolveLevels } from "./core.mjs";
import { normalizeUsage, summarizeRuns } from "./usage.mjs";
import { guardCacheLineage } from "./cache-lineage.mjs";

const PROVIDERS = new Set(["openai", "anthropic", "openclaw", "cursor", "canonical"]);
const HOST_PROVIDERS = Object.freeze({
  "claude-code": "anthropic",
  "codex-cli": "openai",
  cursor: "cursor",
  openclaw: "openclaw",
});
const HOSTS = new Set(Object.keys(HOST_PROVIDERS));
const LEVELS = new Set(["none", "some", "full"]);
const HOOK_MARKER = "scripts/cache-hook.mjs";

export function composeCacheFriendlyPrompt(options = {}) {
  const stablePrefix = String(options.stablePrefix ?? "");
  if (!stablePrefix) throw new Error("stablePrefix is required.");
  const stableInstructions = uniqueExact([
    stablePrefix,
    ...arrayOfText(options.stableInstructions),
  ]);
  const dynamicContext = arrayOfText(options.dynamicContext);
  const task = String(options.task ?? "");
  if (!task.trim()) throw new Error("task is required.");
  const blocks = [
    ...stableInstructions,
    ...dynamicContext,
    task,
  ];
  return {
    prompt: blocks.join("\n\n"),
    stablePrefix,
    stablePrefixFingerprint: `sha256:${hash(stablePrefix)}`,
    stableInstructionCount: stableInstructions.length,
    removedDuplicateInstructions: 1 + arrayOfText(options.stableInstructions).length - stableInstructions.length,
    taskAtEnd: true,
  };
}

export function prepareCacheAwareRequest(provider, request, options = {}) {
  const kind = assertProvider(provider);
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Provider request must be an object.");
  const task = String(options.task ?? "").trim();
  if (!task) throw new Error("task is required.");
  const stablePrefix = String(options.stablePrefix ?? (kind === "anthropic" ? request.system : request.instructions) ?? "");
  if (!stablePrefix) throw new Error("stablePrefix is required.");
  const stableInstructions = uniqueExact([stablePrefix, ...arrayOfText(options.stableInstructions)]);
  const stableBlock = stableInstructions.join("\n\n");
  const taskTail = [...arrayOfText(options.dynamicContext), task].join("\n\n");
  const assembly = {
    prompt: [stableBlock, taskTail].join("\n\n"),
    requestTask: taskTail,
    stablePrefix,
    stablePrefixFingerprint: `sha256:${hash(stablePrefix)}`,
    stableInstructionCount: stableInstructions.length,
    removedDuplicateInstructions: 1 + arrayOfText(options.stableInstructions).length - stableInstructions.length,
    taskAtEnd: true,
  };
  const candidate = structuredClone(request);
  if (kind === "anthropic") {
    candidate.system = stableBlock;
    candidate.messages = [...(Array.isArray(candidate.messages) ? candidate.messages : []), { role: "user", content: taskTail }];
  } else {
    candidate.instructions = stableBlock;
    candidate.input = taskTail;
  }

  const decorated = decoratePromptCacheRequest(kind, candidate, {
    ...options,
    stablePrefix,
    previousRequest: undefined,
  });
  if (!options.previousRequest || !["openai", "anthropic", "canonical"].includes(kind)) {
    return { request: decorated.request, assembly, control: decorated.control, lineage: null };
  }
  const guarded = guardCacheLineage(kind, options.previousRequest, decorated.request, options.lineageMetrics ?? {}, {
    level: options.level ?? "some",
    preserveFields: options.preserveLineageFields ?? ["model", "tools", "system", "reasoning", "tool_behavior", "cache"],
    stableMessages: options.stableMessages,
  });
  return {
    request: guarded.request,
    assembly,
    control: decorated.control,
    lineage: guarded.decision,
  };
}

export function decoratePromptCacheRequest(provider, request, options = {}) {
  const kind = assertProvider(provider);
  const level = assertLevel(options.level ?? "some");
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("Provider request must be an object.");
  }
  const output = structuredClone(request);
  const control = { provider: kind, level, applied: false, mechanism: "unavailable" };
  if (level === "none") return { request: output, control: { ...control, mechanism: "provider-default" } };

  if (kind === "openai") {
    if (!output.prompt_cache_key) {
      output.prompt_cache_key = stableCacheKey(options.cacheKey, options.stablePrefix, options.namespace);
    }
    control.applied = true;
    control.mechanism = "prompt_cache_key";
    if (level === "full") {
      const model = String(options.model ?? output.model ?? "");
      if (options.supportsPromptCacheOptions === true || supportsModernOpenAiCacheOptions(model)) {
        output.prompt_cache_options = { ...(output.prompt_cache_options ?? {}), ttl: "30m" };
        control.mechanism = "prompt_cache_key+30m";
      } else if (options.supportsLegacyLongRetention === true) {
        output.prompt_cache_retention = "24h";
        control.mechanism = "prompt_cache_key+24h";
      }
    }
    return withLineage(kind, output, control, options);
  }

  if (kind === "anthropic") {
    output.cache_control = output.cache_control ?? {
      type: "ephemeral",
      ...(level === "full" ? { ttl: "1h" } : {}),
    };
    return withLineage(kind, output, {
      ...control, applied: true, mechanism: level === "full" ? "ephemeral-1h" : "ephemeral-5m",
    }, options);
  }

  if (kind === "openclaw") {
    output.cacheRetention = level === "full" ? "long" : "short";
    return { request: output, control: { ...control, applied: true, mechanism: `cacheRetention:${output.cacheRetention}` } };
  }

  return { request: output, control };
}

function withLineage(provider, request, control, options) {
  if (!options.previousRequest) return { request, control };
  const guarded = guardCacheLineage(provider, options.previousRequest, request, options.lineageMetrics ?? {}, {
    level: options.level,
    preserveFields: options.preserveLineageFields,
    stableMessages: options.stableMessages,
  });
  return { request: guarded.request, control: { ...control, lineage: guarded.decision } };
}

function arrayOfText(value) {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return values.map((item) => String(item)).filter((item) => item.trim() !== "");
}

function uniqueExact(values) {
  return [...new Set(values)];
}

export function createCacheTelemetryRecord(provider, payload, metadata = {}) {
  const usage = normalizeUsage(assertProvider(provider), payload, metadata);
  const timestamp = validTimestamp(metadata.timestamp) ?? new Date().toISOString();
  const prefixFingerprint = fingerprint(metadata.prefixFingerprint ?? metadata.stablePrefix);
  const cacheKeyFingerprint = fingerprint(metadata.cacheKey);
  const identity = metadata.eventId ?? hash(JSON.stringify({
    provider: usage.provider,
    model: usage.model,
    session: metadata.sessionId ?? null,
    request: metadata.requestId ?? metadata.turnId ?? null,
    timestamp,
    usage,
  }));
  return {
    version: 1,
    event_id: String(identity),
    timestamp,
    source: metadata.source ?? "provider-response",
    host: metadata.host ?? null,
    session_id: metadata.sessionId ?? null,
    request_id: metadata.requestId ?? null,
    turn_id: metadata.turnId ?? null,
    mode: metadata.mode ?? null,
    prefix_fingerprint: prefixFingerprint,
    cache_key_fingerprint: cacheKeyFingerprint,
    ...usage,
  };
}

export async function appendCacheTelemetry(root, records) {
  const filePath = telemetryPath(root);
  const items = Array.isArray(records) ? records : [records];
  const existing = await readTelemetry(filePath);
  const ids = new Set(existing.map((record) => record.event_id));
  const added = [];
  for (const record of items) {
    if (!record?.event_id || ids.has(record.event_id)) continue;
    ids.add(record.event_id);
    added.push(record);
  }
  if (added.length) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, `${added.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
  }
  return { path: filePath, added: added.length, duplicate: items.length - added.length };
}

export async function readCacheTelemetry(root) {
  return readTelemetry(telemetryPath(root));
}

export function summarizeCacheTelemetry(records) {
  if (!Array.isArray(records)) throw new Error("Telemetry records must be an array.");
  if (records.length === 0) {
    return {
      version: 1,
      events: 0,
      cache_reported_events: 0,
      cache_missing_events: 0,
      telemetry_coverage: null,
      summary: null,
      groups: [],
      alerts: [],
    };
  }
  const reported = records.filter((record) => record.cache_telemetry_available);
  const groups = new Map();
  for (const record of records) {
    const key = `${record.provider}|${record.model ?? "unknown"}|${record.mode ?? "unknown"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return {
    version: 1,
    events: records.length,
    cache_reported_events: reported.length,
    cache_missing_events: records.length - reported.length,
    telemetry_coverage: round(reported.length / records.length),
    summary: summarizeRuns(records),
    groups: [...groups.entries()].map(([key, runs]) => ({ key, ...summarizeRuns(runs) })),
    alerts: cacheAlerts(records),
  };
}

export function extractCacheTelemetry(transcript, options = {}) {
  const provider = assertProvider(options.provider);
  const records = [];
  const lines = String(transcript ?? "").split(/\r?\n/);
  lines.forEach((line, lineIndex) => {
    if (!line.trim()) return;
    let value;
    try { value = JSON.parse(line); } catch { return; }
    const candidates = usageCandidates(value);
    candidates.forEach((candidate, candidateIndex) => {
      try {
        records.push(createCacheTelemetryRecord(provider, candidate, {
          host: options.host,
          source: options.source ?? "transcript",
          sessionId: options.sessionId ?? value.session_id ?? value.sessionId,
          requestId: value.request_id ?? value.requestId ?? value.id,
          turnId: value.turn_id ?? value.turnId,
          model: candidate.model ?? value.model ?? value.message?.model,
          timestamp: value.timestamp ?? value.created_at,
          mode: options.mode,
          eventId: hash(`${options.transcriptPath ?? "inline"}:${lineIndex}:${candidateIndex}:${line}`),
        }));
      } catch {
        // Ignore malformed or unrelated usage-shaped transcript entries.
      }
    });
  });
  return records;
}

export async function handleCacheTelemetryHook(payload, options = {}) {
  const host = assertHost(options.host);
  const provider = HOST_PROVIDERS[host];
  const root = path.resolve(options.cwd || payload?.cwd || process.cwd());
  const state = await readState(options.statePath || path.join(root, ".condiments", "state.json"));
  const level = resolveLevels(state).ranch;
  const transcriptPath = payload?.transcript_path ?? payload?.transcriptPath;
  const direct = usageCandidates(payload).flatMap((candidate, index) => {
    try {
      return [createCacheTelemetryRecord(provider, candidate, {
        host,
        source: "hook-payload",
        sessionId: payload.session_id ?? payload.conversation_id,
        requestId: payload.request_id,
        turnId: payload.turn_id,
        model: candidate.model ?? payload.model,
        mode: level,
        eventId: hash(`payload:${host}:${index}:${JSON.stringify(candidate)}`),
      })];
    } catch { return []; }
  });
  let transcript = [];
  if (transcriptPath && await exists(transcriptPath)) {
    transcript = extractCacheTelemetry(await readFile(transcriptPath, "utf8"), {
      provider,
      host,
      source: "native-transcript",
      sessionId: payload.session_id ?? payload.conversation_id,
      transcriptPath: path.resolve(transcriptPath),
      mode: level,
    });
  }
  const observed = transcript.length ? transcript : direct;
  const unique = new Map(observed.map((record) => [record.event_id, record]));
  const receipt = await appendCacheTelemetry(root, [...unique.values()]);
  return { host, provider, level, observed: unique.size, ...receipt, output: {} };
}

export async function installPromptCacheTelemetry(host, targetRoot) {
  assertHost(host);
  const root = path.resolve(targetRoot);
  if (host === "claude-code") {
    const configPath = path.join(root, ".claude", "settings.json");
    await mergeGroupedHooks(configPath, { Stop: [groupedHook(".*", ".claude/skills/condiments", host)] });
    return { installed: true, control: false, telemetry: true, configPath, event: "Stop" };
  }
  if (host === "codex-cli") {
    const configPath = path.join(root, ".codex", "hooks.json");
    await mergeGroupedHooks(configPath, { Stop: [groupedHook(".*", ".agents/skills/condiments", host)] });
    return { installed: true, control: false, telemetry: "when-cache-fields-exposed", configPath, event: "Stop" };
  }
  if (host === "cursor") {
    const configPath = path.join(root, ".cursor", "hooks.json");
    await mergeDirectHooks(configPath, { sessionEnd: [directHook(".cursor/skills/condiments", host)] });
    return { installed: true, control: false, telemetry: "when-cache-fields-exposed", configPath, event: "sessionEnd" };
  }
  const baseline = await captureOpenClawBaseline(root);
  return {
    installed: true,
    control: true,
    telemetry: true,
    nativeCounters: ["cacheRead", "cacheWrite"],
    baselinePath: baseline.path,
  };
}

export async function applyNativePromptCachePolicy(host, targetRoot, level) {
  assertHost(host);
  assertLevel(level);
  const root = path.resolve(targetRoot);
  let detail;
  if (host === "openclaw") {
    const baseline = await captureOpenClawBaseline(root);
    if (level === "none" && baseline.value.commandAvailable === false) {
      detail = { applied: false, pending: false, reason: "OpenClaw unavailable; existing cache settings left unchanged" };
    } else {
      const cacheRetention = level === "none"
        ? baseline.value.cacheRetention ?? null
        : level === "full" ? "long" : "short";
      const patch = { agents: { defaults: { params: { cacheRetention } } } };
      const patchPath = path.join(root, ".condiments", "prompt-cache", "openclaw.patch.json");
      await atomicWriteJson(patchPath, patch);
      detail = { patchPath, cacheRetention, ...await runOpenClawPatch(patchPath) };
    }
  } else {
    detail = {
      applied: false,
      supported: false,
      reason: `${host} does not expose provider request cache controls to project hooks`,
      telemetry: "native transcript ingestion installed",
    };
  }
  const receipt = { version: 1, host, level, appliedAt: new Date().toISOString(), detail };
  await atomicWriteJson(path.join(root, ".condiments", "prompt-cache", "last-apply.json"), receipt);
  return receipt;
}

function usageCandidates(value) {
  const output = [];
  const seen = new Set();
  function visit(current, depth) {
    if (!current || typeof current !== "object" || depth > 8 || seen.has(current)) return;
    seen.add(current);
    if (looksLikeUsage(current)) output.push(current);
    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1);
      return;
    }
    for (const [key, item] of Object.entries(current)) {
      if (["usage", "totalUsage", "tokenUsage"].includes(key)) visit(item, depth + 1);
      else if (["message", "response", "result", "data", "payload"].includes(key)) visit(item, depth + 1);
    }
  }
  visit(value, 0);
  return output;
}

function looksLikeUsage(value) {
  const keys = [
    "input_tokens", "prompt_tokens", "inputTokens", "input",
    "output_tokens", "completion_tokens", "outputTokens", "output",
    "cacheRead", "cacheReadTokens", "cache_read_input_tokens",
  ];
  return keys.some((key) => Object.hasOwn(value, key));
}

function cacheAlerts(records) {
  const alerts = [];
  const priorByPrefix = new Map();
  for (const record of [...records].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))) {
    if (!record.cache_read_reported || !record.prefix_fingerprint) continue;
    const key = `${record.provider}|${record.model}|${record.prefix_fingerprint}`;
    const prior = priorByPrefix.get(key);
    if (prior?.cache_read_tokens > 0 && record.cache_read_tokens === 0) {
      alerts.push({
        type: "cache-read-drop",
        provider: record.provider,
        model: record.model,
        prefix_fingerprint: record.prefix_fingerprint,
        previous_event_id: prior.event_id,
        event_id: record.event_id,
      });
    }
    priorByPrefix.set(key, record);
  }
  return alerts;
}

function stableCacheKey(explicit, stablePrefix, namespace = "condiments") {
  if (explicit) return String(explicit).slice(0, 64);
  return `cond-${hash(`${namespace}:${stablePrefix ?? "default"}`).slice(0, 40)}`;
}

function supportsModernOpenAiCacheOptions(model) {
  return /^gpt-(?:[6-9](?:\.|-|$)|5\.(?:[6-9]|\d{2,})(?:-|$))/i.test(model);
}

function fingerprint(value) {
  return value === undefined || value === null || value === "" ? null : `sha256:${hash(String(value))}`;
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function validTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function telemetryPath(root) {
  return path.join(path.resolve(root), ".condiments", "prompt-cache", "events.jsonl");
}

async function readTelemetry(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    const records = text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    return [...new Map(records.map((record) => [record.event_id, record])).values()];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function captureOpenClawBaseline(root) {
  const baselinePath = path.join(root, ".condiments", "prompt-cache", "openclaw-baseline.json");
  try {
    const existing = JSON.parse(await readFile(baselinePath, "utf8"));
    if (existing.value?.commandAvailable !== false) return { ...existing, path: baselinePath };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  let value;
  try {
    const stdout = await runCommand("openclaw", ["config", "get", "agents.defaults", "--json"]);
    const defaults = JSON.parse(stdout);
    value = { commandAvailable: true, cacheRetention: defaults?.params?.cacheRetention ?? null };
  } catch (error) {
    value = { commandAvailable: false, cacheRetention: null, reason: error.message };
  }
  const baseline = { version: 1, host: "openclaw", capturedAt: new Date().toISOString(), value };
  await atomicWriteJson(baselinePath, baseline);
  return { ...baseline, path: baselinePath };
}

async function runOpenClawPatch(patchPath) {
  try {
    await runCommand("openclaw", ["config", "patch", "--file", patchPath, "--dry-run"]);
    await runCommand("openclaw", ["config", "patch", "--file", patchPath]);
    return { applied: true, via: "openclaw config patch" };
  } catch (error) {
    return { applied: false, pending: true, reason: error.code === "ENOENT" ? "openclaw command unavailable" : error.message };
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => { error.code = error.code ?? "SPAWN"; reject(error); });
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
    config.hooks[event] = [...existing.filter((group) => !JSON.stringify(group).includes(HOOK_MARKER)), ...groups];
  }
  await atomicWriteJson(filePath, config);
}

async function mergeDirectHooks(filePath, additions) {
  const config = await readJson(filePath, { version: 1 });
  config.version = config.version ?? 1;
  config.hooks = isObject(config.hooks) ? config.hooks : {};
  for (const [event, hooks] of Object.entries(additions)) {
    const existing = Array.isArray(config.hooks[event]) ? config.hooks[event] : [];
    config.hooks[event] = [...existing.filter((hook) => !JSON.stringify(hook).includes(HOOK_MARKER)), ...hooks];
  }
  await atomicWriteJson(filePath, config);
}

function groupedHook(matcher, skillRoot, host) {
  return {
    matcher,
    hooks: [{
      type: "command",
      command: `node \"${skillRoot}/scripts/cache-hook.mjs\" --host ${host}`,
      timeout: 10,
      statusMessage: "Recording prompt-cache usage",
    }],
  };
}

function directHook(skillRoot, host) {
  return { command: `node \"${skillRoot}/scripts/cache-hook.mjs\" --host ${host}`, timeout: 10 };
}

async function readState(filePath) {
  try { return normalizeState(JSON.parse(await readFile(filePath, "utf8"))); }
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

async function exists(filePath) {
  try { await access(filePath); return true; }
  catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function assertProvider(provider) {
  const value = String(provider ?? "").toLowerCase();
  if (!PROVIDERS.has(value)) throw new Error(`Unknown cache provider '${provider}'.`);
  return value;
}

function assertHost(host) {
  if (!HOSTS.has(host)) throw new Error(`Unknown prompt-cache host '${host}'.`);
  return host;
}

function assertLevel(level) {
  if (!LEVELS.has(level)) throw new Error(`Unknown prompt-cache level '${level}'.`);
  return level;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
