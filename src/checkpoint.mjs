export const CHECKPOINT_FIELDS = Object.freeze([
  "version",
  "goal",
  "constraints",
  "decisions",
  "changed_files",
  "commands_and_results",
  "known_failures",
  "opaque_identifiers",
  "artifact_paths",
  "next_action",
]);

export const CHECKPOINT_MAX_BYTES = 16_000;
export const CHECKPOINT_PRESSURE_THRESHOLDS = Object.freeze({ some: 0.85, full: 0.70 });
export const CHECKPOINT_MINIMUM_TURNS = 4;

const LIST_LIMITS = Object.freeze({
  constraints: { maxItems: 20, maxItemChars: 1_000 },
  decisions: { maxItems: 20, maxItemChars: 1_000 },
  changed_files: { maxItems: 50, maxItemChars: 1_000 },
  commands_and_results: { maxItems: 30, maxItemChars: 2_000 },
  known_failures: { maxItems: 20, maxItemChars: 1_000 },
  opaque_identifiers: { maxItems: 50, maxItemChars: 1_000 },
  artifact_paths: { maxItems: 50, maxItemChars: 1_000 },
});

export class CheckpointValidationError extends Error {
  constructor(errors) {
    super(`Invalid checkpoint: ${errors.join("; ")}`);
    this.name = "CheckpointValidationError";
    this.errors = errors;
  }
}

export function checkpointTemplate() {
  return {
    version: 1,
    goal: "",
    constraints: [],
    decisions: [],
    changed_files: [],
    commands_and_results: [],
    known_failures: [],
    opaque_identifiers: [],
    artifact_paths: [],
    next_action: "",
  };
}

export function resolveCheckpointDecision(options = {}) {
  const level = String(options.level ?? "full").toLowerCase();
  if (!["none", "some", "full"].includes(level)) throw new Error(`Unknown checkpoint level '${options.level}'.`);
  if (level === "none") return { create: false, level, reason: "inactive", pressure: null, threshold: null };
  if (options.explicit === true) return { create: true, level, reason: "explicit", pressure: null, threshold: CHECKPOINT_PRESSURE_THRESHOLDS[level] };

  const turnCount = nonNegativeInteger(options.turnCount ?? 0, "turnCount");
  const threshold = CHECKPOINT_PRESSURE_THRESHOLDS[level];
  if (turnCount < CHECKPOINT_MINIMUM_TURNS) {
    return { create: false, level, reason: "short-session", pressure: pressure(options), threshold, minimumTurns: CHECKPOINT_MINIMUM_TURNS };
  }
  if (options.compactionImminent === true) {
    return { create: true, level, reason: "compaction-imminent", pressure: pressure(options), threshold, minimumTurns: CHECKPOINT_MINIMUM_TURNS };
  }
  const ratio = pressure(options);
  if (ratio === null) return { create: false, level, reason: "pressure-unavailable", pressure: null, threshold, minimumTurns: CHECKPOINT_MINIMUM_TURNS };
  return {
    create: ratio >= threshold,
    level,
    reason: ratio >= threshold ? (options.milestone === true ? "milestone-under-pressure" : "context-pressure") : "below-pressure-threshold",
    pressure: ratio,
    threshold,
    minimumTurns: CHECKPOINT_MINIMUM_TURNS,
  };
}

export function generateCheckpoint(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new CheckpointValidationError(["checkpoint must be an object"]);
  }

  const unknownFields = Object.keys(candidate).filter(
    (field) => !CHECKPOINT_FIELDS.includes(field),
  );
  if (unknownFields.length > 0) {
    throw new CheckpointValidationError([
      `unknown field(s): ${unknownFields.sort().join(", ")}`,
    ]);
  }

  const checkpoint = checkpointTemplate();
  checkpoint.version = candidate.version ?? 1;
  checkpoint.goal = candidate.goal;
  checkpoint.next_action = candidate.next_action;
  for (const field of Object.keys(LIST_LIMITS)) {
    checkpoint[field] = deduplicate(candidate[field] ?? []);
  }

  const result = validateCheckpoint(checkpoint);
  if (!result.valid) throw new CheckpointValidationError(result.errors);
  return checkpoint;
}

export function validateCheckpoint(candidate) {
  const errors = [];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { valid: false, errors: ["checkpoint must be an object"] };
  }

  for (const field of CHECKPOINT_FIELDS) {
    if (!(field in candidate)) errors.push(`missing field '${field}'`);
  }
  for (const field of Object.keys(candidate)) {
    if (!CHECKPOINT_FIELDS.includes(field)) errors.push(`unknown field '${field}'`);
  }

  if (candidate.version !== 1) errors.push("version must equal 1");
  validateRequiredText(candidate.goal, "goal", errors);
  validateRequiredText(candidate.next_action, "next_action", errors);

  for (const [field, limits] of Object.entries(LIST_LIMITS)) {
    validateList(candidate[field], field, limits, errors);
  }

  if (errors.length === 0) {
    const bytes = Buffer.byteLength(JSON.stringify(candidate), "utf8");
    if (bytes > CHECKPOINT_MAX_BYTES) {
      errors.push(`checkpoint exceeds ${CHECKPOINT_MAX_BYTES} UTF-8 bytes`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function renderCheckpoint(candidate) {
  const result = validateCheckpoint(candidate);
  if (!result.valid) throw new CheckpointValidationError(result.errors);
  return `<condiments-checkpoint>${JSON.stringify(candidate)}</condiments-checkpoint>`;
}

function validateRequiredText(value, field, errors) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${field} must be a non-empty string`);
    return;
  }
  if (value.length > 2_000) errors.push(`${field} exceeds 2000 characters`);
}

function validateList(value, field, limits, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
    return;
  }
  if (value.length > limits.maxItems) {
    errors.push(`${field} exceeds ${limits.maxItems} items`);
  }

  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== "string" || item.trim() === "") {
      errors.push(`${field}[${index}] must be a non-empty string`);
      continue;
    }
    if (item.length > limits.maxItemChars) {
      errors.push(
        `${field}[${index}] exceeds ${limits.maxItemChars} characters`,
      );
    }
    if (seen.has(item)) errors.push(`${field} contains duplicate items`);
    seen.add(item);
  }
}

function deduplicate(value) {
  if (!Array.isArray(value)) return value;
  return [...new Set(value)];
}

function pressure(options) {
  const used = Number(options.usedTokens);
  const window = Number(options.contextWindowTokens);
  if (!Number.isFinite(used) || used < 0 || !Number.isFinite(window) || window <= 0) return null;
  return used / window;
}

function nonNegativeInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer.`);
  return parsed;
}
