import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  appendQueryCompressionTelemetry,
  compressQueryEvidence,
  compressQueryEvidenceWithRecovery,
  createQueryCompressionTelemetryRecord,
  readQueryCompressionTelemetry,
  summarizeQueryCompressionTelemetry,
  validateCompressedEvidence,
} from "../src/query-compressor.mjs";

const evidence = [
  { id: "noise", path: "docs/history.md", content: "old release notes and unrelated prose ".repeat(20), tokenCount: 100 },
  { id: "target", path: "src/cart.ts", startLine: 40, endLine: 48, kind: "code", content: "function discount(total) { return total * 0.85; }", tokenCount: 20, dependencies: ["discount"] },
  { id: "test", path: "test/cart.test.ts", startLine: 10, endLine: 14, kind: "test", content: "discount test failed: expected 85, received 80", tokenCount: 20, dependsOn: ["target"] },
  { id: "extra", path: "src/theme.ts", content: "export const theme = 'blue';", tokenCount: 20 },
];

test("query-aware compression locks named paths, symbols, numbers, and failures", () => {
  const result = compressQueryEvidence({
    level: "full",
    query: "Fix `discount` failure in src/cart.ts; expected 85",
    evidence,
    budgetTokens: 45,
    requirements: [
      { id: "target-lines", type: "line", path: "src/cart.ts", startLine: 42, endLine: 44 },
      { id: "expected", type: "exact", value: "expected 85" },
    ],
  });
  assert.equal(result.readyForModel, true);
  assert.deepEqual(result.selected.map((item) => item.id), ["target", "test"]);
  assert.equal(result.selectedTokens, 40);
  assert.equal(result.reductionRate, 0.75);
  assert.match(result.prompt, /src\/cart\.ts:40-48/);
  assert.doesNotMatch(result.prompt, /release notes/);
});

test("locked evidence survives a too-small budget and is reported over budget", () => {
  const result = compressQueryEvidence({
    level: "full",
    query: "Inspect `discount` in src/cart.ts",
    evidence,
    budgetTokens: 5,
  });
  assert.equal(result.readyForModel, true);
  assert.equal(result.overBudget, true);
  assert.ok(result.selected.some((item) => item.id === "target"));
});

test("query-conditioned ranking penalizes duplicate prose and bookends useful optional evidence", () => {
  const result = compressQueryEvidence({
    level: "full",
    query: "diagnose checkout timeout",
    budgetTokens: 18,
    evidence: [
      { id: "doc-a", kind: "docs", content: "checkout timeout old general guide", tokenCount: 6 },
      { id: "doc-b", kind: "docs", content: "checkout timeout old general guide", tokenCount: 6 },
      { id: "error", kind: "error", content: "checkout timeout stack frame payment.mjs", tokenCount: 6 },
      { id: "code", kind: "code", content: "checkout retry handler timeout", tokenCount: 6 },
    ],
  });
  assert.ok(result.selected.some((item) => item.id === "error"));
  assert.ok(result.selected.some((item) => item.id === "code"));
  const duplicate = result.selected.find((item) => item.id === "doc-b");
  if (duplicate) assert.ok(duplicate.scoreComponents.redundancy > 0.9);
  assert.equal(result.selected.at(-1).attentionPosition, "back");
});

test("none retains all evidence", () => {
  const result = compressQueryEvidence({ level: "none", query: "cart", evidence, budgetTokens: 1 });
  assert.equal(result.selectedSegments, evidence.length);
  assert.equal(result.reductionRate, 0);
});

test("validation fails closed when exact or line evidence is missing", () => {
  const result = validateCompressedEvidence({
    query: "Need src/cart.ts and expected 85",
    sourceEvidence: evidence,
    selectedEvidence: [evidence[0]],
    requirements: [
      { id: "exact", type: "exact", value: "expected 85" },
      { id: "line", type: "line", path: "src/cart.ts", startLine: 42 },
    ],
  });
  assert.equal(result.valid, false);
  assert.ok(result.missing.some((item) => item.type === "requirement"));
  assert.ok(result.missing.some((item) => item.type === "locked-evidence"));
});

test("recovery retrieves only missing required evidence and stops when valid", async () => {
  const initial = [evidence[0]];
  const result = await compressQueryEvidenceWithRecovery({
    level: "full",
    query: "Find `ERR-9402`",
    evidence: initial,
    budgetTokens: 30,
    requirements: [{ id: "error", type: "exact", value: "ERR-9402" }],
    retrieveMissing: async (missing, context) => {
      assert.equal(context.round, 1);
      assert.ok(missing.length > 0);
      return [{ id: "recovered", path: "logs/app.log", kind: "error", content: "ERR-9402 timeout in checkout", tokenCount: 8 }];
    },
  });
  assert.equal(result.readyForModel, true);
  assert.equal(result.recoveryRounds, 1);
  assert.deepEqual(result.selected.map((item) => item.id), ["recovered"]);
});

test("repository-specific sufficiency validator can drive targeted recovery", async () => {
  const result = await compressQueryEvidenceWithRecovery({
    level: "full",
    query: "Fix checkout timeout",
    evidence: [{ id: "code", path: "src/checkout.ts", content: "checkout implementation", tokenCount: 5 }],
    budgetTokens: 20,
    verifySufficiency: async (candidate) => candidate.selected.some((item) => item.id === "failure")
      ? true
      : { valid: false, missing: ["failing-test-output"] },
    retrieveMissing: async (missing) => {
      assert.equal(missing[0].id, "failing-test-output");
      return [{ id: "failure", kind: "test", content: "checkout timeout test failed", tokenCount: 6 }];
    },
  });
  assert.equal(result.readyForModel, true);
  assert.equal(result.recoveryRounds, 1);
});

test("telemetry stores counts and hashes without evidence content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-query-compressor-"));
  try {
    const result = compressQueryEvidence({ level: "full", query: "src/cart.ts", evidence, budgetTokens: 40 });
    const record = createQueryCompressionTelemetryRecord(result, { eventId: "evt-1", host: "codex-cli" });
    const serialized = JSON.stringify(record);
    assert.doesNotMatch(serialized, /discount test failed|src\/cart\.ts/);
    assert.equal((await appendQueryCompressionTelemetry(root, [record, record])).added, 1);
    const records = await readQueryCompressionTelemetry(root);
    assert.equal(records.length, 1);
    const summary = summarizeQueryCompressionTelemetry(records);
    assert.equal(summary.events, 1);
    assert.ok(summary.tokenReduction > 0);
    assert.doesNotMatch(await readFile(path.join(root, ".condiments", "query-compressor", "events.jsonl"), "utf8"), /discount/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("query compressor CLI emits ready compressed evidence", () => {
  const payload = JSON.stringify({
    level: "full",
    query: "Find `needle`",
    budgetTokens: 3,
    evidence: [
      { id: "a", content: "noise noise noise", tokenCount: 5 },
      { id: "b", content: "needle value", tokenCount: 3 },
    ],
  });
  const run = spawnSync(process.execPath, [path.resolve("scripts", "query-compressor.mjs"), "compress", "--input", "-"], {
    cwd: path.resolve("."), encoding: "utf8", input: payload,
  });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.readyForModel, true);
  assert.deepEqual(result.selected.map((item) => item.id), ["b"]);
});
