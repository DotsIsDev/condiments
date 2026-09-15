import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { applyCommand, createDefaultState, parseCommand, renderPrompt } from "./core.mjs";
import {
  createOutputCapTelemetryRecord,
  outputCapQualityFailures,
  resolveProviderOutputTokenLimit,
  summarizeOutputCapTelemetry,
} from "./output-budget.mjs";
import { compareEfficiency, normalizeUsage, summarizeRuns } from "./usage.mjs";

export const EVAL_MODES = Object.freeze(["baseline", "some", "full"]);

export function buildEvaluationPrompt(workload, mode, options = {}) {
  if (!EVAL_MODES.includes(mode)) throw new Error(`Unknown evaluation mode '${mode}'.`);
  const policy = mode === "baseline"
    ? ""
    : renderPrompt(applyCommand(createDefaultState(), parseCommand(
      options.control ? `/cond ${options.control} ${mode}` : `/cond ${mode}`,
    )));
  const task = [
    "Read-only evaluation. Do not edit files.",
    workload.prompt,
    "Return only JSON matching supplied schema.",
  ].join("\n");
  return policy ? `${policy}\n\n${task}` : task;
}

export function verifyEvaluationAnswer(answer, expected) {
  const failures = [];
  if (!answer || typeof answer !== "object") return { passed: false, failures: ["answer is not an object"] };
  if ("answerEquals" in expected || "answerIncludes" in expected || Array.isArray(expected.evidence)) {
    const actualAnswer = String(answer.answer ?? "");
    if ("answerEquals" in expected && actualAnswer !== String(expected.answerEquals)) {
      failures.push(`answer expected '${expected.answerEquals}', got '${actualAnswer}'`);
    }
    if ("answerIncludes" in expected && !actualAnswer.includes(String(expected.answerIncludes))) {
      failures.push(`answer missing '${expected.answerIncludes}'`);
    }
    const actualEvidence = Array.isArray(answer.evidence) ? answer.evidence : [];
    for (const item of expected.evidence ?? []) {
      const matched = actualEvidence.some((actual) =>
        pathMatches(actual.file, item.file) &&
        Number(actual.line) === Number(item.line) &&
        (!item.quoteIncludes || String(actual.quote ?? "").includes(item.quoteIncludes))
      );
      if (!matched) failures.push(`missing evidence ${item.file}:${item.line}`);
    }
    return { passed: failures.length === 0, failures };
  }
  const actualFile = slash(String(answer.file ?? ""));
  const expectedFile = slash(String(expected.file ?? ""));
  if (actualFile !== expectedFile) failures.push(`file expected '${expectedFile}', got '${actualFile}'`);
  if (Number(answer.line) !== Number(expected.line)) failures.push(`line expected ${expected.line}, got ${answer.line}`);
  if (expected.evidenceIncludes && !String(answer.evidence ?? "").includes(expected.evidenceIncludes)) {
    failures.push(`evidence missing '${expected.evidenceIncludes}'`);
  }
  return { passed: failures.length === 0, failures };
}

export function parseHostOutput(format, stdout) {
  if (format === "claude-json" || format === "json") {
    const record = JSON.parse(stdout);
    let answer = null;
    let answerParseError = null;
    try {
      answer = parseJsonAnswer(record.result ?? record.answer ?? record);
    } catch (error) {
      if (!record.is_error) answerParseError = error.message;
    }
    return {
      answer,
      answerParseError,
      responseText: String(record.result ?? record.answer ?? ""),
      error: record.is_error ? String(record.result ?? record.subtype ?? "provider error") : null,
      usagePayload: record.usage ?? record,
      metadata: {
        costUsd: record.total_cost_usd ?? record.cost_usd,
        modelCalls: record.num_turns,
        wallTimeMs: record.duration_ms,
      },
      raw: record,
    };
  }
  if (format === "codex-jsonl") {
    const records = stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    const text = findLast(records, (record) => {
      if (record.type === "item.completed" && record.item?.type === "agent_message") return record.item.text;
      if (record.type === "message" && record.role === "assistant") return record.content ?? record.text;
      return undefined;
    });
    const usagePayload = findLast(records, (record) => record.usage ?? record.response?.usage) ?? {};
    const toolCalls = records.filter((record) => record.type === "item.completed" && record.item?.type !== "agent_message").length;
    const toolResultChars = records.reduce((total, record) => {
      if (record.type !== "item.completed" || record.item?.type === "agent_message") return total;
      const output = record.item?.aggregated_output ?? record.item?.output ?? record.item?.text ?? "";
      return total + String(output).length;
    }, 0);
    const modelCalls = records.filter((record) => record.type === "turn.completed" || record.type === "response.completed").length;
    let answer = null;
    let answerParseError = null;
    try { answer = parseJsonAnswer(text); }
    catch (error) { answerParseError = error.message; }
    return {
      answer,
      answerParseError,
      responseText: String(text ?? ""),
      usagePayload,
      metadata: { toolCalls, toolResultChars, modelCalls: Math.max(1, modelCalls) },
      raw: records,
    };
  }
  throw new Error(`Unknown output format '${format}'.`);
}

export async function runProviderEvaluation(config, options = {}) {
  const host = config.hosts?.[options.host];
  if (!host) throw new Error(`Unknown configured host '${options.host}'.`);
  const modes = options.modes ?? EVAL_MODES;
  for (const mode of modes) {
    if (!EVAL_MODES.includes(mode)) throw new Error(`Unknown evaluation mode '${mode}'.`);
  }
  const schemaPath = path.resolve(options.configDirectory, config.answerSchema);
  const schemaJson = await readFile(schemaPath, "utf8");
  const runs = [];
  const selectedWorkloads = options.workloads?.length
    ? config.workloads.filter((workload) => options.workloads.includes(workload.id))
    : config.workloads;
  if (selectedWorkloads.length === 0) throw new Error("No workloads matched the requested IDs.");

  for (const workload of selectedWorkloads) {
    const repository = path.resolve(options.configDirectory, workload.path);
    for (const mode of modes) {
      const prompt = buildEvaluationPrompt(workload, mode, { control: options.control });
      const args = host.args.map((arg) => interpolate(arg, { repository, schemaPath, schemaJson }));
      const started = Date.now();
      const processResult = await runProcess(host.command, args, {
        cwd: repository,
        stdin: prompt,
        timeoutMs: host.timeoutMs ?? 120_000,
      });
      const elapsed = Date.now() - started;
      if (processResult.code !== 0) {
        let usage = {};
        let providerError;
        try {
          const parsed = parseHostOutput(host.outputFormat, processResult.stdout);
          providerError = parsed.error;
          usage = normalizeUsage(host.provider, parsed.usagePayload, {
            ...parsed.metadata,
            wallTimeMs: parsed.metadata.wallTimeMs ?? elapsed,
            verificationPassed: false,
          });
        } catch {
          // Preserve bounded raw output below when provider output is not parseable.
        }
        runs.push({
          workload: workload.id,
          repository,
          host: options.host,
          mode,
          verification_passed: false,
          failures: [
            processResult.timedOut ? `process timed out after ${host.timeoutMs ?? 120_000} ms` : `process exited ${processResult.code}`,
            providerError,
            processResult.stderr.trim(),
            !providerError && processResult.stdout ? tail(processResult.stdout, 2_000).trim() : "",
          ].filter(Boolean),
          wall_time_ms: elapsed,
          ...usage,
          verification_passed: false,
        });
        continue;
      }

      try {
        const parsed = parseHostOutput(host.outputFormat, processResult.stdout);
        const verification = parsed.answerParseError
          ? { passed: false, failures: [`answer parse failed: ${parsed.answerParseError}`] }
          : verifyEvaluationAnswer(parsed.answer, workload.expected);
        const requestedOutputTokens = host.outputTokenLimits?.[mode] ?? null;
        const provisionalUsage = normalizeUsage(host.provider, parsed.usagePayload, {
          ...parsed.metadata,
          wallTimeMs: parsed.metadata.wallTimeMs ?? elapsed,
          verificationPassed: verification.passed,
        });
        const outputCap = createOutputCapTelemetryRecord(host.provider, parsed.raw, {
          host: options.host,
          mode,
          requestedOutputTokens,
          actualOutputTokens: provisionalUsage.output_tokens,
          reasoningOutputTokens: provisionalUsage.reasoning_tokens,
          verificationPassed: verification.passed,
          taskClass: workload.taskClass ?? "standard",
        });
        const failures = [...verification.failures, ...outputCapQualityFailures(outputCap)];
        const qualityPassed = failures.length === 0;
        const usage = normalizeUsage(host.provider, parsed.usagePayload, {
          ...parsed.metadata,
          wallTimeMs: parsed.metadata.wallTimeMs ?? elapsed,
          verificationPassed: qualityPassed,
        });
        runs.push({
          workload: workload.id,
          repository,
          host: options.host,
          mode,
          answer: parsed.answer,
          response_words: countWords(parsed.responseText),
          policy_output_token_limit: mode === "baseline" ? null : resolveProviderOutputTokenLimit(mode),
          output_cap: outputCap,
          failures,
          ...usage,
        });
      } catch (error) {
        runs.push({
          workload: workload.id,
          repository,
          host: options.host,
          mode,
          verification_passed: false,
          failures: [`output parse/normalization failed: ${error.message}`],
          wall_time_ms: elapsed,
        });
      }
    }
  }

  const summaries = {};
  for (const mode of modes) {
    const normalized = runs.filter((run) => run.mode === mode && run.version === 1);
    summaries[mode] = normalized.length > 0 ? summarizeRuns(normalized) : null;
  }
  const comparisons = {};
  if (summaries.baseline) {
    for (const mode of modes.filter((value) => value !== "baseline")) {
      if (summaries[mode]) comparisons[mode] = compareEfficiency(summaries.baseline, summaries[mode]);
    }
  }
  const outputCapSummaries = Object.fromEntries(modes.map((mode) => [
    mode,
    summarizeOutputCapTelemetry(runs.filter((run) => run.mode === mode && run.output_cap).map((run) => run.output_cap)),
  ]));
  return { version: 1, host: options.host, control: options.control ?? null, modes, runs, summaries, output_cap_summaries: outputCapSummaries, comparisons };
}

function runProcess(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        code,
        timedOut,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    child.stdin.end(options.stdin);
  });
}

function parseJsonAnswer(value) {
  if (value && typeof value === "object") return value;
  const text = String(value ?? "").trim();
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(unfenced);
}

function findLast(items, selector) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const value = selector(items[index]);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function interpolate(value, variables) {
  return String(value)
    .replaceAll("{repository}", variables.repository)
    .replaceAll("{schemaPath}", variables.schemaPath)
    .replaceAll("{schemaJson}", variables.schemaJson);
}

function slash(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function pathMatches(actual, expected) {
  const actualPath = slash(String(actual ?? ""));
  const expectedPath = slash(String(expected ?? ""));
  return actualPath === expectedPath || actualPath.endsWith(`/${expectedPath}`);
}

function tail(value, length) {
  const text = String(value);
  return text.slice(Math.max(0, text.length - length));
}

function countWords(value) {
  const text = String(value ?? "").trim();
  return text ? text.split(/\s+/u).length : 0;
}
