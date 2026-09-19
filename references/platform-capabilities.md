# Platform Capability Matrix

Checked 2026-09-13. A `true` status flag means the installed adapter has confirmed host support it can use when that control is callable. It does not mean every invocation changed the host setting.

| Host | Native invocation | Install root | Confirmed host enhancements |
| --- | --- | --- | --- |
| OpenClaw | `/cond`, `/condiments`, `/skill cond[iments]` | `<workspace>/skills` | Tokenjuice interception; native `maxTokens`; pruning/compaction; native cache retention and counters |
| Claude Code | `/cond`, `/condiments` | `.claude/skills` | Output replacement; compaction checkpoint/restore; cache transcript telemetry |
| Codex CLI | `$cond`, `$condiments`; text aliases trigger implicitly | `.agents/skills` | Pre-tool large-file guard; compaction/context management; native model/reasoning routing; current cache/reasoning telemetry |
| Cursor | `/cond`, `/condiments` | `.cursor/skills` | MCP result replacement; compaction; cache-field capture when exposed |

All four hosts provide native file-edit tools, so `direct-edit=yes`. Their public skill/project-hook surfaces do not expose a callable FIM request, so `fim=no`. Unified diffs remain the portable fallback. See [completion-policy.md](completion-policy.md).

All adapters provide the prompt-level adaptive output governor. Direct OpenAI Responses requests can enforce both output and tool-call caps. DeepSeek Responses and Chat Completions can enforce output caps; DeepSeek ignores `max_tool_calls`, so tools retain the policy contract. Anthropic, OpenClaw, and interactive host fallbacks also enforce tool counts through the policy contract where no native request field exists. See [output-governor.md](output-governor.md).

All adapters bundle lossless repetitive-log dictionary encoding and telemetry-trained output-cap selection. Dictionary payloads are injected only when smaller and bounded. Learned caps apply only in direct provider wrappers after matching verified telemetry; interactive hosts retain their documented native or prompt fallback. See [log-dictionary.md](log-dictionary.md) and [output-cap-learning.md](output-cap-learning.md).

All adapters bundle the portable verification-aware query compressor. It reduces caller-supplied evidence before a model request and needs no native host hook. Exact provider token counts remain caller-supplied; otherwise its byte-based count is labeled estimated. See [query-compressor.md](query-compressor.md).

All adapters also bundle reversible dual-form memory, significance-aware semantic output, hierarchical phase budgets, query-conditioned type allocation, an optional LLMLingua-2 bridge, and a shared capability-gated reasoning governor. Direct OpenAI Responses requests support adaptive effort and response-state reuse. Direct Anthropic Messages requests support adaptive effort and server-side thinking cleanup while preserving active tool loops. Qwen and DeepSeek retain their provider-specific thinking controls; DeepSeek removes prior reasoning history only when no tools are present. Interactive native provider controls report unavailable until their runtime surfaces are explicitly confirmed. See [reasoning-governor.md](reasoning-governor.md) and [research-controls.md](research-controls.md).

Hooks are state-aware and perform no checkpoint work under `ketchup none`. Host settings changed by Condiments are restored from a baseline receipt when `none` is selected. See [native-context.md](native-context.md).

Large-output interception is state-aware under `ranch`. See [native-output.md](native-output.md) for thresholds, exact replacement scope, recovery, and unsupported surfaces.

Prompt-cache control and telemetry are also state-aware under `ranch`. See [prompt-cache.md](prompt-cache.md). Missing provider counters are reported as unavailable, never as zero cache reuse.

Provider output budgets are state-aware under `mayo`. Direct OpenAI Responses, Anthropic Messages, DeepSeek Responses/Chat Completions, and OpenClaw request objects can be decorated with native token fields. Only OpenClaw exposes an equivalent workspace-level setting to the installed adapter. See [output-budget.md](output-budget.md).

Codex model and reasoning routing is state-aware under `hot`. See [native-reasoning.md](native-reasoning.md). A route counts as switched only when Codex returns an applied native update.

Tool-schema pruning is state-aware under `ranch`. Direct OpenAI/Anthropic requests support deferred schemas and request-scoped MCP filtering through the bundled helper. OpenClaw applies native Code Mode with baseline restore. Claude Code, Codex CLI, and Cursor project skills cannot alter the active turn's model-visible schema set and report native control unavailable. See [tool-context.md](tool-context.md).

Cache-lineage guarding is available to direct OpenAI and Anthropic request wrappers. Codex can guard active model/reasoning switches only when its managed app-server route is available; installation sets the native capability flag from a live probe. Claude Code project hooks provide cache telemetry but cannot rewrite active provider request settings. See [cache-lineage.md](cache-lineage.md).

`active-turn-route` is discovered at installation. It is `yes` only when `codex app-server proxy` completes model discovery through an existing managed socket. Condiments never starts that daemon.

Primary documentation:

- OpenClaw skills and commands: https://docs.openclaw.ai/tools/creating-skills and https://docs.openclaw.ai/tools/slash-commands
- Claude Code skills: https://code.claude.com/docs/en/skills
- Codex skills: https://developers.openai.com/codex/skills
- Cursor Agent Skills: https://prod.cursor.com/docs/skills
