# Tool Schema and Host Context Pruning

`ranch some|full` reduces tool-definition input before tool calls occur. This is separate from large-result interception, which reduces output after a tool runs.

## Request control

Use `scripts/tool-context.mjs decorate` for direct OpenAI or Anthropic requests.

- Detect needed categories from a task hash without persisting task text.
- Keep up to five common search/read/edit/shell/tool-search definitions eager and byte-stable.
- Defer non-core definitions when a tool-search surface exists.
- Under `full`, remove unrelated MCP server entries from that request.
- Keep relevant MCP tools discoverable through tool search.
- Preserve the input object under `none`.

Anthropic uses `tool_search_tool_bm25_20251119` and `defer_loading`. OpenAI supports deferred tool definitions; callers must supply or already include their supported tool-search definition because hosted/BYOT search configuration varies. Without tool search, Condiments does not mark tools deferred and reports `allowlist-only`.

```bash
node scripts/tool-context.mjs decorate --provider anthropic --level full --task "Fix src/cart.ts" < request.json
node scripts/tool-context.mjs measure < request.json
node scripts/tool-context.mjs report --root .
```

## Token split

`measureContextSplit()` reports exact UTF-8 bytes and a `ceil(bytes/4)` token estimate for:

- system/developer content;
- user/conversation context;
- eager core tool schemas;
- other eager tool schemas;
- eager MCP schemas;
- deferred schemas excluded from initial model context.

If a provider supplies exact category counts, store them as `exact_tokens`. A normal usage object exposes total input only, so Condiments records the reported total and an unattributed remainder instead of inventing an exact split. Telemetry under `.condiments/tool-context/events.jsonl` stores counts, flags, fingerprints, and task hashes; it stores no prompt or schema bodies.

## Native hosts

| Host | Native behavior | Restore |
| --- | --- | --- |
| OpenClaw | `some`: `tools.codeMode.enabled="auto"`; `full`: `true`. Normal and MCP tools move behind lazy catalogs. | `none` applies the exact captured `tools.codeMode` value. |
| Claude Code | Project skills cannot change model-visible tool schemas. | Request helper only. |
| Codex CLI | Project skills cannot change built-in/MCP schemas for an active turn. | Request helper only. |
| Cursor | UI/CLI can disable MCP servers, but project skills lack a safe per-turn disable/restore transaction. | Request helper; native flag remains false. |

Sources checked 2026-09-13:

- OpenAI Responses deferred tools and tool search: https://developers.openai.com/api/reference/resources/responses
- Anthropic tool-context management: https://platform.claude.com/docs/en/agents-and-tools/tool-use/manage-tool-context
- Anthropic tool search: https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool
- OpenClaw Code Mode: https://docs.openclaw.ai/tools/code-mode/configuration
- Cursor MCP tool toggles: https://docs.cursor.com/context/model-context-protocol

## Evaluation

Live evaluation uses isolated Codex CLI runs with temporary relevant and noisy MCP servers. Baseline exposes both catalogs. `some` and `full` disable only the unrelated noisy server for the exact task while retaining the required MCP tool. Each run must return the exact opaque value and show the required MCP call. Report actual input/output/total tokens separately from schema byte estimates.

The deterministic Anthropic request-contract preflight is available through `npm run evaluate:tool-context`. It uses 45 tool definitions, requires one database tool, and verifies the exact opaque result in `none`, `some`, and `full`:

| Mode | Initial-visible tool bytes | Reduction | Required-tool quality |
| --- | ---: | ---: | --- |
| `none` | 18,666 | 0% | pass |
| `some` | 755 | 95.955% | pass |
| `full` | 766 | 95.896% | pass |

These are exact UTF-8 schema byte counts, not provider token totals. The initial live attempt on 2026-09-13 was skipped because five-hour usage was 94% consumed and the remaining 6% was below the 15% evaluation reserve. It ran after reset on 2026-09-14:

| Mode | Provider input | Output | Total | Exact result and MCP call |
| --- | ---: | ---: | ---: | --- |
| `none` | 38,379 | 205 | 38,584 | pass |
| `some` | 38,391 | 176 | 38,567 | pass |
| `full` | 38,434 | 219 | 38,653 | pass |

On Codex CLI, `some` cannot alter the active schema set. The isolated `full` run disabled 40 unrelated MCP tools through a host configuration override, but logical input and total tokens stayed flat: `some` reduced total tokens by 0.044% and `full` increased them by 0.179%. Cache-read variance made uncached-input totals unsuitable for a one-run savings claim. The direct OpenAI/Anthropic request controls remain the surfaces where deferred loading and request-scoped MCP filtering change model-visible schema content. See `evals/results/tool-context-evaluation.md` and `evals/results/codex-cli-tool-context-live.md`.

The live runner uses a read-only sandbox and explicitly approves only its local, read-only `lookup_build_code` fixture tool. It does not persist MCP configuration or disable approval checks globally.
