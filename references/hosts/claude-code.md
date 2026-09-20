# Claude Code host behavior

State lives in `.condiments/state.json`.

- Ranch uses `PostToolUse` to archive exact output and replace oversized compatible results with a bounded envelope. The same hook records compact tool-state evidence.
- Ketchup registers `PreCompact` and `SessionStart(compact)`; native auto-compaction thresholds are 85% under `some` and 70% under `full`.
- Stop telemetry records exposed Anthropic cache reads, writes, and TTL buckets. Project hooks cannot rewrite native request cache controls or active schemas.
- Native edit is available; native FIM is unavailable through this skill surface.

Use direct-request helpers for Anthropic output budgets, cache lineage, lazy tool loading, and reasoning controls. Inspect `.condiments/` receipts before claiming a native change.
