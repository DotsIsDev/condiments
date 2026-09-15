import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  createResultEnvelope,
  offloadToolResult,
} from "../src/result-envelope.mjs";

test("small tool results remain inline and retain error evidence", () => {
  const content = "build started\nERROR missing module\nbuild stopped";
  const envelope = createResultEnvelope(
    { tool: "build", request_summary: "compile", exit_status: 1, content },
    { thresholdChars: 1_000 },
  );

  assert.equal(envelope.truncated, false);
  assert.equal(envelope.content, content);
  assert.equal(envelope.artifact_path, null);
  assert.deepEqual(envelope.error_matches, [
    { line: 2, text: "ERROR missing module" },
  ]);
  assert.match(envelope.content_hash, /^sha256:[a-f0-9]{64}$/);
});

test("large tool results are recoverable from a hash-addressed artifact", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "condiments-result-"));
  const content = `${"A".repeat(120)}\nFatal: compilation failed\n${"Z".repeat(120)}`;

  try {
    const envelope = await offloadToolResult(
      {
        tool: "npm test",
        request_summary: "run suite",
        exit_status: 1,
        content,
      },
      {
        artifactDirectory: temporaryDirectory,
        thresholdChars: 100,
        previewChars: 30,
      },
    );

    assert.equal(envelope.truncated, true);
    assert.equal(envelope.content, null);
    assert.equal(envelope.relevant_head, content.slice(0, 30));
    assert.equal(envelope.relevant_tail, content.slice(-30));
    assert.deepEqual(envelope.error_matches, [
      { line: 2, text: "Fatal: compilation failed" },
    ]);
    assert.ok(path.isAbsolute(envelope.artifact_path));
    assert.equal(await readFile(envelope.artifact_path, "utf8"), content);

    const repeated = await offloadToolResult(
      { tool: "npm test", content },
      {
        artifactDirectory: temporaryDirectory,
        thresholdChars: 100,
        previewChars: 30,
      },
    );
    assert.equal(repeated.artifact_path, envelope.artifact_path);
    assert.equal(repeated.content_hash, envelope.content_hash);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("large-result limits reject invalid values", () => {
  assert.throws(
    () =>
      createResultEnvelope(
        { tool: "test", content: "output" },
        { thresholdChars: 0 },
      ),
    /thresholdChars must be a positive integer/,
  );
});

test("large-result CLI writes the artifact and emits only the envelope", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "condiments-result-cli-"));
  const inputPath = path.join(temporaryDirectory, "input.log");
  const artifactDirectory = path.join(temporaryDirectory, "artifacts");
  const content = `${"start\n".repeat(30)}Error: broken build\n${"end\n".repeat(30)}`;
  const scriptPath = path.resolve("scripts", "compact-tool-result.mjs");

  try {
    await writeFile(inputPath, content, "utf8");
    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        "--input",
        inputPath,
        "--tool",
        "build",
        "--threshold",
        "100",
        "--preview",
        "20",
        "--artifact-dir",
        artifactDirectory,
      ],
      { cwd: path.resolve("."), encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.truncated, true);
    assert.equal(envelope.content, null);
    assert.equal(await readFile(envelope.artifact_path, "utf8"), content);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
