import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { evaluateRepository } from "../src/evaluation.mjs";

test("evaluation narrows context while preserving exact query matches", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-eval-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "README.md"), "fixture repository\n", "utf8");
    await writeFile(path.join(root, "src", "target.js"), [
      "const before = 1;",
      "export function TargetSymbol() {",
      "  return before;",
      "}",
    ].join("\n"), "utf8");
    await writeFile(path.join(root, "src", "noise.js"), "x".repeat(10_000), "utf8");
    await mkdir(path.join(root, "node_modules"));
    await writeFile(path.join(root, "node_modules", "ignored.js"), "TargetSymbol", "utf8");

    const result = await evaluateRepository({ root, query: "TargetSymbol", windowLines: 1 });

    assert.equal(result.queryMatches, 1);
    assert.deepEqual(result.matchedFiles, ["src/target.js"]);
    assert.equal(result.modes.some.matchRecall, 1);
    assert.equal(result.modes.full.matchRecall, 1);
    assert.ok(result.modes.some.contextBytes < result.modes.baseline.contextBytes);
    assert.ok(result.modes.full.contextBytes < result.modes.some.contextBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

