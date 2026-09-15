import assert from "node:assert/strict";
import test from "node:test";
import { decorateQwenRequest, resolveQwenThinkingPolicy } from "../src/native-qwen.mjs";

const capabilities = { hybridThinking: true, thinkingBudget: true };

test("Qwen full disables thinking for routine work", () => {
  const result = decorateQwenRequest({ model: "qwen", messages: [] }, { level: "full", taskClass: "micro", capabilities });
  assert.equal(result.request.extra_body.enable_thinking, false);
  assert.equal("thinking_budget" in result.request.extra_body, false);
  assert.equal(result.policy.reason, "routine-no-thinking");
});

test("Qwen uses bounded thinking for complex work and preserves lower caller cap", () => {
  const result = decorateQwenRequest({ extra_body: { thinking_budget: 900, keep: true } }, { level: "full", task: "Architect a complex migration", capabilities });
  assert.equal(result.request.extra_body.enable_thinking, true);
  assert.equal(result.request.extra_body.thinking_budget, 900);
  assert.equal(result.request.extra_body.keep, true);
  assert.equal(result.policy.thinkingBudget, 2_048);
});

test("Qwen quality failure escalates while unsupported and none remain inert", () => {
  assert.equal(resolveQwenThinkingPolicy({ level: "full", taskClass: "standard", blocked: true, capabilities }).thinkingBudget, 4_096);
  const source = { extra_body: { untouched: 1 } };
  assert.deepEqual(decorateQwenRequest(source, { level: "none", capabilities }).request, source);
  assert.equal(decorateQwenRequest(source, { level: "full", capabilities: {} }).policy.reason, "hybrid-thinking-unsupported");
  assert.deepEqual(source, { extra_body: { untouched: 1 } });
});
