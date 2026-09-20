# Savings Controls Live Evaluation: Condiments v0.1.4 + Unreleased

Generated: 2026-09-20

## Finding

The new controls improve policy safety, but they do not yet establish reliable automatic token savings. Evidence-gated routing now correctly selects baseline for every evaluated or unknown model/workload pair. Forced Ranch `full` reduced aggregate logical tokens and tool calls on Luna, but increased uncached input and regressed simple workloads. Mayo reduced answer output while slightly increasing total tokens. The earlier Sol exact-edit saving failed two replication repeats.

## Usage and scope

- Weekly allowance moved from 12% used to 13% used: **1 percentage point consumed**, leaving 87%.
- **38 live model calls**: 24 Ranch, 4 Mayo explanation, and 10 Sol exact-edit calls.
- Models: `gpt-5.6-luna` low and `gpt-5.6-sol` default evaluator effort.
- All live quality gates passed.
- Deterministic checks covered routing, cache-prefix stability, checkpoint pressure, output caps, required evidence, result reuse, and exceptional-round justification.

## Ranch: three paired repeats

Four Luna read-only workloads ran three times. Mode order was counterbalanced across repeats. The prompt explicitly forced Ranch so the conservative savings router did not turn it off.

| Mode | Quality | Total tokens | Uncached input | Output | Tool calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | 12/12 | 833,527 | 89,290 | 6,957 | 53 |
| Ranch `full` | 12/12 | 788,939 | 116,356 | 6,727 | 49 |
| Change | — | **5.3% less** | **30.3% more** | **3.3% less** | **4 fewer** |

The new one-discovery/one-verification contract repaired the earlier tool inflation: the previous Ranch spot check used four extra calls and 35.2% more total tokens; this matrix used four fewer calls and 5.3% fewer logical tokens. The result still varies sharply by task:

| Workload | Full vs baseline total tokens | Tool-call change |
| --- | ---: | ---: |
| One-line lookup | **49.0% more** | +3 |
| Repository exploration | **19.9% more** | +1 |
| Test debugging | **20.4% less** | −4 |
| Large noisy command | **23.2% less** | −4 |

Ranch is promising for tool-heavy debugging and noisy-output work, but unsafe as a general preset. Higher uncached input also prevents a cache-cost savings claim.

## Mayo explanation cap

One no-tool explanation ran twice with counterbalanced mode order.

| Mode | Quality | Total tokens | Uncached input | Output | Tool calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | 2/2 | 27,150 | 875 | 163 | 2 |
| Mayo `full` | 2/2 | 27,603 | 1,344 | 147 | 2 |
| Change | — | **1.7% more** | **53.6% more** | **9.8% less** | unchanged |

The cap improves visible brevity. On tiny answers, policy-input overhead remains larger than output savings.

## Sol exact-edit replication

Two new repeats used two isolated exact-edit workloads. The second repeat reversed mode order. Every cell passed byte-exact targets, unchanged-file checks, no-extra-file checks, package tests, and behavior tests.

| Mode | Quality | Total tokens | Uncached input | Output | Tool calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | 4/4 | 350,711 | 41,277 | 4,026 | 15 |
| `full` | 4/4 | 454,608 | 49,801 | 3,399 | 23 |
| Change | — | **29.6% more** | **20.7% more** | **15.6% less** | **8 more** |

The earlier single repeat reported 9.8% lower total tokens. That saving did not replicate. The router therefore demotes Sol exact edits to baseline.

## Deterministic control gates

- Router: evaluated Luna, Sol, Astra, and unknown pairs all select baseline; explicit force remains available.
- Checkpoints: a two-turn session and 60% pressure skip; full at 72% and some at 86% create checkpoints.
- Cache assembly: changing tasks retain the same byte-exact prefix fingerprint; duplicate stable instructions are removed; task data remains last.
- Output governor: exact-edit final cap is 128 tokens; explanation cap is 512; 700 required evidence tokens expand safely to 764.
- Tool rounds: the first discovery round is allowed, sufficient prior results are reused, an unjustified extra round is rejected, and one justified missing-evidence exception is allowed.

## Decision

1. Keep all automatic savings routes on baseline.
2. Do not claim general or expected total-token savings.
3. Keep Ranch available through explicit force for evaluation, not default routing.
4. Add workload classes for tool-heavy debugging and noisy-output work before another Ranch trial.
5. Judge future releases by total and uncached input together; shorter output alone is insufficient.

Current expected automatic saving is **0% by design**. The router prevents measured regressions while narrower positive routes are developed.

## Raw artifacts

- `savings-controls-ranch-a.json`
- `savings-controls-ranch-b.json`
- `savings-controls-ranch-c.json`
- `savings-controls-mayo-a.json`
- `savings-controls-mayo-b.json`
- `savings-controls-sol-edit.json`
- `savings-controls-sol-edit-b.json`
- `savings-controls-deterministic.json`
