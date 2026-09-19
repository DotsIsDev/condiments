---
name: condiments
description: Apply token-efficiency presets when the user invokes /condiments or asks to change a Condiments control.
disable-model-invocation: true
---

# Condiments for Claude Code

Treat `$ARGUMENTS` as `/condiments $ARGUMENTS`. Command-only turns use a fast path: run `${CLAUDE_SKILL_DIR}/scripts/condiments.mjs` immediately with the reconstructed command, `--host claude-code`, `--capabilities ${CLAUDE_SKILL_DIR}/capabilities.json`, and `--prompt-only`; apply the compact delta and stop after success. For status or `v|ver|version`, omit `--prompt-only` and show the human result. Do not read reference files for these commands. Before the first substantive task with an active policy, read `references/policy.md` and `references/policy-protocol.md` once. Version commands never change policy state. Never inject repeated status, capabilities, or receipts.

Keep state in the repository `.condiments/state.json`. The native `PostToolUse` hook automatically replaces oversized compatible tool output under `ranch some|full`, preserving a recoverable hash-addressed artifact. `none` passes output through. Inspect `.condiments/native-output/last-apply.json` and `events.jsonl`.

For long retrieved context or tool evidence under `mustard some|full`, use `scripts/query-compressor.mjs`. Lock named paths, symbols, IDs, numbers, errors, citations, and required line ranges. Send its prompt only when `readyForModel=true`; retrieve only reported gaps within the bounded recovery count. `none` retains all evidence.

For `mayo some|full` edit tasks, use Claude Code's native edit tool directly and keep the visible reply short. Native FIM is unavailable through this skill surface. If direct editing is unavailable, emit the smallest exact changed block, then unified diff. Never reproduce a full existing file unless requested. See `references/completion-policy.md`.

At `mayo full`, exact old/new text needs no exploratory read: make one edit, run one requested test, and stop on success.

Use `scripts/output-governor.mjs` to classify micro/standard/complex work. `full` caps output at 128/512/2,048 tokens and tools at 1/4/8; `some` uses safer 512/2,048/4,096 output and 2/8/16 tools. After a successful direct edit, emit paths, test status, and failures only. Retry only when a named required result is missing.

For direct Anthropic Messages requests, decorate request JSON with the bundled output-budget helper so `mayo some|full` sets adaptive `max_tokens`. Anthropic tool-call ceilings remain a prompt contract. Claude Code project hooks cannot alter their own generation request, so its interactive fallback is the final-answer prompt contract.

The `Stop` hook records Anthropic cache reads, writes, and TTL buckets from native transcripts in `.condiments/prompt-cache/events.jsonl`. Claude Code does not expose provider cache controls to project hooks; do not claim native control. Report with `scripts/prompt-cache.mjs report --root .`.

Use `scripts/cache-lineage.mjs` for direct Anthropic request pipelines. It protects stable tools/system/model/reasoning prefixes by measured break-even. Claude Code native request rewriting remains capability-gated off.

For direct Anthropic requests, `scripts/tool-context.mjs` keeps stable core schemas eager, adds native tool search, defers other schemas, and filters unrelated MCP entries under `ranch full`. Claude Code project skills cannot alter its active tool schemas; report native lazy/MCP pruning unavailable.

The adapter registers native `PreCompact` and `SessionStart(compact)` hooks. With `ketchup some|full`, they archive the transcript, write a validated checkpoint, and inject it after compaction. The command sets Claude's native auto-compaction threshold to 85% (`some`) or 70% (`full`); `none` restores the captured setting. Inspect `.condiments/native-context/last-apply.json` before claiming success.

## Learned compression controls

Native compaction also commits a reversible summary/raw pair; expand raw history only for missing exact evidence, then fold it. Use significance-aware semantic blocks so required paths, values, edits, tests, failures, citations, and unresolved items survive output reduction. The governor exposes locate/inspect/edit/verify/report budgets. The query compressor weights errors, tests, code, configuration, and dependencies above repeated prose. Optional LLMLingua-2, Qwen thinking, and DeepSeek reasoning/history controls remain capability-gated. See `references/research-controls.md`.

For repetitive logs, use `scripts/log-dictionary.mjs`; inject its hash-verified lossless payload only when smaller and bounded. For direct provider calls, `scripts/output-budget.mjs --trained` may apply a smaller cap after eight matching verified samples and must fall back after cap-caused quality loss. See `references/log-dictionary.md` and `references/output-cap-learning.md`.
