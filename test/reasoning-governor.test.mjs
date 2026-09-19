import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import {
  classifyReasoningTask,
  decorateProviderReasoningRequest,
  resolveProviderReasoningPolicy,
} from "../src/reasoning-governor.mjs";

test("shared classifier and effort policy adapt across OpenAI and Anthropic", () => {
  assert.equal(classifyReasoningTask("Fix typo"), "standard");
  assert.equal(classifyReasoningTask("status"), "micro");
  assert.equal(classifyReasoningTask("Architect a complex migration"), "complex");

  const capabilities = { reasoningEffort: true, supportedEfforts: ["low", "medium", "high", "xhigh"] };
  assert.equal(resolveProviderReasoningPolicy("openai", { level: "full", taskClass: "micro", capabilities }).effort, "low");
  assert.equal(resolveProviderReasoningPolicy("anthropic", { level: "some", taskClass: "standard", capabilities }).effort, "medium");
  assert.equal(resolveProviderReasoningPolicy("openai", { level: "full", blocked: true, capabilities }).effort, "xhigh");
});

test("OpenAI Responses uses request-level effort and response state", () => {
  const result = decorateProviderReasoningRequest("openai", {
    model: "gpt-test",
    reasoning: { effort: "minimal", summary: "auto" },
  }, {
    level: "full",
    taskClass: "complex",
    previousResponseId: "resp_123",
    capabilities: { reasoningEffort: true, responseState: true, supportedEfforts: ["minimal", "low", "medium", "high"] },
  });
  assert.deepEqual(result.request.reasoning, { effort: "minimal", summary: "auto" });
  assert.equal(result.policy.preservedLowerCallerEffort, true);
  assert.equal(result.request.previous_response_id, "resp_123");
  assert.equal(result.state.mechanism, "previous_response_id");
  assert.equal(JSON.stringify(result.request).includes("configuration_update"), false);
});

test("OpenAI cache lineage can hold an effort change", () => {
  const previous = { model: "gpt-test", reasoning: { effort: "high" }, input: "old" };
  const result = decorateProviderReasoningRequest("openai", { ...previous, input: "new" }, {
    level: "full",
    taskClass: "micro",
    capabilities: { reasoningEffort: true },
    previousRequest: previous,
    lineageMetrics: { cacheReadTokens: 20_000, expectedReasoningTokenSavings: 200 },
  });
  assert.equal(result.request.reasoning.effort, "high");
  assert.equal(result.lineage.action, "preserve");
  assert.equal(result.policy.reason, "cache-lineage-preserved");
});

test("Anthropic uses effort and server-side thinking cleanup", () => {
  const result = decorateProviderReasoningRequest("anthropic", {
    model: "claude-test",
    messages: [{ role: "user", content: "status" }],
    context_management: { edits: [{ type: "clear_tool_uses_20250919" }] },
  }, {
    level: "full",
    taskClass: "micro",
    capabilities: { reasoningEffort: true, contextEditing: true },
  });
  assert.equal(result.request.output_config.effort, "low");
  assert.equal(result.request.context_management.edits[0].type, "clear_thinking_20251015");
  assert.deepEqual(result.request.context_management.edits[0].keep, { type: "thinking_turns", value: 1 });
  assert.ok(result.request.betas.includes("context-management-2025-06-27"));
});

test("Anthropic leaves active tool-loop effort and thinking history untouched", () => {
  const request = {
    output_config: { effort: "high" },
    messages: [
      { role: "assistant", content: [{ type: "thinking", thinking: "keep" }, { type: "tool_use", id: "tool_1" }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tool_1", content: "done" }] },
    ],
  };
  const result = decorateProviderReasoningRequest("anthropic", request, {
    level: "full",
    capabilities: { reasoningEffort: true, contextEditing: true },
  });
  assert.deepEqual(result.request, request);
  assert.equal(result.policy.reason, "tool-continuity-preserved");
  assert.equal(result.context.reason, "tool-continuity-preserved");
});

test("Anthropic cache lineage protects effort and context settings", () => {
  const previous = { model: "claude-test", messages: [], output_config: { effort: "high" } };
  const result = decorateProviderReasoningRequest("anthropic", previous, {
    level: "full",
    taskClass: "micro",
    capabilities: { reasoningEffort: true, contextEditing: true },
    previousRequest: previous,
    lineageMetrics: { cacheReadTokens: 20_000 },
  });
  assert.equal(result.request.output_config.effort, "high");
  assert.equal("context_management" in result.request, false);
  assert.equal("betas" in result.request, false);
  assert.equal(result.context.reason, "cache-lineage-preserved");
});

test("none and unsupported capabilities leave provider requests unchanged", () => {
  const source = { model: "test", messages: [] };
  assert.deepEqual(decorateProviderReasoningRequest("anthropic", source, { level: "none" }).request, source);
  const unsupported = decorateProviderReasoningRequest("openai", source, { level: "full", capabilities: {} });
  assert.deepEqual(unsupported.request, source);
  assert.equal(unsupported.policy.reason, "reasoning-effort-unsupported");
});

test("reasoning governor CLI decorates provider requests", () => {
  const input = JSON.stringify({
    request: { model: "gpt-test" },
    options: { level: "full", taskClass: "micro", capabilities: { reasoningEffort: true } },
  });
  const run = spawnSync(process.execPath, [
    path.resolve("scripts", "reasoning-governor.mjs"), "--provider", "openai", "--input", "-",
  ], { cwd: path.resolve("."), input, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).request.reasoning.effort, "low");
});
