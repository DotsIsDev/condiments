import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  appendOutputCapTelemetry,
  applyNativeResponseBudgetPolicy,
  createOutputCapTelemetryRecord,
  decorateProviderOutputRequest,
  detectOutputCapHit,
  outputCapQualityFailures,
  readOutputCapTelemetry,
  resolveProviderOutputTokenLimit,
  summarizeOutputCapTelemetry,
} from "../src/output-budget.mjs";

test("decorates supported provider requests with native output-token limits", () => {
  const openai = decorateProviderOutputRequest("openai", { model: "gpt-test" }, { level: "full" });
  assert.equal(openai.request.max_output_tokens, 2_048);
  assert.equal(openai.control.mechanism, "max_output_tokens");

  const anthropic = decorateProviderOutputRequest("anthropic", { model: "claude-test" }, { level: "some" });
  assert.equal(anthropic.request.max_tokens, 4_096);
  assert.equal(anthropic.control.mechanism, "max_tokens");

  const openclaw = decorateProviderOutputRequest("openclaw", {}, { level: "full" });
  assert.equal(openclaw.request.maxTokens, 2_048);
  assert.equal(openclaw.control.mechanism, "maxTokens");

  const deepseekChat = decorateProviderOutputRequest("deepseek", { max_tokens: 1_000 }, { level: "full", api: "chat-completions" });
  assert.equal(deepseekChat.request.max_tokens, 1_000);
  assert.equal(deepseekChat.control.mechanism, "max_tokens");

  const deepseekResponses = decorateProviderOutputRequest("deepseek", {}, { level: "full", api: "responses" });
  assert.equal(deepseekResponses.request.max_output_tokens, 2_048);
  assert.equal(deepseekResponses.control.mechanism, "max_output_tokens");
});

test("never raises an existing lower limit and none leaves requests unchanged", () => {
  const lower = decorateProviderOutputRequest("openai", { max_output_tokens: 512 }, { level: "full" });
  assert.equal(lower.request.max_output_tokens, 512);
  const none = decorateProviderOutputRequest("anthropic", { max_tokens: 700 }, { level: "none" });
  assert.deepEqual(none.request, { max_tokens: 700 });
  assert.equal(resolveProviderOutputTokenLimit("none"), null);
});

test("capability-gates unsupported provider APIs", () => {
  const chat = decorateProviderOutputRequest("openai", {}, { level: "full", api: "chat-completions" });
  assert.equal(chat.control.applied, false);
  assert.equal("max_output_tokens" in chat.request, false);
  const cursor = decorateProviderOutputRequest("cursor", {}, { level: "full" });
  assert.equal(cursor.control.applied, false);
});

test("detects OpenAI and Anthropic cap hits and fails lost-result quality", () => {
  assert.deepEqual(detectOutputCapHit("openai", {
    status: "incomplete", incomplete_details: { reason: "max_output_tokens" },
  }), { hit: true, reason: "max_output_tokens" });
  assert.deepEqual(detectOutputCapHit("anthropic", { stop_reason: "max_tokens" }), {
    hit: true, reason: "max_tokens",
  });
  assert.deepEqual(detectOutputCapHit("deepseek", { choices: [{ finish_reason: "length" }] }), {
    hit: true, reason: "length",
  });
  const record = createOutputCapTelemetryRecord("openai", {
    max_output_tokens: 2_048,
    incomplete_details: { reason: "max_output_tokens" },
    usage: { output_tokens: 2_048, output_tokens_details: { reasoning_tokens: 300 } },
  }, { verificationPassed: false, eventId: "cap-hit" });
  assert.equal(record.requested_output_tokens, 2_048);
  assert.equal(record.actual_output_tokens, 2_048);
  assert.equal(record.reasoning_output_tokens, 300);
  assert.equal(record.required_result_lost, true);
  assert.match(outputCapQualityFailures(record)[0], /removed or invalidated/);
});

test("persists and summarizes requested versus actual output tokens", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-cap-telemetry-"));
  try {
    const record = createOutputCapTelemetryRecord("anthropic", {
      stop_reason: "end_turn", usage: { output_tokens: 120 },
    }, { requestedOutputTokens: 2_048, verificationPassed: true, eventId: "complete" });
    assert.equal((await appendOutputCapTelemetry(root, [record, record])).added, 1);
    const records = await readOutputCapTelemetry(root);
    assert.equal(records.length, 1);
    assert.deepEqual(summarizeOutputCapTelemetry(records), {
      version: 1,
      events: 1,
      cap_hits: 0,
      required_result_losses: 0,
      requested_limit_coverage: 1,
      actual_output_coverage: 1,
      requested_output_tokens: 2_048,
      actual_output_tokens: 120,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("non-OpenClaw native policy records an honest fallback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-output-budget-"));
  try {
    const receipt = await applyNativeResponseBudgetPolicy("codex-cli", root, "full");
    assert.equal(receipt.detail.supported, false);
    assert.equal(receipt.detail.fallback, "mayo prompt contract");
    const persisted = JSON.parse(await readFile(path.join(root, ".condiments", "output-budget", "last-apply.json"), "utf8"));
    assert.equal(persisted.level, "full");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenClaw applies a lower native cap and restores the captured baseline", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-openclaw-budget-"));
  const patches = [];
  const runCommand = async (_command, args) => {
    if (args[1] === "get") return JSON.stringify({ params: { maxTokens: 12_000 } });
    const patchPath = args[3];
    if (!args.includes("--dry-run")) patches.push(JSON.parse(await readFile(patchPath, "utf8")));
    return "";
  };
  try {
    const full = await applyNativeResponseBudgetPolicy("openclaw", root, "full", { runCommand });
    assert.equal(full.detail.applied, true);
    assert.equal(full.detail.maxTokens, 2_048);
    const none = await applyNativeResponseBudgetPolicy("openclaw", root, "none", { runCommand });
    assert.equal(none.detail.maxTokens, 12_000);
    assert.equal(patches[0].agents.defaults.params.maxTokens, 2_048);
    assert.equal(patches[1].agents.defaults.params.maxTokens, 12_000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("output-budget CLI decorates OpenAI Responses requests", () => {
  const run = spawnSync(process.execPath, [
    path.resolve("scripts", "output-budget.mjs"),
    "--provider", "openai", "--api", "responses", "--level", "full", "--input", "-",
  ], { cwd: path.resolve("."), input: "{}", encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).request.max_output_tokens, 2_048);
});

test("adaptive governor decorates output and OpenAI tool-call caps", () => {
  const result = decorateProviderOutputRequest("openai", {}, {
    level: "full",
    task: "Fix src/cart.ts discount function",
    directEdit: true,
  });
  assert.equal(result.request.max_output_tokens, 512);
  assert.equal(result.request.max_tool_calls, 4);
  assert.equal(result.control.governor.suppressRecap, true);
  assert.equal(result.control.tool_mechanism, "max_tool_calls");
});

test("adaptive governor keeps Anthropic tool cap as prompt contract", () => {
  const result = decorateProviderOutputRequest("anthropic", {}, {
    level: "full",
    taskClass: "complex",
  });
  assert.equal(result.request.max_tokens, 2_048);
  assert.equal("max_tool_calls" in result.request, false);
  assert.equal(result.control.tool_mechanism, "prompt-contract");
});
