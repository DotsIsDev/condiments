---
name: condiments
description: Apply token-efficiency presets for $condiments and text commands /cond or /condiments.
---

# Condiments

Reconstruct `/cond` or `/condiments` from the user message. Command-only turns take the fast path: run `scripts/condiments.mjs` with the command, host, local `capabilities.json` when installed, and `--prompt-only`; apply its compact delta and stop. For status or `v|ver|version`, omit `--prompt-only` and show the result. Version never changes state. Do not read references for command-only turns.

State lives in `.condiments/state.json`. A global preset clears overrides; later commands win. `none` adds no Condiments behavior and does not disable mandatory host behavior.

Before substantive work, resolve model/workload routing from known context or `scripts/savings-policy.mjs`. The requested preset is a ceiling. Baseline injects nothing. With an active route, read [policy-core.md](references/policy-core.md) and [policy-protocol.md](references/policy-protocol.md) once, then only the active modules:

- Mayo: [controls/mayo.md](references/controls/mayo.md)
- Mustard: [controls/mustard.md](references/controls/mustard.md)
- Ketchup: [controls/ketchup.md](references/controls/ketchup.md)
- Ranch: [controls/ranch.md](references/controls/ranch.md)
- Hot: [controls/hot.md](references/controls/hot.md)

Read only the current host module in `references/hosts/`. For direct provider work, read only the helper reference needed by that request. Do not load legacy [policy.md](references/policy.md) unless a combined index is explicitly needed.

The four net-savings controls are native components:

- `scripts/skill-disclosure.mjs`: deterministic module selection and release audit.
- `scripts/zero-token-memory.mjs`: raw provenance indexing and retrieval with zero LLM calls.
- `scripts/tool-state.mjs`: reusable tool-result hashes, artifacts, facts, and failed-call fingerprints.
- `scripts/workflow-pruner.mjs`: paired quality and amortized break-even gate for recurring workflows.

Quality remains mandatory. Include helper calls, cache traffic, retries, and failures when claiming savings. Unknown counters are unavailable, not zero. Preserve required evidence even when it exceeds a cap.
