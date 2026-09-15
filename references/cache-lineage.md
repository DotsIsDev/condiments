# Cache-Lineage Controller

`hot some|full` now checks cache risk before changing model or reasoning effort. Direct OpenAI and Anthropic request wrappers can also protect stable system and tool prefixes.

## Decision

The controller fingerprints model, tools, system instructions, reasoning settings, tool behavior, cache settings, and any caller-declared stable messages. It stores hashes and counts, never prompt or schema bodies.

For each proposed change:

1. Read provider-reported cache-read tokens from the latest compatible request.
2. Estimate input, output, and reasoning-token savings from the proposed route.
3. Compare expected savings with cached tokens at risk.
4. Preserve the old lineage when savings miss break-even.
5. Always permit changes marked `qualityRequired`.

`some` preserves when expected savings are below 75% of the cached prefix. `full` uses a stricter 125% threshold. `none` passes the candidate request through unchanged.

Default automatic restoration covers model and reasoning settings. Tools and system instructions require explicit `preserveFields` because silently restoring them could remove task-required context.

```bash
node scripts/cache-lineage.mjs guard --provider openai --level full --input request-pair.json
node scripts/cache-lineage.mjs estimate --input observed-cache.json
node scripts/cache-lineage.mjs report --root .
```

## Savings meaning

Prompt caching usually does not reduce logical input tokens. It changes repeated prefix tokens from uncached processing to cheaper cached reads. Reports therefore separate:

- logical input tokens;
- cache-read tokens;
- uncached input tokens;
- projected recoverable uncached tokens;
- output and reasoning tokens.

From the 2026-09-14 Codex tool-context matrix, one lower-hit run had 38,391 input tokens, 29,952 cache-read tokens, and 8,439 uncached tokens. Matching the observed 33,024-token stable-prefix hit would shift 3,072 tokens back to cache: 36.402% less uncached input for that turn, 8.002% of logical input. Across all three measured runs, this equals 15.997% of uncached input. Logical input would remain unchanged. This is an observed opportunity, not a guaranteed average. See `evals/results/cache-lineage-estimate.md`.

## Provider behavior

OpenAI Responses supports stable `prompt_cache_key`, explicit prompt-cache breakpoints on supported models, cache diagnostics, context management, `max_output_tokens`, and `max_tool_calls`.

Anthropic documents four complementary controls: tool search, programmatic tool calling, prompt caching, and context editing. Tool definitions precede system content and messages in cache order. Changing tools invalidates the downstream prefix; changing thinking or output effort can also invalidate caches. Deferred tool references preserve the stable prefix.

Sources checked 2026-09-14:

- https://developers.openai.com/api/reference/resources/responses
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/manage-tool-context
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching
- https://platform.claude.com/docs/en/build-with-claude/context-editing
