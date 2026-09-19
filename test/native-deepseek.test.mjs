import assert from "node:assert/strict";
import test from "node:test";
import { decorateDeepSeekRequest, resolveDeepSeekReasoningPolicy } from "../src/native-deepseek.mjs";

const capabilities = { reasoningEffort: true, reasoningHistoryElision: true };

test("DeepSeek full spends no reasoning on micro work and scales harder work", () => {
  assert.equal(resolveDeepSeekReasoningPolicy({ level: "full", taskClass: "micro", capabilities }).effort, "none");
  assert.equal(resolveDeepSeekReasoningPolicy({ level: "full", taskClass: "standard", capabilities }).effort, "low");
  assert.equal(resolveDeepSeekReasoningPolicy({ level: "full", taskClass: "complex", capabilities }).effort, "high");
  assert.equal(resolveDeepSeekReasoningPolicy({ level: "full", taskClass: "standard", blocked: true, capabilities }).effort, "max");
});

test("DeepSeek Chat Completions removes prior reasoning only without tools", () => {
  const request = {
    model: "deepseek-flash",
    messages: [
      { role: "user", content: "first" },
      { role: "assistant", reasoning_content: "private prior reasoning", content: "answer" },
      { role: "user", content: "next" },
    ],
  };
  const result = decorateDeepSeekRequest(request, { level: "full", taskClass: "standard", capabilities });
  assert.equal(result.request.thinking.type, "enabled");
  assert.equal(result.request.reasoning_effort, "low");
  assert.equal("reasoning_content" in result.request.messages[1], false);
  assert.equal(result.history.removedMessages, 1);
  assert.ok(result.history.estimatedTokensSaved > 0);
  assert.equal(request.messages[1].reasoning_content, "private prior reasoning");

  const withTools = decorateDeepSeekRequest({ ...request, tools: [{ type: "function", function: { name: "lookup" } }] }, {
    level: "full", taskClass: "standard", capabilities,
  });
  assert.equal(withTools.request.messages[1].reasoning_content, "private prior reasoning");
  assert.equal(withTools.history.reason, "tool-continuity-required");
});

test("DeepSeek preserves lower caller effort and supports Responses API", () => {
  const lower = decorateDeepSeekRequest({ reasoning_effort: "low", messages: [] }, {
    level: "some", taskClass: "complex", capabilities,
  });
  assert.equal(lower.request.reasoning_effort, "low");
  assert.equal(lower.policy.preservedLowerCallerEffort, true);

  const responses = decorateDeepSeekRequest({ reasoning: { summary: "auto" } }, {
    level: "full", taskClass: "micro", api: "responses", capabilities,
  });
  assert.deepEqual(responses.request.reasoning, { summary: "auto", effort: "none" });
});

test("DeepSeek controls are capability-gated and none is byte-for-byte inert by value", () => {
  const source = { model: "deepseek-flash", messages: [{ role: "user", content: "hello" }] };
  assert.deepEqual(decorateDeepSeekRequest(source, { level: "none", capabilities }).request, source);
  assert.equal(decorateDeepSeekRequest(source, { level: "full", capabilities: {} }).policy.reason, "reasoning-effort-unsupported");
  assert.deepEqual(source, { model: "deepseek-flash", messages: [{ role: "user", content: "hello" }] });
});
