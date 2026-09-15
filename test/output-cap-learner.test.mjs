import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { decorateProviderOutputRequest, createOutputCapTelemetryRecord } from "../src/output-budget.mjs";
import { selectTelemetryTrainedOutputCap, trainOutputCapPolicy } from "../src/output-cap-learner.mjs";

function records(count = 12, overrides = {}) {
  return Array.from({ length: count }, (_, index) => ({
    version: 1,
    event_id: `event-${index}`,
    timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    provider: "openai",
    host: "codex-cli",
    mode: "full",
    task_class: "standard",
    requested_output_tokens: 512,
    actual_output_tokens: 120 + index * 4,
    cap_hit: false,
    verification_passed: true,
    required_result_lost: false,
    ...overrides,
  }));
}

test("trained selector uses verified high quantile plus headroom", () => {
  const selected = selectTelemetryTrainedOutputCap(records(), {
    provider: "openai", host: "codex-cli", level: "full", taskClass: "standard", fallbackCap: 512,
  });
  assert.equal(selected.applied, true);
  assert.equal(selected.cap, 256);
  assert.equal(selected.verifiedSamples, 12);
  assert.equal(selected.reason, "verified-telemetry");
  assert.equal(selected.estimatedCapReduction, 0.5);
});

test("selector falls back on sparse evidence or recent cap quality loss", () => {
  const sparse = selectTelemetryTrainedOutputCap(records(4), {
    provider: "openai", host: "codex-cli", level: "full", taskClass: "standard", fallbackCap: 512,
  });
  assert.equal(sparse.applied, false);
  assert.equal(sparse.reason, "insufficient-verified-samples");
  assert.equal(sparse.cap, 512);

  const failed = records();
  failed.push({ ...failed.at(-1), event_id: "loss", cap_hit: true, verification_passed: false, required_result_lost: true });
  const guarded = selectTelemetryTrainedOutputCap(failed, {
    provider: "openai", host: "codex-cli", level: "full", taskClass: "standard", fallbackCap: 512,
  });
  assert.equal(guarded.applied, false);
  assert.equal(guarded.reason, "recent-cap-quality-loss");
  assert.equal(guarded.cap, 512);
});

test("selector does not mix provider, host, level, or task class", () => {
  const mixed = records().map((record, index) => index < 6 ? record : { ...record, task_class: "complex" });
  const selected = selectTelemetryTrainedOutputCap(mixed, {
    provider: "openai", host: "codex-cli", level: "full", taskClass: "standard", fallbackCap: 512,
  });
  assert.equal(selected.applied, false);
  assert.equal(selected.verifiedSamples, 6);
  const missingHost = selectTelemetryTrainedOutputCap(records(), {
    provider: "openai", level: "full", taskClass: "standard", fallbackCap: 512,
  });
  assert.equal(missingHost.reason, "missing-training-dimensions");
});

test("provider decoration applies trained cap and reports selection", () => {
  const decorated = decorateProviderOutputRequest("openai", {}, {
    level: "full",
    host: "codex-cli",
    taskClass: "standard",
    telemetryRecords: records(),
  });
  assert.equal(decorated.request.max_output_tokens, 256);
  assert.equal(decorated.control.cap_selection.applied, true);
  assert.equal(decorated.control.requested_limit, 256);
});

test("telemetry records task class and policy training emits safe groups", () => {
  const record = createOutputCapTelemetryRecord("anthropic", {
    stop_reason: "end_turn", usage: { output_tokens: 100 },
  }, { mode: "some", host: "claude-code", taskClass: "micro", directEdit: true, verificationPassed: true });
  assert.equal(record.task_class, "micro");
  assert.equal(record.direct_edit, true);
  const policy = trainOutputCapPolicy(records());
  assert.equal(policy.groups.length, 1);
  assert.equal(policy.groups[0].cap, 256);
});

test("training CLI reads persisted telemetry and selects a cap", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-cap-train-"));
  try {
    const directory = path.join(root, ".condiments", "output-budget");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "events.jsonl"), `${records().map(JSON.stringify).join("\n")}\n`, "utf8");
    const run = spawnSync(process.execPath, [
      path.resolve("scripts", "output-cap-train.mjs"), "select", "--root", root,
      "--provider", "openai", "--host", "codex-cli", "--level", "full",
      "--task-class", "standard", "--fallback-cap", "512",
    ], { cwd: path.resolve("."), encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const selected = JSON.parse(run.stdout);
    assert.equal(selected.applied, true);
    assert.equal(selected.cap, 256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
