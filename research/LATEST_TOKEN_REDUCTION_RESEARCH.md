# Latest Algorithmic Research for Input and Output Token Reduction

Research cutoff: 2026-09-14. This review uses primary papers only. It prioritizes 2026 peer-reviewed work, then recent accepted papers and preprints when they provide a concrete algorithm and quantitative evaluation.

See [Chinese Research on Token-Efficient LLM Operation](./CHINESE_TOKEN_EFFICIENCY_RESEARCH.md) for a China-focused review and Condiments implementation mapping.

“Proof” has two different meanings in this literature:

- **Formal guarantee**: theorem, assumptions, and mathematical proof.
- **Empirical evidence**: benchmark experiments and ablations. This supports a measured claim on the tested setup, but does not prove the same saving on Codex, Claude, or coding repositories.

No paper found formally guarantees end-to-end token savings and unchanged quality for arbitrary proprietary coding agents. Two papers provide useful formal results; the remaining recommendations have peer-reviewed empirical evidence.

## Highest-value findings

| Paper | Date/status | Side | Algorithm | Evidence | Reported result | Condiments fit |
| --- | --- | --- | --- | --- | --- | --- |
| [Not All Tokens Matter: Towards Efficient LLM Reasoning via Token Significance in Reinforcement Learning](https://aclanthology.org/2026.acl-long.726/) | ACL 2026 | Output/reasoning | BINGO separates significant and insignificant reasoning tokens, penalizes only the latter, and changes the significant-token length reward as training converges. | **Formal theorem plus peer-reviewed experiments.** Under its assumptions, the significance-aware reward has higher expected reward than uniform length penalty and yields equal or greater length reduction with smaller accuracy degradation. | Up to **63% shorter** response, 366 versus 1,001 tokens on GSM8K, with **+6.1 accuracy points**. At peak accuracy on MATH500, variants used about 20% of base-model tokens. | Replace uniform truncation with required-result/significance classes. Applicable at semantic-block level for black-box APIs; token-level implementation requires model access or training. |
| [Fundamental Limits of Prompt Compression: A Rate-Distortion Framework for Black-Box Language Models](https://arxiv.org/abs/2407.15504) | 2024 preprint; latest formal black-box result found | Input | Expresses prompt compression as a rate-distortion linear program, derives its dual, and gives an algorithm that computes the optimum for the formal setting. | **Formal theorems and proofs.** The paper proves the primal/dual formulation and Algorithm 1’s optimum under its finite formal model. | Shows a large gap between current compression and the formal optimum; query-aware compression is critical. It does not give a universal production saving. | Make every compression decision task/query-aware. Use an empirical distortion proxy: exact tests, required facts, paths, IDs, line evidence, and citations. |
| [IterCOMP: Reasoning-aware Adaptive Prompt Compression for Multi-hop Question Answering](https://aclanthology.org/2026.acl-long.1559/) | ACL 2026 | Input | Split documents into evidence segments; combine semantic and lexical relevance; check answerability; generate a missing-information question; iterate up to a bound. Training-free. | Peer-reviewed experiments on MuSiQue, 2WikiMultiHopQA, and HotpotQA. | Compressed prompts retained **14%, 37%, and 19%** of raw-document tokens, or about **86%, 63%, and 81% input reduction**, while obtaining the best EM/F1 in its comparison. | Strong basis for a query-aware tool/context compressor and missing-evidence recovery loop. Code tasks require stronger exact-symbol and test-evidence locks. |
| [Efficiency vs. Verifiability in Evidence-Aware RAG](https://aclanthology.org/2026.customnlp4u-1.19/) | ACL workshop 2026 | Input quality guard | Preserve top-ranked evidence, then compress lower-ranked passages; prioritize sentences with query overlap and digits. | Peer-reviewed controlled study. | At 20% retention, answer metrics fell only **2–4 points**, but citation recall/precision fell **39–52 points**. Hierarchical evidence retention kept citation recall 49.80 versus 50.10 and precision 62.55 versus 63.71, though compression was mild. | Required warning for Condiments: answer-only validation is unsafe. Lock cited lines, error text, numbers, identifiers, and test evidence before compression. |
| [SCOPE: A Generative Approach for LLM Prompt Compression](https://arxiv.org/abs/2508.15813) | COLM 2026 accepted; revision 2026-08-20 | Input | Semantically chunk input, rewrite each chunk, handle outliers, assign dynamic ratios, prioritize chunks, and preserve keywords. Training-free. | Accepted-paper empirical evaluation on QA and summarization. | Reports better compression quality and stability than selective-compression baselines, especially at high ratios; the abstract does not support one universal percentage. | Prefer coherent chunk rewriting over deleting isolated code/log tokens. Keep exact spans outside rewriting. |
| [Lossless Prompt Compression via Dictionary-Encoding and In-Context Learning](https://arxiv.org/abs/2604.13066) | 2026 preliminary preprint | Input | Find repeated multi-scale subsequences, replace them with dictionary symbols, and accept a replacement only when token savings exceed dictionary overhead. | Empirical; no theorem found. Evaluated with Claude 3.7 Sonnet on LogHub 2.0. | Up to **80% compression** on repetitive data; template exact match above **0.99** and algorithmic decompression similarity above **0.91** at 60–80% compression. | Directly useful for repetitive logs, stack traces, generated tables, and repeated tool output. Must compare tokenizer counts and verify dictionary round-trip before use. |
| [Stop When Enough: Adaptive Early-Stopping for Chain-of-Thought Reasoning](https://aclanthology.org/2026.acl-long.1256/) | ACL 2026 | Output/reasoning | REFRAIN uses a two-stage redundancy discriminator and sliding-window UCB bandit to adjust stopping thresholds by task difficulty. Training-free. | Peer-reviewed experiments across four benchmarks and two model families. | **20–55% fewer tokens** while maintaining or improving accuracy versus standard CoT. | Use bandit-style cap selection across completed tasks. In proprietary APIs, stop between tool/model rounds; token-stream interception is normally unavailable. |
| [Steering LLM Thinking with Budget Guidance](https://aclanthology.org/2026.findings-acl.1866/) | Findings ACL 2026 | Output/reasoning | A lightweight predictor models remaining reasoning length with a Gamma distribution and softly guides next-token generation toward a target budget. No LLM fine-tuning. | Peer-reviewed experiments. | Competitive accuracy using **63% of full-thinking tokens**; up to **+26 accuracy points** over tight-budget baselines on MATH-500. | Supports learned task-specific budgets. Exact token-level steering requires logits/model access; Condiments can approximate it from task and telemetry features. |
| [Thinking with Reasoning Skills: Fewer Tokens, More Accuracy](https://aclanthology.org/2026.acl-industry.154.pdf) | ACL Industry 2026 | Input plus output | Distill successful reasoning and failure fixes into compact procedural skill cards; retrieve a relevant card instead of reasoning from scratch. Black-box API compatible. | Peer-reviewed math and coding experiments. | Coding completion tokens fell **10.3–33.9%** for several tested models with similar or higher pass rate, but rose **1.9%** for GPT-OSS-120B because retrieved input overhead exceeded output savings. | Strong basis for a compact, validated recipe memory. Inject only when projected output saved exceeds added skill-card input and cache-lineage cost. |
| [Ada-RS: Adaptive Rejection Sampling for Selective Thinking](https://aclanthology.org/2026.acl-industry.88/) | ACL Industry 2026 | Output/reasoning | Score sampled completions with an adaptive length-penalized reward; use stochastic rejection sampling to create efficient DPO/group-policy training data. | Peer-reviewed experiments on tool-use benchmarks. Requires post-training. | Up to about **80% fewer output tokens** and **95% lower thinking rate** while maintaining or improving tool-call accuracy. | Relevant for future open-model adapters. Cannot be implemented as a portable prompt-only Codex/Claude skill. |
| [Extra-CoT: Extreme-Ratio Chain-of-Thought Compression](https://arxiv.org/abs/2602.08324) | ICML 2026 accepted | Output/reasoning | Train a semantic CoT compressor; mixed-ratio SFT; then Constrained Hierarchical Ratio Policy Optimization. | Accepted-paper experiments. Requires model training. | More than **73% token reduction** with **+0.6 accuracy points** on MATH-500 using Qwen3-1.7B. | Useful for DeepSeek/Qwen self-hosted adapters; unavailable through ordinary Codex or Claude request controls. |

## Algorithms suitable for Condiments now

### 1. Verification-aware query compressor

Operate on semantic evidence units: code symbols, nearby line ranges, test failures, log events, documentation paragraphs, and tool-result records.

For evidence unit `e` and task `q`, rank with:

```text
score(e,q) = λ·semantic(e,q)
           + (1-λ)·lexical(e,q)
           + exact_bonus(e)
           + dependency_bonus(e)
           + failure_bonus(e)
```

`exact_bonus` makes user-named paths, symbols, IDs, numeric values, error messages, citations, and changed lines non-removable. `dependency_bonus` protects definitions and direct callers. `failure_bonus` protects failed-test and tool-error evidence.

Select the smallest evidence set within budget that passes a task-specific sufficiency validator. If validation fails, identify the missing result and retrieve only evidence for that gap. Bound this loop to two extra retrieval rounds. This combines the query-aware formal result, IterCOMP’s iterative answerability gate, and the 2026 citation-grounding warning.

### 2. Net-positive dictionary encoder

Apply only to repetitive data. For candidate phrase `p` replaced by symbol `s`:

```text
net_saved(p) = occurrences(p)·(tokens(p)-tokens(s))
             - dictionary_entry_tokens(p,s)
```

Accept only candidates with positive net savings after including the decoder instruction. Prefer stable whole templates, such as repeated log prefixes, paths, stack frames, JSON keys, or table labels. Reject the encoding when required exact spans cannot be reconstructed byte-for-byte. Cache the dictionary as a stable prefix when possible.

### 3. Evidence-gated early stop

Treat 128, 512, and 2,048 output-token budgets as arms. Record task features, selected arm, required-result success, retries, tool calls, and total tokens. Reward:

```text
reward = verified_success
       - λout·output_tokens
       - λtool·tool_calls
       - λretry·retries
```

Choose conservatively at first. Update per task class with an upper-confidence-bound rule. Stop model/tool rounds as soon as required files, tests, values, or citations verify. Retry only the missing requirement. This is the black-box approximation of REFRAIN and Budget Guidance.

### 4. Retrieved procedural recipes

After a verified task, distill a small reusable card:

```text
trigger; required evidence; minimal action sequence; verification; known failure; invalidation keys
```

Retrieve at most one card. Inject it only when:

```text
estimated_output_saved > card_input_tokens + cache_break_cost + safety_margin
```

Invalidate on tool, framework, dependency, or repository-version mismatch. This prevents the input-overhead regression observed in the TRS coding experiments.

### 5. Significance-aware output contracts

Do not treat every output token equally. Generate required artifacts, exact values, failures, and verification first. Suppress introductions, repeated explanations, full-file reproduction, successful tool narration, and recaps. When a hard cap hits, request only missing required fields at the next budget. This follows BINGO’s proven principle at a semantic-block level without claiming its token-level theorem applies directly.

## Methods excluded from portable Codex/Claude implementation

- KV-cache eviction, sparse attention, quantization, and speculative decoding reduce memory, compute, or latency; they usually do **not** reduce provider-reported input/output tokens.
- Soft prompt and latent-token compressors require model weights, embeddings, or adapter training and are not portable to black-box APIs.
- Token-level logit steering, attention scoring, and reasoning-token pruning require inference internals unavailable to ordinary Codex/Claude skills.
- Training-time RL methods can guide DeepSeek/Qwen self-hosted adapters, but cannot be imposed on proprietary hosted models by prompt text.

## Required evaluation protocol

Paper percentages are not Condiments savings claims. Validate each algorithm with randomized, paired `none`/`some`/`full` runs on the same repositories and tasks. Record:

1. Provider-reported logical input, cached input, reasoning, and output separately.
2. Required-result completeness, exact file state, tests, error evidence, and citations.
3. Added compressor, dictionary, recipe, verification, and retry tokens.
4. Tool calls and model calls, including compressor and judge calls.
5. Median and confidence interval across repeats; reject a policy whose quality lower bound misses baseline.

The most defensible next implementation is the **verification-aware query compressor**. It can reduce true logical input, works with black-box models, and has both a formal query-aware foundation and 2026 empirical support. The dictionary encoder should follow for logs and repeated tool output. Evidence-gated UCB budget learning should then tune the existing adaptive output governor.
