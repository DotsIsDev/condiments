# Paired Live Evaluation: Condiments v0.1.4

Generated: 2026-09-20

## Executive finding

The evaluated v0.1.4 presets do not establish a general token-savings claim on current Codex models. Quality remained high, but the global `some` and `full` policies usually caused more tool rounds and more total tokens. Results vary materially by model and workload.

The strongest positive result was `full` on exact edits with `gpt-5.6-sol`: all quality gates passed while total tokens fell 9.8% and output tokens fell 17.5%. This did not generalize to Luna or Astra. Native compaction recovery worked reliably, but its checkpoint overhead did not reduce total tokens in the compact two-turn workload.

## Usage and scope

- Weekly Codex allowance moved from 5% used to 11% used: **6 percentage points consumed**, leaving 89%.
- The user authorized approximately 20 percentage points. The run stopped early because the main signals converged; spending the remaining allowance on duplicate cells had low expected value.
- Approximately **249 model calls** were launched across valid evaluations, evaluator-regression discovery, and memory compaction calls.
- Models: `gpt-5.6-luna` low, `gpt-5.6-sol` medium, and `gpt-6-astra` medium.
- Gates covered exact answers, exact files and unchanged bytes, behavior tests, package tests, exact file/line/quote evidence, required commands, checkpoint recovery, and task-switch relevance.

## Evaluator defect found and fixed

The first 72 Phase-5 calls exposed a harness regression: optimized requests included compact `<cond>` state deltas without the stable protocol prefix that defines their semantics. Those calls are excluded from all savings conclusions.

The provider evaluator now prepends `renderPolicyPrefix()` before each optimized state delta. A regression test verifies the prefix. The long-session evaluator also accepts fixed `--model` and `--effort` overrides so modes can be compared on the same route.

## Main read-only matrix

Three counterbalanced repeats used eight repository workloads on `gpt-5.6-luna` low. Mode order rotated across repeats to reduce warm-cache and position bias.

| Mode | Quality | Total tokens | vs baseline | Uncached input | vs baseline | Output | Tool calls |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 22/24 | 1,140,344 | — | 114,076 | — | 9,436 | 78 |
| `some` | 21/24 | 1,287,441 | **+12.9%** | 146,347 | **+28.3%** | 10,598 | 85 |
| `full` | 21/24 | 1,259,416 | **+10.4%** | 168,507 | **+47.7%** | 10,589 | 87 |

The presets added 7–9 tool calls across 24 cells. Failures were exact-evidence misses in checkpoint recovery, architecture citation, or unrelated-task switching. Neither optimized mode improved aggregate quality.

Results differed by workload. `some` reduced total tokens for large-command output; `full` reduced them for checkpoint recovery and test debugging. One-line fixes, repository exploration, and task switches commonly regressed.

## Control isolation

Four-workload isolated matrices identified `ranch` as the main prompt-level regression.

| Control | Mode | Quality | Total-token delta | Uncached-input delta | Tool-call delta |
| --- | --- | ---: | ---: | ---: | ---: |
| Mustard | `some` | 4/4 | **−3.5%** | +238.2% | −1 |
| Mustard | `full` | 4/4 | +3.2% | +56.4% | 0 |
| Ranch | `some` | 4/4 | **+39.4%** | +203.3% | +4 |
| Ranch | `full` | 4/4 | **+35.2%** | +78.1% | +4 |

Mustard's logical-token result was mixed because cache reuse changed sharply. Ranch consistently prompted extra tool rounds and longer execution without improving the quality gate.

## Cross-model read-only spot checks

Four difficult workloads ran once per mode on Sol and Astra.

| Model | Mode | Quality | Total-token delta | Uncached-input delta | Tool-call delta |
| --- | --- | ---: | ---: | ---: | ---: |
| Sol medium | `some` | 3/4 | **+99.1%** | +59.5% | +17 |
| Sol medium | `full` | 4/4 | **+126.0%** | +89.6% | +17 |
| Astra medium | `some` | 4/4 | +7.3% | **−16.3%** | +1 |
| Astra medium | `full` | 4/4 | **−8.1%** | +57.5% | −1 |

Astra `full` reduced logical tokens while increasing uncached input. This demonstrates why logical, cached, and uncached tokens must remain separate. Sol's extra tool rounds show that compact policy wording is not equally effective across models.

## Exact-edit matrix

Each model edited two isolated repositories. Passing required byte-exact target files, unchanged non-target files, no extra files, package tests, behavior tests, and bounded replies. All 18 cells passed.

| Model | Mode | Total-token delta | Output-token delta | Quality |
| --- | --- | ---: | ---: | ---: |
| Luna low | `some` | +1.1% | **−34.0%** | 2/2 |
| Luna low | `full` | +13.3% | +8.2% | 2/2 |
| Sol medium | `some` | +7.6% | +21.7% | 2/2 |
| Sol medium | `full` | **−9.8%** | **−17.5%** | 2/2 |
| Astra medium | `some` | +32.1% | **−6.6%** | 2/2 |
| Astra medium | `full` | +26.8% | **−10.8%** | 2/2 |

Output compression sometimes worked while total tokens increased. Tool and input cost dominated short final replies.

## Focused answer output

One no-tool maintainer answer ran on Luna. All modes passed. Baseline used 13,610 total tokens and 195 output tokens; `some` used 13,663 and 233; `full` used 13,626 and 193. `full` reduced output only 1.0% and increased total tokens 0.1%. One sample is directional, not a savings estimate.

## Causal memory and compaction matrix

Three repeats per mode used the same model (`gpt-5.6-luna`), effort (`low`), prompts, and compaction threshold. All nine runs recovered exact state. Every optimized run verified native checkpoint and restore hooks.

| Mode | Quality | Total tokens | vs baseline | Uncached input | vs baseline | Output |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 3/3 | 136,277 | — | 75,682 | — | 691 |
| `some` | 3/3 | 142,844 | +4.8% | 82,158 | +8.6% | 782 |
| `full` | 3/3 | 143,405 | +5.2% | **72,582** | **−4.1%** | 935 |

The recovery feature is reliable. This short forced-compaction workload does not show total-token savings. Full mode trades 4.1% less uncached input for 35.3% more output and 5.2% more total tokens.

## Conclusions

1. **Do not expand the README's general savings claims from these runs.** Current live evidence does not support a universal reduction for global presets.
2. **Retune Ranch first.** Its compact directive needs an explicit call-count contract: reuse prior evidence, never rerun a successful command, batch only independent calls, and stop immediately after the required result validates.
3. **Gate task policies by workload and model.** Sol exact edits benefited from `full`; Luna and Astra did not. A single global prompt is too coarse.
4. **Optimize total verified-task cost, not reply length.** Shorter answers regularly coincided with higher total tokens.
5. **Keep cache metrics separate.** Logical-token reductions can hide higher uncached input, as Astra `full` demonstrated.
6. **Keep reversible memory for correctness, not savings marketing.** Exact recovery passed 9/9, while token savings remained unproven.
7. **Do not enable learned caps or phase-share training by default yet.** The live sample shows model-dependent and workload-dependent behavior.

## Recommended next implementation

- Replace Ranch's broad `batch/cache/dedupe` hint with deterministic stop/reuse rules and a hard prompt-level tool-call budget.
- Add model/task routing for edit versus retrieval workloads.
- Add repeated counterbalanced matrices to the release gate; fail a savings claim when optimized quality is lower or total/uncached tokens regress materially.
- Add a checkpoint-evidence retrieval rule for exact final-line citations.
- Rerun the same matrices after tuning before publishing another savings estimate.

## Limits

- Luna has three counterbalanced repeats; Sol and Astra read-only checks are single-repeat spot checks.
- Account usage is rounded and may update late. Measured movement was 6 weekly percentage points.
- npm pricing/cost was unavailable; results report tokens, tool calls, wall time, and quality.
- Independent sessions can still benefit from provider prefix caching. Both logical and uncached input are therefore reported.
- The invalid pre-fix evaluator runs consumed usage but are excluded from performance claims.

## Raw artifacts

Raw JSON remains under `evals/results/paired-live-*.json`. Key human-readable edit reports:

- `paired-live-edit-v0.1.4.md`
- `paired-live-edit-sol-v0.1.4.md`
- `paired-live-edit-astra-v0.1.4.md`
