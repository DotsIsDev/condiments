const COMPLEX = /\b(?:architect|audit|benchmark|complex|design|investigat|migration|multi[- ]file|prove|research|security|system-wide)\b/i;
const ESCALATE = /\b(?:blocked|failed twice|high risk|incorrect|regression|security|data loss)\b/i;
const MICRO = /^\s*(?:status|continue|yes|no|ok|rename|typo|format|what(?:'s| is) next)\b/i;

export function resolveQwenThinkingPolicy(options = {}) {
  const level = normalizeLevel(options.level);
  const capabilities = normalizeCapabilities(options.capabilities);
  const taskClass = classify(options.task, options.taskClass);
  if (level === "none") return decision(false, "inactive", taskClass);
  if (!capabilities.hybridThinking) return decision(false, "hybrid-thinking-unsupported", taskClass);

  const escalated = options.qualityRequired === true || options.blocked === true || ESCALATE.test(String(options.task ?? ""));
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
  const thinkingBudget = capabilities.thinkingBudget ? requestedBudget : null;
  return {
    version: 1,
    active: true,
    applied: true,
    reason: escalated ? "quality-escalation" : enableThinking ? "bounded-thinking" : "routine-no-thinking",
    level,
    taskClass,
    enableThinking,
    thinkingBudget,
    budgetSupported: capabilities.thinkingBudget,
    escalated,
  };
}

export function decorateQwenRequest(request, options = {}) {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Qwen request must be an object.");
  const policy = resolveQwenThinkingPolicy(options);
  const output = structuredClone(request);
  if (!policy.applied) return { request: output, policy };
  const surface = String(options.surface ?? "openai-compatible").toLowerCase();
  let target;
  if (surface === "openai-compatible") {
    output.extra_body = object(output.extra_body);
    target = output.extra_body;
  } else if (surface === "native") {
    target = output;
  } else {
    return { request: structuredClone(request), policy: { ...policy, applied: false, reason: "unsupported-request-surface" } };
  }
  target.enable_thinking = policy.enableThinking;
  if (policy.enableThinking && policy.thinkingBudget !== null) {
    const existing = positiveIntegerOrNull(target.thinking_budget);
    target.thinking_budget = existing === null ? policy.thinkingBudget : Math.min(existing, policy.thinkingBudget);
  } else {
    delete target.thinking_budget;
  }
  return { request: output, policy };
}

function classify(task, explicit) {
  if (explicit != null) {
    const normalized = String(explicit).toLowerCase();
    if (!["micro", "standard", "complex"].includes(normalized)) throw new Error(`Unknown Qwen task class '${explicit}'.`);
    return normalized;
  }
  const text = String(task ?? "");
  if (MICRO.test(text)) return "micro";
  if (COMPLEX.test(text) || text.length > 600) return "complex";
  return "standard";
}

function normalizeCapabilities(value) {
  return { hybridThinking: value?.hybridThinking === true, thinkingBudget: value?.thinkingBudget === true };
}

function decision(applied, reason, taskClass) { return { version: 1, active: reason !== "inactive", applied, reason, taskClass, enableThinking: null, thinkingBudget: null }; }
function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function positiveIntegerOrNull(value) { return Number.isSafeInteger(value) && value > 0 ? value : null; }
function normalizeLevel(value) { const level = String(value ?? "full").toLowerCase(); if (!["none", "some", "full"].includes(level)) throw new Error(`Unknown level '${value}'.`); return level; }
