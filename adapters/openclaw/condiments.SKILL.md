---
name: condiments
description: Apply token-efficiency presets when the user invokes /condiments or asks to change a Condiments control.
user-invocable: true
disable-model-invocation: true
---

# Condiments for OpenClaw

Treat the command arguments as `/condiments <arguments>`. On first use this session, read `references/policy.md` and `references/policy-protocol.md` once. For mode changes, run `{baseDir}/scripts/condiments.mjs` with the reconstructed command, `--host openclaw`, `--capabilities {baseDir}/capabilities.json`, and `--prompt-only`; apply the compact delta. For status, omit `--prompt-only`. Never inject repeated status, capabilities, or receipts.

Keep state in the workspace `.condiments/state.json`. `ranch some|full` activates OpenClaw's Tokenjuice result middleware for automatic `exec` and `bash` compaction; `none` restores the captured plugin state. Missing CLI, installation, or capability consent remains pending in `.condiments/native-output/last-apply.json`.

For long retrieved context or tool evidence under `mustard some|full`, use `scripts/query-compressor.mjs`. Lock named paths, symbols, IDs, numbers, errors, citations, and required line ranges. Send its prompt only when `readyForModel=true`; retrieve only reported gaps within the bounded recovery count. `none` retains all evidence.

For `mayo some|full` edit tasks, use OpenClaw `edit`/`apply_patch` directly and keep the visible reply short. Native FIM is unavailable through this skill surface. If direct editing is unavailable, emit the smallest exact changed block, then unified diff. Never reproduce a full existing file unless requested. See `references/completion-policy.md`.

At `mayo full`, exact old/new text needs no exploratory read: make one edit, run one requested test, and stop on success.

Use `scripts/output-governor.mjs` to classify micro/standard/complex work. `full` caps output at 128/512/2,048 tokens and tools at 1/4/8; `some` uses safer 512/2,048/4,096 output and 2/8/16 tools. After a successful direct edit, emit paths, test status, and failures only. Retry only when a named required result is missing.

`mayo some|full` applies OpenClaw's agent-wide `params.maxTokens` ceiling (4,096 or 2,048); `none` restores the captured value. The separate 120-word `full` prompt contract governs the final visible response. Inspect `.condiments/output-budget/last-apply.json`.

`ranch some|full` also applies native `cacheRetention: short|long`; `none` restores the captured value. Cache counters use OpenClaw's real `cacheRead` and `cacheWrite` fields. Inspect `.condiments/prompt-cache/last-apply.json` and use `scripts/prompt-cache.mjs report --root .`.

Use `scripts/cache-lineage.mjs` for direct provider requests before model/reasoning/tool-prefix changes. OpenClaw native lineage rewriting is not yet exposed and remains capability-gated off.

`ranch some|full` applies OpenClaw Code Mode (`auto`/`true`), leaving only its compact direct surface while normal and MCP tools stay behind lazy catalogs. `none` restores the exact captured `tools.codeMode`. Direct provider requests can use `scripts/tool-context.mjs`; inspect `.condiments/tool-context/last-apply.json` and `events.jsonl`.

The command applies OpenClaw's native `contextPruning` and `compaction` configuration through `openclaw config patch`, including a dry run. `some` uses a 1-hour pruning TTL and 20K recent-token tail. `full` uses a 5-minute TTL, 12K tail, transcript-size guard, and mid-turn precheck. `none` restores the captured baseline patch. Inspect `.condiments/native-context/last-apply.json`; a missing OpenClaw CLI leaves a pending patch instead of claiming success.

## Learned compression controls

Native compaction also commits a reversible summary/raw pair; expand raw history only for missing exact evidence, then fold it. Use significance-aware semantic blocks so required paths, values, edits, tests, failures, citations, and unresolved items survive output reduction. The governor exposes locate/inspect/edit/verify/report budgets. The query compressor weights errors, tests, code, configuration, and dependencies above repeated prose. An optional local LLMLingua-2 sidecar and direct Qwen request decorator remain capability-gated. See `references/research-controls.md`.

For repetitive logs, use `scripts/log-dictionary.mjs`; inject its hash-verified lossless payload only when smaller and bounded. For direct provider calls, `scripts/output-budget.mjs --trained` may apply a smaller cap after eight matching verified samples and must fall back after cap-caused quality loss. See `references/log-dictionary.md` and `references/output-cap-learning.md`.
