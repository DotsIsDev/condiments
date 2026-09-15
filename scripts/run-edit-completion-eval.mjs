#!/usr/bin/env node

import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { applyCommand, createDefaultState, parseCommand, renderPolicyPrefix, renderPrompt } from "../src/core.mjs";
import { validateCompletionOutput, verifyFilesExact } from "../src/completion-policy.mjs";
import { normalizeUsage, summarizeRuns } from "../src/usage.mjs";

const MODES = ["baseline", "some", "full"];
const WORKLOADS = Object.freeze([
  {
    id: "discount-boundary",
    fixture: "discount",
    target: "src/discount.mjs",
    task: "Edit src/discount.mjs. Fix loyaltyDiscount so subtotal exactly 100 receives 0.1. Replace only `subtotal > 100` with `subtotal >= 100`. Do not change any other bytes or file. Run tests. Do the edit; do not print file contents.",
    expected: "export function loyaltyDiscount(subtotal) {\n  return subtotal >= 100 ? 0.1 : 0;\n}\n",
    verifyArgs: ["--input-type=module", "-e", "import('./src/discount.mjs').then(m=>{if(m.loyaltyDiscount(99)!==0||m.loyaltyDiscount(100)!==0.1)process.exit(1)})"],
  },
  {
    id: "router-ready-route",
    fixture: "router",
    target: "src/router.mjs",
    task: "Edit src/router.mjs. Directly after the /health route insert exactly `  { path: \"/ready\", handler: () => \"ready\" },`. Do not change any other bytes or file. Run tests. Do the edit; do not print file contents.",
    expected: "export function createRouter(routes) {\n  return new Map(routes.map((route) => [route.path, route.handler]));\n}\n\nexport const applicationRouter = createRouter([\n  { path: \"/health\", handler: () => \"ok\" },\n  { path: \"/ready\", handler: () => \"ready\" },\n]);\n",
    verifyArgs: ["--input-type=module", "-e", "import('./src/router.mjs').then(m=>{if(m.applicationRouter.get('/ready')?.()!=='ready'||m.applicationRouter.get('/health')?.()!=='ok')process.exit(1)})"],
  },
]);

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const fixture = path.resolve(options.fixture);
  const resumed = options.resume ? await loadReport(options.output, options.model) : null;
  const runs = (resumed?.runs ?? []).filter((run) => !options.rerunModes.includes(run.mode) && run.verified);
  let observedTokens = runs.reduce((sum, run) => sum + Number(run.total_tokens || 0), 0);
  let stopped = false;

  for (const mode of MODES) {
    for (const workload of WORKLOADS) {
      if (runs.some((run) => run.mode === mode && run.workload === workload.id && run.verified)) continue;
      if (observedTokens >= options.maxTotalTokens - options.delayedTokenReserve) {
        stopped = true;
        break;
      }
      const workspace = await mkdtemp(path.join(os.tmpdir(), `condiments-edit-${mode}-`));
      try {
        await cp(path.join(fixture, workload.fixture), workspace, { recursive: true });
        const before = await snapshot(workspace);
        const policy = mode === "baseline" ? "" : buildPolicy(mode);
        const prompt = policy ? `${policy}\n${workload.task}` : workload.task;
        const started = Date.now();
        const execution = await run("codex", [
          "exec", "--ephemeral", "--model", options.model, "--skip-git-repo-check",
          "--sandbox", "workspace-write", "--json", "-C", workspace, "-",
        ], { input: prompt, timeoutMs: options.timeoutMs });
        const elapsed = Date.now() - started;
        const parsed = parseCodexJsonl(execution.stdout);
        const expectedFiles = { [workload.target]: workload.expected };
        const unchangedFiles = Object.fromEntries(Object.entries(before).filter(([file]) => file !== workload.target));
        const exact = await verifyFilesExact(workspace, expectedFiles, unchangedFiles);
        const after = await snapshot(workspace);
        const extraFiles = Object.keys(after).filter((file) => !(file in before));
        const missingFiles = Object.keys(before).filter((file) => !(file in after));
        const packageTests = await run(process.execPath, ["--test"], { cwd: workspace, timeoutMs: 30_000 });
        const behavior = await run(process.execPath, workload.verifyArgs, { cwd: workspace, timeoutMs: 30_000 });
        const outputGuard = validateCompletionOutput({
          output: parsed.text,
          strategy: "direct-edit",
          originalFiles: { [workload.target]: before[workload.target] },
          requestedFullFile: false,
        });
        const failures = [];
        if (execution.code !== 0) failures.push(execution.timedOut ? "codex-timeout" : `codex-exit-${execution.code}`);
        if (!exact.valid) failures.push(...exact.failures.map((failure) => `${failure.code}:${failure.file}`));
        if (extraFiles.length) failures.push(`extra-files:${extraFiles.join(",")}`);
        if (missingFiles.length) failures.push(`missing-files:${missingFiles.join(",")}`);
        if (packageTests.code !== 0) failures.push("package-tests-failed");
        if (behavior.code !== 0) failures.push("behavior-test-failed");
        if (mode !== "baseline" && !outputGuard.valid) failures.push(...outputGuard.failures.map((failure) => failure.code));
        const usage = normalizeUsage("openai", parsed.usage, {
          model: options.model,
          wallTimeMs: elapsed,
          toolCalls: parsed.toolCalls,
          verificationPassed: failures.length === 0,
        });
        observedTokens += usage.total_tokens;
        runs.push({
          mode,
          workload: workload.id,
          verified: failures.length === 0,
          failures,
          policy_bytes: Buffer.byteLength(policy, "utf8"),
          response_words: countWords(parsed.text),
          response_chars: parsed.text.length,
          direct_edit_observed: parsed.editCalls > 0,
          exact_files: exact.valid,
          unchanged_files: exact.failures.every((failure) => failure.code !== "unchanged-file-modified"),
          no_extra_files: extraFiles.length === 0 && missingFiles.length === 0,
          package_tests_passed: packageTests.code === 0,
          behavior_test_passed: behavior.code === 0,
          full_file_guard_passed: outputGuard.valid,
          item_types: parsed.itemTypes,
          actual_target_on_mismatch: exact.valid ? null : (after[workload.target] ?? null),
          ...usage,
        });
        await writeJson(options.output, buildReport(options, runs, observedTokens, false));
      } finally {
        await rm(workspace, { recursive: true, force: true });
      }
    }
    if (stopped) break;
  }

  const report = buildReport(options, runs, observedTokens, stopped);
  const { complete, verified, comparisons } = report;
  await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
  await writeJson(options.output, report);
  await writeFile(path.resolve(options.markdown), markdown(report), "utf8");
  process.stdout.write(`${JSON.stringify({ complete, verified, observedTokens, comparisons }, null, 2)}\n`);
  if (!verified) process.exitCode = 1;
}

function buildReport(options, runs, observedTokens, stopped) {
  const summaries = Object.fromEntries(MODES.map((mode) => {
    const selected = runs.filter((run) => run.mode === mode);
    return [mode, selected.length ? summarizeRuns(selected) : null];
  }));
  const comparisons = Object.fromEntries(["some", "full"].map((mode) => [mode, compare(summaries.baseline, summaries[mode])]));
  const complete = runs.length === MODES.length * WORKLOADS.length;
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    host: "codex-cli",
    model: options.model,
    workloads: WORKLOADS.map((workload) => workload.id),
    budget: { max_total_tokens: options.maxTotalTokens, delayed_token_reserve: options.delayedTokenReserve, observed_tokens: observedTokens, stopped },
    complete,
    verified: complete && runs.every((run) => run.verified),
    runs,
    summaries,
    comparisons,
  };
}

async function loadReport(output, model) {
  try {
    const report = JSON.parse(await readFile(path.resolve(output), "utf8"));
    if (report.model !== model) throw new Error(`Resume model mismatch: ${report.model} != ${model}.`);
    return report;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJson(output, report) {
  const destination = path.resolve(output);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function buildPolicy(mode) {
  const state = applyCommand(createDefaultState(), parseCommand(`/cond mayo ${mode}`));
  return `${renderPolicyPrefix()}\n${renderPrompt(state)}`;
}

function parseCodexJsonl(stdout) {
  const records = String(stdout).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  let text = "";
  let usage = {};
  let toolCalls = 0;
  let editCalls = 0;
  const itemTypes = {};
  for (const record of records) {
    if (record.type === "item.completed" && record.item?.type === "agent_message") text = String(record.item.text ?? "");
    if (record.type === "item.completed" && record.item?.type !== "agent_message") {
      toolCalls += 1;
      itemTypes[record.item?.type ?? "unknown"] = (itemTypes[record.item?.type ?? "unknown"] || 0) + 1;
      if (["file_change", "apply_patch", "edit", "write"].includes(record.item?.type)) editCalls += 1;
    }
    if (record.type === "turn.completed" && record.usage) usage = record.usage;
  }
  return { text, usage, toolCalls, editCalls, itemTypes };
}

async function snapshot(root) {
  const entries = {};
  async function visit(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.name === ".condiments" || item.name === ".git") continue;
      const absolute = path.join(directory, item.name);
      if (item.isDirectory()) await visit(absolute);
      else entries[path.relative(root, absolute).replaceAll("\\", "/")] = await readFile(absolute, "utf8");
    }
  }
  await visit(root);
  return entries;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, options.timeoutMs ?? 90_000);
    child.on("error", reject);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, timedOut, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
    child.stdin.end(options.input ?? "");
  });
}

function compare(baseline, candidate) {
  if (!baseline || !candidate) return null;
  return {
    output_reduction_percent: reduction(baseline.output_tokens, candidate.output_tokens),
    total_reduction_percent: reduction(baseline.total_tokens, candidate.total_tokens),
    quality_passed: candidate.verified_successes === candidate.runs,
  };
}

function reduction(baseline, candidate) {
  return baseline > 0 ? Math.round((1 - candidate / baseline) * 100_000) / 1_000 : null;
}

function countWords(value) {
  const text = String(value).trim();
  return text ? text.split(/\s+/u).length : 0;
}

function markdown(report) {
  const rows = report.runs.map((run) => `| ${run.mode} | ${run.workload} | ${run.verified ? "yes" : "no"} | ${run.output_tokens} | ${run.total_tokens} | ${run.response_words} | ${run.direct_edit_observed ? "yes" : "no"} |`).join("\n");
  const comparisonRows = ["some", "full"].map((mode) => {
    const value = report.comparisons[mode];
    return `| ${mode} | ${value?.output_reduction_percent ?? "n/a"}% | ${value?.total_reduction_percent ?? "n/a"}% | ${value?.quality_passed ? "yes" : "no"} |`;
  }).join("\n");
  return `# FIM / Patch-First Live Evaluation\n\nModel: \`${report.model}\`. Quality gate: **${report.verified ? "passed" : "failed"}**. Every pass requires behavior tests, byte-exact target files, unchanged other files, and no extra files.\n\n| Mode | Workload | Verified | Output tokens | Total tokens | Reply words | Direct edit |\n| --- | --- | ---: | ---: | ---: | ---: | ---: |\n${rows}\n\n| Mode | Output reduction | Total reduction | Quality |\n| --- | ---: | ---: | ---: |\n${comparisonRows}\n\nObserved ${report.budget.observed_tokens} tokens under a ${report.budget.max_total_tokens}-token hard budget with ${report.budget.delayed_token_reserve} reserved for delayed accounting. Native FIM stayed disabled because Codex CLI exposes direct patch/file edits but no skill-callable FIM request surface.\n`;
}

function parseOptions(args) {
  const options = {
    fixture: "evals/fixtures/edit-projects",
    output: "evals/results/codex-cli-edit-completion-live.json",
    markdown: "evals/results/edit-completion-evaluation.md",
    model: "gpt-5.6-luna",
    timeoutMs: 90_000,
    maxTotalTokens: 650_000,
    delayedTokenReserve: 160_000,
    resume: false,
    rerunModes: [],
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--fixture") options.fixture = value(args, ++index, arg);
    else if (arg === "--output") options.output = value(args, ++index, arg);
    else if (arg === "--markdown") options.markdown = value(args, ++index, arg);
    else if (arg === "--model") options.model = value(args, ++index, arg);
    else if (arg === "--timeout-ms") options.timeoutMs = positive(value(args, ++index, arg), arg);
    else if (arg === "--max-total-tokens") options.maxTotalTokens = positive(value(args, ++index, arg), arg);
    else if (arg === "--delayed-token-reserve") options.delayedTokenReserve = positive(value(args, ++index, arg), arg);
    else if (arg === "--resume") options.resume = true;
    else if (arg === "--rerun-mode") options.rerunModes.push(value(args, ++index, arg));
    else throw new Error(`Unknown option '${arg}'.`);
  }
  if (options.delayedTokenReserve >= options.maxTotalTokens) throw new Error("Delayed reserve must be below total budget.");
  for (const mode of options.rerunModes) if (!MODES.includes(mode)) throw new Error(`Unknown rerun mode '${mode}'.`);
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

main().catch((error) => {
  process.stderr.write(`condiments-edit-eval: ${error.message}\n`);
  process.exitCode = 2;
});
