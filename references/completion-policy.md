# FIM and Patch-First Completion

`mayo some|full` detects coding edit requests and minimizes generated code. The resolver order is:

1. `direct-edit`: use the host file-edit or patch tool and return a short result.
2. `fim`: when a callable host/provider explicitly reports native FIM and bounded prefix/suffix context exists, generate only the missing middle.
3. `changed-block`: when an exact replaceable symbol or line region is known, emit only that region.
4. `unified-diff`: portable fallback when no direct edit, FIM surface, or exact region is available.

At `full`, exact old/new text is enough evidence to skip exploratory reads. Make one targeted edit, run the requested test once, and stop when it passes. Expand only after edit or test failure.

`none` leaves completion behavior unchanged. Non-edit requests resolve to `answer`.

## Full-file guard

Existing full-file source must not appear in model-visible output unless the user explicitly requests the complete file. `validateCompletionOutput()` detects exact or fenced reproduction. New files and native edit-tool payloads remain host-owned; the guard applies to generated completion text. FIM validation also rejects repeated prefix or suffix text. Unified-diff validation requires file headers and a hunk.

Use the CLI:

```bash
node scripts/completion-policy.mjs detect --task "Fix src/cart.ts"
node scripts/completion-policy.mjs resolve --task "Fix src/cart.ts" --level full --capabilities capabilities.json
node scripts/completion-policy.mjs validate --input completion.json
```

## Capability truth

All four adapters expose a native direct-file-edit tool. No checked skill or project-hook surface exposes native FIM, so `nativeFimCompletion` is `false` for OpenClaw, Claude Code, Codex CLI, and Cursor. Custom/direct-provider adapters may set it only when they can submit prefix/suffix completion requests. The resolver then selects FIM automatically.

Sources checked 2026-09-13:

- OpenAI apply-patch tool: https://developers.openai.com/api/docs/guides/latest-model
- Anthropic text-editor tool: https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool
- OpenClaw apply-patch tool: https://docs.openclaw.ai/tools/apply-patch
- Cursor Agent edit tools: https://cursor.com/docs/agent/overview

## Quality gate

Evaluation must use isolated writable workspaces. A run passes only when its behavior test passes, every expected changed file is byte-exact, and every declared untouched file is unchanged. Savings use total and output tokens from completed turns; failed runs cannot support a savings claim.

The 2026-09-13 Codex CLI/Luna matrix used two isolated edits and baseline/some/full modes. All 6 runs passed. `some` reduced output 13.462% and total tokens 2.082%; `full` reduced output 16.175% and total tokens 2.921%. Current Codex host context made each small edit consume 64K–92K logical tokens, so the evaluator defaults to a 650K cap with 160K delayed-accounting reserve and checkpoints every completed cell for resume.
