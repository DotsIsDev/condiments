# Provider Reasoning Savings Estimate

Date: 2026-09-18  
Scope: direct OpenAI Responses and Anthropic Messages reasoning governor  
Evidence class: modeled estimate; no provider calls

This estimate isolates adaptive reasoning effort. It does not include savings from output caps, context editing, response-state reuse, cache hits, history elision, prompt compression, or model routing.

## Assumptions

| Input | Assumption |
| --- | ---: |
| Micro request share | 20% |
| Standard request share | 60% |
| Complex request share | 20% |
| Reasoning share of total tokens | 10–30% |
| `low` reasoning relative to `high` | 25–50% |
| `medium` reasoning relative to `high` | 50–75% |
| `high` reasoning relative to `high` | 100% |
| Quality escalations | 0% |

The implemented policy assigns `some` as low/medium/high across micro/standard/complex requests. It assigns `full` as low/low/high.

## Calculation

For `some`, normalized reasoning use is:

```text
0.20 × low + 0.60 × medium + 0.20 × high = 0.55–0.75
```

This gives an estimated reasoning-token reduction of 25–45%. If reasoning is 10–30% of total tokens, the resulting total-token reduction is 2.5–13.5%, rounded to 3–14%.

For `full`, normalized reasoning use is:

```text
0.80 × low + 0.20 × high = 0.40–0.60
```

This gives an estimated reasoning-token reduction of 40–60%. If reasoning is 10–30% of total tokens, the resulting total-token reduction is 4–18%.

| Mode | Normalized reasoning use | Reasoning reduction | Total-token reduction |
| --- | ---: | ---: | ---: |
| `some` | 55–75% | 25–45% | 3–14% |
| `full` | 40–60% | 40–60% | 4–18% |

## External calibration

The [DeepSeek-V4.1-Flash report](../../research/DeepSeek_V41_Tech_Report.md) states that increasing scalar reasoning effort from 25 to 100 produced a 2.0–3.1× increase in average response length across eight reasoning benchmarks. Reversing that comparison corresponds to roughly 50–68% fewer output tokens at effort 25 than effort 100. This supports the expected direction and broad scale of adaptive-effort savings, but it does not validate Condiments' `low`, `medium`, and `high` mappings for OpenAI or Anthropic.

## Limits

This is a sensitivity model, not a benchmark result. Provider implementations may use different effort calibrations; reasoning share varies by workload; quality escalation reduces savings; and lower effort can reduce quality. Replace this range with authenticated provider A/B telemetry when enough verified samples exist.
