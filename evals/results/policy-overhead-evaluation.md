# Policy Overhead Evaluation

Date: 2026-09-13  
Model: `gpt-5.6-luna`  
Workload: inline loyalty-discount maintainer explanation  
Tool calls: zero in every mode  
Quality: 3/3 exact checks passed

| Mode | Policy bytes | Policy token proxy | Input tokens | Output tokens | Reasoning | Total tokens | Total reduction |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 0 | 0 | 13,663 | 313 | 182 | 13,976 | — |
| some | 39 | 10 | 13,678 | 277 | 167 | 13,955 | 0.150% |
| full | 44 | 11 | 13,681 | 265 | 111 | 13,946 | 0.215% |

The policy token proxy is `ceil(UTF-8 bytes / 4)` and is not provider tokenizer telemetry. The actual input increase was 15 tokens for `some` and 18 for `full`, below the 50-token per-turn target.

Compared with the prior isolated Mayo run, where `full` used 472 more input tokens than its baseline, the compact delta reduced measured incremental input to 18 tokens. Human status, capability flags, and native receipts are excluded through `--prompt-only`.

The total-token quality gate passed: both optimized modes used fewer total tokens than baseline while preserving the exact condition, path, line, and equality-boundary explanation. Savings remain small because the fixed Codex host prompt dominates this short workload.
