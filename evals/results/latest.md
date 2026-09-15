# Three-Repository Condiments Evaluation

Generated: 2026-09-13T05:51:51.256Z

Deterministic offline context-volume proxy. It does not measure provider tokens, cost, latency, or model correctness.

Method: baseline loads every eligible text file; some loads query-matching files plus root guidance; full loads merged ±8-line regions around every exact query match. Generated/dependency directories, lockfiles, binaries, and files over 2 MB are excluded. Token counts use UTF-8 bytes / 4.

| Repository | Query | Mode | Files | Regions | Context bytes | Est. tokens | Reduction | Match recall |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dots Launcher | IconService | baseline | 14 | 14 | 55431 | 13858 | 0.00% | 100.00% |
| Dots Launcher | IconService | some | 3 | 3 | 23491 | 5873 | 57.62% | 100.00% |
| Dots Launcher | IconService | full | 2 | 3 | 18046 | 4512 | 67.44% | 100.00% |
| Hoop Metric | LeagueRepository | baseline | 98 | 98 | 613912 | 153478 | 0.00% | 100.00% |
| Hoop Metric | LeagueRepository | some | 2 | 2 | 79157 | 19790 | 87.11% | 100.00% |
| Hoop Metric | LeagueRepository | full | 2 | 15 | 21585 | 5397 | 96.48% | 100.00% |
| Anaheim Project | APIClient | baseline | 562 | 562 | 4778967 | 1194742 | 0.00% | 100.00% |
| Anaheim Project | APIClient | some | 5 | 5 | 40090 | 10023 | 99.16% | 100.00% |
| Anaheim Project | APIClient | full | 5 | 13 | 11153 | 2789 | 99.77% | 100.00% |

Match recall only verifies that selected context retains every exact query occurrence. Provider-backed evaluation is still required for correctness, actual token use, cost, cache reuse, and latency.
