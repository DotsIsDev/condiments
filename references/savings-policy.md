# Evidence-Gated Savings Policy

Condiments treats an enabled preset as the maximum requested optimization intensity. Before applying it, classify the workload and select an effective level from paired live evidence.

| Model | Workload | Effective level | Evidence |
| --- | --- | --- | --- |
| `gpt-5.6-luna` | general | `none` | `full` increased total tokens by 10.4% |
| `gpt-5.6-luna` | debugging, tests, or noisy commands with requested `full` | Ranch `full` only | Ranch reduced logical tokens by 20.4–23.2% in the evaluated tool-heavy workloads |
| `gpt-5.6-luna` | exact recall from prior session memory with requested `full` | Ketchup `full` only | Zero-token local retrieval reduced total tokens by 32.2% across eight paired runs with 8/8 exact recall |
| `gpt-5.6-sol` | exact edit, requested `full` | `none` | Two counterbalanced replication repeats passed quality but increased total tokens by 29.6%; the earlier 9.8% saving did not replicate |
| `gpt-5.6-sol` | exact edit, requested `some` | `none` | `some` increased total tokens by 7.6% |
| `gpt-6-astra` | exact edit | `none` | `some` and `full` increased total tokens by 32.1% and 26.8% |
| any unevaluated pair | any | `none` | No savings claim without paired evidence |

Interactive agents apply the small table directly to avoid spending a tool call on routing. Direct provider pipelines use `scripts/savings-policy.mjs` before applying task-level controls:

```text
node scripts/savings-policy.mjs --model gpt-5.6-sol --level full --workload exact-edit
```

Automatic classification is conservative. It selects `exact-edit` only for direct or exact replacement work, `tool-heavy` for debugging, tests, logs, traces, builds, linting, or noisy commands, and `memory-recall` only for explicit prior-session recall. Lookups and simple edits remain `general`. `--force` preserves the caller's requested level when the caller explicitly chooses to bypass evidence routing.

The validated Luna tool-heavy `full` route enables only Ranch. The validated Luna memory-recall `full` route enables only Ketchup and queries exact local memory before generating a checkpoint. Baseline routes inject no Condiments policy. Active routes inject only their small control directive; when a native hook enforces Ranch, the Ranch prompt directive is also omitted.

Mayo activates only when projected output-token savings exceed its policy-input token cost. Cache-aware request construction preserves model, tool order, reasoning, system/prefix, tool behavior, and cache settings when the cached-token loss exceeds the projected saving.

The route reports logical-token expectations only. Continue to measure uncached input, cache reads, output, tool calls, and verified quality separately.
