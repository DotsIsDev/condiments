#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import OpenAI from "openai";
import { appendOutputCapTelemetry, createOutputCapTelemetryRecord } from "../src/output-budget.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1))), "..");
const resultDirectory = path.join(root, "evals", "results");
const sourceEvaluation = path.join(resultDirectory, "optimal-savings-eval.json");
const outputPath = path.join(resultDirectory, "openai-responses-cap-live.json");
const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    file: { type: "string" },
    line: { type: "integer" },
    evidence: { type: "string" },
  },
  required: ["answer", "file", "line", "evidence"],
};
const input = [
  "Review this exact repository excerpt without tools:",
  "src/discount.mjs line 1: export function loyaltyDiscount(subtotal) {",
  "src/discount.mjs line 2:   return subtotal > 100 ? 0.1 : 0;",
  "src/discount.mjs line 3: }",
  "Requirement: subtotal exactly 100 qualifies.",
  "Return the exact corrected condition, file, one-based line, and exact buggy-line evidence.",
].join("\n");

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const plan = await loadPlan();
  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
  if (dryRun) {
    process.stdout.write(`${JSON.stringify({ model, calls: 2, ...plan, outputPath }, null, 2)}\n`);
    return;
  }
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not visible to this process.");
  const client = new OpenAI();
  await client.models.retrieve(model);
  const runs = [];
  for (const variant of [
    { name: "static", cap: plan.staticCap },
    { name: "learned", cap: plan.learnedCap },
  ]) {
    const started = Date.now();
    const response = await client.responses.create({
      model,
      input,
      max_output_tokens: variant.cap,
      reasoning: { effort: "none" },
      text: { verbosity: "low", format: { type: "json_schema", name: "condiments_cap_eval", strict: true, schema } },
      prompt_cache_key: "condiments-cap-eval-v1",
      store: false,
    });
    const verification = verify(response);
    const telemetry = createOutputCapTelemetryRecord("openai", response, {
      host: "responses-api",
      mode: "some",
      taskClass: "standard",
      requestedOutputTokens: variant.cap,
      verificationPassed: verification.passed,
      eventId: `${response.id}:${variant.name}`,
    });
    await appendOutputCapTelemetry(root, telemetry);
    runs.push({
      variant: variant.name,
      response_id: response.id,
      model: response.model,
      status: response.status,
      wall_time_ms: Date.now() - started,
      verification,
      telemetry,
    });
    if (!verification.passed) break;
  }
  const staticRun = runs.find((run) => run.variant === "static");
  const learnedRun = runs.find((run) => run.variant === "learned");
  const report = {
    version: 1,
    generated_at: new Date().toISOString(),
    provider: "openai",
    api: "responses",
    model,
    plan,
    runs,
    comparison: learnedRun ? {
      both_quality_passed: staticRun.verification.passed && learnedRun.verification.passed,
      output_token_change: learnedRun.telemetry.actual_output_tokens - staticRun.telemetry.actual_output_tokens,
      output_token_reduction: ratio(staticRun.telemetry.actual_output_tokens, learnedRun.telemetry.actual_output_tokens),
      cap_exposure_reduction: ratio(plan.staticCap, plan.learnedCap),
    } : null,
  };
  await mkdir(resultDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ outputPath, model, runs: runs.map((run) => ({ variant: run.variant, passed: run.verification.passed, output_tokens: run.telemetry.actual_output_tokens, cap_hit: run.telemetry.cap_hit })), comparison: report.comparison }, null, 2)}\n`);
}

async function loadPlan() {
  const report = JSON.parse(await readFile(sourceEvaluation, "utf8"));
  const group = report.cap_shadow.groups.find((item) => item.provider === "openai" && item.level === "some" && item.task_class === "standard" && item.selection_applied && item.quality_gate_passed);
  if (!group) throw new Error("No passing learned OpenAI some/standard cap exists in optimal-savings-eval.json.");
  return { source: path.basename(sourceEvaluation), staticCap: group.fallback_cap, learnedCap: group.selected_cap };
}

function verify(response) {
  const failures = [];
  if (response.status !== "completed") failures.push(`response status ${response.status}`);
  let answer;
  try { answer = JSON.parse(response.output_text); }
  catch (error) { failures.push(`invalid JSON: ${error.message}`); }
  if (answer?.answer !== "subtotal >= 100") failures.push("wrong corrected condition");
  if (answer?.file !== "src/discount.mjs") failures.push("wrong file");
  if (answer?.line !== 2) failures.push("wrong line");
  if (!String(answer?.evidence ?? "").includes("subtotal > 100")) failures.push("missing exact buggy evidence");
  return { passed: failures.length === 0, failures };
}

function ratio(baseline, candidate) {
  return Number.isFinite(baseline) && baseline > 0 && Number.isFinite(candidate)
    ? Math.round(((baseline - candidate) / baseline) * 1_000_000) / 1_000_000
    : null;
}

main().catch((error) => {
  process.stderr.write(`openai-responses-cap-eval: ${error.message}\n`);
  process.exitCode = 2;
});
