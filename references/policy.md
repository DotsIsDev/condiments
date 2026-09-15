# Prompt-Only Control Policy

This policy is the portable fallback for environments without native Condiments adapters. Apply the rules for each control's effective level. `full` includes the corresponding `some` rules.

## `mayo`: response output

### `some`

- Answer directly without restating the request.
- Keep routine reports concise and summarize successful command output.
- Report outcome, material evidence, failures, and the next required action.
- Detect edit requests. Prefer the host's direct file-edit tool and return only a short result.
- If direct editing is unavailable, use native FIM when explicitly supported; otherwise return the smallest exact changed block, then a unified diff.
- Classify output as micro, standard, or complex. Under `full`, cap it at 128, 512, or 2,048 tokens. `some` uses the next safer budget.
- Bound tool calls. After a successful direct edit, suppress recap and return only paths, test status, and failures.
- Retry only when an explicit required result is missing or invalid.
- Reserve budget for required semantic blocks before optional rationale, narration, greeting, or recap. Split the task cap across locate, inspect, edit, verify, and report.

### `full`

- Hard cap the final user-facing response at 120 words unless the user explicitly requests a longer format.
- Use simple words and terse grammar. Sentence fragments and dropped articles are acceptable when meaning stays exact.
- Count only the final response. Checkpoints, compaction state, memory, and tool state are internal: never print them or use them to expand the response.
- Put necessary long code, logs, or detailed reports in an artifact and return a brief link.
- Prefer direct edits, patches, diffs, or changed blocks over complete-file reproduction.
- Omit unchanged code and successful routine logs.
- Block complete existing-file reproduction unless the user explicitly requests the full file.
- When exact old/new text is supplied, skip exploratory reads, make one edit, run the requested test once, and stop on success.

Use `scripts/completion-policy.mjs` for deterministic edit detection, strategy selection, FIM envelopes, and output validation. See [completion-policy.md](completion-policy.md).

## `mustard`: context loading

### `some`

- Search filenames and symbols before reading files.
- Read likely files and relevant neighboring definitions or tests only.
- Avoid generated output, dependencies, binaries, and large lockfiles unless required.
- For long evidence, use the verification-aware query compressor. Lock exact paths, symbols, IDs, numbers, errors, citations, and required line ranges before selection.

### `full`

- Locate, rank, fetch exact symbols or line regions, then expand only from evidence.
- Load tools, skills, and supporting references only when needed.
- Bound search results and prefer paths plus match summaries before full content.
- Expand after ambiguity, failed edits, failed tests, or unresolved references.
- Send compressed context only after every requirement validates. Retrieve only missing evidence, with bounded recovery rounds.
- Weight errors, tests, code, configuration, and dependencies above repeated prose; place strongest optional evidence at an attention boundary.
- Use optional learned extractive compression only when capability, locked-signal, and net-saving checks pass.

## `ketchup`: session memory

### `some`

- Create a compact checkpoint after meaningful milestones or under context pressure.
- Preserve the recent conversation tail and exact active constraints.
- Start fresh when work changes to an unrelated domain.

### `full`

- Separate working memory, deduplicated long-term facts, and raw archives.
- Flush memory only when constraints, decisions, files, verification state, or blockers change.
- Preserve exact paths, symbols, commands, errors, hashes, opaque identifiers, and next action.
- Retrieve archived details on demand instead of injecting the archive.
- Never compact or summarize every turn by default.
- Keep dual-form memory: compact summary plus hash-verified raw object. Expand exact raw evidence only when required, then fold it.

Use this checkpoint shape:

```yaml
goal:
constraints:
decisions:
changed_files:
commands_and_results:
known_failures:
opaque_identifiers:
artifact_paths:
next_action:
```

Generate, validate, or render checkpoints with `scripts/checkpoint.mjs`. The canonical JSON schema is [checkpoint.schema.json](checkpoint.schema.json). Keep checkpoints within 16,000 UTF-8 bytes; retrieve archived details rather than enlarging the checkpoint.

## `ranch`: tool execution

### `some`

- Batch independent searches and reads when supported.
- Reuse results already obtained in the task.
- Bound command, test, and search output; preserve actionable failures.
- Keep stable prompt and tool components in deterministic order.
- Use stable provider cache keys and default cache retention where controllable.
- Keep a stable core of common tool schemas eager; load other schemas lazily when the provider supports tool search.

### `full`

- Discover tool schemas lazily and deduplicate equivalent calls.
- Combine lightweight tool chains programmatically when supported.
- Keep stable prompt prefixes unchanged and append dynamic state.
- Request extended provider cache retention where supported.
- Replace superseded results with compact conclusions when the host permits it.
- Prefer one agent; delegate only when context isolation or latency benefit exceeds duplicated context cost.
- Detect task tool categories and disable unrelated MCP schemas for the request when reversible native/provider control exists.

For oversized textual output, use `scripts/compact-tool-result.mjs`. The deterministic envelope retains tool/request metadata, exit status, UTF-8 size, SHA-256 hash, relevant head/tail, bounded error matches, and an absolute artifact path. Identical content reuses the same hash-addressed artifact.

Use `scripts/prompt-cache.mjs` for provider request decoration, cache-counter ingestion, and telemetry reports. Missing cache fields mean unavailable telemetry; they are not a zero hit rate. See [prompt-cache.md](prompt-cache.md).

Use `scripts/cache-lineage.mjs` before changing model, reasoning, tool order, or stable instructions. Preserve the prior model/reasoning settings when projected savings do not repay measured cached-prefix loss. Quality-required escalation always wins. See [cache-lineage.md](cache-lineage.md).

Use `scripts/tool-context.mjs` for task tool detection, deferred-schema request decoration, context-split measurement, and telemetry. OpenClaw Code Mode provides native lazy catalogs; other project adapters report prompt/helper fallback. See [tool-context.md](tool-context.md).

## `hot`: reasoning and model use

### `some`

- Use adaptive or balanced reasoning when supported.
- Avoid deep reasoning for formatting, status, simple lookup, and trivial edits.
- Use stronger reasoning for architecture, concurrency, security, and ambiguous debugging.

### `full`

- Start with the cheapest validated model and lowest suitable reasoning effort when controllable.
- Escalate after two failures for the same suspected cause, conflicting evidence, consequential design uncertainty, integrity-sensitive work, or an explicit user request.
- Use a bounded escalation context and return its conclusion rather than its raw exploration.
- Do not claim a provider setting changed when only prompt-level guidance was applied.
- For declared Qwen hybrid-thinking endpoints, disable routine thinking and bound complex thinking; escalate only for quality failure or blocked work.

## Quality guard

Token reduction never overrides correctness requirements. Verify code changes proportionally to risk. Judge savings by total cost per verified successful task, including retries.
