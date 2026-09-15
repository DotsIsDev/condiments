import assert from "node:assert/strict";
import test from "node:test";
import { detectBudgetElasticity, resolveHierarchicalBudget, WORK_PHASES } from "../src/hierarchical-budget.mjs";

test("hierarchical phase budgets sum exactly and keep verification", () => {
  const result = resolveHierarchicalBudget({ level: "full", taskClass: "standard", totalTokens: 512, directEdit: true });
  assert.equal(Object.values(result.phases).reduce((sum, value) => sum + value, 0), 512);
  assert.ok(result.phases.verify > result.phases.report);
  assert.deepEqual(Object.keys(result.phases), [...WORK_PHASES]);
});

test("verified telemetry trains allocations only after sample floor", () => {
  const telemetry = Array.from({ length: 8 }, () => ({ mode: "full", task_class: "standard", direct_edit: false, verification_passed: true,
    phase_tokens: { locate: 5, inspect: 10, edit: 15, verify: 65, report: 5 } }));
  const result = resolveHierarchicalBudget({ level: "full", taskClass: "standard", totalTokens: 100, telemetry });
  assert.equal(result.source, "verified-telemetry");
  assert.equal(result.verifiedSamples, 8);
  assert.ok(result.phases.verify >= 60);
});

test("detects token elasticity when a lower cap produces more output", () => {
  const shared = { provider: "openai", host: "codex-cli", mode: "full", task_class: "standard" };
  const report = detectBudgetElasticity([
    { ...shared, timestamp: "2026-01-01", requested_output_tokens: 512, actual_output_tokens: 300 },
    { ...shared, timestamp: "2026-01-02", requested_output_tokens: 256, actual_output_tokens: 340 },
  ]);
  assert.equal(report.detected, true);
});
