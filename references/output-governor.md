# Adaptive Output Governor

`mayo some|full` selects an output budget from the task before generation only when projected output savings exceed the input-token cost of its directive. `none` leaves provider and host defaults unchanged. If no positive projection is available for a task-aware cap, the request stays at baseline.

| Task | Typical work | `some` output cap | `full` output cap | `some` tools | `full` tools |
| --- | --- | ---: | ---: | ---: | ---: |
| micro | status, confirmation, final direct-edit result | 512 | 128 | 2 | 1 |
| standard | focused answer or edit execution | 2,048 | 512 | 8 | 4 |
| complex | audit, migration, architecture, broad investigation | 4,096 | 2,048 | 16 | 8 |

A successful direct edit suppresses the prose recap. Return only changed paths, test result, and any material failure. The final phase uses 128 tokens and no further tool calls.

The default tool budget is one batched discovery round and one batched verification round. Reuse sufficient existing results. A single exceptional round is allowed only when required evidence is still missing and the caller supplies a written justification.

Required evidence is never discarded to satisfy a cap. If its estimated token count exceeds the normal cap, preserve it in an artifact and link it; when artifacts are unavailable, the governor expands the request cap by the evidence estimate plus 64 tokens.

OpenAI Responses receives both `max_output_tokens` and positive `max_tool_calls`. Anthropic Messages receives `max_tokens`; its API has no equivalent request field in this adapter, so the tool-call limit remains a prompt contract. OpenClaw receives `maxTokens` and a prompt-level tool limit. Host project hooks that cannot rewrite an active request apply the same contract through the installed skill.

The retry resolver ignores cap hits, style issues, and optional omissions by themselves. It retries only when a named required result is absent or invalid, advances 128 → 512 → 2,048, and stops after two retries by default. Callers must pass explicit required-result checks; they must not infer failure from output length alone.

With matching quality-tagged telemetry, the request decorator can replace the static cap with a smaller trained cap. It requires eight verified samples for the same provider, host, level, and task class; uses the 95th percentile plus 20% headroom; and immediately falls back when a cap caused required-result loss. See [output-cap-learning.md](output-cap-learning.md).

Resolve a policy:

```text
node scripts/output-governor.mjs resolve --level full --task "Fix src/cart.ts" --direct-edit --enforce-economics --policy-input-tokens 14 --projected-output-savings-tokens 80
```

Decorate a direct OpenAI request:

```text
node scripts/output-budget.mjs --provider openai --api responses --level full --task-class standard --policy-input-tokens 14 --projected-output-savings-tokens 80 --input request.json
```

When required evidence cannot fit the normal cap, pass its conservative token estimate with `--required-evidence-tokens <count>`.

Evaluate a retry from JSON containing `policy`, `requiredResults`, and `attempt`:

```text
node scripts/output-governor.mjs retry --input verification.json
```
