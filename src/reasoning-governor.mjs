import { guardCacheLineage } from "./cache-lineage.mjs";

const PROVIDERS = new Set(["openai", "anthropic", "qwen", "deepseek"]);
const LEVELS = new Set(["none", "some", "full"]);
const TASK_CLASSES = new Set(["micro", "standard", "complex"]);
const COMPLEX = /\b(?:architect|audit|benchmark|complex|design|investigat|migration|multi[- ]file|prove|research|security|system-wide)\b/i;
const ESCALATE = /\b(?:blocked|failed twice|high risk|incorrect|regression|security|data loss)\b/i;
const MICRO = /^\s*(?:status|continue|yes|no|ok|rename|typo|format|what(?:'s| is) next)\b/i;
const EFFORTS = Object.freeze(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
const STANDARD_EFFORTS = Object.freeze(["low", "medium", "high"]);
const DEEPSEEK_EFFORTS = Object.freeze(["none", "low", "high", "max"]);
const DEEPSEEK_ALIASES = Object.freeze({ minimal: "low", medium: "high", xhigh: "high", ultra: "max" });
const CONTEXT_MANAGEMENT_BETA = "context-management-2025-06-27";

export function classifyReasoningTask(task, explicit) {
  if (explicit != null) {
    const normalized = String(explicit).toLowerCase();
    if (!TASK_CLASSES.has(normalized)) throw new Error(`Unknown reasoning task class '${explicit}'.`);
    return normalized;
  }
  const text = String(task ?? "");
  if (MICRO.test(text)) return "micro";
  if (COMPLEX.test(text) || text.length > 600) return "complex";
  return "standard";
}

export function resolveProviderReasoningPolicy(provider, options = {}) {
  const kind = assertProvider(provider);
  const level = assertLevel(options.level ?? "full");
  const taskClass = classifyReasoningTask(options.task, options.taskClass);
  if (level === "none") return decision(kind, false, "inactive", level, taskClass);
  if (kind === "qwen") return resolveQwen(level, taskClass, options);
  if (kind === "deepseek") return resolveDeepSeek(level, taskClass, options);
  if (options.capabilities?.reasoningEffort !== true) {
    return decision(kind, false, "reasoning-effort-unsupported", level, taskClass);
  }
  const escalated = isEscalated(options);
  const desired = escalated
    ? "max"
    : level === "some"
      ? taskClass === "micro" ? "low" : taskClass === "standard" ? "medium" : "high"
      : taskClass === "complex" ? "high" : "low";
  const supported = normalizeSupportedEfforts(options.capabilities?.supportedEfforts, STANDARD_EFFORTS);
  const effort = selectSupportedEffort(desired, supported, escalated);
  if (effort === null) return decision(kind, false, "no-supported-effort", level, taskClass);
  return {
    version: 1,
    provider: kind,
    active: true,
    applied: true,
    reason: escalated ? "quality-escalation" : effort === "low" ? "bounded-reasoning" : "adaptive-reasoning",
    level,
    taskClass,
    effort,
    requestedEffort: desired,
    supportedEfforts: supported,
    escalated,
  };
}

export function decorateProviderReasoningRequest(provider, request, options = {}) {
  const kind = assertProvider(provider);
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Provider request must be an object.");
  if (kind === "qwen") return decorateQwen(request, options);
  if (kind === "deepseek") return decorateDeepSeek(request, options);

  const policy = resolveProviderReasoningPolicy(kind, options);
  const output = structuredClone(request);
  const state = { applied: false, mechanism: "unavailable" };
  const context = { applied: false, reason: "unavailable" };
  if (policy.level === "none") return { request: output, policy, state, context, lineage: null };

  if (kind === "openai") {
    if (String(options.api ?? "responses").toLowerCase() !== "responses") {
      return unsupportedSurface(request, policy, state, context, "OpenAI reasoning control requires the Responses API");
    }
    if (policy.applied) {
      output.reasoning = object(output.reasoning);
      const current = normalizeEffort(output.reasoning.effort);
      const effective = selectCallerEffort(policy.effort, current, policy.escalated);
      output.reasoning.effort = effective;
      policy.effort = effective;
      policy.preservedLowerCallerEffort = current !== null && effective !== policy.requestedEffort;
    }
    if (options.capabilities?.responseState === true && options.previousResponseId && !output.previous_response_id) {
      output.previous_response_id = String(options.previousResponseId);
      state.applied = true;
      state.mechanism = "previous_response_id";
    }
  } else {
    if (String(options.api ?? "messages").toLowerCase() !== "messages") {
      return unsupportedSurface(request, policy, state, context, "Anthropic reasoning control requires the Messages API");
    }
    const toolContinuation = options.toolContinuation === true || hasToolResultContinuation(output.messages);
    if (policy.applied && !toolContinuation) {
      output.output_config = object(output.output_config);
      const current = normalizeEffort(output.output_config.effort);
      const effective = selectCallerEffort(policy.effort, current, policy.escalated);
      output.output_config.effort = effective;
      policy.effort = effective;
      policy.preservedLowerCallerEffort = current !== null && effective !== policy.requestedEffort;
    } else if (toolContinuation && policy.applied) {
      policy.applied = false;
      policy.reason = "tool-continuity-preserved";
    }
    if (options.capabilities?.contextEditing === true && options.enableContextEditing !== false && !toolContinuation) {
      const keep = policy.level === "full" ? 1 : 2;
      const edits = Array.isArray(output.context_management?.edits)
        ? structuredClone(output.context_management.edits)
        : [];
      if (!edits.some((edit) => edit?.type === "clear_thinking_20251015")) {
        edits.unshift({ type: "clear_thinking_20251015", keep: { type: "thinking_turns", value: keep } });
        output.context_management = { ...object(output.context_management), edits };
        output.betas = unique([...(Array.isArray(output.betas) ? output.betas : []), CONTEXT_MANAGEMENT_BETA]);
        context.applied = true;
        context.reason = "server-side-thinking-clear";
        context.keepThinkingTurns = keep;
      } else {
        context.reason = "caller-context-policy-preserved";
      }
    } else if (toolContinuation) {
      context.reason = "tool-continuity-preserved";
    } else if (options.capabilities?.contextEditing !== true) {
      context.reason = "context-editing-unsupported";
    }
  }

  if (!options.previousRequest) return { request: output, policy, state, context, lineage: null };
  const guarded = guardCacheLineage(kind, options.previousRequest, output, options.lineageMetrics ?? {}, {
    level: policy.level,
    preserveFields: options.preserveLineageFields ?? ["reasoning", "cache"],
    stableMessages: options.stableMessages,
  });
  if (guarded.decision.restored_fields.includes("reasoning")) {
    policy.applied = false;
    policy.reason = "cache-lineage-preserved";
    policy.effort = kind === "anthropic"
      ? guarded.request.output_config?.effort ?? null
      : guarded.request.reasoning?.effort ?? null;
  }
  if (guarded.decision.restored_fields.includes("cache")) {
    context.applied = false;
    context.reason = "cache-lineage-preserved";
  }
  return { request: guarded.request, policy, state, context, lineage: guarded.decision };
}

function resolveQwen(level, taskClass, options) {
  const capabilities = options.capabilities ?? {};
  if (capabilities.hybridThinking !== true) return qwenDecision(false, "hybrid-thinking-unsupported", level, taskClass);
  const escalated = isEscalated(options);
  let enableThinking;
  let requestedBudget = null;
  if (level === "some") {
    enableThinking = taskClass !== "micro" || escalated;
    requestedBudget = taskClass === "complex" ? 4_096 : 1_024;
  } else {
    enableThinking = taskClass === "complex" || escalated;
    requestedBudget = escalated ? 4_096 : 2_048;
  }
  if (!enableThinking) requestedBudget = null;
  return {
    version: 1, provider: "qwen", active: true, applied: true,
    reason: escalated ? "quality-escalation" : enableThinking ? "bounded-thinking" : "routine-no-thinking",
    level, taskClass, enableThinking,
    thinkingBudget: capabilities.thinkingBudget === true ? requestedBudget : null,
    budgetSupported: capabilities.thinkingBudget === true,
    escalated,
  };
}

function resolveDeepSeek(level, taskClass, options) {
  const capabilities = options.capabilities ?? {};
  if (capabilities.reasoningEffort !== true) return decision("deepseek", false, "reasoning-effort-unsupported", level, taskClass);
  const escalated = isEscalated(options);
  const effort = escalated
    ? "max"
    : level === "some"
      ? taskClass === "micro" ? "low" : "high"
      : taskClass === "micro" ? "none" : taskClass === "standard" ? "low" : "high";
  return {
    version: 1, provider: "deepseek", active: true, applied: true,
    reason: escalated ? "quality-escalation" : effort === "none" ? "routine-no-thinking" : "bounded-reasoning",
    level, taskClass, effort,
    scalarEffort: effort === "none" ? 0 : effort === "low" ? 50 : effort === "high" ? 75 : 100,
    escalated,
  };
}

function decorateQwen(request, options) {
  const policy = resolveProviderReasoningPolicy("qwen", options);
  const output = structuredClone(request);
  if (!policy.applied) return { request: output, policy };
  const surface = String(options.surface ?? "openai-compatible").toLowerCase();
  const target = surface === "openai-compatible"
    ? (output.extra_body = object(output.extra_body))
    : surface === "native" ? output : null;
  if (!target) return { request: structuredClone(request), policy: { ...policy, applied: false, reason: "unsupported-request-surface" } };
  target.enable_thinking = policy.enableThinking;
  if (policy.enableThinking && policy.thinkingBudget !== null) {
    const current = positiveIntegerOrNull(target.thinking_budget);
    target.thinking_budget = current === null ? policy.thinkingBudget : Math.min(current, policy.thinkingBudget);
  } else delete target.thinking_budget;
  return { request: output, policy };
}

function decorateDeepSeek(request, options) {
  const policy = resolveProviderReasoningPolicy("deepseek", options);
  const output = structuredClone(request);
  if (!policy.applied) return { request: output, policy, history: unchangedHistory() };
  const api = String(options.api ?? "chat-completions").toLowerCase();
  const current = deepSeekCurrentEffort(output, api);
  const effective = selectDeepSeekCallerEffort(policy.effort, current, policy.escalated);
  if (api === "chat-completions") {
    output.thinking = object(output.thinking);
    output.thinking.type = effective === "none" ? "disabled" : "enabled";
    if (effective === "none") delete output.reasoning_effort;
    else output.reasoning_effort = effective;
  } else if (api === "responses") {
    output.reasoning = object(output.reasoning);
    output.reasoning.effort = effective;
  } else {
    return { request: structuredClone(request), policy: { ...policy, applied: false, reason: "unsupported-request-surface" }, history: unchangedHistory() };
  }
  const history = api === "chat-completions" ? pruneDeepSeekHistory(output, options.capabilities) : unchangedHistory();
  return {
    request: output,
    policy: { ...policy, requestedEffort: policy.effort, effort: effective, preservedLowerCallerEffort: current !== null && effective !== policy.effort },
    history,
  };
}

function pruneDeepSeekHistory(request, capabilities) {
  const messages = Array.isArray(request.messages) ? request.messages : [];
  if (capabilities?.reasoningHistoryElision !== true) return unchangedHistory("history-elision-unsupported");
  if (Array.isArray(request.tools) && request.tools.length > 0) return unchangedHistory("tool-continuity-required");
  const lastUser = messages.findLastIndex((message) => message?.role === "user");
  if (lastUser < 0) return unchangedHistory("no-user-boundary");
  let removedMessages = 0;
  let removedChars = 0;
  let removedBytes = 0;
  request.messages = messages.map((message, index) => {
    if (index >= lastUser || message?.role !== "assistant" || typeof message.reasoning_content !== "string") return message;
    const copy = { ...message };
    removedChars += copy.reasoning_content.length;
    removedBytes += Buffer.byteLength(copy.reasoning_content, "utf8");
    removedMessages += 1;
    delete copy.reasoning_content;
    return copy;
  });
  return {
    applied: removedMessages > 0,
    reason: removedMessages > 0 ? "prior-reasoning-not-required-without-tools" : "no-prunable-reasoning",
    removedMessages, removedChars, estimatedTokensSaved: Math.ceil(removedBytes / 4),
  };
}

function hasToolResultContinuation(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  const latest = messages.at(-1);
  if (latest?.role !== "user") return false;
  const content = Array.isArray(latest.content) ? latest.content : [];
  return content.some((block) => block?.type === "tool_result");
}

function selectSupportedEffort(desired, supported, escalated) {
  if (supported.length === 0) return null;
  if (escalated) return supported.at(-1);
  const desiredRank = EFFORTS.indexOf(desired);
  return [...supported].reverse().find((effort) => EFFORTS.indexOf(effort) <= desiredRank) ?? supported[0];
}

function selectCallerEffort(requested, current, escalated) {
  if (escalated || current === null) return requested;
  return EFFORTS.indexOf(current) < EFFORTS.indexOf(requested) ? current : requested;
}

function normalizeSupportedEfforts(value, fallback) {
  const raw = Array.isArray(value) && value.length > 0 ? value : fallback;
  return unique(raw.map(normalizeEffort).filter(Boolean)).sort((a, b) => EFFORTS.indexOf(a) - EFFORTS.indexOf(b));
}

function normalizeEffort(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).toLowerCase();
  return EFFORTS.includes(normalized) ? normalized : null;
}

function deepSeekCurrentEffort(request, api) {
  if (api === "chat-completions" && request.thinking?.type === "disabled") return "none";
  const raw = api === "responses" ? request.reasoning?.effort : request.reasoning_effort;
  if (raw === undefined || raw === null) return null;
  const normalized = DEEPSEEK_ALIASES[String(raw).toLowerCase()] ?? String(raw).toLowerCase();
  return DEEPSEEK_EFFORTS.includes(normalized) ? normalized : null;
}

function selectDeepSeekCallerEffort(requested, current, escalated) {
  if (escalated || current === null) return requested;
  return DEEPSEEK_EFFORTS.indexOf(current) < DEEPSEEK_EFFORTS.indexOf(requested) ? current : requested;
}

function unsupportedSurface(request, policy, state, context, reason) {
  return { request: structuredClone(request), policy: { ...policy, applied: false, reason }, state, context, lineage: null };
}

function isEscalated(options) {
  return options.qualityRequired === true || options.blocked === true || ESCALATE.test(String(options.task ?? ""));
}

function decision(provider, applied, reason, level, taskClass) {
  return { version: 1, provider, active: reason !== "inactive", applied, reason, level, taskClass, effort: null, escalated: false };
}

function qwenDecision(applied, reason, level, taskClass) {
  return { version: 1, provider: "qwen", active: reason !== "inactive", applied, reason, level, taskClass, enableThinking: null, thinkingBudget: null };
}

function unchangedHistory(reason = "unchanged") {
  return { applied: false, reason, removedMessages: 0, removedChars: 0, estimatedTokensSaved: 0 };
}

function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function positiveIntegerOrNull(value) { return Number.isSafeInteger(value) && value > 0 ? value : null; }
function unique(values) { return [...new Set(values)]; }
function assertProvider(value) { const provider = String(value ?? "").toLowerCase(); if (!PROVIDERS.has(provider)) throw new Error(`Unknown reasoning provider '${value}'.`); return provider; }
function assertLevel(value) { const level = String(value ?? "").toLowerCase(); if (!LEVELS.has(level)) throw new Error(`Unknown level '${value}'.`); return level; }
