---
name: condiments
description: Apply token-efficiency presets when the user invokes /condiments or asks to change a Condiments control.
disable-model-invocation: true
---

# Condiments for Cursor

Treat invocation arguments as `/condiments <arguments>`. Resolve this skill directory. On first use this session, read `references/policy.md` and `references/policy-protocol.md` once. For mode changes, run `scripts/condiments.mjs` with `--host cursor`, local `capabilities.json`, and `--prompt-only`; apply the compact delta. For status, omit `--prompt-only`. Never inject repeated status, capabilities, or receipts.

Keep state in the repository `.condiments/state.json`. The adapter registers `postToolUse` replacement for oversized MCP output under `ranch some|full`; shell output remains prompt-controlled because Cursor's shell observer cannot replace it. Exact output is hash-addressed under `.condiments/artifacts/`.

For long retrieved context or tool evidence under `mustard some|full`, use `scripts/query-compressor.mjs`. Lock named paths, symbols, IDs, numbers, errors, citations, and required line ranges. Send its prompt only when `readyForModel=true`; retrieve only reported gaps within the bounded recovery count. `none` retains all evidence.

For `mayo some|full` edit tasks, use Cursor Agent's native edit tool directly and keep the visible reply short. Native FIM is unavailable through this skill surface. If direct editing is unavailable, emit the smallest exact changed block, then unified diff. Never reproduce a full existing file unless requested. See `references/completion-policy.md`.

At `mayo full`, exact old/new text needs no exploratory read: make one edit, run one requested test, and stop on success.

Use `scripts/output-governor.mjs` to classify micro/standard/complex work. `full` caps output at 128/512/2,048 tokens and tools at 1/4/8; `some` uses safer 512/2,048/4,096 output and 2/8/16 tools. After a successful direct edit, emit paths, test status, and failures only. Retry only when a named required result is missing.

Cursor project hooks do not expose per-request generation limits. `mayo` therefore uses the final-answer prompt contract; direct OpenAI or Anthropic requests made by user code can use the bundled output-budget helper.

The `sessionEnd` hook records cache counters when Cursor exposes them; SDK or OTEL usage payloads can also be ingested with `scripts/prompt-cache.mjs`. Missing counters remain unavailable. Cursor does not expose provider cache controls to project hooks.

Use `scripts/cache-lineage.mjs` only in a direct provider request pipeline. Cursor project hooks cannot rewrite active model/reasoning/tool prefixes, so native lineage control remains off.

Direct OpenAI/Anthropic requests can use `scripts/tool-context.mjs` for stable core schemas, lazy loading, MCP filtering, and split telemetry. Cursor can toggle MCP servers in UI/CLI, but project skills lack a safe per-turn disable/restore transaction; report native lazy/MCP pruning unavailable.

The adapter also registers Cursor's native `preCompact` observer and `sessionStart` restore hook. With `ketchup some|full`, it archives the transcript, writes a validated checkpoint, and injects the latest checkpoint into a new session. Cursor owns conversation summarization and file condensation.

Do not assume Router or plan-specific model controls are available. Never claim a native setting changed when only prompt guidance was applied.

## Learned compression controls

Native compaction also commits a reversible summary/raw pair; expand raw history only for missing exact evidence, then fold it. Use significance-aware semantic blocks so required paths, values, edits, tests, failures, citations, and unresolved items survive output reduction. The governor exposes locate/inspect/edit/verify/report budgets. The query compressor weights errors, tests, code, configuration, and dependencies above repeated prose. An optional local LLMLingua-2 sidecar and direct Qwen request decorator remain capability-gated. See `references/research-controls.md`.

For repetitive logs, use `scripts/log-dictionary.mjs`; inject its hash-verified lossless payload only when smaller and bounded. For direct provider calls, `scripts/output-budget.mjs --trained` may apply a smaller cap after eight matching verified samples and must fall back after cap-caused quality loss. See `references/log-dictionary.md` and `references/output-cap-learning.md`.
