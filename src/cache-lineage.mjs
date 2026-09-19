import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const PROVIDERS = new Set(["openai", "anthropic", "canonical"]);
const LEVELS = new Set(["none", "some", "full"]);
const PREFIX_FIELDS = new Set(["model", "tools", "system", "reasoning", "tool_behavior", "cache"]);

export function createCacheLineageSnapshot(provider, request, options = {}) {
  const kind = assertProvider(provider);
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Request must be an object.");
  const components = componentValues(kind, request, options);
  const fingerprints = Object.fromEntries(Object.entries(components).map(([key, value]) => [key, fingerprint(value)]));
  return {
    version: 1,
    provider: kind,
    lineage_id: `sha256:${hash(stableStringify(fingerprints))}`,
    fingerprints,
    model: request.model == null ? null : String(request.model),
    tool_count: Array.isArray(request.tools) ? request.tools.length : 0,
  };
}

export function assessCacheLineage(previous, candidate, metrics = {}, options = {}) {
  const level = assertLevel(options.level ?? "some");
  if (!previous || !candidate) throw new Error("Previous and candidate lineage snapshots are required.");
  if (previous.provider !== candidate.provider) throw new Error("Lineage provider mismatch.");
  const changes = Object.keys(candidate.fingerprints).filter((key) => previous.fingerprints[key] !== candidate.fingerprints[key]);
  const invalidatingChanges = changes.filter((key) => PREFIX_FIELDS.has(key));
  const cachedTokensAtRisk = count(metrics.cachedTokensAtRisk ?? metrics.cacheReadTokens ?? 0, "cachedTokensAtRisk");
  const expectedSavings = [metrics.expectedInputTokenSavings, metrics.expectedOutputTokenSavings, metrics.expectedReasoningTokenSavings]
    .reduce((sum, value) => sum + count(value ?? 0, "expectedTokenSavings"), 0);
  const multiplier = level === "full" ? 1.25 : 0.75;
  const breakEvenTokens = Math.ceil(cachedTokensAtRisk * multiplier);
  const qualityRequired = Boolean(metrics.qualityRequired);
  const preserve = level !== "none" && invalidatingChanges.length > 0 && cachedTokensAtRisk > 0
    && !qualityRequired && expectedSavings < breakEvenTokens;
  let reason = "lineage unchanged";
  if (level === "none") reason = "controller off";
  else if (invalidatingChanges.length === 0) reason = "lineage unchanged";
  else if (qualityRequired) reason = "quality requirement overrides cache preservation";
  else if (cachedTokensAtRisk === 0) reason = "no measured cached prefix at risk";
  else if (preserve) reason = `projected saving ${expectedSavings} below ${breakEvenTokens}-token break-even`;
  else reason = `projected saving ${expectedSavings} meets ${breakEvenTokens}-token break-even`;
  return {
    version: 1,
    level,
    action: preserve ? "preserve" : "allow",
    preserve,
    changes,
    invalidating_changes: invalidatingChanges,
    cached_tokens_at_risk: cachedTokensAtRisk,
    expected_token_savings: expectedSavings,
    break_even_tokens: breakEvenTokens,
    quality_required: qualityRequired,
    reason,
  };
}

export function guardCacheLineage(provider, previousRequest, candidateRequest, metrics = {}, options = {}) {
  const kind = assertProvider(provider);
  const previous = createCacheLineageSnapshot(kind, previousRequest, options);
  const candidate = createCacheLineageSnapshot(kind, candidateRequest, options);
  const decision = assessCacheLineage(previous, candidate, metrics, options);
  const request = structuredClone(candidateRequest);
  const allowed = new Set(options.preserveFields ?? ["model", "reasoning"]);
  const restored = [];
  if (decision.preserve) {
    for (const field of decision.invalidating_changes) {
      if (!allowed.has(field)) continue;
      restoreComponent(kind, field, previousRequest, request);
      restored.push(field);
    }
  }
  return {
    request,
    decision: {
      ...decision,
      applied: restored.length > 0,
      restored_fields: restored,
      unresolved_changes: decision.invalidating_changes.filter((field) => !restored.includes(field)),
      selected_lineage_id: restored.length === decision.invalidating_changes.length ? previous.lineage_id : createCacheLineageSnapshot(kind, request, options).lineage_id,
    },
    previous,
    candidate,
  };
}

export function estimateCacheLineageOpportunity(values) {
  const input = count(values.inputTokens, "inputTokens");
  const currentCacheRead = count(values.cacheReadTokens, "cacheReadTokens");
  const targetCacheRead = count(values.targetCacheReadTokens, "targetCacheReadTokens");
  if (currentCacheRead > input || targetCacheRead > input) throw new Error("Cache-read tokens cannot exceed input tokens.");
  const recoverable = Math.max(0, targetCacheRead - currentCacheRead);
  const currentUncached = input - currentCacheRead;
  const projectedUncached = input - Math.max(currentCacheRead, targetCacheRead);
  return {
    version: 1,
    logical_input_token_reduction: 0,
    recoverable_uncached_tokens: recoverable,
    current_uncached_tokens: currentUncached,
    projected_uncached_tokens: projectedUncached,
    uncached_input_reduction_percent: currentUncached === 0 ? 0 : round((recoverable / currentUncached) * 100),
    input_shifted_to_cache_percent: input === 0 ? 0 : round((recoverable / input) * 100),
  };
}

export async function appendCacheLineageTelemetry(root, record) {
  const normalized = {
    version: 1,
    timestamp: record.timestamp ?? new Date().toISOString(),
    provider: record.provider ?? null,
    host: record.host ?? null,
    mode: record.mode ?? null,
    session_hash: record.sessionId ? `sha256:${hash(record.sessionId)}` : null,
    previous_lineage_id: record.previousLineageId ?? null,
    candidate_lineage_id: record.candidateLineageId ?? null,
    decision: record.decision ?? null,
  };
  normalized.event_id = `sha256:${hash(stableStringify(normalized))}`;
  const file = path.join(path.resolve(root), ".condiments", "cache-lineage", "events.jsonl");
  await mkdir(path.dirname(file), { recursive: true });
  const existing = await readEvents(file);
  if (!existing.some((item) => item.event_id === normalized.event_id)) await appendFile(file, `${JSON.stringify(normalized)}\n`, "utf8");
  return normalized;
}

export async function readCacheLineageTelemetry(root) {
  return readEvents(path.join(path.resolve(root), ".condiments", "cache-lineage", "events.jsonl"));
}

function componentValues(provider, request, options) {
  const shared = {
    model: request.model ?? null,
    tools: request.tools ?? null,
    system: provider === "anthropic" ? request.system ?? null : request.instructions ?? null,
    cache: provider === "anthropic"
      ? {
          control: request.cache_control ?? null,
          context_management: request.context_management ?? null,
          betas: request.betas ?? null,
        }
      : { key: request.prompt_cache_key ?? null, options: request.prompt_cache_options ?? null },
  };
  if (provider === "anthropic") {
    return {
      ...shared,
      reasoning: { thinking: request.thinking ?? null, effort: request.output_config?.effort ?? null },
      tool_behavior: { tool_choice: request.tool_choice ?? null, disable_parallel_tool_use: request.disable_parallel_tool_use ?? null },
      stable_messages: options.stableMessages ?? null,
    };
  }
  return {
    ...shared,
    reasoning: request.reasoning ?? request.reasoning_effort ?? null,
    tool_behavior: { tool_choice: request.tool_choice ?? null, parallel_tool_calls: request.parallel_tool_calls ?? null },
    stable_messages: options.stableMessages ?? null,
  };
}

function restoreComponent(provider, field, source, target) {
  if (field === "model") return copyKey(source, target, "model");
  if (field === "tools") return copyKey(source, target, "tools");
  if (field === "system") return copyKey(source, target, provider === "anthropic" ? "system" : "instructions");
  if (field === "cache") {
    for (const key of provider === "anthropic"
      ? ["cache_control", "context_management", "betas"]
      : ["prompt_cache_key", "prompt_cache_options"]) copyKey(source, target, key);
    return;
  }
  if (field === "reasoning") {
    for (const key of provider === "anthropic" ? ["thinking", "output_config"] : ["reasoning", "reasoning_effort"]) copyKey(source, target, key);
    return;
  }
  if (field === "tool_behavior") {
    for (const key of provider === "anthropic" ? ["tool_choice", "disable_parallel_tool_use"] : ["tool_choice", "parallel_tool_calls"]) copyKey(source, target, key);
  }
}

function copyKey(source, target, key) {
  if (Object.hasOwn(source, key)) target[key] = structuredClone(source[key]);
  else delete target[key];
}

function fingerprint(value) { return `sha256:${hash(stableStringify(value))}`; }
function hash(value) { return createHash("sha256").update(String(value)).digest("hex"); }
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function count(value, name) { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer.`); return parsed; }
function round(value) { return Math.round(value * 1000) / 1000; }
function assertProvider(value) { const provider = String(value ?? "").toLowerCase(); if (!PROVIDERS.has(provider)) throw new Error(`Unknown provider '${value}'.`); return provider; }
function assertLevel(value) { const level = String(value ?? "").toLowerCase(); if (!LEVELS.has(level)) throw new Error(`Unknown level '${value}'.`); return level; }
async function readEvents(file) {
  try { return (await readFile(file, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}
