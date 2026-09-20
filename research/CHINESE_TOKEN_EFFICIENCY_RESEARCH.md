# Chinese Research on Token-Efficient LLM Operation

Research cutoff: 2026-09-14.

Update: [Chinese Research Update: Net Token Savings for Condiments](CHINESE_NET_TOKEN_SAVINGS_UPDATE_2026-09-20.md) applies a stricter full-trajectory and billed-cost screen to newer agent, memory, workflow, and skill-compression research through 2026-09-20.

This review uses primary papers, official project repositories, and official model reports from China-based universities and industrial laboratories. It separates provider-billed token reduction from model-internal memory or latency reduction. Reported percentages apply only to each paper's evaluated models and datasets; they are not Condiments savings claims.

## Main conclusion

The strongest common result is that uniform compression is unsafe. Quality is preserved when the system:

1. allocates budgets by task difficulty and reasoning step;
2. removes low-value content while protecting answer-bearing evidence;
3. verifies correctness before accepting a smaller representation;
4. can restore raw evidence after lossy memory compression; and
5. stops compression when token use or quality stops improving.

These principles support three practical Condiments upgrades: reversible dual-form memory, hierarchical output budgets, and query-aware input allocation.

## Primary evidence

| Work | Chinese institutions | Algorithm | Evidence and result | What it reduces | Condiments relevance |
| --- | --- | --- | --- | --- | --- |
| [Not All Tokens Matter / BINGO](https://aclanthology.org/2026.acl-long.726/) (ACL 2026) | Tsinghua University, Peking University, Alibaba Qwen, Microsoft | Classify reasoning tokens by significance. Penalize insignificant length. Change the significant-token reward from exploration to compression as training converges. | Includes a theorem under stated information and PPO assumptions: significance-aware reward has higher expected reward than a uniform length reward and yields equal or greater length reduction with less accuracy loss. On DeepSeek-R1-Distill-Qwen-7B/GSM8K, 1,001 tokens became 366, a 63% reduction, while accuracy rose 6.1 points. | Generated output tokens after model training. | Replace a uniform `mayo` cap with required/optional semantic classes. Never remove required artifacts, exact values, errors, tests, or citations first. |
| [Thinking Economically / HAB](https://aclanthology.org/2026.findings-acl.1965/) (Findings ACL 2026) | HKUST Guangzhou and HKUST | Hierarchical Adaptive Budgeter: predict problem-level depth, then allocate step-level tokens using perplexity comparisons, adaptive Pareto optimization, and Fisher-information guidance. | Qwen2.5-7B on GSM8K: 283.0 to 211.1 tokens while accuracy rose 93.94% to 95.24%. On MATH500: 482.2 to 327.3 tokens while accuracy rose 79.49% to 82.05%. | Generated output tokens after training. | Learn both a turn cap and sub-budget per work phase. Harder tasks receive larger budgets instead of one global limit. |
| [Beyond Token Length / Step Pruner](https://aclanthology.org/2026.findings-acl.94/) (Findings ACL 2026) | Xi'an Jiaotong University, JD Future Academy | Reward compact correct reasoning steps rather than raw short sequences; give no step reward to incorrect answers; stop training when step merging begins to exploit the reward. | Reports 69.7% token reduction on AIME24. On MATH500, the 7B model used 33% of the base model's tokens at the same accuracy. | Generated output tokens after RL training. | Treat direct edits, tool calls, validation, and explanation as semantic steps. Remove redundant steps, not arbitrary suffix tokens. |
| [O1-Pruner](https://aclanthology.org/2026.findings-acl.697/) (Findings ACL 2026) | Sun Yat-sen University Shenzhen, China Agricultural University, Tsinghua University, DiDi | Pre-sample solutions to estimate baseline accuracy and length, then use normalized RL length rewards to harmonize budget with difficulty. | On DeepSeek-R1-Distill-Qwen-7B, average length fell from 5,184 to 3,677 tokens while average accuracy remained 72.5%. | Generated output tokens after training. | Use verified historical samples as task-class baselines. Do not select a cap from unverified or truncated runs. |
| [LightThinker++](https://arxiv.org/abs/2604.03679) (2026 preprint) | Zhejiang University, Ant Group | Store each reasoning step as `(raw, summary)`. `commit` archives raw content, `expand` restores it, `fold` compresses it again, and `answer` terminates. Lifecycle, symmetry, density, and anti-jitter rules constrain actions. | Standard reasoning: 69.9% lower peak token footprint at baseline accuracy in throughput mode; budget mode reports 45.0% lower peak memory and +2.42 accuracy points. Long-horizon agents held 30k-40k active context after 80 rounds versus vanilla reaching 100k by 60 rounds. | Active context/KV memory, primarily. It does not directly prove lower provider-billed tokens. | Direct blueprint for `ketchup`: raw hash-addressed artifact plus summary, reversible recovery, fold-after-use, loop limits, and similarity dedupe. |
| [Token-Budget-Aware LLM Reasoning / TALE](https://aclanthology.org/2025.findings-acl.1274/) (Findings ACL 2025) | Nanjing University | Estimate a feasible token budget, inject it into the prompt, and select budgets by correctness-aware search. The paper identifies token elasticity: caps that are too small can cause the model to ignore the constraint and generate more. | Across six evaluated datasets, TALE-EP reduced average output from 461.25 to 148.72 tokens (67.8%) while accuracy changed from 83.75% to 81.03%. Across four model families it reports 64.63% average output reduction and 45.30% expense reduction. | Provider-visible output tokens; estimator input and extra call are included in expense. | Add non-monotonic cap search, hysteresis, and exact quality gates to the existing telemetry-trained governor. A cap hit is evidence of possible failure, not success. |
| [Perception Compressor](https://aclanthology.org/2025.findings-naacl.229/) (Findings NAACL 2025) | Tsinghua Shenzhen, Pengcheng Laboratory, Ant Group, Sun Yat-sen University | Retrieve and reorder evidence by query-conditioned perception perplexity; allocate different compression ratios to instruction, question, and demonstrations; iteratively remove low-value tokens while keeping an open-book portion. | On LongBench, average input fell from 10,276 to 1,896 tokens (5.4x) while average score rose from 37.4 to 41.9. On MuSiQue, 2x compression raised F1 from 25.3 to 29.2. | Provider-visible input tokens, with local compressor cost. | Upgrade `mustard` from fixed line selection to query-conditioned segment ranking and unequal budgets. Preserve named symbols and exact evidence outside semantic pruning. |
| [TokenSkip](https://aclanthology.org/2025.emnlp-main.165/) (EMNLP 2025) | Hong Kong Polytechnic University, University of Science and Technology of China | Rank token importance, create CoTs at multiple pruning ratios, and use low-rank fine-tuning so the model learns shortcuts between critical tokens. | Qwen2.5-14B on GSM8K: 313 to 181 reasoning tokens, about 40%, with under 0.4-point performance loss. CommonsenseQA reports 50% CoT reduction without performance loss. The paper also shows that direct truncation at ratio 0.5 caused severe accuracy loss. | Generated output tokens after fine-tuning. | Supports preserving numbers, equations, identifiers, and critical transitions while dropping connective prose. Full method belongs in open Qwen/DeepSeek adapters. |
| [LLMLingua-2](https://aclanthology.org/2024.findings-acl.57/) (Findings ACL 2024) | Tsinghua University, Microsoft | Distill extractive compression labels, then use a bidirectional Transformer token classifier to preserve or discard each input token. The compressor cannot invent new text. | 2x-5x prompt compression with 1.6x-2.9x end-to-end acceleration; compressor runs 3x-6x faster than earlier methods. On MeetingBank, 3,003 tokens became 970 with EM changing from 87.75 to 86.92. | Provider-visible input tokens, minus local compressor overhead. | Optional local `mustard` sidecar for prose and documentation. Code, JSON, diffs, and exact diagnostics still need deterministic locks. |
| [Qwen3 Technical Report](https://arxiv.org/abs/2505.09388) and [official thinking-budget implementation](https://github.com/QwenLM/Qwen3/blob/main/docs/source/getting_started/thinking_budget.md) | Alibaba Qwen | Unified thinking/non-thinking model; `/think`, `/no_think`, and a two-stage thinking budget that halts reasoning at a threshold and resumes final-answer generation from accumulated thought. | The report shows performance rises consistently with larger thinking budgets, establishing a controllable quality-cost frontier. It does not state one universal saving percentage. | Reasoning and output tokens on supported Qwen deployments. | Add exact Qwen capability flags and wire-level controls. Route simple coding tasks to non-thinking; reserve budgets for complex diagnosis and design. |

## Formal support and its limits

BINGO gives the strongest China-linked proof found. Let `Ysig` be answer-significant tokens and `Yinsig` the rest. It compares:

```text
Rlen(Y) = correct(Y) - lambda * |Y|
Rsig(Y) = correct(Y) - lambda * |Yinsig|
```

Under its information bound and a stated lower bound on `lambda`, the paper proves:

```text
E[Rsig(Y)] > E[Rlen(Y)]
```

The practical inference is narrow: penalizing low-value content is safer than penalizing all content equally. The theorem applies to its model, significance assumptions, and PPO update. It does not prove that a prompt-only rule on Codex or Claude preserves arbitrary coding quality.

TALE formalizes budget selection as:

```text
minimize actual_output_tokens(task, budget)
subject to verifier(answer) = pass
```

It uses correctness-aware binary/greedy search, but its token-elasticity results show the response is not globally monotone in the requested budget. Condiments should therefore learn from observed actual tokens and verification results instead of assuming a smaller cap always yields a shorter answer.

## Algorithms to add to Condiments

### 1. Reversible dual-form session memory

For each completed semantic step, store:

```text
memory_item = {
  summary,
  raw_artifact_hash,
  verification_hash,
  dependencies,
  state: active | archived
}
```

Operations:

```text
commit(raw, summary) -> archive raw; inject summary
expand(id)           -> restore exact raw artifact
fold(id)             -> verify raw hash; return to summary
answer(result)       -> require output verifier
```

Adopt LightThinker++ lifecycle constraints:

- every `fold(id)` requires a preceding `expand(id)`;
- no consecutive identical memory actions;
- expansions cannot exceed commits;
- `expand + fold <= 2 * commit` per turn;
- reject near-duplicate summaries, using normalized similarity above 0.90;
- preserve exact numeric, path, symbol, error, and test fields separately from lossy summaries.

This improves current checkpoint recovery and compaction-loop controls. Raw evidence remains recoverable, while only compact summaries stay active.

### 2. Significance-aware output governor

Classify final-output blocks before applying a cap:

```text
required:
  requested artifact or edit
  exact file/path/line/value
  failed checks and unresolved limitations
  test result needed to establish correctness
  citations requested by the task

optional:
  greeting or introduction
  tool narration
  repeated rationale
  unchanged code
  recap after a successful direct edit
```

Budget optional blocks first. Required blocks can exceed the soft cap. If the provider hard cap truncates a required block, fail quality and retry only the missing fields at the next budget arm. This is the black-box semantic analogue of BINGO and Step Pruner.

### 3. Hierarchical adaptive budgeting

Use two layers:

```text
turn_budget = select(task_class, difficulty, host, provider)
phase_budget = allocate(turn_budget, phase, evidence_risk)
```

Suggested coding phases are `locate`, `inspect`, `edit`, `verify`, and `report`. Direct edits may allocate almost nothing to `report`; uncertain debugging allocates more to `inspect` and `verify`. Keep the existing 128/512/2,048 arms as fallbacks, but learn task- and phase-specific values only from verified runs.

Quality-first reward:

```text
reward = verified_success
       - lambda_input * uncached_input_tokens
       - lambda_output * output_tokens
       - lambda_calls * model_calls
       - lambda_retry * retries
```

Reject any learned policy whose paired quality lower bound is below baseline.

### 4. Elastic cap search with hysteresis

For a new task class:

1. start at the historical safe cap;
2. test one smaller arm only after verified success;
3. compare actual output, not requested cap;
4. revert immediately on missing required results, truncation, or retry;
5. require repeated verified wins before lowering the stored cap;
6. apply cooldown after a failure so the controller cannot oscillate.

This directly addresses TALE's observation that an infeasible small budget can increase actual output.

### 5. Query-conditioned input allocator

Split context into typed evidence units: symbol regions, diffs, test failures, log events, documentation paragraphs, and prior summaries. Score each unit:

```text
score(e, q) = semantic(e, q)
            + lexical(e, q)
            + exact_lock(e)
            + dependency(e)
            + failure(e)
            - redundancy(e)
```

Allocate unequal retention:

- user question and explicit constraints: nearly full;
- named symbols, changed lines, failing tests: full and exact;
- relevant implementation regions: high;
- examples, repeated logs, unrelated documentation: low;
- stable cached policy prefix: unchanged.

Reorder high-value evidence toward the beginning and end of the request. Run the existing sufficiency verifier. On failure, retrieve only the missing evidence class.

### 6. Optional local learned compressor

Offer LLMLingua-2 as an opt-in local dependency for prose-heavy context. Gate it by content type and net saving:

```text
apply only if:
  predicted_input_saved
    > compressor_prompt_tokens
    + cache_lineage_loss
    + verification_overhead
    + safety_margin
```

Never send source code, JSON, diffs, stack traces, or exact diagnostics through unconstrained semantic rewriting. Extractive compression is safer, but deterministic evidence locks and post-compression validation remain required.

### 7. Native Qwen reasoning control

Map Condiments levels only when the endpoint declares support:

```text
hot none -> provider default
hot some -> thinking enabled with learned task budget
hot full -> /no_think for simple work; bounded thinking for complex work
```

Do not infer support from a model name alone. Record requested budget, actual reasoning/output tokens, stop reason, quality, and fallback behavior.

## Priority for this repository

1. **Reversible dual-form memory lifecycle** under `ketchup`.
2. **Significance-aware semantic block governor** under `mayo`.
3. **Hierarchical task/phase budget learner** under `hot`.
4. **Perception-style query-conditioned context allocator** under `mustard`.
5. **Optional LLMLingua-2 local sidecar** for prose-heavy inputs.
6. **Qwen request-time hybrid-thinking adapter** for declared endpoints; keep TokenSkip, BINGO, Step Pruner, and O1-Pruner as future weight-access training adapters.

Local implementation status (2026-09-14): priorities 1-5 and the Qwen request-time portion of priority 6 are implemented with deterministic safety tests. Provider-token live evaluations remain pending; no saving claim is added from local byte/token estimates alone.

The first four work with black-box Codex and Claude environments. The full paper methods for BINGO, HAB, Step Pruner, O1-Pruner, TokenSkip, and LightThinker require model weights or fine-tuning and should not be advertised as native capabilities on proprietary APIs.

## Evaluation requirements

For every algorithm, run randomized paired `none`/`some`/`full` coding workloads and record:

1. provider-reported uncached input, cached input, reasoning, and visible output;
2. compressor calls, verifier calls, retries, and tool calls;
3. exact file state, tests, required values, and evidence recovery;
4. requested cap, actual tokens, stop reason, and cap hits;
5. median savings and a quality confidence interval across repeats.

Count all added summaries, dictionaries, checkpoints, estimators, and retries. Claim a saving only when total provider tokens fall and quality remains within the predeclared acceptance bound.
