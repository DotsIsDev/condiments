# Ketchup: session memory

Read this module only when Ketchup is active.

Use `scripts/zero-token-memory.mjs` first. Store exact raw events locally with provenance and retrieve a small top-k evidence set without an LLM call. Do not summarize every turn.

Run `scripts/zero-token-memory.mjs decide` before generative consolidation. Skip short sessions. Consolidate only near context pressure, before imminent compaction, or after a semantic pattern recurs at least five times under `some` or four under `full`. Preserve raw pointers and retrieve exact evidence when a summary omits detail.

Use `scripts/checkpoint.mjs decide` before creating a checkpoint. Keep the recent tail, active constraints, changed files, verification state, blockers, and next action. Reversible summary/raw memory remains available through `scripts/reversible-memory.mjs`.

Details: [native-context.md](../native-context.md) and [zero-token-memory.md](../zero-token-memory.md).
