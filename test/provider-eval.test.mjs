import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildEvaluationPrompt, parseHostOutput, verifyEvaluationAnswer } from "../src/provider-eval.mjs";

test("provider prompts add policies only for optimized modes", () => {
  const workload = { prompt: "Find TargetSymbol." };
  assert.doesNotMatch(buildEvaluationPrompt(workload, "baseline"), /<cond-/);
  assert.match(buildEvaluationPrompt(workload, "some"), /<cond-mayo>/);
  assert.match(buildEvaluationPrompt(workload, "some"), /<cond-ranch>/);
  assert.match(buildEvaluationPrompt(workload, "full"), /<cond-hot>/);
  const mayoOnly = buildEvaluationPrompt(workload, "full", { control: "mayo" });
  assert.match(mayoOnly, /<cond-mayo>/);
  assert.doesNotMatch(mayoOnly, /<cond-ranch>/);
});

test("quality verifier requires exact file, line, and evidence", () => {
  const expected = { file: "src/target.js", line: 2, evidenceIncludes: "TargetSymbol" };
  assert.equal(verifyEvaluationAnswer({ file: "src\\target.js", line: 2, evidence: "TargetSymbol" }, expected).passed, true);
  assert.equal(verifyEvaluationAnswer({ file: "src/nope.js", line: 3, evidence: "" }, expected).passed, false);
});

test("quality verifier supports generic answers with evidence sets", () => {
  const result = verifyEvaluationAnswer({
    answer: "fixed",
    evidence: [{ file: "C:\\workspace\\src\\x.js", line: 3, quote: "bug fixed here" }],
  }, {
    answerEquals: "fixed",
    evidence: [{ file: "src/x.js", line: 3, quoteIncludes: "fixed" }],
  });
  assert.equal(result.passed, true);
});

test("Codex JSONL parser extracts final structured answer and usage", () => {
  const output = [
    JSON.stringify({ type: "thread.started" }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: '{"file":"x","line":1,"evidence":"e"}' } }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 2 } }),
  ].join("\n");
  const parsed = parseHostOutput("codex-jsonl", output);
  assert.equal(parsed.answer.file, "x");
  assert.equal(parsed.usagePayload.input_tokens, 10);
});

test("provider runner executes baseline, some, and full with quality gates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-provider-"));
  try {
    await mkdir(path.join(root, "repo", "src"), { recursive: true });
    await writeFile(path.join(root, "repo", "src", "target.js"), "x\nexport function TargetSymbol() {}\n", "utf8");
    await writeFile(path.join(root, "schema.json"), JSON.stringify({ type: "object" }), "utf8");
    const config = {
      answerSchema: "schema.json",
      hosts: {
        fake: {
          command: process.execPath,
          args: [path.resolve("evals", "fixtures", "fake-provider.mjs")],
          outputFormat: "claude-json",
          provider: "anthropic"
        }
      },
      workloads: [{
        id: "fixture",
        path: "repo",
        prompt: "Find TargetSymbol.",
        expected: { file: "src/target.js", line: 2, evidenceIncludes: "TargetSymbol" }
      }]
    };
    const configPath = path.join(root, "config.json");
    const outputPath = path.join(root, "report.json");
    await writeFile(configPath, JSON.stringify(config), "utf8");
    const run = spawnSync(process.execPath, [
      path.resolve("scripts", "run-provider-eval.mjs"),
      "--config", configPath,
      "--host", "fake",
      "--output", outputPath,
    ], { cwd: path.resolve("."), encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(report.runs.length, 3);
    assert.ok(report.runs.every((item) => item.verification_passed));
    assert.equal(report.summaries.full.verified_successes, 1);
    assert.equal(report.output_cap_summaries.full.events, 1);
    assert.equal(report.runs.find((item) => item.mode === "full").policy_output_token_limit, 2_048);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
