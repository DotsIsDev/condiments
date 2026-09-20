export const WORKFLOW_MINIMUM_SAMPLES = 8;
export const WORKFLOW_BREAK_EVEN_SAFETY_MARGIN = 1.25;

export function assessWorkflowPruning(input = {}) {
  const workflowId = requiredText(input.workflowId, "workflowId");
  const expectedFutureRuns = nonNegativeNumber(input.expectedFutureRuns ?? 0, "expectedFutureRuns");
  const minimumSamples = positiveInteger(input.minimumSamples ?? WORKFLOW_MINIMUM_SAMPLES, "minimumSamples");
  const safetyMargin = positiveNumber(input.safetyMargin ?? WORKFLOW_BREAK_EVEN_SAFETY_MARGIN, "safetyMargin");
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  if (!candidates.length) throw new Error("candidates must contain at least one workflow step.");
  const decisions = candidates.map((candidate) => assessCandidate(candidate, { expectedFutureRuns, minimumSamples, safetyMargin }));
  return {
    version: 1,
    workflowId,
    expectedFutureRuns,
    minimumSamples,
    safetyMargin,
    deployable: decisions.some((decision) => decision.approved),
    decisions,
  };
}

function assessCandidate(candidate, options) {
  const stepId = requiredText(candidate.stepId, "candidate.stepId");
  const action = String(candidate.action ?? "prune").toLowerCase();
  if (!["prune", "downgrade"].includes(action)) throw new Error(`Unknown workflow action '${candidate.action}'.`);
  const optimizationCost = nonNegativeNumber(candidate.optimizationCost ?? 0, "candidate.optimizationCost");
  const samples = Array.isArray(candidate.samples) ? candidate.samples.map(normalizeSample) : [];
  const savings = samples.map((sample) => sample.baselineCost - sample.candidateCost);
  const meanSavings = mean(savings);
  const standardError = savings.length > 1 ? sampleStandardDeviation(savings) / Math.sqrt(savings.length) : Infinity;
  const lower95 = Number.isFinite(standardError) ? meanSavings - 1.96 * standardError : -Infinity;
  const baselineSuccesses = samples.filter((sample) => sample.baselineSuccess).length;
  const candidateSuccesses = samples.filter((sample) => sample.candidateSuccess).length;
  const regressions = samples.filter((sample) => sample.baselineSuccess && !sample.candidateSuccess).length;
  const breakEvenRuns = lower95 > 0 ? Math.ceil(optimizationCost / lower95) : null;
  const requiredFutureRuns = breakEvenRuns === null ? null : Math.ceil(breakEvenRuns * options.safetyMargin);

  let reason = "approved";
  if (samples.length < options.minimumSamples) reason = "insufficient-paired-samples";
  else if (regressions > 0 || candidateSuccesses < baselineSuccesses) reason = "quality-regression";
  else if (!(lower95 > 0)) reason = "savings-not-positive-at-95pct-bound";
  else if (options.expectedFutureRuns < requiredFutureRuns) reason = "insufficient-future-runs-to-amortize";
  const approved = reason === "approved";
  return {
    stepId,
    action,
    targetModel: candidate.targetModel ?? null,
    samples: samples.length,
    baselineSuccesses,
    candidateSuccesses,
    regressions,
    meanSavingPerRun: round(meanSavings),
    lower95SavingPerRun: Number.isFinite(lower95) ? round(lower95) : null,
    optimizationCost,
    breakEvenRuns,
    requiredFutureRuns,
    approved,
    reason,
  };
}

function normalizeSample(sample) {
  return {
    baselineCost: nonNegativeNumber(sample?.baselineCost, "sample.baselineCost"),
    candidateCost: nonNegativeNumber(sample?.candidateCost, "sample.candidateCost"),
    baselineSuccess: sample?.baselineSuccess === true,
    candidateSuccess: sample?.candidateSuccess === true,
  };
}

function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function sampleStandardDeviation(values) { const average = mean(values); return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1)); }
function requiredText(value, name) { const text = String(value ?? "").trim(); if (!text) throw new Error(`${name} is required.`); return text; }
function positiveInteger(value, name) { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`); return parsed; }
function positiveNumber(value, name) { const parsed = Number(value); if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be positive.`); return parsed; }
function nonNegativeNumber(value, name) { const parsed = Number(value); if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be non-negative.`); return parsed; }
function round(value) { return Math.round(value * 1_000_000) / 1_000_000; }
