# Mayo: response output

Read this module only when Mayo is active.

`some`: answer directly, summarize routine success, preserve failures and required evidence, and prefer native file edits over reproducing files. Classify micro/standard/complex work and use adaptive output/tool caps through `scripts/output-governor.mjs` or `scripts/output-budget.mjs`.

`full`: final user-facing response is at most 120 words unless the user requests a longer format. Direct edits report changed paths, verification, and failures. Put required long evidence in an artifact and link it. Never shorten required code, logs, citations, or proof merely to hit the cap.

Apply Mayo only when projected output savings exceed directive input cost. Retry only when a named required result is missing or invalid. For completion strategy and exact-edit safeguards, read [completion-policy.md](../completion-policy.md).
