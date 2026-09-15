# Optimal Savings Evaluation

Generated: 2026-09-14T22:56:01.824Z

Usage guard: 14% → 4% five-hour; 24% → 23% weekly. Evaluation-launched model calls: **0**. Account meters may update late and include this active Codex task.

## Lossless repetitive-log compression

| Corpus | Content bytes | Raw JSON | Encoded JSON | Reduction | Exact | Some-visible | Full-visible |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| checkpoint-history | 444946 | 457053 | 243 | 99.9% | yes | yes | yes |
| repetitive-command-output | 166937 | 173044 | 226 | 99.9% | yes | yes | yes |

Reduction is encoded JSON bytes versus equivalent raw JSON. It is not provider token telemetry.

## Telemetry-trained cap shadow holdout

| Group | Train | Holdout verified | Static cap | Selected | Exposure reduction | Would truncate | Gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| openai/codex-cli/some/standard | 24 | 8 | 2048 | 384 | 81.3% | 0 | yes |
| openai/codex-cli/full/standard | 30 | 10 | 512 | 512 | 0.0% | 0 | yes |

A lower cap reduces worst-case exposure. When a response naturally ends below both limits, measured actual token saving is zero. Enable only groups with a passing chronological holdout gate.

## Decision

All groups where learning applied passed the historical holdout quality gate. Keep learned caps opt-in until live direct-provider A/B data exists.

