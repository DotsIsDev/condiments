# FIM / Patch-First Live Evaluation

Model: `gpt-5.6-sol`. Quality gate: **passed**. Every pass requires behavior tests, byte-exact target files, unchanged other files, and no extra files.

| Mode | Workload | Verified | Output tokens | Total tokens | Reply words | Direct edit |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| baseline | discount-boundary | yes | 872 | 102879 | 13 | yes |
| baseline | router-ready-route | yes | 1341 | 85822 | 8 | yes |
| some | discount-boundary | yes | 881 | 86676 | 8 | yes |
| some | router-ready-route | yes | 1870 | 152503 | 12 | yes |
| full | discount-boundary | yes | 802 | 129160 | 8 | yes |
| full | router-ready-route | yes | 808 | 107054 | 7 | yes |

| Mode | Output reduction | Total reduction | Quality |
| --- | ---: | ---: | ---: |
| some | -24.311% | -26.75% | yes |
| full | 27.248% | -25.179% | yes |

Observed 664094 tokens under a 800000-token hard budget with 120000 reserved for delayed accounting. Native FIM stayed disabled because Codex CLI exposes direct patch/file edits but no skill-callable FIM request surface.
