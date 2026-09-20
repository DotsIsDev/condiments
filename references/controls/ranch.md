# Ranch: tool execution

Read this module only when Ranch is active.

Reuse sufficient results. Batch independent operations into one discovery round and one verification round. A single exceptional round requires named missing evidence and a written justification. Block exact duplicate calls outside the model prompt.

Use `scripts/tool-state.mjs` to record result hashes and artifact paths. Before repeating a call, check the compact ledger. Reuse a successful artifact; change inputs or justify a retry after failure. Keep raw output outside the prompt and expose a bounded preview plus provenance.

Bound large output with native hooks or `scripts/compact-tool-result.mjs`. Preserve actionable errors. Keep stable prompt/tool prefixes ordered and byte-stable; load tool schemas lazily where supported. Prefer one agent unless measured context isolation or latency gains exceed duplicated context cost.

Apply workflow pruning only to stable recurring work through `scripts/workflow-pruner.mjs`. Require paired quality, a positive 95% lower savings bound, and expected future executions above amortized break-even.

Details: [native-output.md](../native-output.md), [prompt-cache.md](../prompt-cache.md), [tool-context.md](../tool-context.md), [compact-tool-state.md](../compact-tool-state.md), and [workflow-pruning.md](../workflow-pruning.md).
