import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  appendCacheLineageTelemetry,
  assessCacheLineage,
  createCacheLineageSnapshot,
  estimateCacheLineageOpportunity,
  guardCacheLineage,
  readCacheLineageTelemetry,
} from "../src/cache-lineage.mjs";
import { resolveCodexRoute } from "../src/native-reasoning.mjs";
import { decoratePromptCacheRequest } from "../src/prompt-cache.mjs";

test("lineage snapshots are stable and store no prompt or schema bodies", () => {
  const first = createCacheLineageSnapshot("openai", { model: "m", instructions: "secret", tools: [{ name: "x", parameters: { b: 2, a: 1 } }] });
  const second = createCacheLineageSnapshot("openai", { tools: [{ parameters: { a: 1, b: 2 }, name: "x" }], instructions: "secret", model: "m" });
  assert.equal(first.lineage_id, second.lineage_id);
  assert.equal(JSON.stringify(first).includes("secret"), false);
});

test("controller preserves cache-affecting model and effort below break-even", () => {
  const previous = { model: "gpt-5.6-sol", reasoning: { effort: "medium" }, input: "old" };
  const candidate = { model: "gpt-5.6-luna", reasoning: { effort: "low" }, input: "new" };
  const result = guardCacheLineage("openai", previous, candidate, {
    cacheReadTokens: 30_000,
    expectedOutputTokenSavings: 1_000,
  }, { level: "full" });
  assert.equal(result.decision.action, "preserve");
  assert.equal(result.request.model, previous.model);
  assert.deepEqual(result.request.reasoning, previous.reasoning);
  assert.equal(result.request.input, "new");
});

test("quality requirement and savings above break-even allow lineage change", () => {
  const previous = createCacheLineageSnapshot("anthropic", { model: "a", thinking: { type: "disabled" } });
  const candidate = createCacheLineageSnapshot("anthropic", { model: "b", thinking: { type: "enabled", budget_tokens: 1000 } });
  assert.equal(assessCacheLineage(previous, candidate, { cacheReadTokens: 10_000, qualityRequired: true }, { level: "full" }).action, "allow");
  assert.equal(assessCacheLineage(previous, candidate, { cacheReadTokens: 10_000, expectedInputTokenSavings: 13_000 }, { level: "full" }).action, "allow");
});

test("explicit Anthropic prefix preservation restores tools and system", () => {
  const previous = { model: "claude", system: "stable", tools: [{ name: "read" }] };
  const candidate = { model: "claude", system: "changed", tools: [{ name: "write" }] };
  const result = guardCacheLineage("anthropic", previous, candidate, { cacheReadTokens: 20_000 }, {
    level: "some", preserveFields: ["tools", "system"],
  });
  assert.deepEqual(result.request.tools, previous.tools);
  assert.equal(result.request.system, "stable");
  assert.deepEqual(result.decision.restored_fields.sort(), ["system", "tools"]);
});

test("opportunity estimator separates logical tokens from recoverable uncached input", () => {
  const result = estimateCacheLineageOpportunity({ inputTokens: 38_391, cacheReadTokens: 29_952, targetCacheReadTokens: 33_024 });
  assert.equal(result.logical_input_token_reduction, 0);
  assert.equal(result.recoverable_uncached_tokens, 3_072);
  assert.equal(result.projected_uncached_tokens, 5_367);
  assert.equal(result.uncached_input_reduction_percent, 36.402);
});

test("prompt-cache decorator applies lineage guard when prior request is supplied", () => {
  const previous = { model: "gpt-5.6-sol", input: "old", prompt_cache_key: "stable" };
  const candidate = { model: "gpt-5.6-luna", input: "new", prompt_cache_key: "stable" };
  const result = decoratePromptCacheRequest("openai", candidate, {
    level: "full", previousRequest: previous, lineageMetrics: { cacheReadTokens: 20_000, expectedOutputTokenSavings: 100 },
  });
  assert.equal(result.request.model, previous.model);
  assert.equal(result.control.lineage.applied, true);
});

test("Codex route holds model and effort when cache risk exceeds projected saving", () => {
  const catalog = [
    { model: "gpt-5.6-sol", supportedReasoningEfforts: ["low", "medium"] },
    { model: "gpt-5.6-luna", supportedReasoningEfforts: ["low"] },
  ];
  const route = resolveCodexRoute("full", { prompt: "Rename variable", model: "gpt-5.6-sol", effort: "medium" }, catalog, {
    cacheLineage: { cacheReadTokens: 30_000, expectedOutputTokenSavings: 500 },
  });
  assert.equal(route.model, "gpt-5.6-sol");
  assert.equal(route.effort, "medium");
  assert.equal(route.cacheLineage.action, "preserve");
});

test("lineage telemetry hashes session identifiers and deduplicates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-lineage-"));
  try {
    const input = { timestamp: "2026-09-14T00:00:00Z", provider: "openai", sessionId: "private-session", decision: { action: "preserve" } };
    await appendCacheLineageTelemetry(root, input);
    await appendCacheLineageTelemetry(root, input);
    const events = await readCacheLineageTelemetry(root);
    assert.equal(events.length, 1);
    assert.equal(events[0].session_hash.startsWith("sha256:"), true);
    const raw = await readFile(path.join(root, ".condiments", "cache-lineage", "events.jsonl"), "utf8");
    assert.equal(raw.includes("private-session"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
