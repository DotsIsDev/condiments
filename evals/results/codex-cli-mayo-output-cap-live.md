# Codex Mayo Output-Cap Evaluation

Date: 2026-09-13  
Scope: one read-only exact-answer workload, isolated `mayo` control, Codex CLI  
Quality: 3/3 passed

| Mode | Output tokens | Reasoning tokens | Response words | Total tokens | Cap hit |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline | 164 | 29 | 11 | 32,428 | no |
| some | 133 | 0 | 14 | 32,753 | no |
| full | 129 | 0 | 14 | 32,865 | no |

Against baseline, `some` reduced output tokens by 18.9% and `full` by 21.3%. Total tokens increased 1.0% and 1.35% because the fixed Codex input plus Condiments policy outweighed the small 31–35-token output reduction on this tiny task.

Codex CLI project hooks cannot apply a native per-request generation cap, so requested-limit telemetry is unavailable for these live runs. The run validates response behavior, actual output accounting, exact-answer quality, and absence of native cap signals. Direct API and OpenClaw paths carry requested-limit telemetry.

The ceilings were tuned after this run from 8,192/4,096 to 4,096/2,048 for `some`/`full`. Existing live coding results peaked at 408 output tokens, and the corrected long-session recovery run peaked at 797 including reasoning. The 2,048 full ceiling retains more than 2.5 times the largest observed output while reducing runaway-generation room.
