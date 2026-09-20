import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { classifySavingsWorkload, renderConditionalPolicy, resolveSavingsPlan, resolveSavingsRoute } from "../src/savings-policy.mjs";

test("routes only evaluated model and workload pairs to an active preset", () => {
  const luna = resolveSavingsRoute({ model: "gpt-5.6-luna", level: "full", workload: "general" });
  assert.equal(luna.effectiveLevel, "none");
  assert.equal(luna.evaluated, true);
  assert.ok(luna.expectedLogicalSavings < 0);

  const sol = resolveSavingsRoute({ model: "gpt-5.6-sol", level: "full", workload: "exact-edit" });
  assert.equal(sol.effectiveLevel, "none");
  assert.equal(sol.evaluated, true);
  assert.ok(sol.expectedLogicalSavings < 0);

  const solSome = resolveSavingsRoute({ model: "gpt-5.6-sol", level: "some", workload: "exact-edit" });
  assert.equal(solSome.effectiveLevel, "none");
  assert.equal(solSome.evaluated, true);

  const astra = resolveSavingsRoute({ model: "gpt-6-astra", level: "full", workload: "exact-edit" });
  assert.equal(astra.effectiveLevel, "none");
  assert.equal(astra.evaluated, true);

  const unknown = resolveSavingsRoute({ model: "gpt-future", level: "full", workload: "exact-edit" });
  assert.equal(unknown.effectiveLevel, "none");
  assert.equal(unknown.evaluated, false);
});

test("classifies only explicit edit signals as exact edits and supports a force override", () => {
  assert.equal(classifySavingsWorkload("Replace old with new in src/a.js").workload, "exact-edit");
  assert.equal(classifySavingsWorkload("Investigate src/a.js and fix the bug").workload, "tool-heavy");
  assert.equal(classifySavingsWorkload("Run the failing tests and inspect the traceback").workload, "tool-heavy");
  assert.equal(classifySavingsWorkload("Look up the version in package.json").workload, "general");
  assert.equal(resolveSavingsRoute({ model: "gpt-future", level: "some", force: true }).effectiveLevel, "some");
});

test("enables only Ranch for evaluated Luna tool-heavy work", () => {
  const route = resolveSavingsRoute({ model: "gpt-5.6-luna", level: "full", task: "Debug the failing tests" });
  assert.deepEqual(route.enabledControls, ["ranch"]);
  assert.equal(route.effectiveControls.ranch, "full");
  assert.equal(route.expectedLogicalSavings, 0.21831);
  assert.equal(resolveSavingsRoute({ model: "gpt-5.6-luna", level: "some", task: "Debug test failures" }).baseline, true);
  assert.deepEqual(resolveSavingsRoute({ model: "gpt-5.6-luna", level: "full", task: "Look up package version" }).enabledControls, []);
});

test("injects only active tiny directives and skips policy text for baseline or native Ranch", () => {
  assert.equal(renderConditionalPolicy({ controls: {} }), "");
  const plan = resolveSavingsPlan({ model: "gpt-5.6-luna", level: "full", task: "Debug test failures" });
  assert.match(plan.directive, /^<cond-ranch>/);
  assert.doesNotMatch(plan.directive, /cond-policy/);
  assert.equal(resolveSavingsPlan({ model: "gpt-5.6-luna", level: "full", task: "Debug test failures", nativeToolControl: true }).directive, "");
});

test("savings route CLI returns the conservative baseline decision", () => {
  const run = spawnSync(process.execPath, [
    path.resolve("scripts", "savings-policy.mjs"),
    "--model", "gpt-5.6-sol", "--level", "full", "--workload", "exact-edit",
  ], { cwd: path.resolve("."), encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).effectiveLevel, "none");
});
