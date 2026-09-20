# Codex CLI host behavior

State lives in `.condiments/state.json`. Trusted hooks require repository trust.

- Ranch uses `PreToolUse:Bash` to block oversized whole-file reads, duplicate calls, repeated recorded results, and excess tool rounds. Codex cannot replace native `PostToolUse` output; use the result envelope or tool-state recorder explicitly when needed.
- Ketchup registers `PreCompact`, `PostCompact`, and `SessionStart(compact)` and enables native `context_management` for the next session.
- Stop telemetry records exposed cache and reasoning counters. Codex project hooks cannot rewrite provider cache controls or active tool schemas.
- Hot writes a next-session model/reasoning default from advertised Codex capabilities. Active-turn routing requires an installed managed app-server hook and an `applied` receipt.
- Native patch/file editing is available; native FIM is unavailable through this skill surface.

Inspect native receipts under `.condiments/` before claiming that a host setting changed.
