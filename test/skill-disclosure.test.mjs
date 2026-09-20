import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { auditSkillDisclosure, compileSkillSlice, selectSkillModules } from "../src/skill-disclosure.mjs";

test("progressive disclosure selects only active controls in stable order", () => {
  const plan = selectSkillModules({ host: "codex-cli", controls: { ranch: "full" } });
  assert.deepEqual(plan.modules, [
    "references/policy-core.md",
    "references/policy-protocol.md",
    "references/savings-policy.md",
    "references/hosts/codex-cli.md",
    "references/controls/ranch.md",
  ]);
  assert.equal(plan.modules.some((item) => item.includes("mayo")), false);
  assert.equal(plan.modules.some((item) => item.includes("ketchup")), false);
});

test("compiled slices are byte-stable and the release entrypoints stay compact", async () => {
  const root = path.resolve(".");
  const first = await compileSkillSlice(root, { host: "codex-cli", controls: "ranch" });
  const second = await compileSkillSlice(root, { host: "codex-cli", controls: "ranch" });
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.content, second.content);
  assert.match(first.content, /condiments-module:references\/controls\/ranch\.md/);
  assert.doesNotMatch(first.content, /Mayo: response output/);

  const audit = await auditSkillDisclosure(root);
  assert.equal(audit.valid, true, audit.errors.join("\n"));
  assert.ok(Object.values(audit.entrypointBytes).every((bytes) => bytes < 5_000));
});

test("skill disclosure CLI exposes a metadata-only compile result", () => {
  const run = spawnSync(process.execPath, [
    path.resolve("scripts", "skill-disclosure.mjs"), "compile", "--host", "codex-cli", "--controls", "ranch", "--json",
  ], { cwd: path.resolve("."), encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.ok(result.estimatedTokens > 0);
  assert.equal("content" in result, false);
});
