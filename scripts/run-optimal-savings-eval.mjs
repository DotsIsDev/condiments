#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { encodeLogDictionary, decodeLogDictionary } from "../src/log-dictionary.mjs";
import { classifyOutputTask, resolveAdaptiveOutputPolicy } from "../src/output-governor.mjs";
import { selectTelemetryTrainedOutputCap } from "../src/output-cap-learner.mjs";
import { createResultEnvelope } from "../src/result-envelope.mjs";

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1))), "..");
const resultRoot = path.join(projectRoot, "evals", "results");
const fixtureRoot = path.join(projectRoot, "evals", "fixtures", "phase5-project");

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const dictionary = await evaluateDictionary();
  const telemetry = await loadHistoricalOutputTelemetry();
  const caps = evaluateCaps(telemetry);
  const report = {
    version: 1,
    generated_at: new Date().toISOString(),
    usage_guard: {
      five_hour_remaining_percent: options.remaining5h,
      weekly_remaining_percent: options.remainingWeekly,
      ending_five_hour_remaining_percent: options.ending5h,
      ending_weekly_remaining_percent: options.endingWeekly,
      observed_five_hour_change_points: options.ending5h === null ? null : options.remaining5h - options.ending5h,
      model_calls: 0,
      reason: "Historical authenticated telemetry and local exact corpora were sufficient; Codex CLI cannot exercise direct-provider output cap fields.",
    },
    dictionary,
    cap_shadow: caps,
    claims: {
      dictionary: "Measured encoded JSON bytes and exact reconstruction; provider tokens not measured.",
      output_caps: "Measured cap-exposure reduction on chronological holdout; actual output-token saving is zero when all responses naturally end below both caps.",
    },
  };
  const jsonPath = path.resolve(options.json);
  const markdownPath = path.resolve(options.markdown);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(report), "utf8");
  process.stdout.write(`${JSON.stringify({ jsonPath, markdownPath, dictionary: summarizeDictionary(dictionary), cap_shadow: summarizeCaps(caps) }, null, 2)}\n`);
}

async function evaluateDictionary() {
  const history = await readFile(path.join(fixtureRoot, "data", "history.log"), "utf8");
  const noisy = spawnSync(process.execPath, [path.join(fixtureRoot, "scripts", "noisy.mjs")], {
    cwd: fixtureRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
  if (noisy.error || noisy.status !== 0) throw noisy.error ?? new Error(noisy.stderr || `noisy fixture exited ${noisy.status}`);
  const corpora = [
    { id: "checkpoint-history", content: history },
    { id: "repetitive-command-output", content: `${noisy.stdout}${noisy.stderr}` },
  ];
  return corpora.map(({ id, content }) => {
    const encoded = encodeLogDictionary(content);
    const restored = decodeLogDictionary(encoded);
    const some = createResultEnvelope({ tool: id, content }, { thresholdChars: 80_000, previewChars: 2_000 });
    const full = createResultEnvelope({ tool: id, content }, { thresholdChars: 20_000, previewChars: 1_000 });
    return {
      corpus: id,
      original_bytes: encoded.original_bytes,
      raw_json_bytes: encoded.raw_json_bytes,
      encoded_bytes: encoded.encoded_bytes,
      saved_bytes: encoded.saved_bytes,
      encoded_byte_reduction: round(encoded.reduction_rate),
      dictionary_entries: encoded.dictionary_entries,
      encoded_records: encoded.records,
      exact_recovery: restored === content,
      some_model_visible_dictionary: Boolean(some.dictionary_compression),
      full_model_visible_dictionary: Boolean(full.dictionary_compression),
      some_envelope_bytes: Buffer.byteLength(JSON.stringify(some), "utf8"),
      full_envelope_bytes: Buffer.byteLength(JSON.stringify(full), "utf8"),
    };
  });
}

async function loadHistoricalOutputTelemetry() {
  const prompts = await workloadPrompts();
  const files = (await readdir(resultRoot)).filter((name) => name.endsWith(".json"));
  const records = [];
  const seen = new Set();
  for (const file of files) {
    let report;
    try { report = JSON.parse(await readFile(path.join(resultRoot, file), "utf8")); }
    catch { continue; }
    if (!Array.isArray(report.runs)) continue;
    for (const [index, run] of report.runs.entries()) {
      if (!["some", "full"].includes(run?.mode)) continue;
      const actual = run.output_cap?.actual_output_tokens ?? run.output_tokens;
      if (!Number.isSafeInteger(actual) || actual < 0) continue;
      const prompt = prompts.get(run.workload);
      if (!run.output_cap?.task_class && !prompt) continue;
      const taskClass = run.output_cap?.task_class ?? classifyOutputTask(prompt).taskClass;
      const eventId = run.output_cap?.event_id ?? `${file}:${index}`;
      if (seen.has(eventId)) continue;
      seen.add(eventId);
      const fallbackCap = resolveAdaptiveOutputPolicy({ level: run.mode, taskClass }).outputTokenCap;
      records.push({
        event_id: eventId,
        timestamp: run.output_cap?.timestamp ?? report.generatedAt ?? report.generated_at ?? "1970-01-01T00:00:00.000Z",
        provider: run.provider ?? report.provider ?? "openai",
        host: run.host ?? report.host ?? "codex-cli",
        mode: run.mode,
        task_class: taskClass,
        requested_output_tokens: run.output_cap?.requested_output_tokens ?? run.policy_output_token_limit ?? fallbackCap,
        actual_output_tokens: actual,
        cap_hit: run.output_cap?.cap_hit === true,
        verification_passed: run.output_cap?.verification_passed ?? run.verification_passed ?? run.verified ?? false,
        required_result_lost: run.output_cap?.required_result_lost === true,
        source_file: file,
      });
    }
  }
  return records;
}

function evaluateCaps(records) {
  const grouped = new Map();
  for (const record of records) {
    const key = [record.provider, record.host, record.mode, record.task_class].join("|");
    const group = grouped.get(key) ?? [];
    group.push(record);
    grouped.set(key, group);
  }
  const groups = [];
  for (const [key, all] of grouped) {
    const ordered = [...all].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
    if (ordered.length < 10) continue;
    const holdoutSize = Math.max(2, Math.floor(ordered.length * 0.25));
    const training = ordered.slice(0, -holdoutSize);
    const holdout = ordered.slice(-holdoutSize);
    const [provider, host, level, taskClass] = key.split("|");
    const fallbackCap = resolveAdaptiveOutputPolicy({ level, taskClass }).outputTokenCap;
    const selection = selectTelemetryTrainedOutputCap(training, { provider, host, level, taskClass, fallbackCap });
    const verifiedHoldout = holdout.filter((record) => record.verification_passed === true);
    const wouldTruncate = verifiedHoldout.filter((record) => record.actual_output_tokens > selection.cap);
    const actualTokens = sum(verifiedHoldout, "actual_output_tokens");
    groups.push({
      provider, host, level, task_class: taskClass,
      samples: ordered.length,
      training_samples: training.length,
      holdout_samples: holdout.length,
      verified_holdout_samples: verifiedHoldout.length,
      fallback_cap: fallbackCap,
      selected_cap: selection.cap,
      selection_applied: selection.applied,
      selection_reason: selection.reason,
      cap_exposure_reduction: selection.applied ? round((fallbackCap - selection.cap) / fallbackCap) : 0,
      verified_outputs_above_selected_cap: wouldTruncate.length,
      quality_gate_passed: verifiedHoldout.length > 0 && wouldTruncate.length === 0,
      observed_holdout_output_tokens: actualTokens,
      estimated_actual_output_tokens_saved: 0,
    });
  }
  return {
    source_records: records.length,
    groups,
    all_applied_groups_pass_quality: groups.filter((group) => group.selection_applied).every((group) => group.quality_gate_passed),
  };
}

async function workloadPrompts() {
  const output = new Map();
  for (const name of ["phase5-live-workloads.json", "provider-workloads.json"]) {
    const config = JSON.parse(await readFile(path.join(projectRoot, "evals", name), "utf8"));
    for (const workload of config.workloads ?? []) output.set(workload.id, workload.prompt);
  }
  return output;
}

function renderMarkdown(report) {
  const lines = [
    "# Optimal Savings Evaluation",
    "",
    `Generated: ${report.generated_at}`,
    "",
    `Usage guard: ${report.usage_guard.five_hour_remaining_percent}% → ${report.usage_guard.ending_five_hour_remaining_percent ?? "unknown"}% five-hour; ${report.usage_guard.weekly_remaining_percent}% → ${report.usage_guard.ending_weekly_remaining_percent ?? "unknown"}% weekly. Evaluation-launched model calls: **0**. Account meters may update late and include this active Codex task.`,
    "",
    "## Lossless repetitive-log compression",
    "",
    "| Corpus | Content bytes | Raw JSON | Encoded JSON | Reduction | Exact | Some-visible | Full-visible |",
    "| --- | ---: | ---: | ---: | ---: | --- | --- | --- |",
    ...report.dictionary.map((item) => `| ${item.corpus} | ${item.original_bytes} | ${item.raw_json_bytes} | ${item.encoded_bytes} | ${percent(item.encoded_byte_reduction)} | ${yes(item.exact_recovery)} | ${yes(item.some_model_visible_dictionary)} | ${yes(item.full_model_visible_dictionary)} |`),
    "",
    "Reduction is encoded JSON bytes versus equivalent raw JSON. It is not provider token telemetry.",
    "",
    "## Telemetry-trained cap shadow holdout",
    "",
    "| Group | Train | Holdout verified | Static cap | Selected | Exposure reduction | Would truncate | Gate |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...report.cap_shadow.groups.map((group) => `| ${group.provider}/${group.host}/${group.level}/${group.task_class} | ${group.training_samples} | ${group.verified_holdout_samples} | ${group.fallback_cap} | ${group.selected_cap} | ${percent(group.cap_exposure_reduction)} | ${group.verified_outputs_above_selected_cap} | ${yes(group.quality_gate_passed)} |`),
    "",
    "A lower cap reduces worst-case exposure. When a response naturally ends below both limits, measured actual token saving is zero. Enable only groups with a passing chronological holdout gate.",
    "",
    "## Decision",
    "",
    report.cap_shadow.all_applied_groups_pass_quality
      ? "All groups where learning applied passed the historical holdout quality gate. Keep learned caps opt-in until live direct-provider A/B data exists."
      : "At least one learned group failed holdout. Keep static caps for failed groups.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function summarizeDictionary(records) {
  return {
    corpora: records.length,
    exact: records.every((record) => record.exact_recovery),
    weighted_encoded_byte_reduction: round(sum(records, "saved_bytes") / sum(records, "raw_json_bytes")),
  };
}

function summarizeCaps(result) {
  const applied = result.groups.filter((group) => group.selection_applied);
  return {
    source_records: result.source_records,
    evaluated_groups: result.groups.length,
    applied_groups: applied.length,
    passing_applied_groups: applied.filter((group) => group.quality_gate_passed).length,
  };
}

function parseOptions(args) {
  const options = {
    json: path.join(resultRoot, "optimal-savings-eval.json"),
    markdown: path.join(resultRoot, "optimal-savings-eval.md"),
    remaining5h: 14,
    remainingWeekly: 24,
    ending5h: null,
    endingWeekly: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") options.json = value(args, ++index, arg);
    else if (arg === "--markdown") options.markdown = value(args, ++index, arg);
    else if (arg === "--remaining-5h") options.remaining5h = percentage(value(args, ++index, arg), arg);
    else if (arg === "--remaining-weekly") options.remainingWeekly = percentage(value(args, ++index, arg), arg);
    else if (arg === "--ending-5h") options.ending5h = percentage(value(args, ++index, arg), arg);
    else if (arg === "--ending-weekly") options.endingWeekly = percentage(value(args, ++index, arg), arg);
    else throw new Error(`Unknown option '${arg}'.`);
  }
  return options;
}

function value(args, index, option) {
  if (index >= args.length || args[index].startsWith("--")) throw new Error(`${option} requires a value.`);
  return args[index];
}

function percentage(input, option) {
  const number = Number(input);
  if (!(number >= 0 && number <= 100)) throw new Error(`${option} requires a percentage from 0 to 100.`);
  return number;
}

function sum(records, field) {
  return records.reduce((total, record) => total + Number(record[field] ?? 0), 0);
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 1_000_000) / 1_000_000 : null;
}

function percent(value) {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function yes(value) {
  return value ? "yes" : "no";
}

main().catch((error) => {
  process.stderr.write(`optimal-savings-eval: ${error.stack ?? error.message}\n`);
  process.exitCode = 2;
});
