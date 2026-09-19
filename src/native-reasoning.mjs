import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDefaultState, normalizeState, resolveLevels } from "./core.mjs";
import { assessCacheLineage, createCacheLineageSnapshot } from "./cache-lineage.mjs";
import { readCacheTelemetry } from "./prompt-cache.mjs";

const HOSTS = new Set(["openclaw", "claude-code", "codex-cli", "cursor"]);
const LEVELS = new Set(["none", "some", "full"]);
const HOOK_MARKER = "scripts/reasoning-hook.mjs";
const EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

const MODEL_PREFERENCES = Object.freeze({
  some: Object.freeze({
    routine: Object.freeze(["gpt-5.6-terra", "gpt-5.6-sol"]),
    standard: Object.freeze(["$current", "gpt-5.6-terra", "gpt-5.6-sol"]),
    escalation: Object.freeze(["gpt-6-astra", "$current"]),
  }),
  full: Object.freeze({
    routine: Object.freeze(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]),
    standard: Object.freeze(["gpt-5.6-terra", "gpt-5.6-sol", "$current"]),
    escalation: Object.freeze(["gpt-6-astra", "$current"]),
  }),
});

const EFFORT_PREFERENCES = Object.freeze({
  some: Object.freeze({ routine: "low", standard: "medium", escalation: "high" }),
  full: Object.freeze({ routine: "low", standard: "low", escalation: "high" }),
});

export function classifyCodexTask(prompt, metadata = {}) {
  const text = String(prompt ?? "");
  const lower = text.toLowerCase();
  const signals = [];
  const failureCount = nonnegativeInteger(metadata.failureCount ?? 0, "failureCount");
  if (failureCount >= 2 || /\b(still failing|failed again|blocked|conflicting evidence|cannot reproduce)\b/.test(lower)) {
    signals.push("repeated-failure");
  }
  if (/\b(security|vulnerability|cryptograph|authentication|authorization|data loss|production incident|race condition|concurren|deadlock)\b/.test(lower)) {
    signals.push("high-risk");
  }
  if (/\b(deep dive|think deeply|maximum reasoning|xhigh|ultra reasoning|architect(?:ure)?|formal proof)\b/.test(lower)) {
    signals.push("explicit-depth");
  }
  if (metadata.userRequestedDepth) signals.push("explicit-depth");
  if (metadata.highRisk) signals.push("high-risk");
  if (signals.length) return { class: "escalation", signals: unique(signals) };

  if (/\b(implement|refactor|migrate|debug|design|integrat|optimi[sz]|benchmark|evaluate|multi-file|repository)\b/.test(lower)
    || text.length > 500) {
    return { class: "standard", signals: [text.length > 500 ? "large-request" : "coding-work"] };
  }
  return { class: "routine", signals: ["routine-request"] };
}

export function resolveCodexRoute(level, input, catalog = [], policy = {}) {
  assertLevel(level);
  const currentModel = String(input?.model ?? policy.currentModel ?? "");
  if (level === "none") {
    return {
      level,
      class: "inherit",
      model: currentModel || null,
      effort: null,
      switchedModel: false,
      applied: false,
      signals: [],
      reason: "hot none preserves current turn settings",
    };
  }
  const classification = classifyCodexTask(input?.prompt, input?.metadata);
  const modelPreferences = policy.models?.[level]?.[classification.class]
    ?? MODEL_PREFERENCES[level][classification.class];
  const model = selectModel(modelPreferences, currentModel, catalog);
  const desiredEffort = policy.efforts?.[level]?.[classification.class]
    ?? EFFORT_PREFERENCES[level][classification.class];
  const effort = selectEffort(desiredEffort, model, catalog);
  const route = {
    level,
    class: classification.class,
    model,
    effort,
    switchedModel: Boolean(model && currentModel && model !== currentModel),
    applied: Boolean(model || effort),
    signals: classification.signals,
    reason: `${classification.class} route`,
  };
  if (policy.cacheLineage) {
    const currentEffort = input?.effort ?? policy.currentEffort ?? null;
    const previous = createCacheLineageSnapshot("openai", { model: currentModel || null, reasoning_effort: currentEffort });
    const candidate = createCacheLineageSnapshot("openai", { model: route.model, reasoning_effort: route.effort });
    const lineage = assessCacheLineage(previous, candidate, {
      ...policy.cacheLineage,
      qualityRequired: policy.cacheLineage.qualityRequired ?? classification.class === "escalation",
    }, { level });
    route.cacheLineage = lineage;
    if (lineage.preserve) {
      route.model = currentModel || route.model;
      route.effort = currentEffort;
      route.switchedModel = false;
      route.reason = `${classification.class} route held for cache lineage`;
    }
  }
  return route;
}

export function buildCodexExecArgs(route, options = {}) {
  const args = ["exec"];
  if (route.model) args.push("--model", route.model);
  if (route.effort) args.push("-c", `model_reasoning_effort=${JSON.stringify(route.effort)}`);
  if (options.cwd) args.push("-C", path.resolve(options.cwd));
  if (options.json) args.push("--json");
  if (options.ephemeral) args.push("--ephemeral");
  if (options.skipGitRepoCheck) args.push("--skip-git-repo-check");
  args.push(options.prompt ?? "-");
  return args;
}

export async function installNativeReasoningHooks(host, targetRoot, options = {}) {
  assertHost(host);
  const root = path.resolve(targetRoot);
  if (host !== "codex-cli") {
    return { installed: false, supported: false, reason: "Codex-only native adapter" };
  }
  const configPath = path.join(root, ".codex", "config.toml");
  const hooksPath = path.join(root, ".codex", "hooks.json");
  const baseline = await captureBaseline(root);
  const probe = options.probe ?? probeCodexAppServerRouting;
  const activeTurn = await probe(options);
  if (activeTurn.available) {
    await mergeGroupedHooks(hooksPath, {
      UserPromptSubmit: [groupedHook(".*", ".agents/skills/condiments")],
    });
  } else {
    await removeGroupedHook(hooksPath, "UserPromptSubmit");
  }
  return {
    installed: true,
    supported: true,
    configPath,
    hooksPath,
    baselinePath: baseline.path,
    activeTurnRouting: activeTurn.available,
    event: activeTurn.available ? "UserPromptSubmit" : null,
    probe: activeTurn,
    nativeFeatures: ["step_model_switching"],
  };
}

export async function probeCodexAppServerRouting(options = {}) {
  try {
    const models = await discoverCodexModels({
      proxy: true,
      timeoutMs: options.probeTimeoutMs ?? 2_000,
      command: options.command,
      cwd: options.cwd,
    });
    return { available: true, modelCount: models.length, via: "codex app-server proxy" };
  } catch (error) {
    return {
      available: false,
      modelCount: 0,
      reason: error.message,
      fallback: "project defaults and condiments-codex-route exec",
    };
  }
}

export async function applyNativeReasoningPolicy(host, targetRoot, level) {
  assertHost(host);
  assertLevel(level);
  const root = path.resolve(targetRoot);
  let detail;
  if (host !== "codex-cli") {
    detail = { applied: false, supported: false, reason: "native reasoning router is Codex-only" };
  } else {
    const configPath = path.join(root, ".codex", "config.toml");
    const baseline = await captureBaseline(root);
    if (level === "none") {
      await restoreTomlKey(configPath, "features", "step_model_switching", baseline.value.stepModelSwitching);
      await restoreTomlKey(configPath, "features", "reasoning_effort_override", baseline.value.reasoningEffortOverride);
      await restoreTopLevelTomlKey(configPath, "model", baseline.value.model);
      await restoreTopLevelTomlKey(configPath, "model_reasoning_effort", baseline.value.modelReasoningEffort);
      detail = {
        applied: true,
        mode: "restored",
        configPath,
        appliesOn: "next Codex session",
      };
    } else {
      await upsertTomlKey(configPath, "features", "step_model_switching", "true");
      // Codex serializes reasoning overrides as `configuration_update` input
      // items. Several advertised models reject that item type, so keep the
      // experimental override disabled and route effort through project
      // defaults or the managed turn-settings API instead.
      await upsertTomlKey(configPath, "features", "reasoning_effort_override", "false");
      let catalog = [];
      let discoveryError = null;
      try {
        catalog = await discoverCodexModels({ cwd: root, timeoutMs: 8_000 });
      } catch (error) {
        discoveryError = error.message;
      }
      const baselineModel = unquoteToml(baseline.value.model?.value);
      const currentModel = baselineModel
        || catalog.find((model) => model.isDefault ?? model.is_default)?.model
        || catalog[0]?.model
        || null;
      const defaultRoute = resolveCodexRoute(level, {
        prompt: "Routine coding task",
        model: currentModel,
      }, catalog);
      if (defaultRoute.model) await upsertTopLevelTomlKey(configPath, "model", JSON.stringify(defaultRoute.model));
      if (defaultRoute.effort) await upsertTopLevelTomlKey(configPath, "model_reasoning_effort", JSON.stringify(defaultRoute.effort));
      detail = {
        applied: true,
        mode: "project default plus managed app-server turn routing",
        configPath,
        appliesOn: "project default on next Codex session; active turn only when managed app-server proxy is available",
        features: { step_model_switching: true, reasoning_effort_override: false },
        defaultRoute,
        catalogModels: catalog.length,
        discoveryError,
        policy: { models: MODEL_PREFERENCES[level], efforts: EFFORT_PREFERENCES[level] },
      };
    }
  }
  const receipt = { version: 1, host, level, appliedAt: new Date().toISOString(), detail };
  await atomicWriteJson(path.join(root, ".condiments", "native-reasoning", "last-apply.json"), receipt);
  return receipt;
}

export async function handleCodexReasoningHook(payload, options = {}) {
  const root = path.resolve(options.cwd || payload?.cwd || process.cwd());
  const state = await readState(options.statePath || path.join(root, ".condiments", "state.json"));
  const level = resolveLevels(state).hot;
  if (level === "none") return { action: "noop", level, output: {} };
  const client = options.client ?? routeViaCodexProxy;
  const policy = await cacheAwarePolicy(root, payload, options.policy);
  let result;
  try {
    result = await client({
      threadId: String(payload?.session_id ?? ""),
      turnId: String(payload?.turn_id ?? ""),
      prompt: String(payload?.prompt ?? ""),
      currentModel: String(payload?.model ?? ""),
      level,
      policy,
    });
  } catch (error) {
    result = {
      route: resolveCodexRoute(level, { prompt: payload?.prompt, model: payload?.model, effort: payload?.reasoning_effort ?? payload?.effort }, [], policy),
      status: "unavailable",
      error: error.message,
    };
  }
  await logRoute(root, payload, level, result);
  return { action: result.status === "applied" ? "routed" : "observed", level, ...result, output: {} };
}

async function cacheAwarePolicy(root, payload, policy = {}) {
  if (policy.cacheLineage) return policy;
  const events = await readCacheTelemetry(root);
  const sessionId = payload?.session_id ?? payload?.conversation_id;
  if (!sessionId) return policy;
  const latest = [...events].reverse().find((event) => event.cache_read_reported
    && event.session_id === sessionId);
  if (!latest || latest.cache_read_tokens <= 0) return policy;
  return {
    ...policy,
    currentEffort: payload?.reasoning_effort ?? payload?.effort ?? policy.currentEffort,
    cacheLineage: {
      cacheReadTokens: latest.cache_read_tokens,
      expectedInputTokenSavings: 0,
      expectedOutputTokenSavings: 0,
      expectedReasoningTokenSavings: 0,
      qualityRequired: classifyCodexTask(payload?.prompt).class === "escalation",
    },
  };
}

export async function discoverCodexModels(options = {}) {
  return withCodexRpc(options.proxy ? ["app-server", "proxy"] : ["app-server", "--stdio"], async (rpc) => {
    const response = await rpc("model/list", { limit: 100, includeHidden: false });
    return response?.data ?? [];
  }, options);
}

export async function routeViaCodexProxy(input, options = {}) {
  if (!input.threadId || !input.turnId) throw new Error("Codex hook omitted session_id or turn_id.");
  return withCodexRpc(["app-server", "proxy"], async (rpc) => {
    const catalogResponse = await rpc("model/list", { limit: 100, includeHidden: false });
    const catalog = catalogResponse?.data ?? [];
    const route = resolveCodexRoute(input.level, {
      prompt: input.prompt,
      model: input.currentModel,
    }, catalog, input.policy);
    const response = await rpc("turn/settings/update", {
      threadId: input.threadId,
      turnId: input.turnId,
      model: route.model,
      effort: route.effort,
    });
    return { route, status: String(response?.status ?? "unknown").toLowerCase(), catalogModels: catalog.length };
  }, options);
}

async function withCodexRpc(args, operation, options = {}) {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const command = options.command ?? "codex";
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      cwd: options.cwd,
    });
    const pending = new Map();
    const stderr = [];
    let buffer = "";
    let nextId = 1;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolve(value);
    };
    const request = (method, params) => new Promise((requestResolve, requestReject) => {
      const id = nextId++;
      pending.set(id, { resolve: requestResolve, reject: requestReject });
      child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    });
    const timer = setTimeout(() => finish(new Error(`Codex app-server timed out after ${timeoutMs}ms.`)), timeoutMs);
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (!settled) finish(new Error(Buffer.concat(stderr).toString("utf8").trim() || `codex app-server exited ${code}`));
    });
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id === undefined) continue;
        const waiter = pending.get(message.id);
        if (!waiter) continue;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
        else waiter.resolve(message.result);
      }
    });
    (async () => {
      try {
        await request("initialize", {
          clientInfo: { name: "condiments", title: "Condiments", version: "0.1.0" },
          capabilities: { experimentalApi: true },
        });
        child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
        finish(null, await operation(request));
      } catch (error) {
        finish(error);
      }
    })();
  });
}

function selectModel(preferences, currentModel, catalog) {
  const available = new Map(catalog.map((model) => [String(model.model ?? model.id), model]));
  if (available.size === 0) return currentModel || null;
  for (const candidate of preferences) {
    const resolved = candidate === "$current" ? currentModel : candidate;
    if (resolved && available.has(resolved)) return resolved;
  }
  if (currentModel && available.has(currentModel)) return currentModel;
  const defaultModel = catalog.find((model) => model.isDefault ?? model.is_default);
  return String(defaultModel?.model ?? defaultModel?.id ?? catalog[0]?.model ?? catalog[0]?.id ?? "") || null;
}

function selectEffort(desired, selectedModel, catalog) {
  const model = catalog.find((item) => (item.model ?? item.id) === selectedModel);
  const supported = (model?.supportedReasoningEfforts ?? model?.supported_reasoning_efforts ?? [])
    .map((item) => String(item.reasoningEffort ?? item.reasoning_effort ?? item));
  if (supported.length === 0 || supported.includes(desired)) return desired;
  const desiredIndex = EFFORT_ORDER.indexOf(desired);
  return supported
    .map((effort) => ({ effort, distance: Math.abs(EFFORT_ORDER.indexOf(effort) - desiredIndex) }))
    .filter((item) => EFFORT_ORDER.includes(item.effort))
    .sort((a, b) => a.distance - b.distance)[0]?.effort
    ?? String(model?.defaultReasoningEffort ?? model?.default_reasoning_effort ?? supported[0]);
}

async function captureBaseline(root) {
  const baselinePath = path.join(root, ".condiments", "native-reasoning", "codex-baseline.json");
  if (await exists(baselinePath)) return { ...JSON.parse(await readFile(baselinePath, "utf8")), path: baselinePath };
  const configPath = path.join(root, ".codex", "config.toml");
  const text = await readOptional(configPath);
  const baseline = {
    version: 1,
    host: "codex-cli",
    capturedAt: new Date().toISOString(),
    value: {
      stepModelSwitching: captureTomlKey(text, "features", "step_model_switching"),
      reasoningEffortOverride: captureTomlKey(text, "features", "reasoning_effort_override"),
      model: captureTopLevelTomlKey(text, "model"),
      modelReasoningEffort: captureTopLevelTomlKey(text, "model_reasoning_effort"),
    },
  };
  await atomicWriteJson(baselinePath, baseline);
  return { ...baseline, path: baselinePath };
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

async function removeGroupedHook(filePath, event) {
  const config = await readJson(filePath, null);
  if (!config || !isObject(config.hooks) || !Array.isArray(config.hooks[event])) return;
  const retained = config.hooks[event].filter((group) => !JSON.stringify(group).includes(HOOK_MARKER));
  if (retained.length) config.hooks[event] = retained;
  else delete config.hooks[event];
  await atomicWriteJson(filePath, config);
}

function groupedHook(matcher, skillRoot) {
  return {
    matcher,
    hooks: [{
      type: "command",
      command: `node \"${skillRoot}/scripts/reasoning-hook.mjs\" --host codex-cli`,
      timeout: 12,
      statusMessage: "Routing Codex model and reasoning",
    }],
  };
}

async function logRoute(root, payload, level, result) {
  const logPath = path.join(root, ".condiments", "native-reasoning", "events.jsonl");
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify({
    version: 1,
    timestamp: new Date().toISOString(),
    level,
    session_id: payload?.session_id ?? null,
    turn_id: payload?.turn_id ?? null,
    prompt_hash: createHash("sha256").update(String(payload?.prompt ?? "")).digest("hex"),
    previous_model: payload?.model ?? null,
    route: result.route ?? null,
    status: result.status,
    error: result.error ?? null,
  })}\n`, "utf8");
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
    const pattern = new RegExp(`^\\s*${escapeRegex(key)}\\s*=`);
    const index = lines.findIndex((line, index) => index > start && index < end && pattern.test(line));
    if (index >= 0) lines[index] = `${key} = ${value}`;
    else lines.splice(end, 0, `${key} = ${value}`);
  }
  await atomicWriteText(filePath, `${lines.join("\n").replace(/\n+$/, "")}\n`);
}

async function upsertTopLevelTomlKey(filePath, key, value) {
  const current = await readOptional(filePath);
  const lines = current ? current.replace(/\r\n/g, "\n").split("\n") : [];
  const firstTable = lines.findIndex((line) => /^\s*\[/.test(line));
  const end = firstTable < 0 ? lines.length : firstTable;
  const pattern = new RegExp(`^\\s*${escapeRegex(key)}\\s*=`);
  const index = lines.findIndex((line, lineIndex) => lineIndex < end && pattern.test(line));
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
  const index = lines.findIndex((line, lineIndex) => lineIndex < end && pattern.test(line));
  if (index >= 0) lines.splice(index, 1);
  await atomicWriteText(filePath, `${lines.join("\n").replace(/\n+$/, "")}\n`);
}

async function restoreTomlKey(filePath, table, key, captured) {
  if (captured?.present) return upsertTomlKey(filePath, table, key, captured.value);
  const current = await readOptional(filePath);
  if (!current) return;
  const lines = current.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === `[${table}]`);
  if (start < 0) return;
  let end = lines.findIndex((line, index) => index > start && /^\s*\[/.test(line));
  if (end < 0) end = lines.length;
  const pattern = new RegExp(`^\\s*${escapeRegex(key)}\\s*=`);
  const index = lines.findIndex((line, index) => index > start && index < end && pattern.test(line));
  if (index >= 0) lines.splice(index, 1);
  await atomicWriteText(filePath, `${lines.join("\n").replace(/\n+$/, "")}\n`);
}

function captureTomlKey(text, table, key) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
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

function captureTopLevelTomlKey(text, key) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  const end = lines.findIndex((line) => /^\s*\[/.test(line));
  const limit = end < 0 ? lines.length : end;
  const pattern = new RegExp(`^\\s*${escapeRegex(key)}\\s*=\\s*(.+?)\\s*$`);
  for (let index = 0; index < limit; index += 1) {
    const match = lines[index].match(pattern);
    if (match) return { present: true, value: match[1] };
  }
  return { present: false };
}

function unquoteToml(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed || null;
}

async function readState(filePath) {
  try { return normalizeState(JSON.parse(await readFile(filePath, "utf8"))); }
  catch (error) {
    if (error?.code === "ENOENT") return createDefaultState();
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

async function readJson(filePath, fallback) {
  try { return JSON.parse(await readFile(filePath, "utf8")); }
  catch (error) {
    if (error?.code === "ENOENT") return fallback;
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
  if (!HOSTS.has(host)) throw new Error(`Unknown native-reasoning host '${host}'.`);
  return host;
}

function assertLevel(level) {
  if (!LEVELS.has(level)) throw new Error(`Unknown native-reasoning level '${level}'.`);
  return level;
}

function nonnegativeInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer.`);
  return parsed;
}

function unique(values) {
  return [...new Set(values)];
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
