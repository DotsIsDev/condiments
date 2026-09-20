import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  CHECKPOINT_MAX_BYTES,
  CheckpointValidationError,
  generateCheckpoint,
  renderCheckpoint,
  resolveCheckpointDecision,
  validateCheckpoint,
} from "../src/checkpoint.mjs";

test("creates checkpoints only for established sessions near context pressure", () => {
  assert.equal(resolveCheckpointDecision({ level: "full", turnCount: 2, usedTokens: 9_000, contextWindowTokens: 10_000 }).reason, "short-session");
  assert.equal(resolveCheckpointDecision({ level: "full", turnCount: 8, usedTokens: 6_000, contextWindowTokens: 10_000 }).create, false);
  assert.equal(resolveCheckpointDecision({ level: "full", turnCount: 8, usedTokens: 7_200, contextWindowTokens: 10_000 }).create, true);
  assert.equal(resolveCheckpointDecision({ level: "some", turnCount: 8, compactionImminent: true }).create, true);
  assert.equal(resolveCheckpointDecision({ level: "full", turnCount: 1, explicit: true }).create, true);
});

const VALID_DRAFT = Object.freeze({
  goal: "Implement checkpoint support",
  constraints: ["Preserve identifiers", "Preserve identifiers"],
  decisions: ["Use JSON Schema"],
  changed_files: ["D:\\Projects\\condiments\\src\\checkpoint.mjs"],
  commands_and_results: ["npm test -> pass"],
  known_failures: [],
  opaque_identifiers: ["01a098fd-8904-7c92-b9b4-54a4b31d8650"],
  artifact_paths: ["D:\\artifacts\\result-a1.txt"],
  next_action: "Add platform adapters",
});

test("generation fills schema defaults, deduplicates facts, and preserves identifiers", () => {
  const checkpoint = generateCheckpoint(VALID_DRAFT);

  assert.equal(checkpoint.version, 1);
  assert.deepEqual(checkpoint.constraints, ["Preserve identifiers"]);
  assert.equal(
    checkpoint.opaque_identifiers[0],
    "01a098fd-8904-7c92-b9b4-54a4b31d8650",
  );
  assert.deepEqual(validateCheckpoint(checkpoint), { valid: true, errors: [] });
  assert.ok(Buffer.byteLength(JSON.stringify(checkpoint), "utf8") < CHECKPOINT_MAX_BYTES);
});

test("validation rejects missing, unknown, duplicate, and oversized content", () => {
  const missing = validateCheckpoint({ version: 1 });
  assert.equal(missing.valid, false);
  assert.ok(missing.errors.some((error) => error.includes("missing field 'goal'")));

  assert.throws(
    () => generateCheckpoint({ ...VALID_DRAFT, surprise: true }),
    (error) =>
      error instanceof CheckpointValidationError &&
      error.errors.some((item) => item.includes("unknown field")),
  );

  const generated = generateCheckpoint(VALID_DRAFT);
  const duplicate = {
    ...generated,
    decisions: ["Use JSON Schema", "Use JSON Schema"],
  };
  assert.ok(
    validateCheckpoint(duplicate).errors.includes(
      "decisions contains duplicate items",
    ),
  );

  const oversized = { ...generated, goal: "x".repeat(2_001) };
  assert.ok(
    validateCheckpoint(oversized).errors.includes(
      "goal exceeds 2000 characters",
    ),
  );
});

test("rendering produces compact exact JSON for prompt injection", () => {
  const checkpoint = generateCheckpoint(VALID_DRAFT);
  const rendered = renderCheckpoint(checkpoint);

  assert.match(rendered, /^<condiments-checkpoint>\{/);
  assert.match(rendered, /01a098fd-8904-7c92-b9b4-54a4b31d8650/);
  assert.match(rendered, /<\/condiments-checkpoint>$/);
  assert.equal(rendered.includes("\n"), false);
});

test("checkpoint CLI generates, persists, validates, and renders", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "condiments-checkpoint-"));
  const draftPath = path.join(temporaryDirectory, "draft.json");
  const checkpointPath = path.join(temporaryDirectory, "checkpoint.json");
  const scriptPath = path.resolve("scripts", "checkpoint.mjs");

  try {
    await writeFile(draftPath, JSON.stringify(VALID_DRAFT), "utf8");
    const generated = spawnSync(
      process.execPath,
      [scriptPath, "generate", "--input", draftPath, "--output", checkpointPath],
      { cwd: path.resolve("."), encoding: "utf8" },
    );
    assert.equal(generated.status, 0, generated.stderr);

    const persisted = JSON.parse(await readFile(checkpointPath, "utf8"));
    assert.equal(persisted.goal, VALID_DRAFT.goal);

    const validated = spawnSync(
      process.execPath,
      [scriptPath, "validate", "--input", checkpointPath],
      { cwd: path.resolve("."), encoding: "utf8" },
    );
    assert.equal(validated.status, 0, validated.stderr);
    assert.deepEqual(JSON.parse(validated.stdout), { valid: true, errors: [] });

    const rendered = spawnSync(
      process.execPath,
      [scriptPath, "render", "--input", checkpointPath],
      { cwd: path.resolve("."), encoding: "utf8" },
    );
    assert.equal(rendered.status, 0, rendered.stderr);
    assert.match(rendered.stdout, /<condiments-checkpoint>/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
