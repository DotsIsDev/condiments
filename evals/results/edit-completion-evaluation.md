# FIM / Patch-First Live Evaluation

Model: `gpt-5.6-luna`. Quality gate: **passed**. Every pass requires behavior tests, byte-exact target files, unchanged other files, and no extra files.

| Mode | Workload | Verified | Output tokens | Total tokens | Reply words | Direct edit |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| baseline | discount-boundary | yes | 2116 | 79395 | 14 | yes |
| baseline | router-ready-route | yes | 1717 | 80368 | 13 | yes |
| some | discount-boundary | yes | 1741 | 92472 | 10 | yes |
| some | router-ready-route | yes | 1576 | 63965 | 15 | yes |
| full | discount-boundary | yes | 1776 | 76603 | 14 | yes |
| full | router-ready-route | yes | 1437 | 78494 | 12 | yes |

| Mode | Output reduction | Total reduction | Quality |
| --- | ---: | ---: | ---: |
| some | 13.462% | 2.082% | yes |
| full | 16.175% | 2.921% | yes |

Observed 471297 tokens under a 650000-token hard budget with 160000 reserved for delayed accounting. Native FIM stayed disabled because Codex CLI exposes direct patch/file edits but no skill-callable FIM request surface.
