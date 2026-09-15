import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const PROVIDERS = new Set(["openai", "anthropic", "canonical"]);
const HOSTS = new Set(["openclaw", "claude-code", "codex-cli", "cursor"]);
const LEVELS = new Set(["none", "some", "full"]);
const CORE_CATEGORIES = Object.freeze(["search", "read", "edit", "shell"]);

const TASK_SIGNALS = Object.freeze([
  ["web", /\b(?:latest|online|internet|research|website|url|web)\b/i],
  ["browser", /\b(?:browser|click|screenshot|page|dom|ui test)\b/i],
  ["image", /\b(?:image|photo|illustration|graphic|visual)\b/i],
  ["github", /\b(?:github|pull request|\bpr\b|issue|commit)\b/i],
  ["messaging", /\b(?:slack|message|email|gmail|discord)\b/i],
  ["calendar", /\b(?:calendar|meeting|schedule|event)\b/i],
  ["database", /\b(?:database|sql|query|table|postgres|mysql)\b/i],
  ["finance", /\b(?:stock|crypto|price|market|portfolio|trade)\b/i],
  ["test", /\b(?:tests?|lint|build|compile|verify)\b/i],
  ["edit", /\b(?:add|change|create|delete|edit|fix|implement|modify|patch|refactor|remove|rename|replace|update|write)\b/i],
  ["read", /\b(?:analy[sz]e|explain|find|inspect|read|review|search|trace)\b/i],
]);

export function detectRequiredTools(task) {
  const text = String(task ?? "");
  const categories = new Set();
  for (const [category, expression] of TASK_SIGNALS) if (expression.test(text)) categories.add(category);
  if (categories.has("edit")) {
    categories.add("search");
    categories.add("read");
    categories.add("shell");
  }
  if (categories.has("test")) categories.add("shell");
  return { task_hash: hash(text), categories: [...categories].sort() };
}

export function describeTool(tool, index = 0) {
  const value = tool && typeof tool === "object" ? tool : {};
  const type = String(value.type ?? "function");
  const name = String(value.name ?? value.function?.name ?? value.server_label ?? `${type}-${index}`);
  const server = String(value.server_label ?? value.server_name ?? value.toolset_name ?? "");
  const raw = `${type} ${name} ${server} ${value.description ?? ""}`.toLowerCase();
  const haystack = raw.replace(/[_:-]+/g, " ");
  const mcp = type === "mcp" || type === "mcp_toolset" || /(?:^|[_:\s-])mcp(?:$|[_:\s-])/.test(raw);
  const toolSearch = /tool[ _:-]?search/.test(raw);
  let category = "other";
  if (toolSearch) category = "tool-search";
  else if (/apply.?patch|\bedit\b|\bwrite\b|replace/.test(haystack)) category = "edit";
  else if (/file.?search|search.?files|\bfind\b|\bglob\b|\bgrep\b/.test(haystack)) category = "search";
  else if (/\bread\b/.test(haystack)) category = "read";
  else if (/\bshell\b|\bbash\b|exec|terminal|command/.test(haystack)) category = "shell";
  else if (/browser|computer|playwright|screenshot|dom/.test(haystack)) category = "browser";
  else if (/web.?search|web.?fetch|internet/.test(haystack)) category = "web";
  else if (/image|photo|graphic/.test(haystack)) category = "image";
  else if (/github|gitlab|pull.?request/.test(haystack)) category = "github";
  else if (/slack|gmail|email|message|discord/.test(haystack)) category = "messaging";
  else if (/calendar|meeting|event/.test(haystack)) category = "calendar";
  else if (/database|postgres|mysql|sql|query/.test(haystack)) category = "database";
  else if (/stock|crypto|finance|market|trade/.test(haystack)) category = "finance";
  else if (/\btest\b|lint|build|compile/.test(haystack)) category = "test";
  else if (/\bsearch\b/.test(haystack)) category = "search";
  return { index, name, type, server: server || null, category, mcp, toolSearch };
}

export function resolveToolPlan(task, tools, options = {}) {
  const level = assertLevel(options.level ?? "some");
  const required = detectRequiredTools(task);
  const descriptors = (Array.isArray(tools) ? tools : []).map(describeTool);
  const core = [];
  for (const category of CORE_CATEGORIES) {
    const match = descriptors.find((tool) => tool.category === category && !tool.mcp);
    if (match && !core.includes(match.index)) core.push(match.index);
  }
  for (const tool of descriptors.filter((item) => item.toolSearch)) if (!core.includes(tool.index)) core.push(tool.index);
  const needed = descriptors.filter((tool) => required.categories.includes(tool.category)
    || required.categories.some((category) => tool.name.toLowerCase().includes(category)))
    .map((tool) => tool.index);
  const disabled = level === "full"
    ? descriptors.filter((tool) => tool.mcp && !needed.includes(tool.index)).map((tool) => tool.index)
    : [];
  const eager = [...new Set([...core, ...(!options.lazySupported ? needed : [])])].filter((index) => !disabled.includes(index));
  const deferred = level === "none" || !options.lazySupported
    ? []
    : descriptors.map((tool) => tool.index).filter((index) => descriptors[index].type !== "mcp_toolset"
      && !eager.includes(index) && !disabled.includes(index));
  return {
    version: 1,
    level,
    required,
    core: core.map((index) => descriptors[index].name),
    eager: eager.map((index) => descriptors[index].name),
    deferred: deferred.map((index) => descriptors[index].name),
    disabled: disabled.map((index) => descriptors[index].name),
    indexes: { core, eager, deferred, disabled },
  };
}

export function decorateToolContextRequest(provider, request, options = {}) {
  const kind = assertProvider(provider);
  const level = assertLevel(options.level ?? "some");
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Provider request must be an object.");
  const before = structuredClone(request);
  const output = structuredClone(request);
  output.tools = Array.isArray(output.tools) ? output.tools : [];
  if (level === "none") {
    return { request: output, control: { provider: kind, level, applied: false, mechanism: "provider-default" }, split_before: measureContextSplit(before), split_after: measureContextSplit(output) };
  }

  const existingSearch = output.tools.some((tool, index) => describeTool(tool, index).toolSearch);
  let searchTool = null;
  if (!existingSearch && kind === "anthropic" && options.supportsToolSearch !== false) {
    searchTool = { type: "tool_search_tool_bm25_20251119", name: "tool_search_tool_bm25" };
    output.tools.push(searchTool);
  } else if (!existingSearch && options.toolSearchTool && typeof options.toolSearchTool === "object") {
    searchTool = structuredClone(options.toolSearchTool);
    output.tools.push(searchTool);
  }
  const lazySupported = existingSearch || Boolean(searchTool);
  const plan = resolveToolPlan(options.task, output.tools, { level, lazySupported });
  const disabled = new Set(plan.indexes.disabled);
  const deferred = new Set(plan.indexes.deferred);
  output.tools = output.tools.flatMap((tool, index) => {
    if (disabled.has(index)) return [];
    const clone = structuredClone(tool);
    if (deferred.has(index) && clone.type !== "mcp_toolset") {
      clone.defer_loading = true;
      delete clone.cache_control;
    }
    return [clone];
  });

  const stableCore = output.tools.filter((tool, index) => {
    const descriptor = describeTool(tool, index);
    return descriptor.toolSearch || (CORE_CATEGORIES.includes(descriptor.category) && !tool.defer_loading);
  }).slice(0, 5);
  const stableCoreFingerprint = `sha256:${hash(stableStringify(stableCore))}`;
  if (kind === "openai" && !output.prompt_cache_key) output.prompt_cache_key = `cond-tools-${stableCoreFingerprint.slice(7, 47)}`;
  if (kind === "anthropic" && stableCore.length && !output.tools.some((tool) => tool.cache_control)) {
    const lastCore = stableCore.at(-1);
    lastCore.cache_control = { type: "ephemeral", ...(level === "full" ? { ttl: "1h" } : {}) };
  }
  const control = {
    provider: kind,
    level,
    applied: plan.deferred.length > 0 || plan.disabled.length > 0 || stableCore.length > 0,
    mechanism: lazySupported ? "defer-loading" : "allowlist-only",
    lazy_supported: lazySupported,
    stable_core: stableCore.map((tool, index) => describeTool(tool, index).name),
    stable_core_fingerprint: stableCoreFingerprint,
    required_categories: plan.required.categories,
    deferred_tools: plan.deferred,
    disabled_tools: plan.disabled,
  };
  return { request: output, control, split_before: measureContextSplit(before), split_after: measureContextSplit(output) };
}

export function measureContextSplit(request, options = {}) {
  const tools = Array.isArray(request?.tools) ? request.tools : [];
  const messages = [...messageValues(request?.input), ...messageValues(request?.messages)];
  const systemValues = [request?.instructions, request?.system, ...messages.filter((item) => ["system", "developer"].includes(item.role)).map((item) => item.content)].filter((value) => value !== undefined);
  const userValues = messages.filter((item) => !["system", "developer"].includes(item.role)).map((item) => item.content);
  const bytes = { system: byteSize(systemValues), user_context: byteSize(userValues), core_tools: 0, other_tools: 0, mcp_tools: 0, deferred_tools: 0 };
  for (let index = 0; index < tools.length; index += 1) {
    const tool = tools[index];
    const size = byteSize(tool);
    const descriptor = describeTool(tool, index);
    if (tool.defer_loading === true) bytes.deferred_tools += size;
    else if (descriptor.mcp) bytes.mcp_tools += size;
    else if (descriptor.toolSearch || CORE_CATEGORIES.includes(descriptor.category)) bytes.core_tools += size;
    else bytes.other_tools += size;
  }
  const estimated_tokens = Object.fromEntries(Object.entries(bytes).map(([key, value]) => [key, tokenProxy(value)]));
  const estimatedVisible = estimated_tokens.system + estimated_tokens.user_context + estimated_tokens.core_tools + estimated_tokens.other_tools + estimated_tokens.mcp_tools;
  const reportedInput = optionalCount(options.reportedInputTokens);
  return {
    version: 1,
    source: options.exactSplit ? "provider-exact" : "utf8-byte-proxy",
    bytes,
    estimated_tokens,
    estimated_visible_tokens: estimatedVisible,
    reported_input_tokens: reportedInput,
    unattributed_reported_tokens: reportedInput === null ? null : Math.max(0, reportedInput - estimatedVisible),
    exact_tokens: options.exactSplit ?? null,
    tool_count: tools.length,
    deferred_tool_count: tools.filter((tool) => tool?.defer_loading === true).length,
    mcp_tool_count: tools.filter((tool, index) => describeTool(tool, index).mcp).length,
  };
}

export async function appendToolContextTelemetry(root, record) {
  const normalized = {
    version: 1,
    timestamp: record.timestamp ?? new Date().toISOString(),
    provider: record.provider ?? null,
    host: record.host ?? null,
    mode: record.mode ?? null,
    task_hash: record.task_hash ?? null,
    control: record.control ?? null,
    before: record.before,
    after: record.after,
    actual_input_tokens: optionalCount(record.actual_input_tokens),
    actual_output_tokens: optionalCount(record.actual_output_tokens),
    verification_passed: Boolean(record.verification_passed),
  };
  normalized.event_id = `sha256:${hash(stableStringify(normalized))}`;
  const file = path.join(path.resolve(root), ".condiments", "tool-context", "events.jsonl");
  await mkdir(path.dirname(file), { recursive: true });
  const existing = await readTelemetry(file);
  if (!existing.some((item) => item.event_id === normalized.event_id)) await appendFile(file, `${JSON.stringify(normalized)}\n`, "utf8");
  return normalized;
}

export async function readToolContextTelemetry(root) {
  return readTelemetry(path.join(path.resolve(root), ".condiments", "tool-context", "events.jsonl"));
}

export function summarizeToolContext(records) {
  const values = Array.isArray(records) ? records : [];
  const modes = {};
  for (const record of values) {
    const key = record.mode ?? "unknown";
    modes[key] ??= { runs: 0, verified: 0, actual_input_tokens: 0, actual_output_tokens: 0, estimated_visible_before: 0, estimated_visible_after: 0 };
    const bucket = modes[key];
    bucket.runs += 1;
    if (record.verification_passed) bucket.verified += 1;
    bucket.actual_input_tokens += record.actual_input_tokens ?? 0;
    bucket.actual_output_tokens += record.actual_output_tokens ?? 0;
    bucket.estimated_visible_before += record.before?.estimated_visible_tokens ?? 0;
    bucket.estimated_visible_after += record.after?.estimated_visible_tokens ?? 0;
  }
  return { version: 1, events: values.length, modes };
}

export async function installNativeToolContextControl(host, targetRoot, options = {}) {
  assertHost(host);
  if (host !== "openclaw") return { installed: true, supported: false, reason: "project skill cannot alter host tool schemas" };
  const baseline = await captureOpenClawBaseline(path.resolve(targetRoot), options.runCommand ?? runCommand);
  return { installed: true, supported: true, baselinePath: baseline.path, mechanism: "tools.codeMode" };
}

export async function applyNativeToolContextPolicy(host, targetRoot, level, options = {}) {
  assertHost(host);
  assertLevel(level);
  const root = path.resolve(targetRoot);
  let detail;
  if (host !== "openclaw") {
    detail = { applied: false, supported: false, reason: "host project surface cannot change model-visible tool schemas" };
  } else {
    const runner = options.runCommand ?? runCommand;
    const baseline = await captureOpenClawBaseline(root, runner);
    const codeMode = level === "none"
      ? (baseline.value.present ? baseline.value.codeMode : null)
      : { enabled: level === "full" ? true : "auto" };
    const patchValue = { tools: { codeMode } };
    const patchPath = path.join(root, ".condiments", "tool-context", "openclaw-patch.json");
    await atomicWriteJson(patchPath, patchValue);
    if (!baseline.value.commandAvailable) detail = { applied: false, pending: true, reason: "openclaw command unavailable", patchPath };
    else detail = { patchPath, codeMode, ...await applyOpenClawPatch(patchPath, runner) };
  }
  const receipt = { version: 1, host, level, appliedAt: new Date().toISOString(), detail };
  await atomicWriteJson(path.join(root, ".condiments", "tool-context", "last-apply.json"), receipt);
  return receipt;
}

async function captureOpenClawBaseline(root, runner) {
  const baselinePath = path.join(root, ".condiments", "tool-context", "openclaw-baseline.json");
  try {
    const existing = JSON.parse(await readFile(baselinePath, "utf8"));
    if (existing.value?.commandAvailable) return { ...existing, path: baselinePath };
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  let value;
  try {
    const tools = JSON.parse(await runner("openclaw", ["config", "get", "tools", "--json"]));
    value = { commandAvailable: true, present: Object.hasOwn(tools, "codeMode"), codeMode: tools.codeMode ?? null };
  } catch (error) {
    value = { commandAvailable: false, present: false, codeMode: null, reason: error.message };
  }
  const baseline = { version: 1, host: "openclaw", capturedAt: new Date().toISOString(), value };
  await atomicWriteJson(baselinePath, baseline);
  return { ...baseline, path: baselinePath };
}

async function applyOpenClawPatch(patchPath, runner) {
  try {
    await runner("openclaw", ["config", "patch", "--file", patchPath, "--dry-run"]);
    await runner("openclaw", ["config", "patch", "--file", patchPath]);
    return { applied: true, via: "openclaw config patch" };
  } catch (error) {
    return { applied: false, pending: true, reason: error.message };
  }
}

function messageValues(value) {
  if (typeof value === "string") return [{ role: "user", content: value }];
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === "object" && item.role).map((item) => ({ role: item.role, content: item.content }));
}

function byteSize(value) { return Buffer.byteLength(typeof value === "string" ? value : stableStringify(value), "utf8"); }
function tokenProxy(bytes) { return Math.ceil(bytes / 4); }
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function hash(value) { return createHash("sha256").update(String(value)).digest("hex"); }
function optionalCount(value) {
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid token count '${value}'.`);
  return parsed;
}
async function readTelemetry(file) {
  try { return (await readFile(file, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}
async function atomicWriteJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}
function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [], stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(Buffer.concat(stdout).toString("utf8")) : reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `${command} exited ${code}`)));
  });
}
function assertProvider(value) { const provider = String(value ?? "").toLowerCase(); if (!PROVIDERS.has(provider)) throw new Error(`Unknown provider '${value}'.`); return provider; }
function assertLevel(value) { const level = String(value ?? "").toLowerCase(); if (!LEVELS.has(level)) throw new Error(`Unknown level '${value}'.`); return level; }
function assertHost(value) { if (!HOSTS.has(value)) throw new Error(`Unknown host '${value}'.`); }
