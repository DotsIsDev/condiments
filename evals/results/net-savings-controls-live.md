# Paired Live Net-Savings Evaluation

Generated: 2026-09-20T18:29:34.501Z

Same model, effort, fixture, task, and exact-answer gate. Variant order alternates. Usage includes final reader, tools, reasoning, cache effects, and failures. Local retrieval and pruning use zero provider calls.

| Control | Pairs | Baseline quality | Candidate quality | Baseline tokens | Candidate tokens | Reduction | 95% lower saving/pair | Tool calls |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| progressive-disclosure | 8 | 8/8 | 8/8 | 123198 | 116885 | 5.124% | 759.236 | 0 → 0 |
| zero-token-memory | 8 | 8/8 | 8/8 | 154282 | 104616 | 32.192% | 6206.407 | 0 → 0 |
| compact-tool-state | 8 | 8/8 | 2/8 | 231078 | 205199 | 11.199% | -1839.326 | 8 → 6 |

| Workflow step | Deploy | Reason | Break-even runs | Required runs with margin |
| --- | --- | --- | ---: | ---: |
| progressive-disclosure | yes | approved | 317 | 397 |
| zero-token-memory | yes | approved | 42 | 53 |
| compact-tool-state | no | quality-regression | — | — |

Progressive disclosure and zero-token local memory passed the eight-pair quality, confidence, and amortization gates. At 1,000 expected future executions, their measured evaluation cost is repaid after 397 and 53 runs respectively, including the 25% safety margin. Prompt-only compact tool state is rejected: Luna reran the command in six candidate cells, candidate quality was 2/8, and the lower confidence bound was negative. Native or caller-enforced blocking remains eligible for a separate host-specific evaluation.

The account weekly meter moved from 15% to 16% used during the valid and diagnostic runs. The meter may update late and includes the surrounding Codex task.

Budget: 935258/2000000 observed tokens. Complete: true. Quality passed: false.
