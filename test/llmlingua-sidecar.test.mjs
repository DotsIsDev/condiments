import assert from "node:assert/strict";
import test from "node:test";
import { compressWithLLMLingua, isExtractiveTokenSubsequence } from "../src/llmlingua-sidecar.mjs";

test("LLMLingua adapter applies only net-positive extractive output", async () => {
  const source = `${"noise ".repeat(300)}KEEP-17 final evidence`;
  const response = JSON.stringify({ compressed_text: "KEEP-17 final evidence", source_tokens: 303, compressed_tokens: 3 });
  const result = await compressWithLLMLingua({
    level: "full", capability: true, text: source, lockedSignals: ["KEEP-17"], overheadTokens: 10,
    command: process.execPath, args: ["-e", `process.stdin.resume();process.stdin.on('end',()=>console.log(${JSON.stringify(response)}))`],
  });
  assert.equal(result.applied, true);
  assert.equal(result.netTokenReduction, 290);
});

test("LLMLingua adapter falls back on lost signals or invented tokens", async () => {
  const command = process.execPath;
  const invented = JSON.stringify({ compressed_text: "invented answer", source_tokens: 100, compressed_tokens: 2 });
  const result = await compressWithLLMLingua({ level: "full", capability: true, text: "original KEEP-9 text", lockedSignals: ["KEEP-9"], overheadTokens: 1,
    command, args: ["-e", `process.stdin.resume();process.stdin.on('end',()=>console.log(${JSON.stringify(invented)}))`] });
  assert.equal(result.applied, false);
  assert.equal(result.reason, "non-extractive-output");
  assert.equal(result.text, "original KEEP-9 text");
  assert.equal(isExtractiveTokenSubsequence("a b c d", "a c d"), true);
  assert.equal(isExtractiveTokenSubsequence("a b c", "a x"), false);
});

test("missing capability is inert and never invokes sidecar", async () => {
  const result = await compressWithLLMLingua({ level: "full", capability: false, text: "keep original", command: "does-not-exist" });
  assert.equal(result.reason, "capability-unavailable");
  assert.equal(result.text, "keep original");
});
