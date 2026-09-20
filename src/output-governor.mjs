import { detectEditTask } from "./completion-policy.mjs";
import { resolveHierarchicalBudget } from "./hierarchical-budget.mjs";

export const OUTPUT_TASK_CLASSES = Object.freeze(["micro", "standard", "complex"]);
export const ADAPTIVE_OUTPUT_TOKEN_CAPS = Object.freeze({
  micro: 128,
  standard: 512,
  complex: 2_048,
});
export const DEFAULT_TOOL_ROUND_BUDGET = Object.freeze({
  discovery: 1,
  verification: 1,
  exceptional: 1,
});

export function assessOutputCapEconomics(options = {}) {
  const policyInputTokens = nonNegativeNumber(options.policyInputTokens ?? 0, "policyInputTokens");
  const projectedOutputSavingsTokens = nonNegativeNumber(
    options.projectedOutputSavingsTokens
      ?? (Number(options.predictedOutputTokens ?? 0) * Number(options.predictedSavingsRate ?? 0)),
    "projectedOutputSavingsTokens",
  );
  const safetyMultiplier = positiveNumber(options.safetyMultiplier ?? 1, "safetyMultiplier");
  const breakEvenTokens = Math.ceil(policyInputTokens * safetyMultiplier);
  const apply = projectedOutputSavingsTokens > breakEvenTokens;
  return {
    version: 1,
    apply,
    policyInputTokens,
    projectedOutputSavingsTokens: Math.round(projectedOutputSavingsTokens * 1_000) / 1_000,
    safetyMultiplier,
    breakEvenTokens,
    netProjectedSavingsTokens: Math.round((projectedOutputSavingsTokens - policyInputTokens) * 1_000) / 1_000,
    reason: apply ? "projected-output-savings-exceed-policy-cost" : "policy-cost-not-repaid",
  };
}

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
  const economics = options.enforceEconomics === true ? assessOutputCapEconomics(options.outputEconomics ?? options) : null;
  if (level === "none" || (economics && !economics.apply)) {
    return {
      version: 1,
      active: false,
      level,
      ...classification,
      outputTokenCap: null,
      toolCallCap: null,
      suppressRecap: false,
      contract: null,
      economics,
      reason: level === "none" ? "inactive" : economics.reason,
    };
  }

  const outputCaps = level === "full" ? ADAPTIVE_OUTPUT_TOKEN_CAPS : SOME_OUTPUT_TOKEN_CAPS;
  const finalDirectEdit = classification.directEdit && classification.phase === "final";
  const baseOutputTokenCap = finalDirectEdit ? ADAPTIVE_OUTPUT_TOKEN_CAPS.micro : outputCaps[classification.taskClass];
  const requiredEvidenceTokens = nonNegativeInteger(options.requiredEvidenceTokens ?? 0, "requiredEvidenceTokens");
  const outputTokenCap = requiredEvidenceTokens > baseOutputTokenCap
    ? requiredEvidenceTokens + 64
    : baseOutputTokenCap;
  const toolCallCap = finalDirectEdit ? 0 : TOOL_CALL_CAPS[level][classification.taskClass];
  const suppressRecap = classification.directEdit;
  const contract = [
    `Output cap ${outputTokenCap} tokens. Complete required result first.`,
    `Use at most ${toolCallCap} tool calls${toolCallCap === 0 ? "; call no tools" : "; batch independent calls into one discovery round and one verification round"}.`,
    "Reuse sufficient existing results. Any exceptional tool round requires missing required evidence and a written justification.",
    suppressRecap
      ? "Edit files directly. After success return only changed path(s), test result, and material failure. No recap or code reproduction."
      : "Stop when required result is complete. Omit recap and optional follow-up offers.",
    requiredEvidenceTokens > baseOutputTokenCap
      ? "Required evidence exceeds the normal cap: preserve it in an artifact and link it, or use the expanded cap when artifacts are unavailable."
      : "Never remove required evidence to meet the cap.",
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
    baseOutputTokenCap,
    capExpandedForEvidence: outputTokenCap > baseOutputTokenCap,
    requiredEvidenceTokens,
    toolCallCap,
    toolRoundBudget: DEFAULT_TOOL_ROUND_BUDGET,
    reuseExistingResults: true,
    extraToolCallsRequireJustification: true,
    suppressRecap,
    hierarchicalBudget,
    economics,
    contract,
  };
}

export function resolveToolRoundDecision(options = {}) {
  const level = normalizeLevel(options.level);
  if (level === "none") return { allow: true, exceptional: false, reason: "inactive" };
  const phase = normalizeToolPhase(options.toolPhase ?? options.phase ?? "discovery");
  const roundsUsed = nonNegativeInteger(options.roundsUsed ?? 0, "roundsUsed");
  const exceptionalRoundsUsed = nonNegativeInteger(options.exceptionalRoundsUsed ?? 0, "exceptionalRoundsUsed");
  const requiredEvidenceMissing = options.requiredEvidenceMissing === true;
  const justification = String(options.justification ?? "").trim();

  if (options.existingResultAvailable === true && !requiredEvidenceMissing) {
    return { allow: false, exceptional: false, reason: "reuse-existing-result" };
  }
  if (roundsUsed < DEFAULT_TOOL_ROUND_BUDGET[phase]) {
    return { allow: true, exceptional: false, reason: `${phase}-round-available` };
  }
  if (!requiredEvidenceMissing) {
    return { allow: false, exceptional: false, reason: "sufficient-evidence" };
  }
  if (!justification) {
    return { allow: false, exceptional: false, reason: "justification-required" };
  }
  if (exceptionalRoundsUsed >= DEFAULT_TOOL_ROUND_BUDGET.exceptional) {
    return { allow: false, exceptional: false, reason: "exception-limit" };
  }
  return { allow: true, exceptional: true, reason: "required-evidence-exception", justification };
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

function normalizeToolPhase(value) {
  const phase = String(value ?? "discovery").toLowerCase();
  if (!["discovery", "verification"].includes(phase)) throw new Error(`Unknown tool phase '${value}'.`);
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

function nonNegativeNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${name} must be a non-negative number.`);
  return number;
}

function positiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be a positive number.`);
  return number;
}
