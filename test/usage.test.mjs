import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { compareEfficiency, normalizeUsage, summarizeRuns } from "../src/usage.mjs";

test("normalizes OpenAI Responses usage without double-counting subsets", () => {
  const run = normalizeUsage("openai", {
    model: "gpt-test",
    usage: {
      input_tokens: 1000,
      input_tokens_details: { cached_tokens: 600, cache_write_tokens: 100 },
      output_tokens: 200,
      output_tokens_details: { reasoning_tokens: 80 },
    },
  }, { verificationPassed: true, costUsd: 0.02 });

  assert.equal(run.input_tokens, 1000);
  assert.equal(run.uncached_input_tokens, 400);
  assert.equal(run.billable_input_tokens, 300);
  assert.equal(run.total_tokens, 1200);
  assert.equal(run.reasoning_tokens, 80);
  assert.equal(run.cache_telemetry_available, true);
  assert.equal(run.cache_hit_ratio, 0.6);
});

test("normalizes DeepSeek OpenAI-compatible usage and reasoning tokens", () => {
  const run = normalizeUsage("deepseek", { usage: {
    prompt_tokens: 900,
    completion_tokens: 180,
    prompt_tokens_details: { cached_tokens: 600 },
    completion_tokens_details: { reasoning_tokens: 120 },
  }});
  assert.equal(run.input_tokens, 900);
  assert.equal(run.cache_read_tokens, 600);
  assert.equal(run.uncached_input_tokens, 300);
  assert.equal(run.output_tokens, 180);
  assert.equal(run.reasoning_tokens, 120);
});

test("normalizes Anthropic cache buckets into total logical input", () => {
  const run = normalizeUsage("anthropic", { usage: {
    input_tokens: 50,
    cache_creation_input_tokens: 150,
    cache_read_input_tokens: 800,
    output_tokens: 100,
    output_tokens_details: { thinking_tokens: 40 },
  }});

  assert.equal(run.input_tokens, 1000);
  assert.equal(run.uncached_input_tokens, 200);
  assert.equal(run.billable_input_tokens, 50);
  assert.equal(run.total_tokens, 1100);
  assert.equal(run.cache_read_reported, true);
});

test("does not turn omitted cache telemetry into a measured zero", () => {
  const missing = normalizeUsage("openai", { usage: { input_tokens: 100, output_tokens: 5 } });
  const zero = normalizeUsage("openai", {
    usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 5 },
  });

  assert.equal(missing.cache_read_tokens, 0);
  assert.equal(missing.cache_read_reported, false);
  assert.equal(missing.cache_hit_ratio, null);
  assert.equal(zero.cache_read_reported, true);
  assert.equal(zero.cache_hit_ratio, 0);
  assert.equal(summarizeRuns([missing]).cache_hit_ratio, null);
  assert.equal(summarizeRuns([zero]).cache_hit_ratio, 0);
});

test("normalizes current Codex JSONL cache and reasoning aliases", () => {
  const run = normalizeUsage("openai", {
    input_tokens: 13_407,
    cached_input_tokens: 8_960,
    cache_write_input_tokens: 0,
    output_tokens: 5,
    reasoning_output_tokens: 2,
  });
  assert.equal(run.cache_read_tokens, 8_960);
  assert.equal(run.cache_write_tokens, 0);
  assert.equal(run.reasoning_tokens, 2);
  assert.equal(run.cache_telemetry_available, true);
});

test("preserves Anthropic cache-write TTL buckets", () => {
  const run = normalizeUsage("anthropic", { usage: {
    input_tokens: 10,
    cache_creation_input_tokens: 90,
    cache_read_input_tokens: 0,
    cache_creation: {
      ephemeral_5m_input_tokens: 30,
      ephemeral_1h_input_tokens: 60,
    },
    output_tokens: 5,
  }});
  assert.equal(run.cache_write_5m_tokens, 30);
  assert.equal(run.cache_write_1h_tokens, 60);
});

test("normalizes Cursor and OpenClaw usage aliases", () => {
  const cursor = normalizeUsage("cursor", { totalUsage: {
    inputTokens: 100,
    outputTokens: 20,
    cacheWriteTokens: 30,
    cacheReadTokens: 50,
    totalTokens: 200,
  }});
  const openclaw = normalizeUsage("openclaw", { usage: {
    input: 100,
    output: 20,
    cacheRead: 50,
    cacheWrite: 30,
  }});

  assert.equal(cursor.input_tokens, 180);
  assert.equal(cursor.total_tokens, 200);
  assert.deepEqual(
    [openclaw.input_tokens, openclaw.total_tokens],
    [180, 200],
  );
});

test("summaries separate cache reuse, cost completeness, and verified efficiency", () => {
  const baseline = summarizeRuns([
    normalizeUsage("canonical", { input_tokens: 1000, output_tokens: 100 }, { costUsd: 1, verificationPassed: true }),
  ]);
  const candidate = summarizeRuns([
    normalizeUsage("canonical", { input_tokens: 500, output_tokens: 50, cache_read_tokens: 250 }, { costUsd: 0.5, verificationPassed: true }),
  ]);

  assert.equal(candidate.cache_hit_ratio, 0.5);
  assert.equal(candidate.cost_per_successful_task, 0.5);
  assert.deepEqual(compareEfficiency(baseline, candidate), {
    verified_efficiency: 2,
    token_ratio: 0.5,
  });
});

test("usage CLI accepts mixed provider records from stdin", () => {
  const input = JSON.stringify([
    { provider: "openai", payload: { usage: { input_tokens: 10, output_tokens: 2 } }, metadata: { costUsd: 0.01 } },
    { provider: "anthropic", payload: { usage: { input_tokens: 5, output_tokens: 3 } }, metadata: { costUsd: 0.02 } },
  ]);
  const result = spawnSync(process.execPath, [
    path.resolve("scripts", "report-usage.mjs"), "--input", "-", "--verified",
  ], { cwd: path.resolve("."), input, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.summary.runs, 2);
  assert.equal(output.summary.verified_successes, 2);
  assert.equal(output.summary.cost_usd, 0.03);
  assert.equal(output.summary.cost_per_successful_task, 0.015);
});

test("rejects invalid counts and overlapping cache subsets", () => {
  assert.throws(() => normalizeUsage("openai", { usage: { input_tokens: -1 } }), /Invalid/);
  assert.throws(() => normalizeUsage("openai", { usage: {
    input_tokens: 10,
    input_tokens_details: { cached_tokens: 8, cache_write_tokens: 4 },
  }}), /Cache token subsets/);
  assert.throws(() => normalizeUsage("anthropic", { usage: {
    input_tokens: 1,
    cache_creation_input_tokens: 2,
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_5m_input_tokens: 3 },
  }}), /TTL buckets/);
});
