import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  appendCacheTelemetry,
  composeCacheFriendlyPrompt,
  createCacheTelemetryRecord,
  decoratePromptCacheRequest,
  extractCacheTelemetry,
  handleCacheTelemetryHook,
  prepareCacheAwareRequest,
  readCacheTelemetry,
  summarizeCacheTelemetry,
} from "../src/prompt-cache.mjs";

test("cache-aware construction preserves expensive lineage when savings miss break-even and appends task last", () => {
  const previous = {
    model: "gpt-5.6-luna",
    tools: [{ type: "function", name: "first" }, { type: "function", name: "second" }],
    reasoning: { effort: "low" },
    instructions: "stable-prefix",
    input: "old task",
  };
  const result = prepareCacheAwareRequest("openai", {
    ...previous,
    model: "gpt-6-astra",
    tools: [...previous.tools].reverse(),
    reasoning: { effort: "high" },
  }, {
    level: "full",
    stablePrefix: "stable-prefix",
    task: "new changing task",
    previousRequest: previous,
    lineageMetrics: { cachedTokensAtRisk: 1_000, expectedOutputTokenSavings: 100 },
  });
  assert.equal(result.request.model, previous.model);
  assert.deepEqual(result.request.tools, previous.tools);
  assert.deepEqual(result.request.reasoning, previous.reasoning);
  assert.equal(result.request.input.endsWith("new changing task"), true);
  assert.doesNotMatch(result.request.input, /stable-prefix/);
  assert.equal(result.request.instructions, "stable-prefix");
  assert.equal(result.lineage.preserve, true);
});

test("cache-friendly prompt keeps the prefix exact, deduplicates stable instructions, and puts task last", () => {
  const prefix = "stable-prefix\nbyte-exact";
  const result = composeCacheFriendlyPrompt({
    stablePrefix: prefix,
    stableInstructions: [prefix, "shared policy", "shared policy"],
    dynamicContext: "current evidence",
    task: "change this task",
  });
  assert.equal(result.stablePrefix, prefix);
  assert.equal(result.prompt.startsWith(prefix), true);
  assert.equal(result.prompt.endsWith("change this task"), true);
  assert.equal(result.prompt.match(/shared policy/g).length, 1);
  assert.equal(result.removedDuplicateInstructions, 2);
});

test("decorates OpenAI requests with stable keys and supported modern TTL", () => {
  const first = decoratePromptCacheRequest("openai", { model: "gpt-5.6-test", input: "hi" }, {
    level: "full",
    stablePrefix: "same-prefix",
  });
  const second = decoratePromptCacheRequest("openai", { model: "gpt-5.6-test", input: "bye" }, {
    level: "full",
    stablePrefix: "same-prefix",
  });
  assert.equal(first.request.prompt_cache_key, second.request.prompt_cache_key);
  assert.equal(first.request.prompt_cache_options.ttl, "30m");
  assert.equal(first.control.applied, true);
});

test("decorates Anthropic requests with short and long automatic caching", () => {
  const some = decoratePromptCacheRequest("anthropic", { model: "claude-test" }, { level: "some" });
  const full = decoratePromptCacheRequest("anthropic", { model: "claude-test" }, { level: "full" });
  assert.deepEqual(some.request.cache_control, { type: "ephemeral" });
  assert.deepEqual(full.request.cache_control, { type: "ephemeral", ttl: "1h" });
});

test("records real zero separately from missing cache telemetry", () => {
  const reported = createCacheTelemetryRecord("openai", {
    usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 10 },
  }, { eventId: "reported", timestamp: "2026-01-01T00:00:00Z" });
  const missing = createCacheTelemetryRecord("openai", {
    usage: { input_tokens: 100, output_tokens: 10 },
  }, { eventId: "missing", timestamp: "2026-01-01T00:01:00Z" });
  const report = summarizeCacheTelemetry([reported, missing]);
  assert.equal(report.cache_reported_events, 1);
  assert.equal(report.cache_missing_events, 1);
  assert.equal(report.telemetry_coverage, 0.5);
  assert.equal(report.summary.cache_hit_ratio, 0);
});

test("extracts provider usage from JSONL transcripts and flags cache-read drops", () => {
  const transcript = [
    JSON.stringify({ id: "a", timestamp: "2026-01-01T00:00:00Z", message: { usage: {
      input_tokens: 100, cache_read_input_tokens: 80, cache_creation_input_tokens: 10, output_tokens: 5,
    }}}),
    JSON.stringify({ id: "b", timestamp: "2026-01-01T00:01:00Z", message: { usage: {
      input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 10, output_tokens: 5,
    }}}),
  ].join("\n");
  const records = extractCacheTelemetry(transcript, { provider: "anthropic", host: "claude-code" })
    .map((record) => ({ ...record, prefix_fingerprint: "sha256:same" }));
  assert.equal(records.length, 2);
  assert.equal(summarizeCacheTelemetry(records).alerts[0].type, "cache-read-drop");
});

test("appends deduplicated telemetry and native hook ingests a transcript", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-cache-"));
  try {
    const record = createCacheTelemetryRecord("cursor", {
      inputTokens: 10, outputTokens: 2, cacheReadTokens: 5, cacheWriteTokens: 1,
    }, { eventId: "one" });
    assert.equal((await appendCacheTelemetry(root, [record, record])).added, 1);
    assert.equal((await appendCacheTelemetry(root, record)).added, 0);

    const transcriptPath = path.join(root, "claude.jsonl");
    await writeFile(transcriptPath, `${JSON.stringify({ id: "turn", message: { usage: {
      input_tokens: 3, cache_read_input_tokens: 4, cache_creation_input_tokens: 5, output_tokens: 1,
    }}})}\n`);
    const result = await handleCacheTelemetryHook({ transcript_path: transcriptPath, session_id: "s1" }, {
      host: "claude-code", cwd: root,
    });
    assert.equal(result.added, 1);
    assert.equal((await readCacheTelemetry(root)).length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cache CLI decorates requests", () => {
  const run = spawnSync(process.execPath, [
    path.resolve("scripts", "prompt-cache.mjs"), "decorate",
    "--provider", "anthropic", "--level", "full", "--input", "-",
  ], { cwd: path.resolve("."), input: "{}", encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).request.cache_control.ttl, "1h");
});
