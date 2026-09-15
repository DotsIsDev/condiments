import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { decodeLogDictionary, encodeLogDictionary } from "../src/log-dictionary.mjs";
import { createResultEnvelope } from "../src/result-envelope.mjs";

function repeatedLog(count = 200) {
  return Array.from({ length: count }, (_, index) =>
    `2026-09-14T12:00:${String(index % 60).padStart(2, "0")}Z INFO worker=${index} request completed in ${index + 10}ms${index % 2 ? "\r\n" : "\n"}`
  ).join("");
}

test("dictionary codec compresses repetitive variable logs and reconstructs exact bytes", () => {
  const content = repeatedLog();
  const encoded = encodeLogDictionary(content);
  assert.equal(encoded.compressed, true);
  assert.equal(encoded.lossless, true);
  assert.ok(encoded.reduction_rate > 0.25);
  assert.equal(encoded.dictionary_entries, 2);
  assert.equal(decodeLogDictionary(encoded), content);
});

test("dictionary codec run-packs arithmetic substitutions", () => {
  const content = Array.from({ length: 12_000 }, (_, index) => `event ${index + 1}: stable historical record\n`).join("");
  const encoded = encodeLogDictionary(content);
  assert.deepEqual(encoded.payload.r, [["R", 0, 12_000, ["i", 1, 1]]]);
  assert.ok(encoded.reduction_rate > 0.99);
  assert.equal(decodeLogDictionary(encoded), content);
});

test("dictionary codec falls back to raw for non-repetitive content", () => {
  const content = "alpha\nbeta has words\ngamma differs completely";
  const encoded = encodeLogDictionary(content);
  assert.equal(encoded.compressed, false);
  assert.equal(encoded.codec, "raw");
  assert.equal(decodeLogDictionary(encoded), content);
});

test("decoder rejects tampered payload", () => {
  const encoded = encodeLogDictionary(repeatedLog());
  encoded.payload.r[0][1] = "tampered";
  assert.throws(() => decodeLogDictionary(encoded), /hash does not match/);
});

test("large-result envelope carries bounded lossless dictionary when it fits", () => {
  const content = repeatedLog();
  const envelope = createResultEnvelope({ tool: "test", content }, {
    thresholdChars: 10_000,
    previewChars: 100,
  });
  assert.equal(envelope.truncated, true);
  assert.equal(envelope.dictionary_compression.codec, "log-dict");
  assert.equal(decodeLogDictionary(envelope.dictionary_compression.payload), content);
  assert.ok(JSON.stringify(envelope).length <= 10_000);
});

test("log dictionary CLI round trips compact payload", () => {
  const script = path.resolve("scripts", "log-dictionary.mjs");
  const content = repeatedLog(80);
  const encoded = spawnSync(process.execPath, [script, "encode", "--input", "-", "--compact"], {
    cwd: path.resolve("."), input: content, encoding: "utf8",
  });
  assert.equal(encoded.status, 0, encoded.stderr);
  const decoded = spawnSync(process.execPath, [script, "decode", "--input", "-"], {
    cwd: path.resolve("."), input: encoded.stdout, encoding: "utf8",
  });
  assert.equal(decoded.status, 0, decoded.stderr);
  assert.equal(decoded.stdout, content);
});
