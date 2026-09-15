# Phase 5 Live Quality Evaluation

Generated: 2026-09-13T08:43:30.986Z

## Outcome

Codex CLI passed 24/24 quality gates across eight workload classes and three modes.

| Mode | Passed | Input tokens | Output tokens | Total tokens | Tool-result chars | Tool calls | Wall time | Token ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 8/8 | 394,722 | 1,792 | 396,514 | 171,136 | 19 | 134.9 s | 1.000 |
| some | 8/8 | 363,012 | 1,788 | 364,800 | 3,301 | 15 | 131.6 s | 0.920 |
| full | 8/8 | 363,393 | 2,043 | 365,436 | 3,535 | 15 | 138.2 s | 0.922 |

`some` and `full` retain correctness. A token ratio below 1.000 is a net reduction against baseline.

## Workload Results

| Workload | Baseline | `some` | `some` delta | `full` | `full` delta | Quality |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| one-line-fix | 32,605 | 32,881 | +0.8% | 32,974 | +1.1% | 3/3 |
| multi-file-diagnosis | 49,359 | 49,694 | +0.7% | 50,028 | +1.4% | 3/3 |
| repository-exploration | 48,960 | 32,780 | -33.0% | 32,817 | -33.0% | 3/3 |
| test-debug-loop | 66,695 | 67,322 | +0.9% | 67,209 | +0.8% | 3/3 |
| checkpoint-recovery | 49,193 | 49,591 | +0.8% | 49,575 | +0.8% | 3/3 |
| large-command-output | 34,617 | 33,137 | -4.3% | 33,129 | -4.3% | 3/3 |
| architecture-escalation | 49,239 | 32,913 | -33.2% | 32,922 | -33.1% | 3/3 |
| unrelated-task-switch | 65,846 | 66,482 | +1.0% | 66,782 | +1.4% | 3/3 |

## Method

- Synthetic read-only repository with exact, deterministic answers and line-level evidence.
- Eight classes: one-line fix, multi-file diagnosis, repository exploration, test/debug loop, checkpoint recovery, large command output, architecture decision, and unrelated task switch.
- Each class ran independently under native baseline, `/cond some`, and `/cond full`.
- Gates verify answer content plus exact file, line, and source quote. Extra explanatory prose is allowed when the required answer remains present.
- The first matrix hit a temporary Codex usage limit after 11 calls. Incomplete cells were resumed, policies were tuned from observed extra tool rounds, and optimized modes were rerun. This report selects the fixed baseline and latest completed tuned result for each optimized cell.

## Telemetry Limits

Codex CLI exposed input tokens, output tokens, tool calls, tool-result characters, and wall time. It did not expose price, cache-read/write tokens, or reasoning-token detail in these JSONL records, so cost efficiency and cache efficiency remain unverified.

## Host Coverage

- Codex CLI 0.154.0-alpha.6.2: authenticated; full matrix complete.
- Claude Code 2.1.270: installed; live run blocked by `Not logged in · Please run /login`.
- OpenClaw: command unavailable.
- Cursor: command unavailable.

## Decision

Both presets reduced measured tokens while preserving all quality gates.

