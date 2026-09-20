import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkToolReuse, inspectToolState, recordToolResult, renderActiveToolState } from "../src/tool-state.mjs";

test("compact tool state reuses successful exact artifacts and invalidates on changed inputs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-tool-state-"));
  try {
    const saved = await recordToolResult(root, {
      sessionId: "session", turnId: "turn", tool: "Bash", call: "npm test",
      inputFingerprint: "tree-a", exitStatus: 0, content: "18 tests passed", facts: ["tests pass"],
    });
    assert.equal(await readFile(saved.record.artifactPath, "utf8"), "18 tests passed");
    const reuse = await checkToolReuse(root, { sessionId: "session", turnId: "turn", tool: "Bash", call: "npm   test", inputFingerprint: "tree-a" });
    assert.equal(reuse.allow, false);
    assert.equal(reuse.action, "reuse");
    assert.match(reuse.instruction, /Reuse tool result/);

    const active = renderActiveToolState(await inspectToolState(root, { sessionId: "session", turnId: "turn" }));
    assert.match(active, /tests pass/);
    assert.match(active, /artifactPath/);
    assert.doesNotMatch(active, /18 tests passed/);

    const changed = await checkToolReuse(root, { sessionId: "session", turnId: "turn", tool: "Bash", call: "npm test", inputFingerprint: "tree-b" });
    assert.equal(changed.allow, true);
    assert.equal(changed.reason, "new-call");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("compact tool state blocks unchanged failures unless retry is justified", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-tool-state-"));
  try {
    await recordToolResult(root, { sessionId: "s", turnId: "t", tool: "Bash", call: "npm test", exitStatus: 1, content: "failed" });
    const blocked = await checkToolReuse(root, { sessionId: "s", turnId: "t", tool: "Bash", call: "npm test" });
    assert.equal(blocked.allow, false);
    assert.equal(blocked.reason, "repeated-failed-call");
    const retry = await checkToolReuse(root, { sessionId: "s", turnId: "t", tool: "Bash", call: "npm test", justification: "new required stack trace" });
    assert.equal(retry.allow, true);
    assert.equal(retry.reason, "failed-call-justified-retry");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
