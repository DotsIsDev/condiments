import { detectEditTask } from "./completion-policy.mjs";
import { resolveHierarchicalBudget } from "./hierarchical-budget.mjs";

export const OUTPUT_TASK_CLASSES = Object.freeze(["micro", "standard", "complex"]);
export const ADAPTIVE_OUTPUT_TOKEN_CAPS = Object.freeze({
  micro: 128,
  standard: 512,
  complex: 2_048,
});

const SOME_OUTPUT_TOKEN_CAPS = Object.freeze({
  micro: 512,
  standard: 2_048,
  complex: 4_096,
});
const TOOL_CALL_CAPS = Object.freeze({
  some: Object.freeze({ micro: 2, standard: 8, complex: 16 }),
  full: Object.freeze({ micro: 1, standard: 4, complex: 8 }),
});
const COMPLEX_TASK = /\b(?:architect|audit|benchmark|compare|comprehensive|design|diagnos|investigat|migration|multi[- ]file|performance|research|root cause|security|system-wide)\b/i;
const MICRO_TASK = /^\s*(?:\/cond(?:iments)?\s+status|status|yes|no|ok|confirm|continue|what(?:'s| is) next)\s*[?.!]*\s*$/i;

export function classifyOutputTask(task, options = {}) {
  const text = String(task ?? "").trim();
  const explicit = normalizeTaskClass(options.taskClass, true);
  const edit = detectEditTask(text);
  const directEdit = options.directEdit === true || (edit.isEdit && options.capabilities?.directFileEdit === true);
  const phase = normalizePhase(options.phase);
  let taskClass;
  let reason;

  if (explicit) {
    taskClass = explicit;
    reason = "explicit";
  } else if (phase === "final" && directEdit) {
    taskClass = "micro";
    reason = "direct-edit-final";
  } else if (MICRO_TASK.test(text)) {
    taskClass = "micro";
    reason = "small-answer";
  } else if (COMPLEX_TASK.test(text) || text.length > 600) {
    taskClass = "complex";
    reason = "complex-signals";
  } else {
    taskClass = "standard";
    reason = edit.isEdit ? "edit-execution" : "default";
  }

  return {
    version: 1,
    taskClass,
    reason,
    editTask: edit.isEdit,
    directEdit,
    phase,
  };
}

export function resolveAdaptiveOutputPolicy(options = {}) {
  const level = normalizeLevel(options.level);
  const classification = classifyOutputTask(options.task, options);
  if (level === "none") {
    return {
      version: 1,
      active: false,
      level,
      ...classification,
      outputTokenCap: null,
      toolCallCap: null,
      suppressRecap: false,
      contract: null,
    };
  }

  const outputCaps = level === "full" ? ADAPTIVE_OUTPUT_TOKEN_CAPS : SOME_OUTPUT_TOKEN_CAPS;
  const finalDirectEdit = classification.directEdit && classification.phase === "final";
  const outputTokenCap = finalDirectEdit ? ADAPTIVE_OUTPUT_TOKEN_CAPS.micro : outputCaps[classification.taskClass];
  const toolCallCap = finalDirectEdit ? 0 : TOOL_CALL_CAPS[level][classification.taskClass];
  const suppressRecap = classification.directEdit;
  const contract = [
    `Output cap ${outputTokenCap} tokens. Complete required result first.`,
    `Use at most ${toolCallCap} tool calls${toolCallCap === 0 ? "; call no tools" : "; batch independent calls"}.`,
    suppressRecap
      ? "Edit files directly. After success return only changed path(s), test result, and material failure. No recap or code reproduction."
      : "Stop when required result is complete. Omit recap and optional follow-up offers.",
    "Retry only when a required result is missing.",
  ].join(" ");
  const hierarchicalBudget = resolveHierarchicalBudget({
    level,
    taskClass: classification.taskClass,
    totalTokens: outputTokenCap,
    directEdit: classification.directEdit,
    telemetry: options.telemetry,
    minSamples: options.minPhaseSamples,
  });

  return {
    version: 1,
    active: true,
    level,
    ...classification,
    outputTokenCap,
    toolCallCap,
    suppressRecap,
    hierarchicalBudget,
    contract,
  };
}

export function resolveGovernorRetry(options = {}) {
  const policy = options.policy?.active
    ? options.policy
    : resolveAdaptiveOutputPolicy(options);
  const attempt = nonNegativeInteger(options.attempt ?? 0, "attempt");
  const maxRetries = nonNegativeInteger(options.maxRetries ?? 2, "maxRetries");
  const missing = missingRequiredResults(options.requiredResults);
  if (options.requiredResultMissing === true && !missing.includes("required-result")) missing.push("required-result");
  const requiredResultMissing = missing.length > 0;

  if (!policy.active || !requiredResultMissing || attempt >= maxRetries) {
    return {
      retry: false,
      reason: !policy.active ? "inactive" : !requiredResultMissing ? "required-result-complete" : "retry-limit",
      missing,
      nextOutputTokenCap: null,
    };
  }

  const current = positiveInteger(options.currentOutputTokenCap ?? policy.outputTokenCap, "currentOutputTokenCap");
  const nextOutputTokenCap = nextCap(current);
  return {
    retry: true,
    reason: "required-result-missing",
    missing,
    nextOutputTokenCap,
    instruction: `Return only missing required result(s): ${missing.join(", ")}. Cap ${nextOutputTokenCap} tokens.`,
  };
}

function missingRequiredResults(results) {
  if (!Array.isArray(results)) return [];
  const missing = [];
  for (const [index, result] of results.entries()) {
    if (typeof result === "string") {
      missing.push(result);
      continue;
    }
    if (!result || typeof result !== "object" || result.required === false) continue;
    if (result.present === true || result.valid === true || result.passed === true) continue;
    missing.push(String(result.name ?? result.id ?? `result-${index + 1}`));
  }
  return [...new Set(missing)];
}

function nextCap(current) {
  for (const cap of Object.values(ADAPTIVE_OUTPUT_TOKEN_CAPS)) {
    if (cap > current) return cap;
  }
  return ADAPTIVE_OUTPUT_TOKEN_CAPS.complex;
}

function normalizeLevel(value) {
  const level = String(value ?? "full").toLowerCase();
  if (!["none", "some", "full"].includes(level)) throw new Error(`Unknown governor level '${value}'.`);
  return level;
}

function normalizeTaskClass(value, optional = false) {
  if ((value === undefined || value === null || value === "") && optional) return null;
  const taskClass = String(value ?? "standard").toLowerCase();
  if (!OUTPUT_TASK_CLASSES.includes(taskClass)) throw new Error(`Unknown output task class '${value}'.`);
  return taskClass;
}

function normalizePhase(value) {
  const phase = String(value ?? "execution").toLowerCase();
  if (!["execution", "final"].includes(phase)) throw new Error(`Unknown output phase '${value}'.`);
  return phase;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function nonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value;
}
