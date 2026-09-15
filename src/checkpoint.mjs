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
