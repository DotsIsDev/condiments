#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { runDeterministicToolContextEvaluation, renderToolContextEvaluationMarkdown } from "../src/tool-context-evaluation.mjs";

const options = parseArgs(process.argv.slice(2));
const usedPercent = Number(options["codex-used-percent"] ?? 0);
const minimumRemaining = Number(options["minimum-remaining-percent"] ?? 15);
const remaining = Math.max(0, 100 - usedPercent);
let liveCodex = {
  attempted: false,
  skipped: true,
  used_percent: usedPercent,
  remaining_percent: remaining,
  minimum_remaining_percent: minimumRemaining,
  reason: remaining < minimumRemaining
    ? `Codex five-hour usage is ${usedPercent}% used; ${remaining}% remains below the ${minimumRemaining}% reserve.`
    : "This deterministic runner does not invent provider usage; use the isolated live-host runner after reset.",
};
try {
  const live = JSON.parse(await readFile(path.resolve(options["live-result"] ?? "evals/results/codex-cli-tool-context-live.json"), "utf8"));
  if (live.complete) liveCodex = {
    attempted: true,
    skipped: false,
    complete: true,
    quality_passed: live.quality_passed,
    observed_tokens: live.budget?.observed_tokens ?? null,
    modes: live.runs.map((run) => ({ mode: run.mode, input_tokens: run.input_tokens, output_tokens: run.output_tokens, total_tokens: run.total_tokens, quality_passed: run.quality_passed })),
  };
} catch (error) { if (error.code !== "ENOENT") throw error; }
const result = runDeterministicToolContextEvaluation({ liveCodex });
const jsonPath = path.resolve(options.json ?? "evals/results/tool-context-evaluation.json");
const markdownPath = path.resolve(options.markdown ?? "evals/results/tool-context-evaluation.md");
await mkdir(path.dirname(jsonPath), { recursive: true });
await mkdir(path.dirname(markdownPath), { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
await writeFile(markdownPath, renderToolContextEvaluationMarkdown(result), "utf8");
console.log(JSON.stringify({ quality_passed: result.quality_passed, json: jsonPath, markdown: markdownPath, live_codex: liveCodex }, null, 2));

function parseArgs(args) {
  const output = {};
  for (let index = 0; index < args.length; index += 1) {
    if (!args[index].startsWith("--")) throw new Error(`Unexpected argument '${args[index]}'.`);
    const key = args[index].slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}.`);
    output[key] = value;
    index += 1;
  }
  return output;
}
