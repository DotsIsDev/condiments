# Codex Long-Session Evaluation

Quality gate: **passed**. All modes recovered the seven exact values after native compaction. This compact recovery workload shows 0.09% for `some` and -2.099% for `full`; differences this small do not establish material savings.

| Mode | Verified | Exact recovery | Authoritative tokens | Model calls | Compactions | Token reduction |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | yes | yes | 55456 | 3 | 1 | — |
| some | yes | yes | 55406 | 3 | 1 | 0.1% |
| full | yes | yes | 56620 | 3 | 1 | -2.1% |

Rollout-level totals include internal compaction calls. CLI turn totals are diagnostic only. Routes are the resolved preset routes, so this is an end-to-end preset comparison rather than an isolated context-policy experiment.
