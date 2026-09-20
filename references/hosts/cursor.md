# Cursor host behavior

State lives in `.condiments/state.json`.

- Ranch can replace oversized MCP output through `postToolUse`, archive exact evidence, and record compact tool state. Shell output remains prompt-controlled.
- Ketchup observes `preCompact` and restores checkpoints at `sessionStart`; Cursor owns conversation summarization and file condensation.
- `sessionEnd` records cache counters when exposed. Project hooks cannot rewrite request cache, reasoning, model, or tool-schema settings.
- Native edit is available; native FIM is unavailable through this skill surface.

Use direct-provider helpers only when the caller owns the request pipeline. Do not claim native router or model changes without a receipt.
