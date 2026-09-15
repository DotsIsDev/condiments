#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { compareEfficiency } from "../src/usage.mjs";

const modes = ["baseline", "some", "full"];
const root = path.resolve("evals", "results");
const reports = Object.fromEntries(await Promise.all(modes.map(async (mode) => [
  mode,
  JSON.parse(await readFile(path.join(root, `codex-cli-long-session-${mode}.json`), "utf8")),
])));
const qualityPassed = modes.every((mode) => reports[mode].verification_passed && reports[mode].recovery?.exact_state_recovered);
const comparisons = Object.fromEntries(["some", "full"].map((mode) => [
  mode,
  qualityPassed ? compareEfficiency(reports.baseline.authoritative_usage, reports[mode].authoritative_usage) : null,
]));
const claims = Object.fromEntries(["some", "full"].map((mode) => {
  const ratio = comparisons[mode]?.token_ratio ?? null;
  return [mode, {
    quality_eligible: qualityPassed,
    measured_savings: qualityPassed && ratio !== null && ratio < 1,
    token_reduction_percent: qualityPassed && ratio !== null ? Number(((1 - ratio) * 100).toFixed(3)) : null,
    material_savings: qualityPassed && ratio !== null && (1 - ratio) >= 0.01,
  }];
}));
const result = {
  version: 1,
  generatedAt: new Date().toISOString(),
  quality_gate_passed: qualityPassed,
  savings_claim_allowed: claims.some.material_savings || claims.full.material_savings,
  reports: Object.fromEntries(modes.map((mode) => [mode, {
    verified: reports[mode].verification_passed,
    exact_state_recovered: reports[mode].recovery?.exact_state_recovered === true,
    checkpoint_recovery_verified: reports[mode].recovery?.checkpoint_recovery_verified ?? null,
    authoritative_usage: reports[mode].authoritative_usage,
  }])),
  comparisons,
  claims,
};
const rows = modes.map((mode) => {
  const report = reports[mode];
  const usage = report.authoritative_usage || {};
  const ratio = mode === "baseline" || !comparisons[mode] ? "—" : `${((1 - comparisons[mode].token_ratio) * 100).toFixed(1)}%`;
  return `| ${mode} | ${report.verification_passed ? "yes" : "no"} | ${report.recovery?.exact_state_recovered ? "yes" : "no"} | ${usage.total_tokens ?? "—"} | ${usage.model_calls ?? "—"} | ${usage.compaction_count ?? "—"} | ${ratio} |`;
});
const markdown = `# Codex Long-Session Evaluation\n\nQuality gate: **${qualityPassed ? "passed" : "failed"}**. All modes recovered the seven exact values after native compaction. This compact recovery workload shows ${claims.some.token_reduction_percent}% for \`some\` and ${claims.full.token_reduction_percent}% for \`full\`; differences this small do not establish material savings.\n\n| Mode | Verified | Exact recovery | Authoritative tokens | Model calls | Compactions | Token reduction |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n${rows.join("\n")}\n\nRollout-level totals include internal compaction calls. CLI turn totals are diagnostic only. Routes are the resolved preset routes, so this is an end-to-end preset comparison rather than an isolated context-policy experiment.\n`;
await mkdir(root, { recursive: true });
await writeFile(path.join(root, "codex-cli-long-session-comparison.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
await writeFile(path.join(root, "long-session-evaluation.md"), markdown, "utf8");
process.stdout.write(markdown);
