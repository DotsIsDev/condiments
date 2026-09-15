---
name: condiments
description: Control token-efficiency behavior in coding agents with /cond or /condiments presets and individual mayo, mustard, ketchup, ranch, and hot controls.
---

# Condiments

Use this skill when a user invokes `/cond` or `/condiments`, asks to inspect the active Condiments policy, or asks to change a Condiments control.

## Commands

Accept these commands case-insensitively:

```text
/cond <none|some|full>
/condiments <none|some|full>
/cond <control> [none|some|full]
/condiments <control> [none|some|full]
/cond status
/cond reset
```

Aliases:

- `mayo`, `mayonnaise`
- `must`, `mustard`
- `ket`, `ketchup`
- `ran`, `ranch`
- `hot`, `hotsauce`

A bare control selects `full`. A bare `/cond` or `/condiments` shows status. A global preset clears individual overrides. Later commands take precedence.

Use `scripts/condiments.mjs` for deterministic parsing and state resolution when local execution is available. For mode changes, use `--prompt-only` so status, capabilities, and native receipts do not enter model context. Use normal output for `/cond status`. Otherwise maintain equivalent state in the current session.

Read [references/policy.md](references/policy.md) on first Condiments use in a session, then apply later compact deltas without rereading it. `none` adds no Condiments behavior and does not disable mandatory host behavior.

Full rules are loaded once with this skill. Later commands emit protocol-v1 state deltas only: `m/u/k/r/h` mean mayo/mustard/ketchup/ranch/hot and `n/s/f` mean none/some/full. Preserve omitted control values. `reset` makes all controls `none`; `q=verify` retains correctness. Direct provider sessions may add `--policy-prefix` on their first `--prompt-only` command, then keep that stable prefix cached. See [references/policy-protocol.md](references/policy-protocol.md).

With `mayo full`, hard cap the final user-facing response at 120 words unless the user explicitly requests a longer format. Use simple words and terse grammar; fragments and dropped articles are acceptable when meaning remains exact. Treat checkpoints, compaction state, memory, and tool state as internal; they never consume or expand this budget. Put required long detail in an artifact and return a brief link.

For `mayo some|full`, detect edit requests and resolve completion with `scripts/completion-policy.mjs`. Prefer a direct host file edit. If unavailable, use FIM only when `nativeFimCompletion=yes` and bounded prefix/suffix exist; otherwise emit the smallest exact changed block, then a unified diff. Never reproduce a complete existing file unless explicitly requested. Verify behavior, byte-exact expected files, and untouched files. See [references/completion-policy.md](references/completion-policy.md).

At `mayo full`, exact old/new text needs no exploratory read. Make one targeted edit, run one requested test, and stop on success. Expand only after failure.

For direct provider requests, use `scripts/output-budget.mjs`. When a task or task class is supplied, the adaptive governor sets full-mode micro/standard/complex caps to 128/512/2,048 tokens; `some` uses 512/2,048/4,096. Direct-edit final replies use 128 tokens and no more tools. OpenAI Responses also receives `max_tool_calls`; other providers use a prompt tool limit. Retry only when an explicit required-result check fails. Without task evidence, retain the compatible fixed 4,096 (`some`) or 2,048 (`full`) ceiling. See [references/output-governor.md](references/output-governor.md) and [references/output-budget.md](references/output-budget.md).

Before returning a constrained response, pass structured answer blocks through `scripts/significance-output.mjs` when available. Mark exact values, paths, edits, tests, failures, citations, requested data, and unresolved work required. The soft budget may remove optional prose but never required blocks. The output governor also divides its cap across locate, inspect, edit, verify, and report; use learned shares only after eight matching verified samples.

Installed native adapters intercept oversized textual tool output when the host exposes replacement. `ranch some` offloads above 80,000 characters; `ranch full` offloads above 20,000. Codex uses trusted `PreToolUse` control instead: it blocks literal whole-file reads above 320,000 bytes under `some` or 80,000 bytes under `full`, then returns bounded read and search commands. Use `scripts/compact-tool-result.mjs` as the explicit fallback. See [references/native-output.md](references/native-output.md).

`ranch` also controls prompt caching. `some` uses stable/default-lifetime caching; `full` requests longer provider-supported retention. OpenClaw applies native `cacheRetention`; other host adapters truthfully report unavailable request control. Completed-turn hooks ingest real counters when exposed. Use `scripts/prompt-cache.mjs` and read [references/prompt-cache.md](references/prompt-cache.md).

Before changing model, reasoning, tools, or stable instructions, use `scripts/cache-lineage.mjs` to compare expected token savings with provider-reported cached tokens at risk. `none` is inert; `some` and `full` increasingly preserve cache lineage unless quality requires the change. Store hashes and counts only. See [references/cache-lineage.md](references/cache-lineage.md).

`ranch some|full` also keeps a small stable core tool set and lazily loads other schemas when supported. `full` removes unrelated MCP entries from direct provider requests. OpenClaw applies native Code Mode (`auto`/`true`) and restores the captured value on `none`; other host project skills report native schema control unavailable. Use `scripts/tool-context.mjs`; read [references/tool-context.md](references/tool-context.md).

Before sending long retrieved context or tool evidence under `mustard some|full`, use `scripts/query-compressor.mjs`. Segment by semantic units and lock user-named paths, symbols, IDs, numbers, errors, citations, line ranges, and explicit requirements. `some` targets 65% retention; `full` targets 35%. Exceed the budget rather than remove locked evidence. Send compressed context only when validation passes. If evidence is missing, retrieve only that gap for at most one (`some`) or two (`full`) rounds. Telemetry stores hashes and counts, not content. See [references/query-compressor.md](references/query-compressor.md).

Prefer errors, tests, code, configuration, and dependencies over repeated prose. For prose-heavy context only, `scripts/llmlingua-sidecar.mjs` may call an explicitly enabled local LLMLingua-2 install. Use its output only when it is extractive, retains every locked signal, and saves more tokens than its overhead.

When `ketchup` creates a milestone checkpoint, use `scripts/checkpoint.mjs` and [references/checkpoint.schema.json](references/checkpoint.schema.json) to generate and validate it.

Installed native adapters register state-aware compaction hooks. `ketchup some|full` archives the pre-compaction transcript, writes a validated checkpoint, and restores it through host context injection when supported. Native settings are applied when the command changes `ketchup`; `none` restores captured pre-Condiments settings. Inspect `.condiments/native-context/last-apply.json` and `events.jsonl` for exact results.

These hooks also commit reversible dual-form memory: compact checkpoint plus hash-verified raw object. Use `scripts/reversible-memory.mjs expand` only when a required exact fact is absent, verify the raw hash, then `fold`. Never inject raw history by default.

Read [references/native-context.md](references/native-context.md) for host event mappings, pruning profiles, persistence paths, and recovery behavior.

On Codex CLI, `hot some|full` sets a routed project default for the next session. The installer probes for a managed app-server socket once and registers `UserPromptSubmit` routing only when available; it never starts a daemon. `none` restores model, effort, and feature settings. Inspect `.condiments/native-reasoning/last-apply.json` and `events.jsonl`; read [references/native-reasoning.md](references/native-reasoning.md).

For direct Qwen endpoints that explicitly declare hybrid-thinking support, use `scripts/qwen-thinking.mjs`. Under `full`, disable thinking for routine work and cap complex thinking; escalate only for missing quality or blocked work. Do not infer capability from a model name. See [references/research-controls.md](references/research-controls.md).

Normalize provider usage with `scripts/report-usage.mjs`. Keep logical input, uncached input, cache reads, cache writes, reasoning, output, cost, and verified success separate. Never add cache subsets twice when reporting total logical tokens. Never report an omitted cache counter as a measured zero.

For `/cond status`, report the preset, five effective control levels, host, and capability flags. Do not claim a native capability unless an adapter reports it.

Install a host adapter with `scripts/install-adapter.mjs --host <openclaw|claude-code|codex-cli|cursor> --target <workspace-or-repository>`. Read [references/platform-capabilities.md](references/platform-capabilities.md) for host paths, invocation syntax, and confirmed native features.

Optimization levels express control intensity, not guaranteed token savings. Measure raw tokens, cache reuse, cost, and verified task success separately.

## Learned compression controls

For repetitive logs, use `scripts/log-dictionary.mjs`; inject its hash-verified lossless payload only when smaller and bounded. For direct provider calls, `scripts/output-budget.mjs --trained` may apply a smaller cap after eight matching verified samples and must fall back after cap-caused quality loss. See `references/log-dictionary.md` and `references/output-cap-learning.md`.
