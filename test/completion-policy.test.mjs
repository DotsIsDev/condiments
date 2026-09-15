import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createFimEnvelope,
  detectEditTask,
  resolveCompletionStrategy,
  validateCompletionOutput,
  verifyFilesExact,
} from "../src/completion-policy.mjs";

test("detects edit work and respects explicit no-edit requests", () => {
  assert.equal(detectEditTask("Fix src/cart.ts discount function").isEdit, true);
  assert.equal(detectEditTask("Review src/cart.ts but do not edit it").isEdit, false);
  assert.equal(detectEditTask("Explain this stack trace").isEdit, false);
  assert.equal(detectEditTask("Implement request caching").isEdit, true);
  assert.equal(detectEditTask("Rewrite the entire file src/cart.ts").explicitFullFile, true);
});

test("resolves direct edit, FIM, changed block, and unified diff in order", () => {
  const task = "Fix src/cart.ts discount function";
  assert.equal(resolveCompletionStrategy({ task, capabilities: { directFileEdit: true } }).strategy, "direct-edit");
  assert.equal(resolveCompletionStrategy({ task, capabilities: { nativeFimCompletion: true }, fim: { prefix: "a", suffix: "b" } }).strategy, "fim");
  assert.equal(resolveCompletionStrategy({ task, exactRegion: true }).strategy, "changed-block");
  assert.equal(resolveCompletionStrategy({ task }).strategy, "unified-diff");
  assert.equal(resolveCompletionStrategy({ task, level: "none", capabilities: { directFileEdit: true } }).strategy, "answer");
});

test("FIM envelope contains only bounded insertion context", () => {
  assert.deepEqual(createFimEnvelope({ path: "src/a.js", prefix: "one\n", suffix: "\nthree", instruction: "add two" }), {
    version: 1,
    strategy: "fim",
    path: "src/a.js",
    prefix: "one\n",
    suffix: "\nthree",
    instruction: "add two",
  });
  assert.throws(() => createFimEnvelope({}), /requires a prefix or suffix/);
});

test("blocks unrequested full-file reproduction and malformed FIM or diff", () => {
  const source = "export function add(a, b) {\n  return a + b;\n}\n";
  assert.equal(validateCompletionOutput({ output: `\`\`\`js\n${source}\`\`\``, originalFiles: { "src/a.js": source } }).valid, false);
  assert.equal(validateCompletionOutput({ output: source, originalFiles: { "src/a.js": source }, requestedFullFile: true }).valid, true);
  assert.equal(validateCompletionOutput({ output: "beforeMID", strategy: "fim", fim: { prefix: "before", suffix: "after" } }).valid, false);
  assert.equal(validateCompletionOutput({ output: "replace one line", strategy: "unified-diff" }).valid, false);
  assert.equal(validateCompletionOutput({ output: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b", strategy: "unified-diff" }).valid, true);
});

test("verifies changed and untouched files byte-exactly", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-completion-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "changed.js"), "new\n");
    await writeFile(path.join(root, "src", "same.js"), "same\n");
    assert.equal((await verifyFilesExact(root, { "src/changed.js": "new\n" }, { "src/same.js": "same\n" })).valid, true);
    const result = await verifyFilesExact(root, { "src/changed.js": "wrong\n" }, { "src/same.js": "same\n" });
    assert.equal(result.valid, false);
    assert.equal(result.failures[0].code, "content-mismatch");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
