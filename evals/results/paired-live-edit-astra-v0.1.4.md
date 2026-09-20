# FIM / Patch-First Live Evaluation

Model: `gpt-6-astra`. Quality gate: **passed**. Every pass requires behavior tests, byte-exact target files, unchanged other files, and no extra files.

| Mode | Workload | Verified | Output tokens | Total tokens | Reply words | Direct edit |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| baseline | discount-boundary | yes | 531 | 49333 | 24 | no |
| baseline | router-ready-route | yes | 1130 | 68210 | 22 | no |
| some | discount-boundary | yes | 595 | 77161 | 15 | no |
| some | router-ready-route | yes | 956 | 78110 | 15 | no |
| full | discount-boundary | yes | 608 | 72315 | 16 | no |
| full | router-ready-route | yes | 873 | 76780 | 13 | no |

| Mode | Output reduction | Total reduction | Quality |
| --- | ---: | ---: | ---: |
| some | 6.623% | -32.097% | yes |
| full | 10.837% | -26.843% | yes |

Observed 421909 tokens under a 1200000-token hard budget with 150000 reserved for delayed accounting. Native FIM stayed disabled because Codex CLI exposes direct patch/file edits but no skill-callable FIM request surface.
