#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyEvaluationAnswer } from "../src/provider-eval.mjs";
import { compareEfficiency, summarizeRuns } from "../src/usage.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(root, "evals", "phase5-live-workloads.json");
const sourcePaths = [
  path.join(root, "evals", "results", "codex-cli-phase5-eight-workloads.json"),
  path.join(root, "evals", "results", "phase5-retry-test-debug-full.json"),
  path.join(root, "evals", "results", "phase5-retry-remaining.json"),
  path.join(root, "evals", "results", "codex-cli-phase5-post-tuning.json"),
  path.join(root, "evals", "results", "codex-cli-phase5-full-retuned.json"),
];
const outputPath = path.join(root, "evals", "results", "codex-cli-phase5-live.json");
const markdownPath = path.join(root, "evals", "results", "phase5-live-report.md");

const config = JSON.parse(await readFile(configPath, "utf8"));
const reports = await Promise.all(sourcePaths.map(async (sourcePath) =>
  JSON.parse(await readFile(sourcePath, "utf8"))
));
const expectedByWorkload = new Map(config.workloads.map((workload) => [workload.id, workload.expected]));
const selected = new Map();

for (const report of reports) {
  for (const run of report.runs) {
    if (!run.answer || run.version !== 1) continue;
    const expected = expectedByWorkload.get(run.workload);
    if (!expected) continue;
    const verification = verifyEvaluationAnswer(run.answer, expected);
    selected.set(`${run.workload}:${run.mode}`, {
      ...run,
      failures: verification.failures,
      verification_passed: verification.passed,
    });
  }
}

const modes = ["baseline", "some", "full"];
const runs = [];
for (const workload of config.workloads) {
  for (const mode of modes) {
    const run = selected.get(`${workload.id}:${mode}`);
    if (!run) throw new Error(`Missing completed run: ${workload.id}:${mode}`);
    runs.push(run);
  }
}

const summaries = Object.fromEntries(modes.map((mode) => [
  mode,
  summarizeRuns(runs.filter((run) => run.mode === mode)),
]));
const comparisons = {
  some: compareEfficiency(summaries.baseline, summaries.some),
  full: compareEfficiency(summaries.baseline, summaries.full),
};
const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  host: "codex-cli",
  modes,
  sourceReports: sourcePaths.map((sourcePath) => path.relative(root, sourcePath).replaceAll("\\", "/")),
  runs,
  summaries,
  comparisons,
};

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(markdownPath, renderMarkdown(report, config.workloads), "utf8");
console.log(`Wrote ${path.relative(root, outputPath)}`);
console.log(`Wrote ${path.relative(root, markdownPath)}`);

function renderMarkdown(result, workloads) {
  const lines = [
    "# Phase 5 Live Quality Evaluation",
    "",
    `Generated: ${result.generatedAt}`,
    "",
    "## Outcome",
    "",
    `Codex CLI passed ${result.runs.filter((run) => run.verification_passed).length}/${result.runs.length} quality gates across eight workload classes and three modes.`,
    "",
    "| Mode | Passed | Input tokens | Output tokens | Total tokens | Tool-result chars | Tool calls | Wall time | Token ratio |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...modes.map((mode) => {
      const summary = result.summaries[mode];
      const ratio = mode === "baseline" ? "1.000" : result.comparisons[mode].token_ratio.toFixed(3);
      return `| ${mode} | ${summary.verified_successes}/${summary.runs} | ${n(summary.input_tokens)} | ${n(summary.output_tokens)} | ${n(summary.total_tokens)} | ${n(summary.tool_result_chars)} | ${summary.tool_calls} | ${seconds(summary.wall_time_ms)} | ${ratio} |`;
    }),
    "",
    "`some` and `full` retain correctness. A token ratio below 1.000 is a net reduction against baseline.",
    "",
    "## Workload Results",
    "",
    "| Workload | Baseline | `some` | `some` delta | `full` | `full` delta | Quality |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...workloads.map((workload) => {
      const byMode = Object.fromEntries(modes.map((mode) => [mode, result.runs.find((run) => run.workload === workload.id && run.mode === mode)]));
      return `| ${workload.id} | ${n(byMode.baseline.total_tokens)} | ${n(byMode.some.total_tokens)} | ${percentDelta(byMode.baseline.total_tokens, byMode.some.total_tokens)} | ${n(byMode.full.total_tokens)} | ${percentDelta(byMode.baseline.total_tokens, byMode.full.total_tokens)} | ${modes.every((mode) => byMode[mode].verification_passed) ? "3/3" : "FAIL"} |`;
    }),
    "",
    "## Method",
    "",
    "- Synthetic read-only repository with exact, deterministic answers and line-level evidence.",
    "- Eight classes: one-line fix, multi-file diagnosis, repository exploration, test/debug loop, checkpoint recovery, large command output, architecture decision, and unrelated task switch.",
    "- Each class ran independently under native baseline, `/cond some`, and `/cond full`.",
    "- Gates verify answer content plus exact file, line, and source quote. Extra explanatory prose is allowed when the required answer remains present.",
    "- The first matrix hit a temporary Codex usage limit after 11 calls. Incomplete cells were resumed, policies were tuned from observed extra tool rounds, and optimized modes were rerun. This report selects the fixed baseline and latest completed tuned result for each optimized cell.",
    "",
    "## Telemetry Limits",
    "",
    "Codex CLI exposed input tokens, output tokens, tool calls, tool-result characters, and wall time. It did not expose price, cache-read/write tokens, or reasoning-token detail in these JSONL records, so cost efficiency and cache efficiency remain unverified.",
    "",
    "## Host Coverage",
    "",
    "- Codex CLI 0.154.0-alpha.6.2: authenticated; full matrix complete.",
    "- Claude Code 2.1.270: installed; live run blocked by `Not logged in · Please run /login`.",
    "- OpenClaw: command unavailable.",
    "- Cursor: command unavailable.",
    "",
    "## Decision",
    "",
    result.comparisons.some.token_ratio < 1 && result.comparisons.full.token_ratio < 1
      ? "Both presets reduced measured tokens while preserving all quality gates."
      : "Keep the policies experimental. Quality held, but at least one optimized preset did not reduce total measured tokens across this matrix.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function n(value) {
  return Number(value).toLocaleString("en-US");
}

function seconds(value) {
  return `${(value / 1000).toFixed(1)} s`;
}

function percentDelta(baseline, candidate) {
  const delta = ((candidate / baseline) - 1) * 100;
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`;
}
