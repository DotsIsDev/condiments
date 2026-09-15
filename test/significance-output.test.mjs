import assert from "node:assert/strict";
import test from "node:test";
import { classifyOutputBlock, selectSignificantOutput } from "../src/significance-output.mjs";

test("required semantic blocks survive a soft output budget", () => {
  const result = selectSignificantOutput({
    level: "full",
    budgetTokens: 8,
    blocks: [
      { id: "hello", kind: "greeting", text: "Thanks for asking", tokenCount: 4 },
      { id: "path", kind: "path", text: "src/cart.mjs", tokenCount: 3 },
      { id: "test", kind: "test", text: "npm test: 42 passed", tokenCount: 6 },
      { id: "recap", kind: "recap", text: "Long repeated recap", tokenCount: 5 },
    ],
  });
  assert.equal(result.requiredOverBudget, true);
  assert.deepEqual(result.blocks.map((block) => block.id), ["path", "test"]);
  assert.match(result.output, /42 passed/);
});

test("optional blocks are ranked by utility per token and deduplicated", () => {
  const result = selectSignificantOutput({
    level: "full", budgetTokens: 5,
    blocks: [
      { id: "r1", kind: "result", text: "done", tokenCount: 2 },
      { id: "r2", kind: "result", text: "done", tokenCount: 2 },
      { id: "why", kind: "rationale", text: "because reasons", tokenCount: 5 },
    ],
  });
  assert.deepEqual(result.blocks.map((block) => block.id), ["r1"]);
  assert.ok(result.omitted.includes("r2"));
});

test("cap-caused missing required result fails quality", () => {
  const result = selectSignificantOutput({ level: "some", budgetTokens: 20, blocks: [], capHit: true, requiredResultLost: true,
    requiredResults: [{ name: "exact-value", present: false }] });
  assert.equal(result.qualityPassed, false);
  assert.deepEqual(result.missingRequired, ["exact-value"]);
  assert.equal(classifyOutputBlock({ kind: "recap", text: "optional" }).required, false);
});
