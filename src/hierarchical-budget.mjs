export const WORK_PHASES = Object.freeze(["locate", "inspect", "edit", "verify", "report"]);

const BASE_WEIGHTS = Object.freeze({
  micro: Object.freeze({ locate: 0.1, inspect: 0.15, edit: 0.3, verify: 0.35, report: 0.1 }),
  standard: Object.freeze({ locate: 0.15, inspect: 0.25, edit: 0.3, verify: 0.2, report: 0.1 }),
  complex: Object.freeze({ locate: 0.15, inspect: 0.3, edit: 0.3, verify: 0.2, report: 0.05 }),
});

export function resolveHierarchicalBudget(options = {}) {
  const level = normalizeLevel(options.level);
  const taskClass = normalizeTaskClass(options.taskClass);
  const totalTokens = options.totalTokens == null ? null : positiveInteger(options.totalTokens, "totalTokens");
  if (level === "none" || totalTokens === null) return { version: 1, active: false, level, taskClass, totalTokens, phases: null, source: "inactive" };

  const trained = trainedWeights(options.telemetry, { level, taskClass, directEdit: options.directEdit === true }, options.minSamples ?? 8);
  const weights = trained?.weights ?? adjustedWeights(taskClass, options.directEdit === true);
  const phases = allocateExact(totalTokens, weights);
  return {
    version: 1,
    active: true,
    level,
    taskClass,
    difficulty: taskClass === "micro" ? 0.2 : taskClass === "standard" ? 0.55 : 0.9,
    totalTokens,
    phases,
    source: trained ? "verified-telemetry" : "deterministic",
    verifiedSamples: trained?.samples ?? 0,
    contract: WORK_PHASES.map((phase) => `${phase}:${phases[phase]}`).join(","),
  };
}

export function detectBudgetElasticity(records = []) {
  if (!Array.isArray(records)) throw new Error("records must be an array.");
  const ordered = records.filter(validRecord).sort((a, b) => Date.parse(a.timestamp ?? 0) - Date.parse(b.timestamp ?? 0));
  const events = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (sameContext(previous, current) && current.requested_output_tokens < previous.requested_output_tokens && current.actual_output_tokens > previous.actual_output_tokens) {
      events.push({ previousRequested: previous.requested_output_tokens, currentRequested: current.requested_output_tokens, previousActual: previous.actual_output_tokens, currentActual: current.actual_output_tokens });
    }
  }
  return { version: 1, detected: events.length > 0, events };
}

function trainedWeights(records, context, minSamples) {
  if (!Array.isArray(records)) return null;
  const samples = records.filter((record) => record?.verification_passed === true
    && record?.mode === context.level
    && record?.task_class === context.taskClass
    && Boolean(record?.direct_edit) === context.directEdit
    && WORK_PHASES.every((phase) => Number.isFinite(Number(record?.phase_tokens?.[phase]))));
  if (samples.length < minSamples) return null;
  const totals = Object.fromEntries(WORK_PHASES.map((phase) => [phase, samples.reduce((sum, record) => sum + Number(record.phase_tokens[phase]), 0)]));
  const sum = Object.values(totals).reduce((value, item) => value + item, 0);
  if (sum <= 0) return null;
  return { samples: samples.length, weights: normalizeWeights(Object.fromEntries(WORK_PHASES.map((phase) => [phase, Math.max(0.03, totals[phase] / sum)]))) };
}

function adjustedWeights(taskClass, directEdit) {
  if (!directEdit) return BASE_WEIGHTS[taskClass];
  const weights = { ...BASE_WEIGHTS[taskClass], edit: BASE_WEIGHTS[taskClass].edit + 0.05, verify: BASE_WEIGHTS[taskClass].verify + 0.05, report: 0.02 };
  return normalizeWeights(weights);
}

function allocateExact(total, weights) {
  const raw = WORK_PHASES.map((phase) => ({ phase, value: total * weights[phase] }));
  const result = Object.fromEntries(raw.map(({ phase, value }) => [phase, Math.floor(value)]));
  let remainder = total - Object.values(result).reduce((sum, value) => sum + value, 0);
  for (const item of [...raw].sort((a, b) => (b.value % 1) - (a.value % 1))) {
    if (remainder-- <= 0) break;
    result[item.phase] += 1;
  }
  return result;
}

function normalizeWeights(weights) { const total = Object.values(weights).reduce((sum, value) => sum + value, 0); return Object.fromEntries(WORK_PHASES.map((phase) => [phase, weights[phase] / total])); }
function sameContext(a, b) { return a.provider === b.provider && a.host === b.host && a.mode === b.mode && a.task_class === b.task_class; }
function validRecord(record) { return Number.isSafeInteger(record?.requested_output_tokens) && Number.isSafeInteger(record?.actual_output_tokens); }
function normalizeLevel(value) { const level = String(value ?? "full").toLowerCase(); if (!["none", "some", "full"].includes(level)) throw new Error(`Unknown level '${value}'.`); return level; }
function normalizeTaskClass(value) { const taskClass = String(value ?? "standard").toLowerCase(); if (!["micro", "standard", "complex"].includes(taskClass)) throw new Error(`Unknown task class '${value}'.`); return taskClass; }
function positiveInteger(value, name) { if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`); return value; }
