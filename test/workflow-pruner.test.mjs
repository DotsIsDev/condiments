import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { assessWorkflowPruning } from "../src/workflow-pruner.mjs";

function samples(count = 8, candidateCost = 60) {
  return Array.from({ length: count }, () => ({ baselineCost: 100, candidateCost, baselineSuccess: true, candidateSuccess: true }));
}

test("workflow pruning requires paired quality, positive lower-bound savings, and amortization", () => {
  const approved = assessWorkflowPruning({
    workflowId: "nightly", expectedFutureRuns: 100,
    candidates: [{ stepId: "formatter-agent", action: "prune", optimizationCost: 200, samples: samples() }],
  }).decisions[0];
  assert.equal(approved.approved, true);
  assert.equal(approved.meanSavingPerRun, 40);
  assert.equal(approved.breakEvenRuns, 5);
  assert.equal(approved.requiredFutureRuns, 7);

  const oneOff = assessWorkflowPruning({
    workflowId: "one-off", expectedFutureRuns: 2,
    candidates: [{ stepId: "reviewer", optimizationCost: 200, samples: samples() }],
  }).decisions[0];
  assert.equal(oneOff.approved, false);
  assert.equal(oneOff.reason, "insufficient-future-runs-to-amortize");
});

test("workflow pruning rejects any paired quality regression", () => {
  const paired = samples();
  paired[3] = { ...paired[3], candidateSuccess: false };
  const result = assessWorkflowPruning({
    workflowId: "release", expectedFutureRuns: 10_000,
    candidates: [{ stepId: "verifier", action: "downgrade", targetModel: "small", optimizationCost: 0, samples: paired }],
  }).decisions[0];
  assert.equal(result.approved, false);
  assert.equal(result.reason, "quality-regression");
});

test("workflow pruner CLI returns the deploy decision", () => {
  const input = JSON.stringify({ workflowId: "batch", expectedFutureRuns: 50, candidates: [{ stepId: "selector", optimizationCost: 20, samples: samples() }] });
  const run = spawnSync(process.execPath, [path.resolve("scripts", "workflow-pruner.mjs"), "assess", "--input", "-"], { cwd: path.resolve("."), encoding: "utf8", input });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).deployable, true);
});
