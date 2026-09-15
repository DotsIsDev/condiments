import assert from "node:assert/strict";
import test from "node:test";
import { budgetStatus, inspectCodexRolloutRecords } from "../src/codex-rollout.mjs";

test("rollout telemetry includes internal compaction calls and authoritative totals", () => {
  const usage = (responseId, turnId, total) => ({
    type: "token_usage_record",
    payload: {
      response_id: responseId,
      turn_id: turnId,
      thread_token_usage: { input_tokens: total - 10, output_tokens: 10, total_tokens: total },
    },
  });
  const records = [
    usage("response-turn", "turn-1", 900),
    usage("response-compact", "turn-1", 1_800),
    { type: "compacted", payload: { latest_token_usage_record: { turn_id: "turn-1" } } },
    usage("response-next", "turn-2", 2_400),
  ];
  const result = inspectCodexRolloutRecords(records);
  assert.equal(result.modelCalls, 3);
  assert.equal(result.count, 1);
  assert.equal(result.threadUsage.total_tokens, 2_400);
  assert.equal(result.maximumCompactionsInTurn, 1);
});

test("hard budget reserves allowance for delayed accounting", () => {
  const result = budgetStatus({
    threadUsage: { total_tokens: 91_000 },
    modelCalls: 7,
    maximumCompactionsInTurn: 1,
  }, {
    maxTotalTokens: 100_000,
    delayedTokenReserve: 10_000,
    maxModelCalls: 8,
    delayedModelCallReserve: 1,
    maxCompactionsPerTurn: 1,
  });
  assert.equal(result.stop, true);
  assert.equal(result.reasons.length, 2);
});
