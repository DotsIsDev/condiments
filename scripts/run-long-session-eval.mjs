#!/usr/bin/env node

import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { budgetStatus, inspectCodexRollout } from "../src/codex-rollout.mjs";
import { applyCommand, createDefaultState, parseCommand, renderPrompt } from "../src/core.mjs";
import { applyNativeContextPolicy } from "../src/native-context.mjs";
import { normalizeUsage } from "../src/usage.mjs";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODES = new Set(["baseline", "some", "full"]);
const ROUTES = Object.freeze({
  baseline: { model: "gpt-6-astra", effort: "medium" },
  some: { model: "gpt-5.6-terra", effort: "medium" },
  full: { model: "gpt-5.6-terra", effort: "low" },
});
const EXPECTED = Object.freeze([
  "subtotal > 100|session.expiresAtMs|createRouter|exponential-jitter|midnight-blue|sqlite-outbox",
  "CP-FINAL-7K9",
  "subtotal > 100|session.expiresAtMs|createRouter|exponential-jitter|midnight-blue|sqlite-outbox|CP-FINAL-7K9",
]);
const TURN_EXPECTED = Object.freeze([EXPECTED[0], EXPECTED[2]]);

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const sourceRoot = path.resolve(options.repository);
  const schema = path.resolve(options.schema);
  const route = ROUTES[options.mode];
  const prompts = buildPrompts(options.mode);
  const workspaceRoot = path.join(PACKAGE_ROOT, ".eval-workspaces");
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await mkdtemp(path.join(workspaceRoot, `${options.mode}-`));
  const turns = [];
  let threadId;
  let telemetry = null;
  let stoppedByBudget = null;
  let hookEvidence = { events: [], checkpoint: null };
  let hookPreflight = null;
  let trustProfile = null;

  try {
    await cp(sourceRoot, workspace, { recursive: true });
    const initialized = await run("git", ["init", "--quiet"], { cwd: workspace, stdin: "", timeoutMs: 15_000 });
    if (initialized.code !== 0) throw new Error(`temporary git init failed: ${initialized.stderr}`);
    await installIsolatedAdapter(workspace);
    const preset = options.mode === "baseline" ? "none" : options.mode;
    await writeFile(path.join(workspace, ".condiments", "state.json"), `${JSON.stringify({ version: 1, preset, overrides: {} }, null, 2)}\n`, "utf8");
    await applyNativeContextPolicy("codex-cli", workspace, preset);
    trustProfile = await createTrustProfile(workspace);
    const configuredHooks = JSON.parse(await readFile(path.join(workspace, ".codex", "hooks.json"), "utf8"));
    hookPreflight = { source: "static-config", profile: trustProfile.name, hooks: Object.keys(configuredHooks.hooks || {}) };
    const requiredHooks = options.mode === "baseline" ? [] : ["PreCompact", "PostCompact", "SessionStart"];
    for (const eventName of requiredHooks) {
      if (!hookPreflight.hooks.includes(eventName)) {
        throw new Error(`isolated hook preflight did not find enabled ${eventName}: ${JSON.stringify(hookPreflight)}`);
      }
    }

    for (let index = 0; index < prompts.length; index += 1) {
      const args = buildArgs({ first: index === 0, threadId, route, schema, threshold: options.threshold, workspace, profile: trustProfile.name });
      const started = Date.now();
      const result = await runCodex("codex", args, {
        cwd: workspace,
        stdin: prompts[index],
        timeoutMs: options.timeout,
        budget: options.budget,
        threadId,
      });
      const parsed = parseJsonl(result.stdout);
      threadId ??= parsed.threadId ?? result.observedThreadId;
      const answer = parseAnswer(parsed.message);
      const passed = result.code === 0 && answer?.answer === TURN_EXPECTED[index];
      turns.push({
        turn: index + 1,
        expected: TURN_EXPECTED[index],
        answer: answer?.answer ?? null,
        verification_passed: passed,
        failures: [
          result.code !== 0 ? `codex exited ${result.code}` : null,
          result.timedOut ? `timeout after ${options.timeout}ms` : null,
          result.budgetStop ? `hard budget stop: ${result.budgetStop.reasons.join("; ")}` : null,
          !passed && answer?.answer !== TURN_EXPECTED[index] ? "answer mismatch" : null,
          cleanStderr(result.stderr),
        ].filter(Boolean),
        cli_usage: parsed.usage,
        elapsed_ms: Date.now() - started,
      });
      if (result.budgetStop) {
        stoppedByBudget = result.budgetStop;
        break;
      }
      if (!threadId || result.code !== 0) break;
      telemetry = await inspectCodexRollout(threadId);
      const status = budgetStatus(telemetry, options.budget);
      if (status.stop && index < prompts.length - 1) {
        stoppedByBudget = status;
        break;
      }
    }
    if (threadId) telemetry = await inspectCodexRollout(threadId);
    hookEvidence = await readHookEvidence(workspace);
  } finally {
    if (!options.keepWorkspace) await rm(workspace, { recursive: true, force: true });
    if (trustProfile) {
      try { await unlink(trustProfile.path); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
  }

  if (telemetry?.rollout) telemetry = { ...telemetry, rolloutFile: path.basename(telemetry.rollout), rollout: null };

  const exactStateRecovered = turns.length === prompts.length && turns.at(-1)?.verification_passed === true;
  const checkpointRecoveryVerified = options.mode === "baseline"
    ? null
    : exactStateRecovered
      && hookEvidence.events.some((event) => event.event === "pre-compact" && event.action === "checkpoint")
      && hookEvidence.events.some((event) => event.event === "restore" && event.action === "restore")
      && checkpointContainsExpected(hookEvidence.checkpoint);
  const authoritativeUsage = telemetry?.threadUsage
    ? normalizeUsage("openai", telemetry.threadUsage, {
        model: route.model,
        modelCalls: telemetry.modelCalls,
        compactionCount: telemetry.count,
        wallTimeMs: turns.reduce((total, turn) => total + turn.elapsed_ms, 0),
        verificationPassed: turns.every((turn) => turn.verification_passed),
      })
    : null;
  const report = {
    version: 2,
    generatedAt: new Date().toISOString(),
    host: "codex-cli",
    mode: options.mode,
    route,
    compaction_threshold_tokens: options.threshold,
    compaction_scope: "body_after_prefix",
    thread_id: threadId ?? null,
    workspace: options.keepWorkspace ? workspace : null,
    turns,
    authoritative_usage: authoritativeUsage,
    telemetry,
    budget: options.budget,
    stopped_by_budget: stoppedByBudget,
    recovery: {
      exact_state_recovered: exactStateRecovered,
      checkpoint_recovery_verified: checkpointRecoveryVerified,
      hook_events: hookEvidence.events,
      checkpoint: hookEvidence.checkpoint,
      hook_preflight: hookPreflight,
    },
    verification_passed: turns.length === prompts.length
      && turns.every((turn) => turn.verification_passed)
      && telemetry?.detected === true
      && (options.mode === "baseline" ? exactStateRecovered : checkpointRecoveryVerified)
      && !stoppedByBudget,
  };
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) {
    const outputPath = path.resolve(options.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output, "utf8");
  } else process.stdout.write(output);
  if (!report.verification_passed) process.exitCode = 1;
}

async function installIsolatedAdapter(workspace) {
  const result = await run(process.execPath, [path.join(PACKAGE_ROOT, "scripts", "install-adapter.mjs"), "--host", "codex-cli", "--target", workspace], {
    cwd: PACKAGE_ROOT,
    stdin: "",
    timeoutMs: 60_000,
  });
  if (result.code !== 0) throw new Error(`isolated adapter install failed: ${result.stderr || result.stdout}`);
}

async function createTrustProfile(workspace) {
  const codexHome = process.env.CODEX_HOME || path.join(process.env.USERPROFILE || "", ".codex");
  const name = `condiments-eval-${process.pid}-${Date.now()}`;
  const profilePath = path.join(codexHome, `${name}.config.toml`);
  await writeFile(profilePath, `[projects.'${workspace.toLowerCase()}']\ntrust_level = "trusted"\n`, { encoding: "utf8", mode: 0o600 });
  return { name, path: profilePath };
}

function buildPrompts(mode) {
  const policy = mode === "baseline" ? "" : renderPrompt(applyCommand(createDefaultState(), parseCommand(`/cond ${mode}`)));
  const prefix = policy ? `${policy}\n\n` : "";
  return [
    `${prefix}Long-session state seed. Use no tools. Preserve these six exact values in order: ${EXPECTED[0]}. Return only JSON with that exact joined string as answer.`,
    `${prefix}Memory check under context pressure. Ignore this controlled filler: ${"x ".repeat(4_500)}\nUse no tools. Append the exact checkpoint ID ${EXPECTED[1]} after the six values from the prior turn. Return only JSON with all seven values joined by | in their original order.`,
  ];
}

function buildArgs({ first, threadId, route, schema, threshold, profile }) {
  const common = [
    "--dangerously-bypass-hook-trust",
    "--skip-git-repo-check",
    "--output-schema", schema,
    "--json",
    "--model", route.model,
    "-c", `model_reasoning_effort=${JSON.stringify(route.effort)}`,
    "-c", `model_auto_compact_token_limit=${threshold}`,
    "-c", 'model_auto_compact_token_limit_scope="body_after_prefix"',
    "-c", "features.token_budget=false",
  ];
  if (first) return ["exec", "--profile", profile, "--sandbox", "read-only", ...common, "-"];
  return ["exec", "--profile", profile, "resume", ...common, threadId, "-"];
}

export function parseJsonl(stdout) {
  const records = String(stdout).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const started = records.find((record) => record.type === "thread.started");
  const messages = records.filter((record) => record.type === "item.completed" && record.item?.type === "agent_message");
  const completed = [...records].reverse().find((record) => record.type === "turn.completed" || record.type === "response.completed");
  return {
    threadId: started?.thread_id ?? started?.threadId ?? null,
    message: messages.at(-1)?.item?.text ?? "",
    usage: completed?.usage ?? completed?.response?.usage ?? {},
  };
}

async function readHookEvidence(workspace) {
  const events = await readJsonl(path.join(workspace, ".condiments", "native-context", "events.jsonl"));
  let checkpoint = null;
  try { checkpoint = JSON.parse(await readFile(path.join(workspace, ".condiments", "checkpoints", "latest.json"), "utf8")); } catch {}
  return { events, checkpoint };
}

async function readJsonl(filePath) {
  try { return String(await readFile(filePath, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); }
  catch { return []; }
}

function checkpointContainsExpected(checkpoint) {
  const text = JSON.stringify(checkpoint || {});
  return EXPECTED[0].split("|").every((value) => text.includes(value));
}

function parseAnswer(message) {
  try { return JSON.parse(String(message).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { return null; }
}

function cleanStderr(stderr) {
  const kept = String(stderr || "").split(/\r?\n/).filter((line) => line.trim() && !/shell snapshot|interface\.icon_/i.test(line));
  return kept.length ? kept.slice(-4).join("\n") : null;
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, options.timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, timedOut, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
    child.stdin.end(options.stdin);
  });
}

function runCodex(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let budgetStop = null;
    let observedThreadId = options.threadId || null;
    let finalMessageSeen = false;
    let lineBuffer = "";
    let monitorBusy = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, options.timeoutMs);
    const monitor = setInterval(async () => {
      if (!observedThreadId || monitorBusy || budgetStop || finalMessageSeen) return;
      monitorBusy = true;
      try {
        const inspection = await inspectCodexRollout(observedThreadId);
        const status = budgetStatus(inspection, options.budget);
        if (status.stop) {
          budgetStop = status;
          child.kill();
        }
      } finally {
        monitorBusy = false;
      }
    }, 1_000);
    child.stdout.on("data", (chunk) => {
      stdout.push(chunk);
      lineBuffer += chunk.toString("utf8");
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() || "";
      for (const line of lines) {
        try {
          const record = JSON.parse(line);
          if (record.type === "thread.started") observedThreadId ??= record.thread_id ?? record.threadId;
          if (record.type === "item.completed" && record.item?.type === "agent_message") finalMessageSeen = true;
        } catch {}
      }
    });
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      clearInterval(monitor);
      resolve({
        code: code ?? 1,
        timedOut,
        budgetStop,
        observedThreadId,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    child.stdin.end(options.stdin);
  });
}

function parseOptions(args) {
  const options = {
    mode: undefined,
    repository: "evals/fixtures/phase5-project",
    schema: "evals/long-session-answer.schema.json",
    threshold: 4_000,
    timeout: 180_000,
    output: undefined,
    keepWorkspace: false,
    budget: {
      maxTotalTokens: 75_000,
      delayedTokenReserve: 10_000,
      maxModelCalls: 5,
      delayedModelCallReserve: 1,
      maxCompactionsPerTurn: 1,
    },
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--mode") options.mode = value(args, ++index, arg);
    else if (arg === "--repository") options.repository = value(args, ++index, arg);
    else if (arg === "--schema") options.schema = value(args, ++index, arg);
    else if (arg === "--threshold") options.threshold = Number(value(args, ++index, arg));
    else if (arg === "--timeout") options.timeout = Number(value(args, ++index, arg));
    else if (arg === "--output") options.output = value(args, ++index, arg);
    else if (arg === "--max-total-tokens") options.budget.maxTotalTokens = Number(value(args, ++index, arg));
    else if (arg === "--delayed-token-reserve") options.budget.delayedTokenReserve = Number(value(args, ++index, arg));
    else if (arg === "--max-model-calls") options.budget.maxModelCalls = Number(value(args, ++index, arg));
    else if (arg === "--delayed-model-call-reserve") options.budget.delayedModelCallReserve = Number(value(args, ++index, arg));
    else if (arg === "--max-compactions-per-turn") options.budget.maxCompactionsPerTurn = Number(value(args, ++index, arg));
    else if (arg === "--keep-workspace") options.keepWorkspace = true;
    else throw new Error(`Unknown option '${arg}'.`);
  }
  if (!MODES.has(options.mode)) throw new Error("--mode must be baseline, some, or full.");
  if (!Number.isSafeInteger(options.threshold) || options.threshold < 1_000) throw new Error("--threshold must be an integer >= 1000.");
  for (const [key, count] of Object.entries(options.budget)) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`${key} must be a non-negative integer.`);
  }
  if (options.budget.delayedTokenReserve >= options.budget.maxTotalTokens) throw new Error("delayed token reserve must be below maximum total tokens.");
  if (options.budget.delayedModelCallReserve >= options.budget.maxModelCalls) throw new Error("delayed model-call reserve must be below maximum model calls.");
  return options;
}

function value(args, index, option) {
  if (index >= args.length || args[index].startsWith("--")) throw new Error(`${option} requires a value.`);
  return args[index];
}

main().catch((error) => {
  process.stderr.write(`condiments-long-session-eval: ${error.stack ?? error.message}\n`);
  process.exitCode = 2;
});

