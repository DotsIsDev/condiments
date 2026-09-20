# Amortized workflow pruning

Use `scripts/workflow-pruner.mjs assess --input <json|->` only for stable recurring workflows. Each candidate contains `stepId`, `action` (`prune` or `downgrade`), `optimizationCost`, and paired samples with baseline/candidate cost and success.

Approval requires:

- at least eight paired samples by default;
- no baseline-success to candidate-failure regression;
- candidate successes at least equal to baseline successes;
- positive savings at the 95% lower confidence bound; and
- expected future runs at least 1.25 times the conservative break-even count.

Costs must use one consistent unit and include all provider calls, retries, cache effects, and verification. Keep the baseline for one-off work and unevaluated task/model combinations.
