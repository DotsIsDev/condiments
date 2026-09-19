---
name: condiments
description: Apply token-efficiency presets for $condiments and text commands /cond or /condiments.
---

# Condiments for Codex CLI

Reconstruct the requested `/condiments` or `/cond` command from the user message. Resolve this skill directory. On first use this session, read `references/policy.md` and `references/policy-protocol.md` once. For mode changes, run `scripts/condiments.mjs` with `--host codex-cli`, local `capabilities.json`, and `--prompt-only`; apply the compact delta. For status, omit `--prompt-only` and show the human result. Never inject repeated status, capabilities, or receipts.

Keep state in the repository `.condiments/state.json`. With `ranch some|full`, the trusted `PreToolUse:Bash` hook blocks oversized literal whole-file reads before execution and returns bounded read/search alternatives. `none` passes through. Add `condiments:allow-large-output` only when full output is explicitly required. Codex still cannot replace native `PostToolUse` output; use the bundled result-envelope helper for other large commands.

For long retrieved context or tool evidence under `mustard some|full`, use `scripts/query-compressor.mjs`. Lock named paths, symbols, IDs, numbers, errors, citations, and required line ranges. Send its prompt only when `readyForModel=true`; retrieve only reported gaps within the bounded recovery count. `none` retains all evidence.

For `mayo some|full` edit tasks, use Codex's native patch/file-edit tool directly and keep the visible reply short. Native FIM is unavailable through this skill surface. If direct editing is unavailable, emit the smallest exact changed block, then unified diff. Never reproduce a full existing file unless requested. See `references/completion-policy.md`.

At `mayo full`, exact old/new text needs no exploratory read: make one edit, run one requested test, and stop on success.

Use `scripts/output-governor.mjs` to classify micro/standard/complex work. `full` caps output at 128/512/2,048 tokens and tools at 1/4/8; `some` uses safer 512/2,048/4,096 output and 2/8/16 tools. After a successful direct edit, emit paths, test status, and failures only. Retry only when a named required result is missing.

For direct OpenAI Responses requests, decorate request JSON with the bundled output-budget helper so `mayo some|full` sets adaptive `max_output_tokens` and `max_tool_calls`. Codex CLI project hooks cannot alter their own generation request, so its interactive fallback is the final-answer prompt contract.

The `Stop` hook records Codex `cached_input_tokens`, `cache_write_input_tokens`, and `reasoning_output_tokens` when exposed. Missing counters remain unavailable, never measured zero. Codex does not expose provider cache controls to project hooks. Report `.condiments/prompt-cache/events.jsonl` with `scripts/prompt-cache.mjs report --root .`.

When managed app-server routing is available, model/reasoning changes consult latest same-session cache telemetry and preserve current lineage below break-even. Quality escalation bypasses this hold. Direct request pipelines can use `scripts/cache-lineage.mjs`.

For direct OpenAI requests, `scripts/tool-context.mjs` keeps stable core schemas eager, defers others when the request includes supported tool search, and filters unrelated MCP entries under `ranch full`. Codex CLI project skills cannot alter active built-in or MCP schemas; report native lazy/MCP pruning unavailable.

The adapter registers native `PreCompact`, `PostCompact`, and `SessionStart(compact)` hooks. With `ketchup some|full`, they archive the transcript and preserve a validated checkpoint around Codex compaction. The command enables native `context_management` for the next Codex session; `none` restores the captured setting. Hooks require Codex trust. Inspect `.condiments/native-context/last-apply.json` and `/hooks` before claiming success.

With `hot some|full`, the command selects only models advertised by Codex and writes a native project default for the next direct CLI session. The installer probes once for a managed app-server socket and registers `UserPromptSubmit` routing only after success; it never starts a daemon. `none` restores captured model, effort, and feature settings. Require `active-turn-route=yes` and an `applied` receipt before claiming an active-turn switch.

## Learned compression controls

Native compaction also commits a reversible summary/raw pair; expand raw history only for missing exact evidence, then fold it. Use significance-aware semantic blocks so required paths, values, edits, tests, failures, citations, and unresolved items survive output reduction. The governor exposes locate/inspect/edit/verify/report budgets. The query compressor weights errors, tests, code, configuration, and dependencies above repeated prose. Optional LLMLingua-2, Qwen thinking, and DeepSeek reasoning/history controls remain capability-gated. See `references/research-controls.md`.

For repetitive logs, use `scripts/log-dictionary.mjs`; inject its hash-verified lossless payload only when smaller and bounded. For direct provider calls, `scripts/output-budget.mjs --trained` may apply a smaller cap after eight matching verified samples and must fall back after cap-caused quality loss. See `references/log-dictionary.md` and `references/output-cap-learning.md`.
