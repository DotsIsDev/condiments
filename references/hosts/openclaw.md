# OpenClaw host behavior

State lives in `.condiments/state.json`.

- Ranch applies Tokenjuice for compatible exec/bash output, native cache retention, and Code Mode lazy catalogs when available. `none` restores captured settings.
- Mayo can apply native `params.maxTokens`; the 120-word `full` contract separately controls the visible final answer.
- Ketchup applies native context pruning and compaction through a dry-run configuration patch, then uses zero-token local retrieval before generated checkpoints.
- Native edit is available; native FIM is unavailable through this skill surface.

Missing CLI, plugin, or capability leaves a pending receipt. Never claim application until `.condiments/*/last-apply.json` says `applied`.
