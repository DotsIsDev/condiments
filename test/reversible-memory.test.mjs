import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  commitReversibleMemory,
  expandReversibleMemory,
  foldReversibleMemory,
  inspectReversibleMemory,
  memorySummarySimilarity,
  renderReversibleMemoryReference,
} from "../src/reversible-memory.mjs";

test("dual-form memory restores exact raw bytes and folds to summary", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-memory-"));
  try {
    const raw = Buffer.from([0, 1, 2, 10, 13, 255]);
    const committed = await commitReversibleMemory(root, { sessionId: "s/1", summary: { goal: "fix exact state", ids: ["A-17"] }, rawBytes: raw });
    assert.equal(committed.deduplicated, false);
    assert.doesNotMatch(JSON.stringify(await inspectReversibleMemory(root, "s/1")), /AAECCg3\//);
    const expanded = await expandReversibleMemory(root, { sessionId: "s/1", memoryId: committed.memory.id, encoding: null });
    assert.deepEqual(expanded.bytes, raw);
    const folded = await foldReversibleMemory(root, { sessionId: "s/1", memoryId: committed.memory.id });
    assert.match(folded.summary, /A-17/);
    assert.equal(folded.state.expandedMemoryId, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("memory verifies hash and enforces bounded action lifecycle", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-memory-life-"));
  try {
    const committed = await commitReversibleMemory(root, { sessionId: "s", summary: "unique milestone alpha", rawText: "exact raw" });
    await writeFile(committed.memory.objectPath, "tampered", "utf8");
    await assert.rejects(expandReversibleMemory(root, { sessionId: "s", memoryId: committed.memory.id }), /verification/);
    await writeFile(committed.memory.objectPath, "exact raw", "utf8");
    await expandReversibleMemory(root, { sessionId: "s", memoryId: committed.memory.id });
    await assert.rejects(expandReversibleMemory(root, { sessionId: "s", memoryId: committed.memory.id }), /Repeated|cannot exceed/);
    await foldReversibleMemory(root, { sessionId: "s", memoryId: committed.memory.id });
    await assert.rejects(foldReversibleMemory(root, { sessionId: "s", memoryId: committed.memory.id }), /Repeated|lifecycle/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("near-duplicate summaries share summary storage but preserve distinct raw bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-memory-dedupe-"));
  try {
    const first = await commitReversibleMemory(root, { sessionId: "s", summary: "fix checkout error retain exact session id A17", rawText: "one" });
    const second = await commitReversibleMemory(root, { sessionId: "s", summary: "fix checkout error retain exact session id A17", rawText: "two" });
    assert.equal(second.deduplicated, false);
    assert.equal(second.summaryDeduplicated, true);
    assert.notEqual(second.memory.id, first.memory.id);
    const state = await inspectReversibleMemory(root, "s");
    assert.equal(state.memories.length, 2);
    assert.equal(state.memories[1].summary, null);
    assert.equal(state.memories[1].summaryRef, first.memory.id);
    assert.ok(memorySummarySimilarity("a b c", "a b c") > 0.9);
    assert.match(renderReversibleMemoryReference(first.memory), /raw_sha256=/);
    assert.doesNotMatch(renderReversibleMemoryReference(first.memory), /fix checkout/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("memory CLI commits without printing raw content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-memory-cli-"));
  try {
    const input = path.join(root, "input.json");
    await writeFile(input, JSON.stringify({ sessionId: "cli", summary: "safe summary", rawText: "SECRET-RAW-CONTENT" }), "utf8");
    const { spawnSync } = await import("node:child_process");
    const run = spawnSync(process.execPath, [path.resolve("scripts/reversible-memory.mjs"), "commit", "--root", root, "--input", input], { cwd: path.resolve("."), encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.doesNotMatch(run.stdout, /SECRET-RAW-CONTENT/);
    assert.match(run.stdout, /rawSha256/);
    await readFile(JSON.parse(run.stdout).memory.objectPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
