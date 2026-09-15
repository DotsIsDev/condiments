#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { applyCommand, createDefaultState, parseCommand, renderPrompt } from "../src/core.mjs";
import { normalizeUsage } from "../src/usage.mjs";

const MODES = ["none", "some", "full"];
const EXPECTED = "TOKEN-SPLIT-OK-927";
const TASK = "Call the relevant MCP tool lookup_build_code exactly once with code ALPHA. Return only the tool's exact value, with no quotes or explanation.";

const options = parseArgs(process.argv.slice(2));
const existing = options.resume ? await readReport(options.output) : null;
const runs = existing?.model === options.model ? existing.runs.filter((run) => run.quality_passed) : [];
let observedTokens = runs.reduce((sum, run) => sum + run.total_tokens, 0);
let stopped = false;

for (const mode of MODES) {
  if (runs.some((run) => run.mode === mode)) continue;
  if (observedTokens >= options.maxTotalTokens - options.delayedTokenReserve) { stopped = true; break; }
  const prompt = mode === "none" ? TASK : `${policy(mode)}\n${TASK}`;
  const args = codexArgs(mode, options);
  const started = Date.now();
  const execution = await run("codex", args, { input: prompt, timeoutMs: options.timeoutMs });
  const parsed = parseCodexJsonl(execution.stdout);
  const exactOutput = parsed.text.trim() === EXPECTED;
  const requiredToolCalled = parsed.requiredToolCalls === 1;
  const failures = [];
  if (execution.code !== 0) failures.push(execution.timedOut ? "codex-timeout" : `codex-exit-${execution.code}`);
  if (!exactOutput) failures.push("exact-output-mismatch");
  if (!requiredToolCalled) failures.push(`required-tool-call-count-${parsed.requiredToolCalls}`);
  const usage = normalizeUsage("openai", parsed.usage, {
    model: options.model,
    wallTimeMs: Date.now() - started,
    toolCalls: parsed.toolCalls,
    modelCalls: 1,
    verificationPassed: failures.length === 0,
  });
  observedTokens += usage.total_tokens;
  runs.push({
    mode,
    quality_passed: failures.length === 0,
    failures,
    exact_output_passed: exactOutput,
    required_tool_called: requiredToolCalled,
    required_tool_calls: parsed.requiredToolCalls,
    unrelated_mcp_enabled: mode !== "full",
    policy_bytes: Buffer.byteLength(mode === "none" ? "" : policy(mode), "utf8"),
    response: parsed.text,
    item_types: parsed.itemTypes,
    stderr_tail: execution.code === 0 ? "" : execution.stderr.slice(-2000),
    ...usage,
  });
  await save(buildReport(false));
}

const report = buildReport(stopped);
await save(report);
await writeFile(path.resolve(options.markdown), renderMarkdown(report), "utf8");
console.log(JSON.stringify({ complete: report.complete, quality_passed: report.quality_passed, observed_tokens: observedTokens, comparisons: report.comparisons }, null, 2));
if (!report.quality_passed) process.exitCode = 1;

function codexArgs(mode, values) {
  const fixture = path.resolve("evals/fixtures/tool-context-mcp.mjs").replaceAll("\\", "/");
  const args = [
    "exec", "--ephemeral", "--model", values.model, "--skip-git-repo-check", "--sandbox", "read-only",
    "--json", "--ignore-user-config", "--ignore-rules", "-c", `model_reasoning_effort=${JSON.stringify(values.reasoningEffort)}`,
    "-c", "mcp_servers.relevant.command=\"node\"",
    "-c", `mcp_servers.relevant.args=${JSON.stringify([fixture, "relevant"])}`,
    "-c", "mcp_servers.relevant.enabled=true",
    "-c", "mcp_servers.relevant.tools.lookup_build_code.approval_mode=\"approve\"",
    "-c", "mcp_servers.noisy.command=\"node\"",
    "-c", `mcp_servers.noisy.args=${JSON.stringify([fixture, "noisy"])}`,
    "-c", `mcp_servers.noisy.enabled=${mode === "full" ? "false" : "true"}`,
    "-C", process.cwd(), "-",
  ];
  return args;
}

function policy(mode) {
  return renderPrompt(applyCommand(createDefaultState(), parseCommand(`/cond ranch ${mode}`)));
}

function parseCodexJsonl(stdout) {
  const records = String(stdout).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  let text = "";
  let usage = {};
  let toolCalls = 0;
  let requiredToolCalls = 0;
  const itemTypes = {};
  for (const record of records) {
    if (record.type === "item.completed" && record.item?.type === "agent_message") text = String(record.item.text ?? "");
    if (record.type === "item.completed" && record.item?.type !== "agent_message") {
      toolCalls += 1;
      const type = record.item?.type ?? "unknown";
      itemTypes[type] = (itemTypes[type] ?? 0) + 1;
      if (JSON.stringify(record.item).includes("lookup_build_code")) requiredToolCalls += 1;
    }
    if (record.type === "turn.completed" && record.usage) usage = record.usage;
  }
  return { text, usage, toolCalls, requiredToolCalls, itemTypes };
}

function buildReport(stoppedValue) {
  const byMode = Object.fromEntries(runs.map((run) => [run.mode, run]));
  const comparisons = {};
  for (const mode of ["some", "full"]) {
    if (byMode.none && byMode[mode]) comparisons[mode] = {
      input_reduction_percent: reduction(byMode.none.input_tokens, byMode[mode].input_tokens),
      uncached_input_reduction_percent: reduction(byMode.none.uncached_input_tokens, byMode[mode].uncached_input_tokens),
      output_reduction_percent: reduction(byMode.none.output_tokens, byMode[mode].output_tokens),
      total_reduction_percent: reduction(byMode.none.total_tokens, byMode[mode].total_tokens),
      quality_passed: byMode[mode].quality_passed,
    };
  }
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    evaluation: "live-codex-cli-tool-context",
    host: "codex-cli",
    model: options.model,
    reasoning_effort: options.reasoningEffort,
    capability_note: "Codex CLI cannot lazily alter active tool schemas. none/some expose both MCP servers; full uses an isolated host override to disable the unrelated server.",
    budget: { max_total_tokens: options.maxTotalTokens, delayed_token_reserve: options.delayedTokenReserve, observed_tokens: observedTokens, stopped: stoppedValue },
    complete: runs.length === MODES.length,
    quality_passed: runs.length === MODES.length && runs.every((run) => run.quality_passed),
    runs,
    comparisons,
  };
}

async function save(report) {
  const output = path.resolve(options.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function readReport(file) {
  try { return JSON.parse(await readFile(path.resolve(file), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function run(command, args, values = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [], stderr = [];
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, values.timeoutMs);
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

function renderMarkdown(report) {
  const rows = report.runs.map((run) => `| ${run.mode} | ${run.input_tokens} | ${run.cache_read_tokens} | ${run.uncached_input_tokens} | ${run.output_tokens} | ${run.total_tokens} | ${run.required_tool_calls} | ${run.quality_passed ? "pass" : "FAIL"} |`).join("\n");
  const comparisons = ["some", "full"].filter((mode) => report.comparisons[mode]).map((mode) => {
    const value = report.comparisons[mode];
    return `| ${mode} | ${value.input_reduction_percent}% | ${value.uncached_input_reduction_percent}% | ${value.output_reduction_percent}% | ${value.total_reduction_percent}% | ${value.quality_passed ? "pass" : "FAIL"} |`;
  }).join("\n");
  return `# Live Codex Tool Context Evaluation\n\nGenerated: ${report.generated_at}\n\n${report.capability_note}\n\n` +
    `| Mode | Input tokens | Cache read | Uncached input | Output tokens | Total tokens | Required MCP calls | Quality |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |\n${rows}\n\n` +
    `| Mode vs none | Input reduction | Uncached input reduction | Output reduction | Total reduction | Quality |\n| --- | ---: | ---: | ---: | ---: | --- |\n${comparisons}\n\n` +
    `Budget: ${report.budget.observed_tokens}/${report.budget.max_total_tokens} observed tokens; ${report.budget.delayed_token_reserve} reserved for delayed accounting.\n`;
}

function reduction(baseline, candidate) { return baseline > 0 ? Number((((baseline - candidate) / baseline) * 100).toFixed(3)) : null; }

function parseArgs(args) {
  const values = {
    model: "gpt-5.6-luna", reasoningEffort: "low", output: "evals/results/codex-cli-tool-context-live.json",
    markdown: "evals/results/codex-cli-tool-context-live.md", maxTotalTokens: 300000,
    delayedTokenReserve: 60000, timeoutMs: 120000, resume: true,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--no-resume") { values.resume = false; continue; }
    const next = args[++index];
    if (!next) throw new Error(`Missing value for ${arg}.`);
    if (arg === "--model") values.model = next;
    else if (arg === "--reasoning-effort") values.reasoningEffort = next;
    else if (arg === "--output") values.output = next;
    else if (arg === "--markdown") values.markdown = next;
    else if (arg === "--max-total-tokens") values.maxTotalTokens = Number(next);
    else if (arg === "--delayed-token-reserve") values.delayedTokenReserve = Number(next);
    else if (arg === "--timeout-ms") values.timeoutMs = Number(next);
    else throw new Error(`Unknown option '${arg}'.`);
  }
  return values;
}
