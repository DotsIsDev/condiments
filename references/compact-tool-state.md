# Compact tool state

`scripts/tool-state.mjs` stores tool calls, success state, content hashes, exact local artifacts, facts, and open gaps without replaying raw output into every prompt.

```text
record  --root <workspace> --input <json|->
check   --root <workspace> --input <json|->
inspect --root <workspace> --input <json|->
render  --root <workspace> --input <json|->
```

Inputs require `sessionId`, `turnId`, and a `call` or `command`. Recording also accepts `tool`, `content`, `exitStatus` or `success`, `inputFingerprint`, `facts`, and `openGaps`. Checking returns `reuse` for a successful matching call and blocks an unchanged failed call unless inputs changed or a justification is supplied.

Keep input fingerprints tied to the relevant workspace state. Never reuse evidence after a file, dependency, environment, or command input changes.

The Luna/Codex prompt-only evaluation reran the command in six of eight candidate cells, so prompt text alone is not savings-validated. Default reuse requires native blocking or a caller-enforced `check` decision. Other host/model combinations remain baseline until evaluated.
