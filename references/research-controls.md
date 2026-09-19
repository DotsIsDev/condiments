# Research-derived token controls

These controls implement the portable findings summarized in `research/CHINESE_TOKEN_EFFICIENCY_RESEARCH.md`. They default to deterministic local logic and fail back to the uncompressed input when validation fails.

## Reversible dual-form memory (`ketchup`)

`condiments-memory` stores a compact checkpoint summary beside a content-addressed, SHA-256-verified raw artifact. Native compaction hooks commit this pair automatically. Restore injects the summary and a short raw-memory reference. Exact raw bytes are loaded only through `expand`, and `fold` returns to the summary.

The ledger enforces the bounded lifecycle: no repeated identical action, expansions cannot exceed commits, folds cannot exceed expansions, and expand-plus-fold cannot exceed twice the commit count. Summaries above 0.90 token-Dice similarity are deduplicated.

## Significance-aware output (`mayo`)

`condiments-significance-output --input request.json` accepts semantic blocks. Exact values, paths, edits, test results, failures, citations, requested material, and unresolved items are mandatory. Greetings, narration, rationale, and recaps spend only the remaining soft budget. Mandatory blocks may exceed that budget instead of being silently truncated. A provider cap hit plus lost required result fails quality.

The adaptive governor divides its task cap across `locate`, `inspect`, `edit`, `verify`, and `report`. Allocation is deterministic until eight matching verified phase records exist. Direct edits move budget from report to edit and verification. A lower requested cap that produces more actual output is reported as token elasticity and must not train a lower cap.

## Query-conditioned context (`mustard`)

The query compressor weights errors, tests, code, configuration, dependencies, exact query signals, and explicit requirements above generic documents and history. Repetitive optional evidence receives a similarity penalty. Locked evidence remains first; the most useful optional evidence is placed at the end attention boundary. Exact sufficiency checks and bounded missing-evidence recovery still apply.

## Optional LLMLingua-2 sidecar (`mustard`)

`condiments-llmlingua probe` reports availability. Install the Python `llmlingua` package and model separately. Condiments does not download a model during adapter installation. Compression requires an explicit capability flag, extractive token-subsequence output, all locked signals, and estimated savings greater than sidecar overhead. Any failure returns the original text.

## Qwen hybrid thinking (`hot`)

`condiments-qwen-thinking --input request.json` decorates declared Qwen request surfaces. It never infers support from a model name. Callers must declare `hybridThinking`; `thinkingBudget` is separate. `full` disables thinking for routine work, uses 2,048 tokens for complex work, and raises to 4,096 only for a quality-required or blocked attempt. Existing lower budgets remain lower. `none` leaves the request unchanged.

Provider fields are written to `extra_body` for OpenAI-compatible Qwen endpoints or to the request root for a declared native surface. Interactive host-native Qwen control remains unavailable unless that host exposes the request surface.

## DeepSeek reasoning and history (`hot`)

`condiments-deepseek-reasoning --input request.json` decorates explicitly declared DeepSeek V4.1 request surfaces. Callers must declare `reasoningEffort` and, separately, `reasoningHistoryElision` capabilities. `none` is inert.

For `full`, micro work disables thinking, standard work uses `low`, complex work uses `high`, and quality-required or blocked work uses `max`. `some` keeps thinking enabled and uses `low` for micro work, `high` otherwise, and `max` for quality escalation. Existing lower caller effort remains lower unless the caller explicitly marks a quality escalation.

For Chat Completions without tools, the decorator removes prior assistant `reasoning_content` before the latest user turn and reports the estimated input-token reduction. It never removes that history when `tools` is present because DeepSeek requires the full reasoning chain for tool-call continuation. Responses requests use `reasoning.effort`; Chat Completions uses `thinking.type` plus `reasoning_effort`.

This is request-level control for direct DeepSeek calls. A coding host controls it natively only when the host exposes those provider fields.

## Shared provider reasoning (`hot`)

`condiments-reasoning --provider <provider> --input request.json` applies the same task classification and quality escalation policy across OpenAI Responses, Anthropic Messages, Qwen, and DeepSeek. OpenAI receives request-level `reasoning.effort` and optional `previous_response_id`; the governor never generates Codex `configuration_update` items. Anthropic receives `output_config.effort` and, when explicitly supported, server-side thinking cleanup that remains disabled during active tool-result continuation.

When callers provide a previous request and measured cache-lineage metrics, the governor retains earlier reasoning and context settings unless the projected savings clear the cache break-even threshold or quality requires escalation. See [reasoning-governor.md](reasoning-governor.md).
