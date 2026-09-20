import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { decideMemoryConsolidation, ingestMemoryEvent, queryMemoryEvents } from "../src/zero-token-memory.mjs";

test("zero-token memory retrieves exact provenance without model work", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-zero-memory-"));
  try {
    const first = await ingestMemoryEvent(root, {
      sessionId: "s1", turn: 1, verified: true,
      rawText: "Failure in src/cache.mjs: CacheKeyError E431. Run npm test.",
      paths: ["src/cache.mjs"], symbols: ["CacheKeyError"], commands: ["npm test"],
      timestamp: "2026-09-01T00:00:00Z",
    });
    await ingestMemoryEvent(root, {
      sessionId: "s1", turn: 2, rawText: "Updated README formatting only.", timestamp: "2026-09-02T00:00:00Z",
    });
    const result = await queryMemoryEvents(root, { query: "Why did CacheKeyError occur in src/cache.mjs?", sessionId: "s1", now: "2026-09-03T00:00:00Z" });
    assert.equal(result.providerCalls, 0);
    assert.equal(result.providerTokens, 0);
    assert.equal(result.evidence.length, 1);
    assert.equal(result.evidence[0].rawSha256, first.event.rawSha256);
    assert.match(result.evidence[0].preview, /CacheKeyError/);
    assert.equal(await readFile(result.evidence[0].rawPath, "utf8"), "Failure in src/cache.mjs: CacheKeyError E431. Run npm test.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("zero-token memory rejects tampered raw evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-zero-memory-"));
  try {
    const stored = await ingestMemoryEvent(root, { sessionId: "s", rawText: "src/a.mjs ExactError" });
    await writeFile(stored.event.rawPath, "tampered");
    await assert.rejects(() => queryMemoryEvents(root, { query: "src/a.mjs ExactError" }), /hash verification/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("zero-token memory verifies the original bytes for file-backed evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-zero-memory-"));
  try {
    const source = path.join(root, "event.bin");
    const raw = Buffer.from([0xff, 0x00, ...Buffer.from("ExactBinaryError", "utf8")]);
    await writeFile(source, raw);
    const stored = await ingestMemoryEvent(root, { sessionId: "s", rawPath: source, errors: ["ExactBinaryError"] });
    const result = await queryMemoryEvents(root, { query: "ExactBinaryError" });
    assert.equal(result.evidence[0].rawSha256, stored.event.rawSha256);
    assert.deepEqual(await readFile(result.evidence[0].rawPath), raw);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("memory consolidation is skipped for short sessions and gated by recurrence or pressure", () => {
  assert.equal(decideMemoryConsolidation({ level: "full", turnCount: 3, recurrenceCount: 9 }).reason, "short-session");
  assert.equal(decideMemoryConsolidation({ level: "full", turnCount: 8, recurrenceCount: 3, usedTokens: 10, contextWindowTokens: 100 }).consolidate, false);
  assert.equal(decideMemoryConsolidation({ level: "full", turnCount: 8, recurrenceCount: 4 }).reason, "sustained-recurrence");
  assert.equal(decideMemoryConsolidation({ level: "some", turnCount: 8, recurrenceCount: 1, usedTokens: 90, contextWindowTokens: 100 }).reason, "context-pressure");
});
