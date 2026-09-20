import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import {
  assessOutputCapEconomics,
  classifyOutputTask,
  resolveAdaptiveOutputPolicy,
  resolveGovernorRetry,
  resolveToolRoundDecision,
} from "../src/output-governor.mjs";

test("applies Mayo only when predicted output savings repay policy input", () => {
  assert.equal(assessOutputCapEconomics({ policyInputTokens: 20, projectedOutputSavingsTokens: 20 }).apply, false);
  assert.equal(assessOutputCapEconomics({ policyInputTokens: 20, projectedOutputSavingsTokens: 21 }).apply, true);
  const skipped = resolveAdaptiveOutputPolicy({
    level: "full", taskClass: "standard", enforceEconomics: true,
    outputEconomics: { policyInputTokens: 30, projectedOutputSavingsTokens: 12 },
  });
  assert.equal(skipped.active, false);
  assert.equal(skipped.reason, "policy-cost-not-repaid");
});

test("classifies micro, standard, complex, and direct-edit final tasks", () => {
  assert.equal(classifyOutputTask("status").taskClass, "micro");
  assert.equal(classifyOutputTask("Explain why this function returns null").taskClass, "standard");
  assert.equal(classifyOutputTask("Audit and design a system-wide migration").taskClass, "complex");
  const direct = classifyOutputTask("Fix src/cart.ts", { directEdit: true, phase: "final" });
  assert.equal(direct.taskClass, "micro");
  assert.equal(direct.directEdit, true);
});

test("full applies 128/512/2048 task caps and bounded tools", () => {
  assert.equal(resolveAdaptiveOutputPolicy({ level: "full", taskClass: "micro" }).outputTokenCap, 128);
  assert.equal(resolveAdaptiveOutputPolicy({ level: "full", taskClass: "standard" }).outputTokenCap, 512);
  assert.equal(resolveAdaptiveOutputPolicy({ level: "full", taskClass: "complex" }).outputTokenCap, 2_048);
  assert.deepEqual(
    ["micro", "standard", "complex"].map((taskClass) => resolveAdaptiveOutputPolicy({ level: "full", taskClass }).toolCallCap),
    [1, 4, 8],
  );
  const policy = resolveAdaptiveOutputPolicy({ level: "full", taskClass: "standard" });
  assert.equal(Object.values(policy.hierarchicalBudget.phases).reduce((sum, value) => sum + value, 0), 512);
});

test("some is quality-biased and none is inert", () => {
  assert.equal(resolveAdaptiveOutputPolicy({ level: "some", taskClass: "standard" }).outputTokenCap, 2_048);
  const none = resolveAdaptiveOutputPolicy({ level: "none", taskClass: "complex" });
  assert.equal(none.active, false);
  assert.equal(none.outputTokenCap, null);
  assert.equal(none.toolCallCap, null);
});

test("direct edits suppress recap and final phase forbids more tools", () => {
  const policy = resolveAdaptiveOutputPolicy({
    level: "full",
    task: "Fix src/cart.ts discount function",
    directEdit: true,
    phase: "final",
  });
  assert.equal(policy.outputTokenCap, 128);
  assert.equal(policy.toolCallCap, 0);
  assert.equal(policy.suppressRecap, true);
  assert.match(policy.contract, /No recap/);
});

test("limits normal work to one discovery and verification round, then requires justified missing evidence", () => {
  assert.equal(resolveToolRoundDecision({ level: "full", toolPhase: "discovery", roundsUsed: 0 }).allow, true);
  assert.equal(resolveToolRoundDecision({ level: "full", toolPhase: "discovery", roundsUsed: 1 }).reason, "sufficient-evidence");
  assert.equal(resolveToolRoundDecision({
    level: "full", toolPhase: "verification", roundsUsed: 1, requiredEvidenceMissing: true,
  }).reason, "justification-required");
  const exception = resolveToolRoundDecision({
    level: "full", toolPhase: "verification", roundsUsed: 1, requiredEvidenceMissing: true,
    justification: "test failure omitted the expected line",
  });
  assert.equal(exception.allow, true);
  assert.equal(exception.exceptional, true);
  assert.equal(resolveToolRoundDecision({
    level: "full", existingResultAvailable: true,
  }).reason, "reuse-existing-result");
});

test("expands a response cap when required evidence cannot fit", () => {
  const policy = resolveAdaptiveOutputPolicy({ level: "full", taskClass: "standard", requiredEvidenceTokens: 700 });
  assert.equal(policy.baseOutputTokenCap, 512);
  assert.equal(policy.outputTokenCap, 764);
  assert.equal(policy.capExpandedForEvidence, true);
});

test("retries only missing required results and raises cap", () => {
  const policy = resolveAdaptiveOutputPolicy({ level: "full", taskClass: "micro" });
  assert.equal(resolveGovernorRetry({ policy, requiredResults: [{ name: "path", present: true }] }).retry, false);
  const missing = resolveGovernorRetry({ policy, requiredResults: [{ name: "test-result", present: false }] });
  assert.equal(missing.retry, true);
  assert.equal(missing.nextOutputTokenCap, 512);
  assert.equal(resolveGovernorRetry({ policy, requiredResultMissing: true, attempt: 2 }).retry, false);
});

test("governor CLI resolves policy", () => {
  const run = spawnSync(process.execPath, [
    path.resolve("scripts", "output-governor.mjs"), "resolve", "--level", "full", "--task-class", "standard",
  ], { cwd: path.resolve("."), encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).outputTokenCap, 512);
});
