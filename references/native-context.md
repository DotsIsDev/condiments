# Native Context Execution

Condiments installs host lifecycle hooks with each adapter. Hooks read `.condiments/state.json`; they remain inert when effective `ketchup` is `none`.

## Shared behavior

Before native compaction, the hook:

1. Reads the host-provided transcript path.
2. Copies the exact transcript to a SHA-256-addressed archive.
3. Extracts bounded recent goals, constraints, decisions, paths, commands, failures, and opaque IDs.
4. Generates and validates a checkpoint under the 16,000-byte schema limit.
5. Writes `.condiments/checkpoints/<session>.json` and `latest.json` atomically.

Outside a host `PreCompact` event, use `scripts/checkpoint.mjs decide`. `some` triggers at 85% context pressure and `full` at 70%, after at least four turns. Short sessions are skipped unless the caller explicitly requests a checkpoint.

Recent verified assistant results and identifier-shaped exact values are retained even when they are not phrased as decisions. This prevents checkpoint recovery from silently keeping only task instructions.

Hook telemetry is appended to `.condiments/native-context/events.jsonl`. Native-setting application is recorded in `last-apply.json`. Full transcripts are never printed into hook output.

## OpenClaw

`/cond` applies configuration with `openclaw config patch --dry-run`, followed by the owner CLI write when validation succeeds.

| Level | Pruning | Compaction |
| --- | --- | --- |
| `none` | Restore captured baseline | Restore captured baseline |
| `some` | `cache-ttl`, 1 hour | Enabled, 20K recent tokens, mid-turn precheck |
| `full` | `cache-ttl`, 5 minutes | Enabled, 12K recent tokens, 8 MB transcript guard, mid-turn precheck |

If OpenClaw is unavailable, the patch remains pending and no success is claimed. A missing baseline is never replaced or deleted.

## Claude Code

Project hooks are merged into `.claude/settings.json`:

- `PreCompact` for `manual|auto`: persist archive and checkpoint.
- `SessionStart` for `compact`: inject the validated checkpoint with `additionalContext`.

`some` sets `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=85`; `full` sets `70`; `none` restores the value captured before installation.

## Codex CLI

Project hooks are merged into `.codex/hooks.json`:

- `PreCompact` for `manual|auto`: persist archive and checkpoint.
- `PostCompact` for `manual|auto`: record successful lifecycle completion.
- `SessionStart` for `compact`: inject the validated checkpoint when that lifecycle source is emitted.

The adapter enables Codex hooks, toggles `[features].context_management`, and sets `model_auto_compact_token_limit_scope="body_after_prefix"` for the next session. The body scope provides hysteresis after a compacted prefix. `some` permits two compactions per turn with a 10-second cooldown; `full` permits one with a 30-second cooldown. A repeated attempt stops the turn before another paid compaction. `none` restores both captured values. Project hooks require host trust; inspect them with `/hooks`.

Codex dispatches `SessionStart(source=compact)` after a successful compact and before the next model sample. That is the model-context injection point; `PostCompact` itself accepts lifecycle control only.

## Cursor

Project hooks are merged into `.cursor/hooks.json`:

- `preCompact`: persist archive and checkpoint before Cursor summarization.
- `sessionStart`: inject the latest validated checkpoint into a new session.

Cursor's `preCompact` event is observational, so Cursor continues to own summarization. Native smart condensation continues to prune large file context.

## Recovery

To inspect the exact saved state:

```text
.condiments/checkpoints/latest.json
.condiments/native-context/last-apply.json
.condiments/native-context/events.jsonl
```

Use an archive path from the checkpoint only when a missing fact is required. Loading the archive wholesale defeats pruning.

The long-session evaluator installs the adapter into an isolated temporary copy of its fixture. Its report passes only when a real `PreCompact` checkpoint and compact-session restore are observed, the final answer recovers every exact value, and rollout-level usage stays inside token/model-call budgets. Rollout totals include internal compaction calls; CLI turn totals are diagnostic only.

The corrected 2026-09-13 matrix used a two-turn exact-state workload and one forced compaction per mode. Baseline used 55,456 tokens, `some` 55,406, and `full` 56,620. All recovered seven exact values. The 0.1% decrease for `some` and 2.1% increase for `full` are not material token savings; the result validates recovery and bounded compaction behavior.

## Primary references

- OpenClaw: [session pruning](https://docs.openclaw.ai/concepts/session-pruning), [compaction](https://docs.openclaw.ai/reference/session-management-compaction/compaction), and [configuration CLI](https://docs.openclaw.ai/cli/config).
- Claude Code: [hook lifecycle](https://code.claude.com/docs/en/hooks-guide) and [environment variables](https://code.claude.com/docs/en/env-vars).
- Codex: [agent-loop compaction](https://openai.com/index/unrolling-the-codex-agent-loop/) and [compact hook event source](https://github.com/openai/codex/blob/main/codex-rs/hooks/src/events/compact.rs).
- Cursor: [hooks](https://prod.cursor.com/docs/hooks) and [summarization](https://docs.cursor.com/en/agent/chat/summarization).
