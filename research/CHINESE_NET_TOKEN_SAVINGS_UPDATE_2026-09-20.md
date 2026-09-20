# Chinese Research Update: Net Token Savings for Condiments

Research cutoff: 2026-09-20.

This update reviews recent work from China-based universities and laboratories that can reduce tokens in an agent skill such as Condiments. It extends [CHINESE_TOKEN_EFFICIENCY_RESEARCH.md](CHINESE_TOKEN_EFFICIENCY_RESEARCH.md) and [LATEST_TOKEN_REDUCTION_RESEARCH.md](LATEST_TOKEN_REDUCTION_RESEARCH.md).

The screen is deliberately strict. A shorter prompt, tool result, reasoning trace, or KV cache is not counted as a Condiments saving unless the experiment also preserves task quality and accounts for the provider-visible work needed to obtain it. Paper percentages below describe the reported benchmark only. They are not forecasts for Condiments.

## Verdict

Four methods are strong enough to implement and test:

1. **Progressively disclose the skill itself.** Keep only routing and mandatory rules in the always-loaded body. Load the relevant control module on demand. This is the most direct match to Condiments.
2. **Use non-generative memory first.** Index raw, provenance-bearing events locally and retrieve a small evidence set. Do not spend LLM tokens to summarize every interaction.
3. **Keep compact active tool state.** Carry the current objective, verified facts, artifacts, and failed-call fingerprints instead of replaying complete tool trajectories.
4. **Prune or downgrade recurring workflow steps only after measured marginal-value and break-even tests.** Expensive workflow search is unsuitable for one-off tasks.

Reasoning-skill cards can save money on hard recurring tasks, but only behind a task/model-specific break-even gate. Multi-agent auctions, blind prompt compression, and model-internal cache methods do not yet justify a general Condiments feature.

## What counts as real savings

For each paired run, Condiments should record:

```text
provider_tokens = uncached_input
                + cached_input
                + cache_write_input
                + reasoning_output
                + visible_output
                + auxiliary_LLM_calls
                + retry_LLM_calls

billed_cost = sum(provider_reported_token_class * provider_price)

quality_adjusted_cost = billed_cost / verified_successes

amortized_cost = billed_cost
               + one_time_optimization_cost / expected_future_uses
```

A control passes only when:

- the same model, tools, task data, and quality checks are used in both arms;
- all calls, retries, memory work, retrieval work, and cache effects are included;
- the candidate is non-inferior on deterministic task checks; and
- both total provider tokens and billed cost are reported, since prompt caching can make them diverge.

This standard is supported by an external 2026 coding-agent study, [Token Reduction Is Not Cost Reduction](https://arxiv.org/abs/2607.12161), where removing 38.4% of delivered tool output increased billed cost by 6.8%. Extra retrieval, testing, turns, and cache traffic erased the local reduction.

## Evidence that passes or partly passes the screen

| Work | Measured result | Evidence grade | Condiments use |
| --- | --- | --- | --- |
| [SkillReducer](https://arxiv.org/abs/2603.29919) (v2, June 2026; HKUST, Tsinghua, Zhejiang University of Technology) | Across 600 skills, descriptions shrank 48% and bodies 39%. Its end-to-end analysis reports **26.8% mean input savings**, with only **+1.7% mean output** and **-0.3% median output**. Compressed skills scored 0.742 versus 0.722 for originals; 86% did not regress. The one-time optimizer used about 20-40 LLM calls per skill and was estimated to amortize within a few hundred invocations. | **Pass, conditional.** It measures runtime input and output, quality, reference-load behavior, and build-time cost. Results are an arXiv preprint, and 14% of skills regressed before attribution. | Split the Condiments body into a small core and task-routed control modules. Deduplicate body/reference overlap. Restore content whenever command-routing or task tests regress. Perform optimization at release time, never on every invocation. |
| [Zero-Mem](https://arxiv.org/abs/2607.29377) (July 2026; Hong Kong Polytechnic University, SWUFE, Jilin University) | With the same final reader and context budget, memory operations used **0 LLM tokens**, versus 877,086 for the most token-efficient compared system, LightMem. Zero-Mem also had higher F1 (59.15 versus 38.44) and lower memory latency (334.77 versus 788.76 seconds). | **Pass for memory-operation tokens.** The 100% figure applies only to memory operations; the final reader still consumes tokens, so it is not a 100% end-to-end saving. | Preserve raw events as source of truth. Build local lexical/entity, temporal, path, symbol, error, and artifact indexes. Retrieve top-k exact evidence and calibrate it deterministically. Do not generate memory summaries by default. |
| [RecMem](https://aclanthology.org/2026.findings-acl.1619/) (Findings ACL 2026; CUHK, BUPT, Huawei, Wuhan University) | On LoCoMo with GPT-4.1-mini, construction used **193.2K tokens**, versus 1,520.8K for Mem0 and 1,459.9K for A-Mem: reductions of 87.3% and 86.8%. On LongMemEval-S it used 365.49K, versus 1,626.54K and 1,264.25K: reductions of 77.5% and 71.1%. It also led the reported quality results. | **Pass for construction; conditional end to end.** Query tokens can be slightly higher, but the construction reduction dominates long-running streams in the paper. | If a generated summary is ever useful, consolidate only after a semantic pattern recurs four or five times, or when measured context pressure requires it. Retrieve the exact raw records during refinement. Short sessions perform no consolidation call. |
| [GenericAgent](https://arxiv.org/abs/2604.17091) (April 2026; Shenzhen Aquaintelling Technology and Fudan University) | On Lifelong AgentBench with the same Claude Sonnet 4.6 model, GA used **241K total tokens** at 100% completion, versus Claude Code's 814K at 75% and OpenClaw's 1.45M at 70%. That is 70.4% and 83.4% fewer total tokens. On same-model web tasks, its total token use was 64.1-74.6% lower than OpenClaw while scores improved. | **Pass on the reported end-to-end benchmarks.** The paper is a preprint and some components lack isolated ablations. Its head-tail truncation is unsafe for exact code unless raw artifacts remain recoverable. | Keep a minimal active tool surface, tier memory, offload large tool output to raw artifacts, maintain a small working-state anchor, and preserve prompt-cache stability. Condiments already implements parts of this; it should add a provenance-based active-state ledger rather than blind truncation. |
| [AgentSlimming](https://aclanthology.org/2026.acl-long.1387/) (ACL 2026; Shanghai Jiao Tong, Nanjing University, NUAA, Shanghai AI Laboratory) | It prunes redundant agents and moves low-value nodes to cheaper models. Per-problem API cost fell 71.7-78.9% on MBPP/LiveCode while scores rose, and 78.8% on GSM8K at the same score. | **Pass at execution time; often fail after amortization.** Its one-time search required **1,222-13,459 future calls** to break even, depending on benchmark. | Borrow the baseline-anchored acceptance rule and cheap-model substitution. Do not run its search for ordinary tasks. Apply pruning only to stable, high-volume automations whose expected future executions exceed measured break-even. |
| [Smurfs](https://aclanthology.org/2025.naacl-long.169/) (NAACL 2025; CUHK Shenzhen and Shenzhen Research Institute of Big Data) | On StableToolBench it used 8,096 tokens per query versus DFSDT's 20,714, a **60.9% reduction**, while pass rate rose from 55.4% to 57.4%. It gives each role only relevant local state and uses deterministic rollback rules. | **Pass on tool-planning benchmark; transfer unproven.** It adds multiple agents, so Condiments must validate the pattern against a simpler single-agent baseline. | Store local active trajectory state, exclude failed branches, prevent repeated failing tool selection, and pass compact hints between phases. Use state-machine logic rather than adding several LLM agents. |
| [Thinking with Reasoning Skills](https://aclanthology.org/2026.acl-industry.154/) (ACL Industry 2026; Qiyuan Tech, Tsinghua, HKU, Peking University) | On coding, completion tokens fell 10.3-33.9% for three model families and normalized cost fell 6.0-14.8%, with equal or better pass@1. GPT-OSS-120B was the counterexample: completion grew 1.9% and cost grew 4.8% because the injected card cost more than it saved. Mismatched cards increased non-reasoning task cost by 36.8-102.8%. | **Pass only with routing and break-even gates.** The negative cases are central evidence, not edge cases. | Retrieve at most one short, versioned recipe for a recurring hard task. Inject it only when historical saved reasoning/output exceeds card input, retrieval overhead, and cache loss. Never inject reasoning cards into simple edits or unrelated tasks. |
| [DALA](https://ojs.aaai.org/index.php/AAAI/article/view/40182) (AAAI 2026; Sun Yat-sen University) | Its learned value-per-token auction used 6.2M tokens on GSM8K versus 7.5M for AgentPrune-R, 14M for DyLAN, and 22-26M for debate/PHP, while accuracy was highest. But vanilla used only 3.5M. On MMLU, DALA used 380K versus vanilla's 150K. | **Reject as a general savings control.** It improves the multi-agent Pareto frontier but does not beat the simplest baseline on token count. Training overhead is not a fit for a portable skill. | Retain only the principle: an optional message must justify its value per token. Suppress low-value agent commentary and repeated evidence. Do not implement the auction learner. |

## Algorithms to implement

### 1. Release-time skill slicing

This has the closest evidence to the Condiments deployment model. The current root `SKILL.md` is about 13 KB, while the generated Codex adapter is about 6.9 KB; both still contain multiple controls that are irrelevant to most turns.

Build a release-time compiler:

```text
classify each instruction:
  ROUTING        command grammar, status/version, state precedence
  MANDATORY      safety/correctness and active-control dispatch
  CONTROL        mayo, mustard, ketchup, ranch, hot
  PROVIDER       OpenAI, Anthropic, Qwen, DeepSeek
  HOST           Codex, Claude Code, Cursor, OpenClaw
  EXAMPLE/DOC    explanation and examples

always_loaded = ROUTING + minimal MANDATORY dispatcher
on_demand     = selected CONTROL + selected PROVIDER + selected HOST
never_runtime = examples and maintainer rationale
```

Required safeguards:

- use deterministic sections and dependency declarations, not an online LLM classifier;
- load at most the modules selected by the current command, route, host, and provider;
- hash loaded modules and retain stable order for prompt caching;
- deduplicate instructions that occur in both the skill and references;
- run command-routing, adapter, and paired task evaluations before accepting the slice;
- restore any clause whose removal changes routing or verified behavior.

The release-time compiler's own token cost should be included in break-even. A deterministic compiler after the first validated layout can reduce later release costs to nearly zero.

### 2. Zero-token raw memory index

Replace routine generative checkpoints with a local index over exact events:

```text
event = {
  timestamp,
  task_hash,
  turn,
  paths[], symbols[], error_codes[], commands[], artifact_hashes[],
  outcome, verification,
  raw_pointer
}

query_profile = deterministic extraction of the same fields
candidates    = lexical/path/symbol overlap + recency + verified-outcome weight
evidence      = top-k raw spans + temporal neighbours + provenance pointers
```

The index consumes no provider tokens. Full output stays in a hash-addressed artifact; the active prompt receives a bounded preview and exact pointer. The retriever must keep user-named paths, identifiers, numbers, error text, citations, and requirements intact.

Use RecMem only as a second tier:

```text
if short_session and context_pressure is low:
    no checkpoint; no summarization
elif recurrence_count >= 4 or context_pressure is high:
    consolidate one cluster once
    retain raw pointers
else:
    retrieve raw indexed evidence
```

This improves the current pressure-only checkpoint rule by also preventing eager consolidation in long but non-repetitive sessions.

### 3. Compact tool-trajectory state

Condiments already blocks duplicate commands and defaults to one discovery plus one verification round. Add a native state ledger:

```text
goal
constraints
facts: [{claim, source_hash, verified}]
artifacts: [{path, hash, purpose}]
failed_calls: [{normalized_call_hash, failure_class}]
open_gaps
next_allowed_round
```

Before a tool call:

1. block a matching successful or failed call unless its inputs changed;
2. return the existing artifact pointer and bounded preview when evidence already exists;
3. make only `open_gaps` available to discovery;
4. retain exact raw evidence outside the prompt;
5. expand raw content only for a named missing fact.

This implements the useful part of Smurfs without paying for planner, executor, answerer, and verifier LLMs.

### 4. Net-positive recipe cards

Create a recipe only after several verified repetitions of the same task class. A card contains:

```text
trigger
preconditions
minimal procedure
known failure
verification
invalidation keys: model, host, tools, repository/dependency version
```

Injection rule:

```text
projected_saved_cost = historical_baseline_cost - historical_card_cost
added_cost = card_input + retrieval + cache_loss + expected_retry_delta

inject iff:
  similarity >= validated_threshold
  and projected_saved_cost > added_cost
  and lower_confidence_bound(projected_saved_cost - added_cost) > 0
```

Use one card at most. A mismatch returns immediately to baseline. This rule directly addresses the TRS regressions.

### 5. Amortized workflow pruning

For a stable recurring automation, record each optional step's marginal contribution:

```text
value(step) = paired_quality_delta / paired_cost_delta
break_even  = optimization_cost / per_run_saving
```

Remove or downgrade a step only after a minimum paired sample, deterministic quality checks, and a conservative confidence bound. Keep one capable planner/editor and route mechanical formatting, selection, and deterministic verification to local code or a cheaper evaluated model.

This should remain disabled for one-off interactive work. AgentSlimming's own break-even table shows why.

## What not to implement

- **Per-turn LLM summarization.** Zero-Mem and RecMem show that eager memory generation is avoidable.
- **Blind middle or head-tail deletion for code and diagnostics.** It can remove the one answer-bearing line and trigger retries.
- **A per-task workflow search.** AgentSlimming needs thousands of later executions to amortize its optimizer.
- **Always-on recipe injection.** TRS increased cost on mismatched and some coding/model combinations.
- **An auction-trained multi-agent controller.** DALA spends more tokens than vanilla even when it improves accuracy.
- **Skill compression judged only by file size.** Runtime reference reads, outputs, retries, quality failures, and build-time calls must be counted.
- **KV-cache, latency, FLOP, or hidden-state reductions presented as provider-token savings.** Report them separately.
- **Unsupported reasoning controls.** Send only provider-declared fields and verify actual returned counters.

## Condiments implementation priority

| Priority | Change | Why now | Required proof before default-on |
| --- | --- | --- | --- |
| P0 | Add one canonical total-token, billed-cost, cache, retry, and verified-success ledger | Every later decision depends on correct accounting | Reconcile against provider usage objects on recorded fixtures and live paired runs |
| P1 | Compile a small core skill with on-demand control/provider/host modules | SkillReducer is the closest direct evidence; current skill bodies load unrelated controls | Lower total input and billed cost on command, simple edit, debugging, and explanation workloads with identical outcomes |
| P1 | Add zero-token local memory index and top-k exact evidence retrieval | Removes recurring memory-management calls while preserving provenance | Long-session paired eval; include final-reader tokens and retrieval-caused retries |
| P2 | Add compact tool-state ledger and artifact reuse | Complements the existing round and duplicate-call guard | Tool-heavy paired eval; require fewer total tokens and no lower patch/test success |
| P2 | Add one-card recipe retrieval with a learned break-even gate | Can reduce repeated reasoning, but negative transfer is common | Separate model/workload cells; default baseline for unknown cells |
| P3 | Add workflow-node pruning for high-volume automations only | Large execution savings are possible after amortization | Expected future runs exceed measured break-even with a safety margin |

## Evaluation plan

Use a paired suite with at least these strata:

- command/status/version only;
- small exact edit;
- debugging with noisy tests;
- long tool-heavy repair;
- repeated repository workflow;
- long session with factual recall;
- deliberately mismatched recipe/control.

For every task, run baseline and candidate with the same model and initial state. Record provider usage for every turn and helper call. Verify exact files, tests, required evidence, and task completion. Report median and bootstrap confidence intervals for:

```text
total provider tokens
billed cost
quality-adjusted cost
turns and tool calls
cache creation/read tokens
retry rate
verified success rate
```

Do not publish a savings percentage for Condiments until the lower confidence bound is positive for both total provider tokens and quality-adjusted billed cost. Report results by model and workload; never average an unevaluated combination into a supported claim.

## Sources

- Gao et al., [SkillReducer: Optimizing LLM Agent Skills for Token Efficiency](https://arxiv.org/abs/2603.29919), arXiv v2, 2026.
- Xiao et al., [Zero-Mem: Zero-Token Memory Operations for LLM Agents](https://arxiv.org/abs/2607.29377), arXiv, 2026.
- Dai et al., [RecMem: Recurrence-based Memory Consolidation for Efficient and Effective Long-Running LLM Agents](https://aclanthology.org/2026.findings-acl.1619/), Findings ACL 2026.
- Liang et al., [GenericAgent: A Token-Efficient Self-Evolving LLM Agent via Contextual Information Density Maximization](https://arxiv.org/abs/2604.17091), arXiv, 2026.
- Chen et al., [AgentSlimming: Towards Efficient and Cost-Aware Multi-Agent Systems](https://aclanthology.org/2026.acl-long.1387/), ACL 2026.
- Chen et al., [Smurfs: Multi-Agent System using Context-Efficient DFSDT for Tool Planning](https://aclanthology.org/2025.naacl-long.169/), NAACL 2025.
- Zhao et al., [Thinking with Reasoning Skills: Fewer Tokens, More Accuracy](https://aclanthology.org/2026.acl-industry.154/), ACL Industry 2026.
- Fan et al., [Cost-Effective Communication: An Auction-based Method for Language Agent Interaction](https://ojs.aaai.org/index.php/AAAI/article/view/40182), AAAI 2026.
- Weinberger and Hozez, [Token Reduction Is Not Cost Reduction](https://arxiv.org/abs/2607.12161), arXiv v5, 2026. Used as an external validation standard rather than Chinese-source evidence.
