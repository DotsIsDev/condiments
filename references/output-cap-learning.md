# Telemetry-Trained Output Caps

`mayo some|full` can select a smaller provider output cap from `.condiments/output-budget/events.jsonl`. Selection is scoped to an exact provider, host, optimization level, and task class. Old records without `task_class` are ignored.

The default learner requires eight verified outputs. It takes the nearest-rank 95th percentile of actual output tokens, adds 20% headroom, applies a class floor, and rounds upward to 64 tokens. It applies the result only when it is smaller than the static governor cap. Sparse data, a non-improving candidate, or any recent cap-caused required-result loss returns the static cap.

This is a bounded empirical selector. It never trains from unknown-quality output. A cap hit that still passes verification is treated as censored evidence and prevents the learned cap from falling below that request limit.

Record task class while ingesting provider telemetry:

```text
node scripts/output-budget.mjs ingest --provider openai --host codex-cli --level full --task-class standard --requested 512 --verified --input response.json
```

Inspect all learned groups or select one cap:

```text
node scripts/output-cap-train.mjs train --root .
node scripts/output-cap-train.mjs select --root . --provider openai --host codex-cli --level full --task-class standard --fallback-cap 512
```

Apply learned selection while decorating a request:

```text
node scripts/output-budget.mjs decorate --trained --root . --provider openai --host codex-cli --api responses --level full --task-class standard --input request.json
```

The returned `control.cap_selection` explains whether training applied, its sample count, observed quantile, candidate, fallback, and estimated cap reduction. Provider cap-hit detection and required-result verification remain the quality gate.
