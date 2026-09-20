---
name: condiments
description: Apply token-efficiency presets for $condiments and text commands /cond or /condiments.
---

# Condiments for Codex CLI

Reconstruct `/cond` or `/condiments`. For command-only turns, immediately run `scripts/condiments.mjs` with `--host codex-cli`, local `capabilities.json`, and `--prompt-only`; apply the delta and stop. For status or `v|ver|version`, omit `--prompt-only`. Read no references on this path.

For substantive work, resolve the model/workload route from known context or `scripts/savings-policy.mjs`. Baseline adds nothing. For an active route, read `references/policy-core.md`, `references/policy-protocol.md`, and [the Codex host module](references/hosts/codex-cli.md), then only each active control module under `references/controls/`. Do not load `references/policy.md` or inactive controls.

Native components:

- `scripts/skill-disclosure.mjs` selects and audits progressive modules.
- `scripts/zero-token-memory.mjs` indexes and retrieves exact local memory without model calls.
- `scripts/tool-state.mjs` reuses result artifacts and blocks unchanged failed calls.
- `scripts/workflow-pruner.mjs` permits recurring workflow pruning only after paired quality and break-even checks.

State lives in `.condiments/state.json`. Trust native hook receipts before claiming host changes. Correctness and required evidence override token limits. Count all calls, retries, and cache effects when reporting savings.
