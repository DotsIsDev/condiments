const PROVIDERS = new Set(["openai", "anthropic", "openclaw", "cursor", "canonical"]);

export function normalizeUsage(provider, payload, metadata = {}) {
  const kind = String(provider || "").toLowerCase();
  if (!PROVIDERS.has(kind)) {
    throw new Error(`Unknown provider '${provider}'. Use ${[...PROVIDERS].join(", ")}.`);
  }
  if (!payload || typeof payload !== "object") throw new Error("Usage payload must be an object.");

  const source = unwrap(kind, payload);
  let inputTokens;
  let outputTokens;
  let reasoningTokens;
  let cacheReadTokens;
  let cacheWriteTokens;
  let cacheReadReported = false;
  let cacheWriteReported = false;
  let cacheWrite5mTokens = 0;
  let cacheWrite1hTokens = 0;

  if (kind === "openai") {
    inputTokens = count(first(source.input_tokens, source.prompt_tokens));
    outputTokens = count(first(source.output_tokens, source.completion_tokens));
    cacheReadTokens = count(first(
      source.input_tokens_details?.cached_tokens,
      source.prompt_tokens_details?.cached_tokens,
      source.cached_input_tokens,
    ));
    cacheReadReported = hasAny(source, [
      ["input_tokens_details", "cached_tokens"],
      ["prompt_tokens_details", "cached_tokens"],
      ["cached_input_tokens"],
    ]);
    cacheWriteTokens = count(first(
      source.input_tokens_details?.cache_write_tokens,
      source.prompt_tokens_details?.cache_write_tokens,
      source.cache_write_input_tokens,
    ));
    cacheWriteReported = hasAny(source, [
      ["input_tokens_details", "cache_write_tokens"],
      ["prompt_tokens_details", "cache_write_tokens"],
      ["cache_write_input_tokens"],
    ]);
    reasoningTokens = count(first(
      source.output_tokens_details?.reasoning_tokens,
      source.completion_tokens_details?.reasoning_tokens,
      source.reasoning_output_tokens,
    ));
  } else if (kind === "anthropic") {
    const freshInput = count(source.input_tokens);
    cacheReadTokens = count(source.cache_read_input_tokens);
    cacheWriteTokens = count(source.cache_creation_input_tokens);
    cacheReadReported = hasOwn(source, "cache_read_input_tokens");
    cacheWriteReported = hasOwn(source, "cache_creation_input_tokens");
    cacheWrite5mTokens = count(source.cache_creation?.ephemeral_5m_input_tokens);
    cacheWrite1hTokens = count(source.cache_creation?.ephemeral_1h_input_tokens);
    inputTokens = freshInput + cacheReadTokens + cacheWriteTokens;
    outputTokens = count(source.output_tokens);
    reasoningTokens = count(source.output_tokens_details?.thinking_tokens);
  } else if (kind === "cursor") {
    const freshInput = count(first(source.inputTokens, source.input_tokens));
    cacheReadTokens = count(first(source.cacheReadTokens, source.cache_read_tokens));
    cacheWriteTokens = count(first(source.cacheWriteTokens, source.cache_write_tokens));
    cacheReadReported = hasOwn(source, "cacheReadTokens") || hasOwn(source, "cache_read_tokens");
    cacheWriteReported = hasOwn(source, "cacheWriteTokens") || hasOwn(source, "cache_write_tokens");
    inputTokens = freshInput + cacheReadTokens + cacheWriteTokens;
    outputTokens = count(first(source.outputTokens, source.output_tokens));
    reasoningTokens = count(first(source.reasoningTokens, source.reasoning_tokens));
  } else if (kind === "openclaw") {
    const freshInput = count(first(source.input, source.input_tokens));
    cacheReadTokens = count(first(source.cacheRead, source.cache_read_tokens));
    cacheWriteTokens = count(first(source.cacheWrite, source.cache_write_tokens));
    cacheReadReported = hasOwn(source, "cacheRead") || hasOwn(source, "cache_read_tokens");
    cacheWriteReported = hasOwn(source, "cacheWrite") || hasOwn(source, "cache_write_tokens");
    inputTokens = freshInput + cacheReadTokens + cacheWriteTokens;
    outputTokens = count(first(source.output, source.output_tokens));
    reasoningTokens = count(first(source.reasoning, source.reasoning_tokens));
  } else {
    inputTokens = count(source.input_tokens);
    outputTokens = count(source.output_tokens);
    reasoningTokens = count(source.reasoning_tokens);
    cacheReadTokens = count(source.cache_read_tokens);
    cacheWriteTokens = count(source.cache_write_tokens);
    cacheReadReported = hasOwn(source, "cache_read_tokens");
    cacheWriteReported = hasOwn(source, "cache_write_tokens");
    cacheWrite5mTokens = count(source.cache_write_5m_tokens);
    cacheWrite1hTokens = count(source.cache_write_1h_tokens);
  }

  if (reasoningTokens > outputTokens) {
    throw new Error("Reasoning tokens cannot exceed output tokens.");
  }
  if (cacheReadTokens + cacheWriteTokens > inputTokens) {
    throw new Error("Cache token subsets cannot exceed total input tokens.");
  }
  if (cacheWrite5mTokens + cacheWrite1hTokens > cacheWriteTokens) {
    throw new Error("Cache-write TTL buckets cannot exceed cache-write tokens.");
  }

  const uncachedInputTokens = inputTokens - cacheReadTokens;
  const billableInputTokens = inputTokens - cacheReadTokens - cacheWriteTokens;
  const costUsd = optionalNumber(first(
    metadata.costUsd,
    source.cost_usd,
    source.cost?.total,
    source.cost?.turn_usd,
  ));

  return {
    version: 1,
    provider: kind,
    model: metadata.model ?? payload.model ?? null,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    reasoning_tokens: reasoningTokens,
    cache_read_tokens: cacheReadTokens,
    cache_write_tokens: cacheWriteTokens,
    cache_write_5m_tokens: cacheWrite5mTokens,
    cache_write_1h_tokens: cacheWrite1hTokens,
    cache_read_reported: cacheReadReported,
    cache_write_reported: cacheWriteReported,
    cache_telemetry_available: cacheReadReported || cacheWriteReported,
    uncached_input_tokens: uncachedInputTokens,
    billable_input_tokens: billableInputTokens,
    total_tokens: inputTokens + outputTokens,
    cost_usd: costUsd,
    tool_result_chars: count(metadata.toolResultChars),
    tool_calls: count(metadata.toolCalls),
    model_calls: count(metadata.modelCalls ?? 1),
    compaction_count: count(metadata.compactionCount),
    retry_count: count(metadata.retryCount),
    wall_time_ms: count(metadata.wallTimeMs),
    verification_passed: Boolean(metadata.verificationPassed),
    cache_hit_ratio: cacheReadReported && inputTokens > 0
      ? round(cacheReadTokens / inputTokens)
      : null,
  };
}

export function summarizeRuns(runs) {
  if (!Array.isArray(runs) || runs.length === 0) throw new Error("At least one normalized run is required.");
  const totals = {
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cache_write_5m_tokens: 0,
    cache_write_1h_tokens: 0,
    uncached_input_tokens: 0,
    billable_input_tokens: 0,
    total_tokens: 0,
    tool_result_chars: 0,
    tool_calls: 0,
    model_calls: 0,
    compaction_count: 0,
    retry_count: 0,
    wall_time_ms: 0,
  };
  let totalCostUsd = 0;
  let pricedRuns = 0;
  let verifiedSuccesses = 0;
  let cacheReadReportedRuns = 0;
  let cacheWriteReportedRuns = 0;
  let cacheReadEligibleInput = 0;
  for (const run of runs) {
    for (const key of Object.keys(totals)) {
      totals[key] += count(run[key]);
    }
    if (run.cost_usd !== null && run.cost_usd !== undefined) {
      totalCostUsd += optionalNumber(run.cost_usd);
      pricedRuns += 1;
    }
    if (run.verification_passed) verifiedSuccesses += 1;
    if (run.cache_read_reported) {
      cacheReadReportedRuns += 1;
      cacheReadEligibleInput += count(run.input_tokens);
    }
    if (run.cache_write_reported) cacheWriteReportedRuns += 1;
  }

  return {
    version: 1,
    runs: runs.length,
    verified_successes: verifiedSuccesses,
    ...totals,
    cost_usd: pricedRuns === runs.length ? round(totalCostUsd) : null,
    cost_complete: pricedRuns === runs.length,
    cache_read_reported_runs: cacheReadReportedRuns,
    cache_write_reported_runs: cacheWriteReportedRuns,
    cache_telemetry_complete: cacheReadReportedRuns === runs.length && cacheWriteReportedRuns === runs.length,
    cache_hit_ratio: cacheReadEligibleInput === 0
      ? null
      : round(totals.cache_read_tokens / cacheReadEligibleInput),
    cost_per_successful_task: pricedRuns === runs.length && verifiedSuccesses > 0
      ? round(totalCostUsd / verifiedSuccesses)
      : null,
  };
}

export function compareEfficiency(baselineSummary, candidateSummary) {
  const baseline = baselineSummary?.cost_per_successful_task;
  const candidate = candidateSummary?.cost_per_successful_task;
  return {
    verified_efficiency: positiveFinite(baseline) && positiveFinite(candidate)
      ? round(baseline / candidate)
      : null,
    token_ratio: positiveFinite(baselineSummary?.total_tokens)
      ? round(candidateSummary.total_tokens / baselineSummary.total_tokens)
      : null,
  };
}

function unwrap(provider, payload) {
  if (provider === "cursor") return payload.totalUsage ?? payload.usage ?? payload;
  return payload.usage ?? payload.response?.usage ?? payload;
}

function first(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function hasOwn(value, key) {
  return Boolean(value) && typeof value === "object" && Object.hasOwn(value, key)
    && value[key] !== undefined && value[key] !== null;
}

function hasAny(value, paths) {
  return paths.some((parts) => {
    let current = value;
    for (const part of parts) {
      if (!hasOwn(current, part)) return false;
      current = current[part];
    }
    return true;
  });
}

function count(value) {
  if (value === undefined || value === null) return 0;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid token/count value '${value}'.`);
  return parsed;
}

function optionalNumber(value) {
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid numeric value '${value}'.`);
  return parsed;
}

function positiveFinite(value) {
  return Number.isFinite(value) && value > 0;
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
