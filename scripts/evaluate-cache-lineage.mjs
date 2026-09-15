#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { estimateCacheLineageOpportunity } from "../src/cache-lineage.mjs";

const source = path.resolve(process.argv[2] ?? "evals/results/codex-cli-tool-context-live.json");
const output = path.resolve(process.argv[3] ?? "evals/results/cache-lineage-estimate.json");
const markdown = path.resolve(process.argv[4] ?? "evals/results/cache-lineage-estimate.md");
const report = JSON.parse(await readFile(source, "utf8"));
const valid = report.runs.filter((run) => run.quality_passed && Number.isSafeInteger(run.input_tokens) && Number.isSafeInteger(run.cache_read_tokens));
if (!valid.length) throw new Error("No verified cache telemetry in source report.");
const targetCacheReadTokens = Math.max(...valid.map((run) => run.cache_read_tokens));
const runs = valid.map((run) => ({
  mode: run.mode,
  input_tokens: run.input_tokens,
  cache_read_tokens: run.cache_read_tokens,
  ...estimateCacheLineageOpportunity({
    inputTokens: run.input_tokens,
    cacheReadTokens: run.cache_read_tokens,
    targetCacheReadTokens: Math.min(run.input_tokens, targetCacheReadTokens),
  }),
}));
const result = {
  version: 1,
  generated_at: new Date().toISOString(),
  source,
  method: "observed best compatible cache-read count as target",
  target_cache_read_tokens: targetCacheReadTokens,
  logical_input_token_reduction: 0,
  recoverable_uncached_tokens: runs.reduce((sum, run) => sum + run.recoverable_uncached_tokens, 0),
  current_uncached_tokens: runs.reduce((sum, run) => sum + run.current_uncached_tokens, 0),
  runs,
  limitation: "Single ordered matrix. Cache reuse varies by provider state; this is an observed opportunity, not causal savings proof.",
};
result.matrix_uncached_input_reduction_percent = Number(((result.recoverable_uncached_tokens / result.current_uncached_tokens) * 100).toFixed(3));
const rows = runs.map((run) => `| ${run.mode} | ${run.current_uncached_tokens} | ${run.recoverable_uncached_tokens} | ${run.uncached_input_reduction_percent}% |`).join("\n");
const text = `# Cache-Lineage Savings Estimate\n\n` +
  `Source: live verified Codex matrix. Target cache read: ${targetCacheReadTokens.toLocaleString()} tokens.\n\n` +
  `| Mode | Current uncached | Recoverable | Uncached reduction |\n| --- | ---: | ---: | ---: |\n${rows}\n\n` +
  `Across this matrix: ${result.recoverable_uncached_tokens.toLocaleString()} recoverable uncached tokens, ${result.matrix_uncached_input_reduction_percent}% of observed uncached input. Logical input reduction: 0.\n\n` +
  `${result.limitation}\n`;
await mkdir(path.dirname(output), { recursive: true });
await mkdir(path.dirname(markdown), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
await writeFile(markdown, text, "utf8");
console.log(JSON.stringify({ output, markdown, recoverable_uncached_tokens: result.recoverable_uncached_tokens, matrix_uncached_input_reduction_percent: result.matrix_uncached_input_reduction_percent }, null, 2));
