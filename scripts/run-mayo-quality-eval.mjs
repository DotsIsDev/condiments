#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { applyCommand, createDefaultState, parseCommand, renderPrompt } from "../src/core.mjs";
import { createOutputCapTelemetryRecord, resolveProviderOutputTokenLimit } from "../src/output-budget.mjs";
import { normalizeUsage } from "../src/usage.mjs";

const MODES = ["baseline", "some", "full"];
const TASK = [
  "Do not use tools. Review this exact source: src/discount.mjs line 1 `export function loyaltyDiscount(subtotal) {`; line 2 `return subtotal > 100 ? 0.1 : 0;`; line 3 `}`.",
  "Explain the loyalty-discount bug and fix to a maintainer.",
  "Include current behavior, required boundary behavior, exact corrected condition, repository-relative file and one-based line, and three boundary test examples.",
  "Do not edit. Return plain text.",
].join(" ");

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const repository = path.resolve(options.repository);
  const runs = [];
  for (const mode of MODES) {
    const policy = mode === "baseline"
      ? ""
      : renderPrompt(applyCommand(createDefaultState(), parseCommand(`/cond mayo ${mode}`)));
    const prompt = policy ? `${policy}\n${TASK}` : TASK;
    const started = Date.now();
    const result = await runCodex(repository, prompt, options.timeoutMs, options.model);
    const elapsed = Date.now() - started;
    const parsed = parseCodexJsonl(result.stdout);
    const failures = verifyAnswer(parsed.text);
    if (result.code !== 0) {
      failures.push(result.timedOut ? "process timeout" : `process exited ${result.code}`);
      if (result.stderr.trim()) failures.push(result.stderr.trim().slice(-1_000));
    }
    const usage = normalizeUsage("openai", parsed.usage, {
      wallTimeMs: elapsed,
      verificationPassed: failures.length === 0,
    });
    const cap = createOutputCapTelemetryRecord("openai", parsed.records, {
      host: "codex-cli",
      mode,
      actualOutputTokens: usage.output_tokens,
      reasoningOutputTokens: usage.reasoning_tokens,
      verificationPassed: failures.length === 0,
      taskClass: "standard",
    });
    runs.push({
      mode,
      verified: failures.length === 0,
      failures,
      stderr_warning_chars: result.code === 0 ? result.stderr.trim().length : 0,
      tool_calls_observed: parsed.toolCalls,
      policy_bytes: Buffer.byteLength(policy, "utf8"),
      policy_token_proxy: Math.ceil(Buffer.byteLength(policy, "utf8") / 4),
      response_words: countWords(parsed.text),
      policy_output_token_limit: mode === "baseline" ? null : resolveProviderOutputTokenLimit(mode),
      output_cap: cap,
      ...usage,
    });
  }
  const baseline = runs[0];
  const comparisons = Object.fromEntries(runs.slice(1).map((run) => [run.mode, {
    output_reduction_percent: percentReduction(baseline.output_tokens, run.output_tokens),
    total_reduction_percent: percentReduction(baseline.total_tokens, run.total_tokens),
  }]));
  const report = { version: 1, generatedAt: new Date().toISOString(), host: "codex-cli", model: options.model, workload: "mayo-maintainer-explanation", runs, comparisons };
  const outputPath = path.resolve(options.output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (runs.some((run) => !run.verified)) process.exitCode = 1;
}

function runCodex(repository, prompt, timeoutMs, model) {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", ["exec", "--ephemeral", "--model", model, "--skip-git-repo-check", "--sandbox", "read-only", "--json", "-C", repository, "-"], {
      shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, timedOut, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
    child.stdin.end(prompt);
  });
}

function parseCodexJsonl(stdout) {
  const records = String(stdout).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  let text = "";
  let usage = {};
  let toolCalls = 0;
  for (const record of records) {
    if (record.type === "item.completed" && record.item?.type === "agent_message") text = String(record.item.text ?? "");
    if (record.type === "item.completed" && record.item?.type !== "agent_message") toolCalls += 1;
    if (record.type === "turn.completed" && record.usage) usage = record.usage;
  }
  return { records, text, usage, toolCalls };
}

function verifyAnswer(text) {
  const value = String(text);
  const failures = [];
  if (!value.includes("subtotal >= 100")) failures.push("missing exact corrected condition");
  if (!/src[\\/]discount\.mjs/i.test(value)) failures.push("missing source file");
  if (!/(?:line\s*2|discount\.mjs:2)/i.test(value)) failures.push("missing one-based line 2");
  if (!/(?:equal|exactly|at)\s+(?:to\s+)?100/i.test(value)) failures.push("missing equality-boundary explanation");
  return failures;
}

function parseOptions(args) {
  const options = {
    repository: "evals/fixtures/phase5-project",
    output: "evals/results/codex-cli-policy-overhead-quality.json",
    timeoutMs: 90_000,
    model: "gpt-5.6-luna",
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--repository") options.repository = value(args, ++index, arg);
    else if (arg === "--output") options.output = value(args, ++index, arg);
    else if (arg === "--timeout-ms") options.timeoutMs = positive(value(args, ++index, arg), arg);
    else if (arg === "--model") options.model = value(args, ++index, arg);
    else throw new Error(`Unknown option '${arg}'.`);
  }
  return options;
}

function value(args, index, option) {
  if (index >= args.length || args[index].startsWith("--")) throw new Error(`${option} requires a value.`);
  return args[index];
}

function positive(input, option) {
  const parsed = Number(input);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${option} requires a positive integer.`);
  return parsed;
}

function countWords(value) {
  const text = String(value).trim();
  return text ? text.split(/\s+/u).length : 0;
}

function percentReduction(baseline, candidate) {
  return baseline > 0 ? Math.round((1 - candidate / baseline) * 100_000) / 1_000 : null;
}

main().catch((error) => {
  process.stderr.write(`condiments-mayo-eval: ${error.message}\n`);
  process.exitCode = 2;
});
