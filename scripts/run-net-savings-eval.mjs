#!/usr/bin/env node

import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { compileSkillSlice, DISCLOSURE_CONTROLS } from "../src/skill-disclosure.mjs";
import { ingestMemoryEvent, queryMemoryEvents } from "../src/zero-token-memory.mjs";
import { inspectToolState, recordToolResult, renderActiveToolState } from "../src/tool-state.mjs";
import { assessWorkflowPruning } from "../src/workflow-pruner.mjs";
import { normalizeUsage } from "../src/usage.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(ROOT, "evals", "fixtures", "phase5-project");
const VARIANTS = Object.freeze(["baseline", "candidate"]);
const DISCLOSURE_CASES = Object.freeze([
  { id: "mayo", control: "mayo", answer: "SLICE-MAYO-7Q2" },
  { id: "mustard", control: "mustard", answer: "SLICE-MUSTARD-4K8" },
  { id: "ketchup", control: "ketchup", answer: "SLICE-KETCHUP-9M3" },
  { id: "ranch", control: "ranch", answer: "SLICE-RANCH-6P1" },
]);
const MEMORY_CASES = Object.freeze([
  { id: "alpha", key: "MEMORY_KEY_ALPHA", answer: "MEM-A7Q9" },
  { id: "bravo", key: "MEMORY_KEY_BRAVO", answer: "MEM-B4K2" },
  { id: "charlie", key: "MEMORY_KEY_CHARLIE", answer: "MEM-C8M5" },
  { id: "delta", key: "MEMORY_KEY_DELTA", answer: "MEM-D2P6" },
]);
const TOOL_CASES = Object.freeze(["ALPHA", "BRAVO", "CHARLIE", "DELTA"].map((key) => ({
  id: key.toLowerCase(), key, answer: `REUSE_TOKEN_${key}`,
})));

const options = parseOptions(process.argv.slice(2));
const existing = options.resume ? await readJson(options.output, null) : null;
const runs = Array.isArray(existing?.runs) && existing.model === options.model && existing.reasoning_effort === options.effort
  ? existing.runs
  : [];
let observedTokens = runs.reduce((total, run) => total + (Number(run.total_tokens) || 0), 0);
let stopped = false;
const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "condiments-net-memory-"));
const toolRoot = await mkdtemp(path.join(os.tmpdir(), "condiments-net-tools-"));
const liveRoot = await mkdtemp(path.join(os.tmpdir(), "condiments-net-live-"));
await cp(FIXTURE, liveRoot, { recursive: true });

try {
  const disclosure = await prepareDisclosure();
  const memory = await prepareMemory(memoryRoot);
  const toolState = await prepareToolState(toolRoot);
  const suites = [
    { control: "progressive-disclosure", cases: DISCLOSURE_CASES, prompt: (item, variant) => disclosurePrompt(disclosure, item, variant) },
    { control: "zero-token-memory", cases: MEMORY_CASES, prompt: (item, variant) => memoryPrompt(memory, item, variant) },
    { control: "compact-tool-state", cases: TOOL_CASES, prompt: (item, variant) => toolPrompt(toolState, item, variant) },
  ];

  for (const suite of suites) {
    for (let repetition = 1; repetition <= options.repetitions; repetition += 1) {
      for (const item of suite.cases) {
        const order = (repetition + suite.cases.indexOf(item)) % 2 === 0 ? VARIANTS : [...VARIANTS].reverse();
        for (const variant of order) {
          const key = `${suite.control}:${item.id}:${repetition}:${variant}`;
          if (runs.some((run) => run.key === key)) continue;
          if (observedTokens >= options.maxTotalTokens - options.reserveTokens) { stopped = true; break; }
          process.stderr.write(`[net-savings] ${key}\n`);
          const prompt = suite.prompt(item, variant);
          const result = await executeLiveRun({ key, control: suite.control, caseId: item.id, repetition, variant, prompt, expected: item.answer });
          runs.push(result);
          observedTokens += result.total_tokens ?? 0;
          await saveReport(buildReport({ stopped, disclosure, memory }));
        }
        if (stopped) break;
      }
      if (stopped) break;
    }
    if (stopped) break;
  }

  const report = buildReport({ stopped, disclosure, memory });
  await saveReport(report);
  await writeFile(path.resolve(options.markdown), renderMarkdown(report), "utf8");
  process.stdout.write(`${JSON.stringify({ complete: report.complete, quality_passed: report.quality_passed, observed_tokens: observedTokens, summaries: report.summaries, workflow_pruning: report.workflow_pruning }, null, 2)}\n`);
  if (!report.quality_passed) process.exitCode = 1;
} finally {
  await rm(memoryRoot, { recursive: true, force: true });
  await rm(toolRoot, { recursive: true, force: true });
  await rm(liveRoot, { recursive: true, force: true });
}

async function prepareDisclosure() {
  const full = await compileSkillSlice(ROOT, {
    host: "codex-cli",
    controls: Object.fromEntries(DISCLOSURE_CONTROLS.map((control) => [control, "full"])),
  });
  const candidates = {};
  for (const item of DISCLOSURE_CASES) {
    candidates[item.id] = await compileSkillSlice(ROOT, { host: "codex-cli", controls: { [item.control]: "full" } });
  }
  return {
    full,
    candidates,
    baselineBytes: full.bytes,
    candidateBytes: Object.fromEntries(Object.entries(candidates).map(([key, value]) => [key, value.bytes])),
  };
}

async function prepareMemory(root) {
  const sessionId = "net-savings-memory";
  const corpus = [];
  for (let index = 1; index <= 20; index += 1) {
    const raw = `Historical event ${index}. ${Array.from({ length: 24 }, (_, part) => `Routine subsystem-${index} observation-${part + 1} remained stable after verification.`).join(" ")}`;
    corpus.push(raw);
    await ingestMemoryEvent(root, { sessionId, turn: index, rawText: raw, timestamp: `2026-08-${String(index).padStart(2, "0")}T00:00:00Z` });
  }
  for (let index = 0; index < MEMORY_CASES.length; index += 1) {
    const item = MEMORY_CASES[index];
    const raw = `Verified release memory. For ${item.key}, the exact release code is ${item.answer}. Preserve this value byte-for-byte. ${"Supporting provenance remained unchanged. ".repeat(20)}`;
    corpus.push(raw);
    await ingestMemoryEvent(root, { sessionId, turn: 30 + index, rawText: raw, verified: true, terms: [item.key, item.answer], timestamp: `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00Z` });
  }
  const evidence = {};
  const retrievalMs = {};
  for (const item of MEMORY_CASES) {
    const started = performance.now();
    evidence[item.id] = await queryMemoryEvents(root, { sessionId, query: `${item.key} exact release code`, topK: 1, maxChars: 1_600, now: "2026-09-20T00:00:00Z" });
    retrievalMs[item.id] = Number((performance.now() - started).toFixed(3));
  }
  return { corpus: corpus.join("\n\n"), evidence, retrievalMs };
}

async function prepareToolState(root) {
  const rendered = {};
  const script = path.join(FIXTURE, "scripts", "tool-state-noisy.mjs");
  for (const item of TOOL_CASES) {
    const execution = await run(process.execPath, [script, item.key], { cwd: FIXTURE, input: "", timeoutMs: 30_000 });
    if (execution.code !== 0) throw new Error(`Tool-state fixture failed for ${item.key}.`);
    await recordToolResult(root, {
      sessionId: "net-savings-tools", turnId: item.id, tool: "Bash",
      call: `node scripts/tool-state-noisy.mjs ${item.key}`, inputFingerprint: "phase5-fixture-v1",
      exitStatus: 0, content: `${execution.stdout}${execution.stderr}`,
      facts: [`ERROR ${item.answer} recovery-required`],
    });
    rendered[item.id] = renderActiveToolState(await inspectToolState(root, { sessionId: "net-savings-tools", turnId: item.id }));
  }
  return { rendered };
}

function disclosurePrompt(prepared, item, variant) {
  const policy = variant === "baseline" ? prepared.full.content : prepared.candidates[item.id].content;
  return `${policy}\n\nChanging task data follows. Do not use tools. Return only this exact token: ${item.answer}`;
}

function memoryPrompt(prepared, item, variant) {
  const context = variant === "baseline"
    ? prepared.corpus
    : prepared.evidence[item.id].evidence.map((entry) => `[sha256:${entry.rawSha256}]\n${entry.preview}`).join("\n\n");
  return `Use the supplied verified memory evidence. Do not use tools.\n\n${context}\n\nChanging task data: return only the exact release code associated with ${item.key}.`;
}

function toolPrompt(prepared, item, variant) {
  const command = `node scripts/tool-state-noisy.mjs ${item.key}`;
  const evidence = variant === "candidate"
    ? `A verified prior execution is recorded below. Reuse it when sufficient and do not rerun the command.\n${prepared.rendered[item.id]}`
    : "Run the command to obtain the required evidence.";
  return `${evidence}\n\nDetermine the actionable token produced by \`${command}\`. Return only the token beginning with REUSE_TOKEN_.`;
}

async function executeLiveRun(values) {
  const started = Date.now();
  const execution = await run("codex", [
    "exec", "--ephemeral", "--model", options.model, "--skip-git-repo-check",
    "--approve-for-me", "--json", "--ignore-user-config", "--ignore-rules", "-c", `model_reasoning_effort=${JSON.stringify(options.effort)}`,
    "-C", liveRoot, "-",
  ], { cwd: liveRoot, input: values.prompt, timeoutMs: options.timeoutMs });
  const parsed = parseCodexJsonl(execution.stdout);
  const response = parsed.text.trim().replace(/^`|`$/g, "");
  const failures = [];
  if (execution.code !== 0) failures.push(execution.timedOut ? "timeout" : `codex-exit-${execution.code}`);
  if (response !== values.expected) failures.push(`expected-${values.expected}-got-${response.slice(0, 120)}`);
  if (values.control === "compact-tool-state" && values.variant === "baseline" && parsed.toolCalls < 1) failures.push("baseline-did-not-run-tool");
  if (values.control === "compact-tool-state" && values.variant === "candidate" && parsed.toolCalls !== 0) failures.push(`candidate-tool-calls-${parsed.toolCalls}`);
  const usage = normalizeUsage("openai", parsed.usage, {
    model: options.model,
    wallTimeMs: Date.now() - started,
    toolCalls: parsed.toolCalls,
    modelCalls: 1,
    verificationPassed: failures.length === 0,
  });
  return {
    key: values.key,
    control: values.control,
    caseId: values.caseId,
    repetition: values.repetition,
    variant: values.variant,
    expected: values.expected,
    response,
    quality_passed: failures.length === 0,
    failures,
    prompt_bytes: Buffer.byteLength(values.prompt, "utf8"),
    item_types: parsed.itemTypes,
    stderr_tail: execution.code === 0 ? "" : execution.stderr.slice(-2_000),
    ...usage,
  };
}

function parseCodexJsonl(stdout) {
  const records = String(stdout).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  let text = "";
  let usage = {};
  let toolCalls = 0;
  const itemTypes = {};
  const toolTypes = new Set(["command_execution", "mcp_tool_call", "web_search", "file_change"]);
  for (const record of records) {
    if (record.type === "item.completed" && record.item?.type === "agent_message") text = String(record.item.text ?? "");
    if (record.type === "item.completed" && record.item?.type) {
      const type = record.item.type;
      itemTypes[type] = (itemTypes[type] ?? 0) + 1;
      if (toolTypes.has(type)) toolCalls += 1;
    }
    if (record.type === "turn.completed" && record.usage) usage = record.usage;
  }
  return { text, usage, toolCalls, itemTypes };
}

function buildReport(context) {
  const expectedRuns = options.repetitions * 4 * 2 * 3;
  const controls = ["progressive-disclosure", "zero-token-memory", "compact-tool-state"];
  const summaries = Object.fromEntries(controls.map((control) => [control, summarizeControl(control)]));
  const candidates = Object.entries(summaries).map(([control, summary]) => ({
    stepId: control,
    action: control === "zero-token-memory" ? "downgrade" : "prune",
    targetModel: options.model,
    optimizationCost: summary.evaluation_tokens,
    samples: pairedSamples(control),
  })).filter((candidate) => candidate.samples.length > 0);
  const workflowPruning = candidates.length
    ? assessWorkflowPruning({ workflowId: "condiments-net-savings-controls", expectedFutureRuns: options.expectedFutureRuns, candidates })
    : null;
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    evaluation: "paired-live-net-savings-controls",
    host: "codex-cli",
    model: options.model,
    reasoning_effort: options.effort,
    repetitions: options.repetitions,
    methodology: "Same model, effort, fixture, task, and exact-answer gate. Variant order alternates. Usage includes final reader, tools, reasoning, cache effects, and failures. Local retrieval and pruning use zero provider calls.",
    budget: { max_total_tokens: options.maxTotalTokens, reserve_tokens: options.reserveTokens, observed_tokens: observedTokens, stopped: context.stopped },
    complete: !context.stopped && runs.length === expectedRuns,
    quality_passed: runs.length === expectedRuns && runs.every((run) => run.quality_passed),
    local_metrics: {
      disclosure_baseline_bytes: context.disclosure.baselineBytes,
      disclosure_candidate_bytes: context.disclosure.candidateBytes,
      memory_retrieval_ms: context.memory.retrievalMs,
      memory_provider_calls: 0,
      workflow_pruner_provider_calls: 0,
    },
    runs,
    summaries,
    workflow_pruning: workflowPruning,
  };
}

function summarizeControl(control) {
  const pairs = pairedSamples(control);
  const baselineRuns = runs.filter((run) => run.control === control && run.variant === "baseline");
  const candidateRuns = runs.filter((run) => run.control === control && run.variant === "candidate");
  const savings = pairs.map((sample) => sample.baselineCost - sample.candidateCost);
  const meanSaving = mean(savings);
  const lower95 = savings.length > 1 ? meanSaving - 1.96 * sampleSd(savings) / Math.sqrt(savings.length) : null;
  const baselineTokens = sum(baselineRuns, "total_tokens");
  const candidateTokens = sum(candidateRuns, "total_tokens");
  return {
    pairs: pairs.length,
    baseline_quality: baselineRuns.filter((run) => run.quality_passed).length,
    candidate_quality: candidateRuns.filter((run) => run.quality_passed).length,
    baseline_total_tokens: baselineTokens,
    candidate_total_tokens: candidateTokens,
    total_reduction_percent: baselineTokens > 0 ? round(((baselineTokens - candidateTokens) / baselineTokens) * 100) : null,
    mean_saving_per_pair: round(meanSaving),
    lower95_saving_per_pair: lower95 === null ? null : round(lower95),
    baseline_tool_calls: sum(baselineRuns, "tool_calls"),
    candidate_tool_calls: sum(candidateRuns, "tool_calls"),
    evaluation_tokens: baselineTokens + candidateTokens,
  };
}

function pairedSamples(control) {
  const grouped = new Map();
  for (const run of runs.filter((item) => item.control === control)) {
    const pairKey = `${run.caseId}:${run.repetition}`;
    if (!grouped.has(pairKey)) grouped.set(pairKey, {});
    grouped.get(pairKey)[run.variant] = run;
  }
  return [...grouped.values()].filter((pair) => pair.baseline && pair.candidate).map((pair) => ({
    baselineCost: pair.baseline.total_tokens,
    candidateCost: pair.candidate.total_tokens,
    baselineSuccess: pair.baseline.quality_passed,
    candidateSuccess: pair.candidate.quality_passed,
  }));
}

async function saveReport(report) {
  const output = path.resolve(options.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function renderMarkdown(report) {
  const rows = Object.entries(report.summaries).map(([control, value]) => `| ${control} | ${value.pairs} | ${value.baseline_quality}/${value.pairs} | ${value.candidate_quality}/${value.pairs} | ${value.baseline_total_tokens} | ${value.candidate_total_tokens} | ${value.total_reduction_percent ?? "—"}% | ${value.lower95_saving_per_pair ?? "—"} | ${value.baseline_tool_calls} → ${value.candidate_tool_calls} |`).join("\n");
  const pruning = report.workflow_pruning?.decisions?.map((item) => `| ${item.stepId} | ${item.approved ? "yes" : "no"} | ${item.reason} | ${item.breakEvenRuns ?? "—"} | ${item.requiredFutureRuns ?? "—"} |`).join("\n") ?? "";
  return `# Paired Live Net-Savings Evaluation\n\nGenerated: ${report.generated_at}\n\n${report.methodology}\n\n` +
    `| Control | Pairs | Baseline quality | Candidate quality | Baseline tokens | Candidate tokens | Reduction | 95% lower saving/pair | Tool calls |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${rows}\n\n` +
    `| Workflow step | Deploy | Reason | Break-even runs | Required runs with margin |\n| --- | --- | --- | ---: | ---: |\n${pruning}\n\n` +
    `Budget: ${report.budget.observed_tokens}/${report.budget.max_total_tokens} observed tokens. Complete: ${report.complete}. Quality passed: ${report.quality_passed}.\n`;
}

function run(command, args, values = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: values.cwd, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [], stderr = [];
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, values.timeoutMs ?? 120_000);
    child.on("error", reject);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
    child.stdin.end(values.input ?? "");
  });
}

async function readJson(filePath, fallback) {
  try { return JSON.parse(await readFile(path.resolve(filePath), "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}

function parseOptions(args) {
  const values = {
    model: "gpt-5.6-luna", effort: "low", repetitions: 2,
    output: "evals/results/net-savings-controls-live.json",
    markdown: "evals/results/net-savings-controls-live.md",
    maxTotalTokens: 2_000_000, reserveTokens: 100_000, expectedFutureRuns: 1_000,
    timeoutMs: 120_000, resume: true,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--no-resume") { values.resume = false; continue; }
    const value = args[++index];
    if (value === undefined) throw new Error(`Missing value for ${arg}.`);
    if (arg === "--model") values.model = value;
    else if (arg === "--effort") values.effort = value;
    else if (arg === "--repetitions") values.repetitions = positiveInteger(value, arg);
    else if (arg === "--output") values.output = value;
    else if (arg === "--markdown") values.markdown = value;
    else if (arg === "--max-total-tokens") values.maxTotalTokens = positiveInteger(value, arg);
    else if (arg === "--reserve-tokens") values.reserveTokens = positiveInteger(value, arg);
    else if (arg === "--expected-future-runs") values.expectedFutureRuns = positiveInteger(value, arg);
    else if (arg === "--timeout-ms") values.timeoutMs = positiveInteger(value, arg);
    else throw new Error(`Unknown option '${arg}'.`);
  }
  return values;
}

function positiveInteger(value, name) { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`); return parsed; }
function sum(items, field) { return items.reduce((total, item) => total + (Number(item[field]) || 0), 0); }
function mean(values) { return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0; }
function sampleSd(values) { const average = mean(values); return Math.sqrt(values.reduce((total, value) => total + (value - average) ** 2, 0) / (values.length - 1)); }
function round(value) { return Number.isFinite(value) ? Number(value.toFixed(3)) : null; }
