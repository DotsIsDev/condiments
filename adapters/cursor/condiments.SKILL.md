---
name: condiments
description: Apply token-efficiency presets when the user invokes /condiments or asks to change a Condiments control.
disable-model-invocation: true
---

# Condiments for Cursor

Treat invocation arguments as `/condiments <arguments>`. For command-only turns, immediately run `scripts/condiments.mjs` with `--host cursor`, local `capabilities.json`, and `--prompt-only`; apply the delta and stop. For status or `v|ver|version`, omit `--prompt-only`. Read no references on this path.

For substantive work, resolve the model/workload route from known context or `scripts/savings-policy.mjs`. Baseline adds nothing. For an active route, read `references/policy-core.md`, `references/policy-protocol.md`, and [the Cursor host module](references/hosts/cursor.md), then only each active control module under `references/controls/`. Do not load `references/policy.md` or inactive controls.

Use the bundled disclosure, zero-token-memory, tool-state, and workflow-pruner scripts for the four measured savings controls. State lives in `.condiments/state.json`. Trust native receipts before claiming host changes. Correctness and required evidence override token limits. Count all calls, retries, and cache effects when reporting savings.
