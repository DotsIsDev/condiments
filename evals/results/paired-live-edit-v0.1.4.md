# FIM / Patch-First Live Evaluation

Model: `gpt-5.6-luna`. Quality gate: **passed**. Every pass requires behavior tests, byte-exact target files, unchanged other files, and no extra files.

| Mode | Workload | Verified | Output tokens | Total tokens | Reply words | Direct edit |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| baseline | discount-boundary | yes | 2010 | 106635 | 16 | yes |
| baseline | router-ready-route | yes | 1600 | 73792 | 20 | yes |
| some | discount-boundary | yes | 732 | 71964 | 13 | yes |
| some | router-ready-route | yes | 1649 | 110421 | 13 | yes |
| full | discount-boundary | yes | 2250 | 124318 | 13 | yes |
| full | router-ready-route | yes | 1656 | 80103 | 31 | yes |

| Mode | Output reduction | Total reduction | Quality |
| --- | ---: | ---: | ---: |
| some | 34.044% | -1.085% | yes |
| full | -8.199% | -13.298% | yes |

Observed 567233 tokens under a 800000-token hard budget with 120000 reserved for delayed accounting. Native FIM stayed disabled because Codex CLI exposes direct patch/file edits but no skill-callable FIM request surface.
