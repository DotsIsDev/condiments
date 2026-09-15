export const OUTPUT_CAP_TRAINING_DEFAULTS = Object.freeze({
  minSamples: 8,
  quantile: 0.95,
  headroom: 1.2,
  quantum: 64,
  lookback: 100,
});

const CLASS_FLOORS = Object.freeze({ micro: 64, standard: 256, complex: 512 });

export function selectTelemetryTrainedOutputCap(records, context = {}, options = {}) {
  if (!Array.isArray(records)) throw new Error("Output-cap records must be an array.");
  const level = normalizeLevel(context.level ?? context.mode);
  const taskClass = normalizeTaskClass(context.taskClass ?? context.task_class);
  const fallbackCap = positiveInteger(context.fallbackCap, "fallbackCap");
  if (level === "none") return decision(false, "inactive", fallbackCap, []);
  if (!context.provider || !context.host) return decision(false, "missing-training-dimensions", fallbackCap, []);

  const settings = normalizeOptions(options);
  const matching = records
    .filter((record) => matches(record, { ...context, level, taskClass }))
    .sort(byTimestamp)
    .slice(-settings.lookback);
  const measured = matching.filter((record) => Number.isSafeInteger(record.actual_output_tokens) && record.actual_output_tokens >= 0);
  const qualityLosses = measured.filter((record) => record.required_result_lost === true || (record.cap_hit === true && record.verification_passed === false));
  const verified = measured.filter((record) => record.verification_passed === true && record.required_result_lost !== true);

  if (qualityLosses.length) {
    return decision(false, "recent-cap-quality-loss", fallbackCap, verified, { qualityLosses: qualityLosses.length });
  }
  if (verified.length < settings.minSamples) {
    return decision(false, "insufficient-verified-samples", fallbackCap, verified, { requiredSamples: settings.minSamples });
  }

  const observed = nearestRank(verified.map((record) => record.actual_output_tokens), settings.quantile);
  const censoredFloor = Math.max(0, ...verified
    .filter((record) => record.cap_hit === true)
    .map((record) => Number(record.requested_output_tokens ?? record.actual_output_tokens ?? 0)));
  const classFloor = options.minimumCap === undefined
    ? CLASS_FLOORS[taskClass]
    : positiveInteger(options.minimumCap, "minimumCap");
  const candidate = quantizeUp(Math.max(classFloor, observed * settings.headroom, censoredFloor), settings.quantum);
  if (candidate >= fallbackCap) {
    return decision(false, "no-smaller-safe-cap", fallbackCap, verified, { observedQuantile: observed, candidateCap: candidate });
  }
  return decision(true, "verified-telemetry", candidate, verified, {
    fallbackCap,
    observedQuantile: observed,
    candidateCap: candidate,
    estimatedCapReduction: (fallbackCap - candidate) / fallbackCap,
    settings,
  });
}

export function trainOutputCapPolicy(records, options = {}) {
  if (!Array.isArray(records)) throw new Error("Output-cap records must be an array.");
  const groups = new Map();
  for (const record of records) {
    if (!record?.provider || !record?.mode || !record?.task_class) continue;
    if (!["some", "full"].includes(record.mode)) continue;
    const key = [record.provider, record.host ?? "*", record.mode, record.task_class].join("|");
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  return {
    version: 1,
    trained_at: new Date().toISOString(),
    groups: [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, group]) => {
      const [provider, host, level, taskClass] = key.split("|");
      const fallbackCap = fallbackFor(level, taskClass);
      return { provider, host: host === "*" ? null : host, level, task_class: taskClass,
        ...selectTelemetryTrainedOutputCap(group, { provider, host: host === "*" ? undefined : host, level, taskClass, fallbackCap }, options) };
    }),
  };
}

function matches(record, context) {
  if (record?.provider !== context.provider) return false;
  if (record?.mode !== context.level) return false;
  if (record?.task_class !== context.taskClass) return false;
  if (context.host && record?.host !== context.host) return false;
  return true;
}

function decision(applied, reason, cap, verified, extra = {}) {
  return {
    version: 1,
    active: reason !== "inactive",
    applied,
    reason,
    cap,
    verifiedSamples: verified.length,
    ...extra,
  };
}

function normalizeOptions(options) {
  const minSamples = positiveInteger(options.minSamples ?? OUTPUT_CAP_TRAINING_DEFAULTS.minSamples, "minSamples");
  const quantile = Number(options.quantile ?? OUTPUT_CAP_TRAINING_DEFAULTS.quantile);
  const headroom = Number(options.headroom ?? OUTPUT_CAP_TRAINING_DEFAULTS.headroom);
  const quantum = positiveInteger(options.quantum ?? OUTPUT_CAP_TRAINING_DEFAULTS.quantum, "quantum");
  const lookback = positiveInteger(options.lookback ?? OUTPUT_CAP_TRAINING_DEFAULTS.lookback, "lookback");
  if (!(quantile > 0 && quantile <= 1)) throw new Error("quantile must be greater than 0 and at most 1.");
  if (!(headroom >= 1 && Number.isFinite(headroom))) throw new Error("headroom must be at least 1.");
  return { minSamples, quantile, headroom, quantum, lookback };
}

function nearestRank(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)];
}

function quantizeUp(value, quantum) {
  return Math.ceil(value / quantum) * quantum;
}

function fallbackFor(level, taskClass) {
  const caps = level === "full"
    ? { micro: 128, standard: 512, complex: 2_048 }
    : { micro: 512, standard: 2_048, complex: 4_096 };
  return caps[taskClass];
}

function byTimestamp(left, right) {
  return Date.parse(left?.timestamp ?? 0) - Date.parse(right?.timestamp ?? 0);
}

function normalizeLevel(value) {
  const level = String(value ?? "").toLowerCase();
  if (!["none", "some", "full"].includes(level)) throw new Error(`Unknown output-cap level '${value}'.`);
  return level;
}

function normalizeTaskClass(value) {
  const taskClass = String(value ?? "").toLowerCase();
  if (!["micro", "standard", "complex"].includes(taskClass)) throw new Error(`Unknown output task class '${value}'.`);
  return taskClass;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}
