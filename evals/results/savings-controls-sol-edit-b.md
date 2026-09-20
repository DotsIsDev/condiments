# FIM / Patch-First Live Evaluation

Model: `gpt-5.6-sol`. Quality gate: **passed**. Every pass requires behavior tests, byte-exact target files, unchanged other files, and no extra files.

| Mode | Workload | Verified | Output tokens | Total tokens | Reply words | Direct edit |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| full | discount-boundary | yes | 1145 | 128379 | 13 | yes |
| full | router-ready-route | yes | 644 | 90015 | 10 | yes |
| baseline | discount-boundary | yes | 1109 | 97534 | 13 | yes |
| baseline | router-ready-route | yes | 704 | 64476 | 13 | yes |

| Mode | Output reduction | Total reduction | Quality |
| --- | ---: | ---: | ---: |
| full | 1.324% | -34.803% | yes |

Observed 380404 tokens under a 800000-token hard budget with 120000 reserved for delayed accounting. Native FIM stayed disabled because Codex CLI exposes direct patch/file edits but no skill-callable FIM request surface.
