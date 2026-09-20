# FIM / Patch-First Live Evaluation

Model: `gpt-5.6-sol`. Quality gate: **passed**. Every pass requires behavior tests, byte-exact target files, unchanged other files, and no extra files.

| Mode | Workload | Verified | Output tokens | Total tokens | Reply words | Direct edit |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| baseline | discount-boundary | yes | 3430 | 193142 | 10 | yes |
| baseline | router-ready-route | yes | 1678 | 98713 | 8 | yes |
| some | discount-boundary | yes | 3795 | 179953 | 16 | yes |
| some | router-ready-route | yes | 2419 | 134026 | 7 | yes |
| full | discount-boundary | yes | 2749 | 178002 | 13 | yes |
| full | router-ready-route | yes | 1467 | 85328 | 13 | yes |

| Mode | Output reduction | Total reduction | Quality |
| --- | ---: | ---: | ---: |
| some | -21.652% | -7.58% | yes |
| full | 17.463% | 9.774% | yes |

Observed 869164 tokens under a 1200000-token hard budget with 150000 reserved for delayed accounting. Native FIM stayed disabled because Codex CLI exposes direct patch/file edits but no skill-callable FIM request surface.
