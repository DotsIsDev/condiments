# Condiments Token-Efficiency Skill: Development and Implementation Plan

Status: Recommended first implementation slice complete  
Research current through: 2026-09-13  
Target environments: Claude Code, Codex CLI, OpenClaw, Cursor

## 1. Objective

Build a portable command skill named `condiments` that reduces token use, context pressure, latency, and cost in coding-agent workflows while preserving task correctness.

The skill exposes five memorable controls:

| Control | Domain | Primary waste addressed |
| --- | --- | --- |
| `mayo` | Response output | Excess prose and repeated code; `full` hard caps the final user-facing response at 120 words independently of checkpoints |
| `mustard` | Context loading | Broad file reads and eager tool/skill loading |
| `ketchup` | Session memory | Repeated history and stale conversational state |
| `ranch` | Tool execution | Repeated calls, large results, and unstable cached prefixes |
| `hot` | Reasoning/model use | Excess reasoning and expensive model use on routine work |

The global commands apply all controls at a shared optimization intensity:

```text
/cond none
/cond some
/cond full

/condiments none
/condiments some
/condiments full
```

`none`, `some`, and `full` describe optimization intensity. They do not promise literal 0%, 50%, or 100% token reduction. A 100% reduction would mean sending no request. Product documentation must use the phrase **optimization intensity**, not guaranteed savings.

## 2. Success Criteria

The implementation is complete when:

1. The same command vocabulary works in all four target environments, using adapters where host capabilities differ.
2. Global presets and individual overrides produce deterministic effective policy.
3. Unsupported native features degrade to prompt-level behavior and appear in `/cond status`.
4. `some` reduces median cost per successful task without a meaningful quality regression.
5. `full` reduces median cost more than `some`, while verification-triggered escalation protects correctness.
6. The skill never claims savings that telemetry cannot demonstrate.
7. Tests cover parsing, aliases, precedence, state, capability fallback, checkpoint preservation, and token-accounting calculations.

Primary optimization metric:

```text
cost_per_successful_task = total_cost / verified_successes
```

Supporting metrics:

```yaml
input_tokens: 0
output_tokens: 0
reasoning_tokens: 0
cache_read_tokens: 0
cache_write_tokens: 0
uncached_input_tokens: 0
tool_result_chars: 0
tool_calls: 0
model_calls: 0
compaction_count: 0
retry_count: 0
wall_time_ms: 0
verification_passed: false
```

## 3. Command Contract

### 3.1 Commands and aliases

```text
/cond <none|some|full>
/condiments <none|some|full>

/cond <control> [none|some|full]
/condiments <control> [none|some|full]

/cond status
/cond reset
```

Control aliases:

```yaml
mayo: [mayo, mayonnaise]
mustard: [must, mustard]
ketchup: [ket, ketchup]
ranch: [ran, ranch]
hot: [hot, hotsauce]
```

A bare control sets that control to `full`:

```text
/cond mayo
# Equivalent: /cond mayo full
```

### 3.2 Precedence

Last applicable command wins.

```text
/cond some
/cond mayo full
```

Effective state:

```yaml
preset: some
controls:
  mayo: full
  mustard: some
  ketchup: some
  ranch: some
  hot: some
```

A later global command overwrites every individual override:

```text
/cond full
# All five controls become full.
```

`/cond reset` is equivalent to `/cond none`.

### 3.3 Meaning of `none`

`none` means Condiments adds no optimization behavior for that control. The host retains its native defaults. For example, `ketchup none` must not disable a host's mandatory overflow compaction.

### 3.4 Status response

`/cond status` should remain compact:

```text
Condiments: some
mayo=full mustard=some ketchup=some ranch=some hot=some
Native: cache=yes compact=yes tool-search=no reasoning=prompt-only
```

## 4. Canonical Policy

The implementation should keep one canonical, platform-neutral policy document. Adapters translate it into each host's supported mechanisms.

```yaml
version: 1
preset: some
controls:
  mayo: some
  mustard: some
  ketchup: some
  ranch: some
  hot: some
quality_guard:
  require_verification_for_code_changes: true
  escalation_after_repeated_failure: 2
telemetry:
  enabled: true
```

Recommended architecture:

```text
condiments/
|-- SKILL.md
|-- references/
|   |-- policy.md
|   |-- research-global.md
|   |-- research-china.md
|   `-- platform-capabilities.md
|-- scripts/
|   |-- parse-command.*
|   |-- resolve-policy.*
|   |-- compact-tool-result.*
|   `-- report-usage.*
|-- adapters/
|   |-- claude-code/
|   |-- codex-cli/
|   |-- openclaw/
|   `-- cursor/
`-- evals/
    |-- fixtures/
    |-- expected/
    `-- score.*
```

Only create scripts where deterministic logic materially improves reliability. Keep prompts and routing rules in `SKILL.md` or focused references. Validate each target environment's current packaging path before generating adapter files.

## 5. Control Specifications

### 5.1 `mayo`: Response Output

#### `none`

- Add no output constraints.
- Use host/model defaults.

#### `some`

- Answer directly.
- Do not repeat the user's request.
- Prefer five or fewer bullets for routine reports.
- Summarize successful routine command output.
- Report outcome, material evidence, failure, and next required action.
- Use native low-verbosity settings when available and safe.

#### `full`

- Hard cap the final user-facing response at 120 words unless the user explicitly requests a longer format.
- Keep checkpoint, compaction, memory, and tool state outside the final-response budget.
- Prefer editor operations, patches, unified diffs, or FIM over complete-file reproduction.
- Report changed files without pasting unchanged code.
- Suppress successful routine logs; retain failing checks and relevant error lines.
- Apply provider-native per-generation ceilings where exposed: 2,048 tokens for `full`.
- Put necessary long code, errors, migrations, or recovery detail in an artifact and link it briefly.

Output preference:

```text
1. Direct file edit
2. Patch
3. FIM/partial completion
4. Changed function or block
5. Complete file only when required
```

Research basis:

- OpenAI exposes output verbosity and output-token limits.
- DeepSeek and Qwen expose FIM or partial continuation for generating only the missing code region.

### 5.2 `mustard`: Context Loading

#### `none`

- Add no context-selection policy.

#### `some`

- Search filenames and symbols before reading files.
- Read likely files only.
- Include adjacent declarations, callers, or tests when evidence indicates relevance.
- Avoid build outputs, dependencies, generated files, binaries, and large lockfiles unless requested.

#### `full`

- Use staged retrieval: locate, rank, fetch, expand.
- Load tool and skill definitions only when needed.
- Read exact symbols or line regions first.
- Expand context only after ambiguity, failed edits, failed tests, or unresolved references.
- Use repository ignore rules and host-specific context exclusions.
- Cap retrieval results and return paths plus match summaries before returning full content.

Required retrieval sequence:

```text
1. Locate filenames/symbols/references.
2. Rank likely sources.
3. Fetch exact ranges.
4. Inspect necessary callers/tests.
5. Expand only when evidence requires it.
```

Research basis:

- Cursor has shifted from broad static context toward dynamic context retrieval.
- Anthropic recommends tool search for large tool catalogs.
- OpenClaw bounds skill catalog and tool-result context.
- AgentScope separates search from exact-line retrieval.

### 5.3 `ketchup`: Session Memory

#### `none`

- Add no memory or compaction policy.
- Do not interfere with mandatory host overflow handling.

#### `some`

- Create a checkpoint after meaningful milestones.
- Preserve a recent conversation tail verbatim.
- Compact only under context pressure or after tool-heavy phases.
- Start a fresh session when the task changes to an unrelated domain.

#### `full`

- Maintain working memory, curated long-term memory, and an external raw archive.
- Flush memory only when facts change or compaction is imminent.
- Consolidate memory asynchronously or with a cheaper model where supported.
- Prune stale tool results after extracting their conclusions.
- Preserve exact identifiers, paths, commands, hashes, errors, constraints, and unresolved work.
- Keep raw transcripts outside active context and retrieve them on demand.

Checkpoint schema:

```yaml
goal:
constraints:
decisions:
changed_files:
commands_and_results:
known_failures:
opaque_identifiers:
artifact_paths:
next_action:
```

Memory layers:

```yaml
working_memory:
  purpose: Current task state injected into active context
long_term_memory:
  purpose: Deduplicated stable facts retrieved when relevant
raw_archive:
  purpose: Full audit trail stored outside active context
```

Memory-flush triggers:

- User introduces or changes a constraint.
- Architecture decision changes.
- Files change.
- Verification state changes.
- A blocker appears or clears.
- Compaction is imminent.

Do not flush after every turn. Do not compact after every turn. Both operations consume tokens and may invalidate cache prefixes.

Research basis:

- OpenAI recommends milestone compaction for long tool-heavy workflows.
- OpenClaw preserves recent turns and tool-call/result pairs during compaction.
- Claude Code supports focused compaction and fresh sessions for unrelated work.
- Alibaba AgentScope uses two-layer memory, throttled flushes, recent-tail compaction, and external archives.

### 5.4 `ranch`: Tool Execution

#### `none`

- Add no tool-execution optimization.

#### `some`

- Batch independent searches and reads.
- Reuse results already present in the current task.
- Bound command, test, and search output.
- Summarize success; preserve actionable failures.
- Keep stable prompt components ordered consistently.

#### `full`

- Discover tool schemas lazily.
- Combine lightweight tool chains programmatically when supported.
- Deduplicate equivalent calls.
- Keep stable prompt/tool prefixes byte-stable where possible.
- Append dynamic state rather than rewriting earlier context.
- Offload large tool results to artifacts; retain digest, head/tail, path, and hash.
- Truncate obsolete large tool arguments before semantic compaction.
- Prefer one agent. Spawn workers only when context isolation or latency benefit exceeds duplicated context cost.

Large-result envelope:

```yaml
tool:
request_summary:
exit_status:
relevant_head:
relevant_tail:
error_matches:
artifact_path:
content_hash:
truncated: true
```

Supersession rules:

- A newer read of the same file may replace the older read.
- A verified edit may replace the full edit payload with a diff summary.
- Repeated identical searches retain one result plus call count.
- Passing test logs retain counts and duration.
- Failing test logs retain failing cases and the relevant stack region.

Cache-prefix rules:

```text
1. Stable system instructions first.
2. Stable tool definitions next.
3. Stable repository guidance next.
4. Existing conversation remains append-only.
5. Dynamic environment data and new user input go last.
6. Tool order remains deterministic.
```

Research basis:

- Anthropic combines tool search, programmatic calling, prompt caching, and context editing.
- OpenAI's agent harness uses lazy discovery, bounded tool output, deterministic tool order, and append-only prompt history.
- DeepSeek and Alibaba caches depend on reusable prompt prefixes.
- AgentScope offloads large results and performs zero-LLM argument truncation before compaction.

### 5.5 `hot`: Reasoning and Model Use

#### `none`

- Add no model or reasoning override.

#### `some`

- Use adaptive or balanced reasoning where available.
- Disable deep reasoning for formatting, status, simple lookup, and trivial edits.
- Use stronger reasoning for planning, architecture, concurrency, security, and ambiguous debugging.

#### `full`

- Start with the cheapest validated model and lowest suitable reasoning effort.
- Apply explicit reasoning budgets where supported.
- Escalate only on measurable signals.
- Prefer a separate bounded escalation step when changing model/effort would destroy a valuable prompt cache.
- Return only the escalation conclusion to the main context.

Escalation signals:

- Verification fails twice for the same suspected cause.
- Sources or runtime evidence conflict.
- A decision affects multiple components or public contracts.
- Security, concurrency, data integrity, or irreversible migration correctness matters.
- The active model reports unresolved uncertainty.
- The user explicitly requests deeper reasoning.

Provider adapters must map semantic levels to actual provider capabilities. Level labels are not portable: some providers map `low` and `medium` to the same internal setting, while others expose continuous or model-specific budgets.

Research basis:

- OpenAI and Anthropic expose effort controls and recommend eval-driven escalation.
- Cursor provides cost/balance/intelligence routing modes.
- Alibaba Qwen exposes hybrid thinking and `thinking_budget`.
- Zhipu GLM exposes dynamic thinking and `reasoning_effort`, with provider-specific level mappings.

## 6. Cross-Cutting Accounting Rules

The skill must distinguish three optimization classes:

| Class | Meaning | Examples |
| --- | --- | --- |
| Token reduction | Less input, reasoning, or output generated | Sliced reads, pruning, FIM, concise output |
| Compute reuse | Same logical tokens processed through cache | Stable prefixes, provider prompt cache |
| Cost reduction | Lower price without necessarily lowering tokens | Model routing, batch APIs, off-peak pricing |

Reports must not call cached tokens “removed tokens.” Report raw tokens, cached tokens, uncached tokens, and cost separately.

Recommended cache metric:

```text
cache_hit_ratio = cache_read_tokens / input_tokens
```

Recommended effectiveness metric:

```text
verified_efficiency = baseline_cost_per_success / current_cost_per_success
```

## 7. Platform Adapter Strategy

### Claude Code

Use prompt behavior for all controls. Use native effort, compaction, clear/resume, hooks, subagent context isolation, and usage telemetry when available. Avoid agent teams for routine token-saving mode because every teammate owns a context window.

Adapter validation:

- Confirm current skill directory and frontmatter.
- Confirm whether effort can be selected from skill frontmatter.
- Confirm callable/native compaction behavior.
- Confirm hooks available for tool-result preprocessing.
- Record unsupported operations in status output.

### Codex CLI

Use a concise `SKILL.md` with progressive references. Rely on native context compaction where exposed. Preserve deterministic tool ordering and append-only context. Use exact searches and bounded tool output. Model, effort, and verbosity settings require adapter capability detection rather than assumptions.

Adapter validation:

- Confirm current skill installation path and invocation syntax.
- Confirm configuration fields for model, reasoning effort, and verbosity.
- Confirm whether native compaction can be requested by the skill.
- Confirm usage/cached-token telemetry surface.

### OpenClaw

Use native command dispatch where available. Integrate with context pruning, compaction, cache retention, utility models, usage reporting, and per-agent model settings. Preserve OpenClaw's host-owned overflow recovery.

Adapter validation:

- Confirm command-dispatch metadata.
- Map `some/full` to supported pruning and compaction settings.
- Map memory/compaction work to utility or configured cheaper model.
- Surface native `cacheRead`, `cacheWrite`, context pressure, and compaction count.

### Cursor

Use skills/rules for prompt behavior, surgical symbol/file context, ignore files, and concise output. Use Auto/Router optimization modes only when the user's plan and client expose them. Do not assume Teams/Enterprise-only routing exists for every user.

Adapter validation:

- Confirm current skills and command packaging.
- Confirm rule scoping and persistent-state options.
- Confirm model-router availability before selecting it.
- Use Cursor's native condensation rather than duplicating large file summaries.

## 8. Implementation Phases

### Phase 0: Baseline and capability audit

Tasks:

- Record current command/skill packaging for every target host.
- Build capability matrix: native, prompt-only, unavailable.
- Collect baseline tasks and token/cost measurements.
- Define representative repositories: small, medium, monorepo.

Exit criteria:

- Capability matrix reviewed.
- Baseline dataset stored.
- No undocumented host-setting assumptions remain.

### Phase 1: Canonical router and state

Tasks:

- Implement command grammar and aliases.
- Implement `none/some/full` presets.
- Implement individual overrides and last-command precedence.
- Implement `status` and `reset`.
- Define session persistence boundary per platform.

Exit criteria:

- Parser tests pass for every alias and invalid input.
- Effective state is deterministic.
- Global commands overwrite prior individual overrides.

### Phase 2: Prompt-level controls

Tasks:

- Implement `mayo` output contracts.
- Implement `mustard` staged retrieval rules.
- Implement `ketchup` checkpoint schema.
- Implement `ranch` batching, dedupe, and result envelopes.
- Implement `hot` escalation signals.

Exit criteria:

- All controls work without provider-native APIs.
- `none` produces no Condiments behavior changes.
- Prompt instructions remain concise enough to justify their own token overhead.

### Phase 3: Deterministic helpers

Tasks:

- Add command parser only if host parsing cannot be reused.
- Add policy resolver.
- Add tool-result compactor/offloader.
- Add usage normalizer.
- Add checkpoint validator preserving identifiers and file paths.

Exit criteria:

- Helpers have focused tests.
- Large-result handling preserves recoverable artifact paths.
- Token telemetry normalizes provider field-name differences.

### Phase 4: Native platform adapters

Order:

- Implement OpenClaw adapter.
- Implement Claude Code adapter.
- Implement Codex CLI adapter.
- Implement Cursor adapter.
- Add capability detection and fallback messages.

Exit criteria:

- Same commands behave consistently across hosts.
- Native enhancements activate only when confirmed available.
- Unsupported capabilities degrade safely.

### Phase 5: Evaluation and tuning

Evaluate these workload classes:

1. One-line code fix.
2. Multi-file bug diagnosis and fix.
3. Repository exploration.
4. Tool-heavy test/debug loop.
5. Long session crossing compaction threshold.
6. Large command output.
7. Architecture decision requiring escalation.
8. Unrelated task switch.

For each workload, run:

```text
baseline/native
/cond none
/cond some
/cond full
```

Measure:

- Verified task success.
- Input/output/reasoning tokens.
- Cached/uncached input.
- Tool and model calls.
- Retry count.
- Cost and wall time.
- Context loss after compaction.

Quality gates:

- `none` remains behaviorally equivalent to native host behavior.
- `some` shows no material verified-success regression.
- `full` may trade detail and latency, but not code correctness.
- Any preset causing extra retries must be evaluated by total task cost, not first-call cost.
- No release claim uses a percentage unsupported by results.

### Phase 6: Packaging and documentation

Tasks:

- Keep canonical `SKILL.md` short.
- Move platform-specific procedures into references/adapters.
- Document status output and unsupported-feature fallback.
- Add examples for global presets and individual overrides.
- Produce installation packages for each platform.

Exit criteria:

- Fresh installation test succeeds on all target environments.
- Skill discovery descriptions remain short and discriminating.
- No unused placeholder directories or files remain.

## 9. Test Matrix

| Area | Required tests |
| --- | --- |
| Parsing | Long/short command names; all condiment aliases; invalid modes |
| State | Global preset; individual override; later global overwrite; reset |
| Mayo | Concise report; patch preference; safe expansion after truncation risk |
| Mustard | Search before read; exact-range fetch; evidence-driven expansion |
| Ketchup | Identifier preservation; recent-tail retention; unrelated-task reset |
| Ranch | Dedupe; batch; large-result offload; artifact recovery; stable ordering |
| Hot | Routine low effort; escalation signals; provider-level mapping fallback |
| Telemetry | Cached vs uncached accounting; missing provider fields; multi-call totals |
| Quality | Code compiles/tests; no increased unresolved defect rate |

## 10. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| “Full” removes necessary evidence | Verification-triggered expansion and escalation |
| Compaction loses identifiers | Structured checkpoint plus exact identifier preservation |
| Frequent compaction costs more | Milestone/pressure triggers; never per-turn by default |
| Cache breaks from changing settings | Stable prefixes; deterministic tool order; session-level settings |
| Agent delegation multiplies tokens | Single-agent default; explicit ROI/context-isolation threshold |
| Provider effort labels differ | Capability adapter and tested mappings |
| Hard output cap truncates usable code | Adaptive caps and retry/expansion on truncation |
| Offloaded result becomes unreachable | Persist absolute/host-valid path plus content hash |
| Prompt instructions cost more than they save | Keep skill body compact; benchmark net task cost |
| Host feature changes | Capability detection; versioned adapter tests |

## 11. Research Incorporated

### Global and platform research

- OpenAI model guidance: verbosity, reasoning effort, prompt caching, compaction, and eval-driven tuning.  
  https://developers.openai.com/api/docs/guides/latest-model
- OpenAI Codex agent loop: append-only context, exact-prefix caching, automatic compaction.  
  https://openai.com/index/unrolling-the-codex-agent-loop/
- OpenAI agent-harness efficiency: lazy tool discovery, bounded tool output, deterministic ordering.  
  https://openai.com/index/gpt-5-6-frontier-intelligence-efficiency/
- Anthropic tool-context management: tool search, programmatic tool calls, caching, context editing.  
  https://platform.claude.com/docs/en/agents-and-tools/tool-use/manage-tool-context
- Anthropic cost optimization: cache-first design, low-effort retries, budgets, multi-model routing.  
  https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence
- Claude Code cost guidance: usage tracking, clear/resume, compaction, model choice.  
  https://code.claude.com/docs/en/costs
- Cursor harness research: dynamic rather than broad static context.  
  https://cursor.com/blog/continually-improving-agent-harness
- Cursor summarization and file condensation.  
  https://docs.cursor.com/en/agent/chat/summarization
- Cursor Router: cost, balance, and intelligence routing.  
  https://prod.cursor.com/docs/cursor-router
- OpenClaw compaction, pruning, caching, token reporting, and subagent cost.  
  https://docs.openclaw.ai/reference/session-management-compaction/compaction  
  https://docs.openclaw.ai/concepts/session-pruning  
  https://docs.openclaw.ai/reference/prompt-caching  
  https://docs.openclaw.ai/tools/subagents

### Chinese-language and Chinese-platform research

- DeepSeek disk context cache: exact/common-prefix reuse and cache telemetry.  
  https://api-docs.deepseek.com/zh-cn/guides/kv_cache/
- DeepSeek FIM completion: bounded generation between prefix and suffix.  
  https://api-docs.deepseek.com/zh-cn/api/create-completion/
- Alibaba Bailian Context Cache: implicit/explicit cache behavior and cached-token billing.  
  https://help.aliyun.com/zh/model-studio/context-cache
- Alibaba Qwen deep thinking: hybrid thinking and explicit thinking budgets.  
  https://help.aliyun.com/zh/model-studio/deep-thinking
- Alibaba Qwen Coder: partial continuation and FIM patterns.  
  https://help.aliyun.com/zh/model-studio/qwen-coder
- Alibaba AgentScope memory: two-layer memory, throttled flush, cheaper maintenance model, exact-range retrieval.  
  https://java.agentscope.io/v2/zh/docs/harness/memory
- Alibaba AgentScope compaction: structured summaries, large-result offload, argument truncation, overflow recovery.  
  https://java.agentscope.io/v2/zh/docs/harness/compaction
- Zhipu GLM thinking: dynamic thinking and provider-specific reasoning-effort mappings.  
  https://docs.bigmodel.cn/cn/guide/capabilities/thinking

## 12. Recommended First Implementation Slice

Build the smallest end-to-end version before adding native APIs:

1. [x] Command parser and state resolver (`src/core.mjs`, `scripts/condiments.mjs`).
2. [x] Prompt-only implementations of all five controls (`references/policy.md`, runtime prompt renderer).
3. [x] `/cond status` with capability flags.
4. [x] Large-result summarization envelope (`src/result-envelope.mjs`, `scripts/compact-tool-result.mjs`).
5. [x] Structured checkpoint generation and validation (`src/checkpoint.mjs`, `scripts/checkpoint.mjs`, JSON Schema).
6. [x] Baseline/some/full evaluation on three repositories (`scripts/evaluate.mjs`, `evals/results/latest.md`).
7. [x] Add native adapters in this order: OpenClaw, Claude Code, Codex CLI, Cursor (`adapters/`, `scripts/install-adapter.mjs`).

This slice validates whether the command vocabulary and policies save net tokens before platform-specific complexity is added.

## 13. First-Slice Evaluation Results

The deterministic offline evaluation uses one exact-symbol retrieval task per repository. Baseline loads all eligible text, `some` loads matching files plus root guidance, and `full` loads merged ±8-line regions around all matches. Estimated tokens use UTF-8 bytes divided by four.

| Repository | Query | Baseline tokens | `some` tokens | `some` reduction | `full` tokens | `full` reduction | Exact-match recall |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dots Launcher | `IconService` | 13,858 | 5,873 | 57.62% | 4,512 | 67.44% | 100% |
| Hoop Metric | `LeagueRepository` | 153,478 | 19,790 | 87.11% | 5,397 | 96.48% | 100% |
| Anaheim Project | `APIClient` | 1,194,742 | 10,023 | 99.16% | 2,789 | 99.77% | 100% |

These are context-volume proxies, not provider token counts or quality claims. The result validates the staged retrieval mechanism and exact-match retention. Provider-backed evaluation remains required for task correctness, cost, cache reuse, latency, and retries.

## 14. Adapter Packages

The installer copies a self-contained runtime bundle and both command names into the host's project or workspace skill root:

```text
node scripts/install-adapter.mjs --host openclaw --target <openclaw-workspace>
node scripts/install-adapter.mjs --host claude-code --target <repository>
node scripts/install-adapter.mjs --host codex-cli --target <repository>
node scripts/install-adapter.mjs --host cursor --target <repository>
```

Installed paths:

| Host | Main skill | Alias skill |
| --- | --- | --- |
| OpenClaw | `skills/condiments/SKILL.md` | `skills/cond/SKILL.md` |
| Claude Code | `.claude/skills/condiments/SKILL.md` | `.claude/skills/cond/SKILL.md` |
| Codex CLI | `.agents/skills/condiments/SKILL.md` | `.agents/skills/cond/SKILL.md` |
| Cursor | `.cursor/skills/condiments/SKILL.md` | `.cursor/skills/cond/SKILL.md` |

Each adapter includes explicit capability flags. Native settings are applied only through a callable host surface; otherwise the canonical prompt policy remains active and status does not claim a setting change.

## 15. Second Implementation Slice

1. [x] Normalize OpenAI, Anthropic, OpenClaw, Cursor, and canonical usage payloads (`src/usage.mjs`, `scripts/report-usage.mjs`).
2. [x] Calculate cache-hit ratio, cost per verified successful task, and baseline/candidate efficiency without double-counting cache or reasoning subsets.
3. [x] Add provider-backed workload runner for baseline, `some`, and `full` (`src/provider-eval.mjs`, `scripts/run-provider-eval.mjs`).
4. [x] Run quality-gated workloads across all runnable authenticated hosts (`evals/results/phase5-live-report.md`).
5. [x] Tune preset policies from measured total tokens per verified successful task; retain experimental status until priced multi-host telemetry is available.

Normalized accounting rules:

- `input_tokens` is total logical prompt input.
- `cache_read_tokens` and `cache_write_tokens` are subsets of input.
- `uncached_input_tokens = input_tokens - cache_read_tokens`.
- `billable_input_tokens = input_tokens - cache_read_tokens - cache_write_tokens` where providers expose a distinct write bucket.
- Reasoning tokens remain a subset of output tokens.
- Cost remains unavailable when any run lacks a provider-reported or caller-supplied amount.

Provider and live-evaluation status on 2026-09-13:

- Codex CLI `0.154.0-alpha.6.2`: Windows `seclogon` was started, read-only sandbox preflight passed, and the eight-workload live matrix completed.
- Claude Code `2.1.270`: CLI is installed, but provider execution reports `Not logged in · Please run /login`; zero tokens used.
- OpenClaw and Cursor command-line hosts are unavailable on this workstation.

The tuned Codex CLI results preserve every exact answer/evidence gate while reducing total tokens and tool-result context:

| Mode | Verified | Total tokens | Change vs baseline | Tool-result chars | Tool calls | Wall time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline / `none` | 8/8 | 396,514 | — | 171,136 | 19 | 134.9 s |
| `some` | 8/8 | 364,800 | -8.0% | 3,301 | 15 | 131.6 s |
| `full` | 8/8 | 365,436 | -7.8% | 3,535 | 15 | 138.2 s |

The largest gain came from filtering large command output inside the command and stopping after sufficient line evidence. The Phase 5 Codex JSONL records did not expose price, cache-read/write, or reasoning-token detail, so their historical cost and cache claims remain unavailable. A later live routed run exposed `cached_input_tokens`, `cache_write_input_tokens`, and `reasoning_output_tokens`; current telemetry now normalizes those fields without rewriting historical results. Claude, OpenClaw, and Cursor are documented environment blockers rather than model-quality failures.

## 16. Native Context Execution

1. [x] Add state-aware pre-compaction transcript archiving and validated checkpoint generation (`src/native-context.mjs`).
2. [x] Add post-compaction restoration through host context injection where supported (`scripts/context-hook.mjs`).
3. [x] Configure OpenClaw native `contextPruning` and compaction through dry-run-validated owner CLI patches.
4. [x] Register Claude Code `PreCompact` and `SessionStart(compact)` hooks and adaptive native thresholds.
5. [x] Register Codex CLI `PreCompact`, `PostCompact`, and compact-session hooks; toggle native `context_management` with baseline restoration.
6. [x] Register Cursor `preCompact` and `sessionStart` hooks while preserving Cursor-owned summarization.
7. [x] Keep `none` inert and restore pre-Condiments settings rather than overwriting user configuration.
8. [x] Add atomic receipts, bounded event telemetry, idempotent configuration merges, and cross-platform tests.

## 17. Automatic Large-Output Interception

1. [x] Add state-aware native output profiles: `some` at 80K characters and `full` at 20K.
2. [x] Archive byte-exact strings or lossless structured JSON by SHA-256 and emit bounded, recoverable envelopes.
3. [x] Register Claude Code `PostToolUse` replacement while preserving built-in output shapes.
4. [x] Activate OpenClaw Tokenjuice pre-model middleware for `exec` and `bash`, with baseline restoration.
5. [x] Register Cursor `postToolUse` replacement for MCP results.
6. [x] Keep Codex post-output replacement unsupported; prevent oversized literal whole-file reads through trusted `PreToolUse:Bash` control.
7. [x] Add atomic telemetry, idempotent hook merging, CLI bundling, documentation, and tests.

## 18. Provider Prompt-Cache Control and Real Telemetry

1. [x] Add stable OpenAI `prompt_cache_key` request decoration and capability-gated extended retention.
2. [x] Add Anthropic automatic cache control for default 5-minute and extended 1-hour TTLs.
3. [x] Apply and restore OpenClaw native `cacheRetention` through dry-run-validated owner CLI patches.
4. [x] Ingest completed-turn transcript usage from Claude Code, Codex CLI, and Cursor hooks when fields are exposed.
5. [x] Persist deduplicated JSONL receipts without raw prompt prefixes or cache keys.
6. [x] Distinguish provider-reported zero cache use from absent telemetry.
7. [x] Preserve Anthropic cache-write TTL buckets and calculate hit ratios only over reported input.
8. [x] Add provider/model/mode rollups, telemetry coverage, and stable-prefix cache-read-drop detection.
9. [x] Add request-decoration, direct-ingest, report CLIs, adapter bundling, capability flags, documentation, and tests.

## 19. Codex Native Reasoning and Model Switching

1. [x] Register a Codex `UserPromptSubmit` hook with thread, turn, prompt, and current-model inputs.
2. [x] Enable and baseline-restore native `step_model_switching` and `reasoning_effort_override` features.
3. [x] Discover the authenticated model catalog through app-server `model/list`.
4. [x] Classify routine, standard, and escalation work from bounded task signals.
5. [x] Map `hot some|full` to cheapest-first advertised models and supported reasoning efforts.
6. [x] Write native project model/effort defaults for the next direct Codex CLI session, with exact baseline restoration.
7. [x] Apply active-turn settings through experimental `turn/settings/update` when a managed app-server control socket is available.
8. [x] Preserve the current model for `some` standard work to reduce cache-lineage churn.
9. [x] Fall back to the current or default advertised model when preferred models are unavailable.
10. [x] Add a routed `codex exec` wrapper for explicit headless execution.
11. [x] Add prompt-hash-only receipts, truthful native statuses, adapter bundling, documentation, and tests.
12. [x] Probe managed app-server routing once during installation; install or remove only the Condiments active-turn hook from that result.
13. [x] Expose dynamic `active-turn-route` capability status and never start a daemon automatically.

## 20. Real Long-Session Compaction Evaluation

1. [x] Add a resumable Codex CLI workload runner with a configurable native compaction threshold (`scripts/run-long-session-eval.mjs`).
2. [x] Capture authoritative rollout compaction events and thread-level cache/reasoning usage.
3. [x] Run a usage-capped `/cond full` live evaluation (`evals/results/long-session-evaluation.md`).
4. [x] Repair the evaluator so it installs Condiments hooks in an isolated workspace; retain recent exact assistant results and verify `PreCompact` checkpoint plus `SessionStart(compact)` injection.
5. [x] Add native compaction hysteresis (`body_after_prefix`), cooldowns, and maximum compactions per turn with exact baseline restoration.
6. [x] Add hard rollout-token/model-call evaluation budgets with delayed-accounting reserves.
7. [x] Make rollout-level totals, including internal compaction calls, authoritative in reports.
8. [x] Run and consolidate the corrected `baseline`/`some`/`full` matrix; all modes recovered seven exact values after one compaction. `some` measured 0.1% lower tokens and `full` 2.1% higher on this compact recovery workload, so no material savings claim is made.

## 21. Codex Large-File Command Guard

1. [x] Register an idempotent `PreToolUse:Bash` hook during Codex adapter installation.
2. [x] Resolve literal file sizes before `Get-Content`, `cat`, `type`, or `gc` whole-file reads.
3. [x] Block above 320,000 bytes under `ranch some` and 80,000 bytes under `ranch full`; keep `none` inert.
4. [x] Return bounded head/tail and exact-search retry commands without executing the risky read.
5. [x] Preserve explicit full-output intent through `condiments:allow-large-output`.

## 22. Provider-Native Response Budgets

1. [x] Add immutable request decoration for OpenAI Responses `max_output_tokens` and Anthropic Messages `max_tokens`.
2. [x] Add OpenClaw `maxTokens` request decoration and native `agents.defaults.params.maxTokens` application with baseline restoration.
3. [x] Map `mayo some` to 4,096 generated tokens and `mayo full` to 2,048 without raising an existing lower limit; tuned from live output and long-session recovery evidence.
4. [x] Capability-gate unsupported APIs and host project hooks; retain the 120-word final-response prompt contract.
5. [x] Bundle the request CLI, capability flags, documentation, and tests in every adapter.
6. [x] Detect OpenAI `max_output_tokens` and Anthropic `max_tokens` stop signals.
7. [x] Persist requested/actual/reasoning output counts with deduplicated telemetry.
8. [x] Fail provider-evaluation quality when a cap hit invalidates required output.
9. [x] Run isolated live Codex `mayo` baseline/some/full evaluation: all exact answers passed; output was 164/133/129 tokens, no cap hits, and `full` cut output 21.3% while total tokens rose 1.35% from fixed input overhead.

## 23. Policy Overhead Reduction

1. [x] Compile control state into protocol-v1 deltas; the largest global preset is 129 ASCII bytes.
2. [x] Load full rules once per installed-skill session; expose `--policy-prefix` for stable direct-provider session setup.
3. [x] Emit only changed controls after the initial state, including a compact all-off reset.
4. [x] Keep the once-per-session policy prefix byte-stable for provider prompt caching.
5. [x] Add `--prompt-only` and update every host adapter so status, capability flags, and native receipts stay outside model context.
6. [x] Run a tool-free live Codex baseline/some/full quality comparison on `gpt-5.6-luna` with exact condition/path/line/boundary checks.
7. [x] Pass the lower-total-token quality gate: all 3 modes verified; `some` reduced total tokens 0.150% and `full` 0.215%, with measured policy input overhead of 15 and 18 tokens.
6. [x] Log command hashes and file metadata without storing command text.
7. [x] Re-run the live long-session matrix with authoritative budgets after the five-hour allowance reset.

## 24. FIM and Patch-First Completion

1. [x] Detect edit tasks, explicit no-edit requests, and explicit full-file requests.
2. [x] Prefer confirmed native direct-file-edit tools on OpenClaw, Claude Code, Codex CLI, and Cursor.
3. [x] Emit the smallest exact changed block when direct edits and usable FIM are unavailable.
4. [x] Select FIM only behind a truthful native capability flag with bounded prefix/suffix input.
5. [x] Fall back to validated unified diff when no exact replaceable region exists.
6. [x] Block unrequested complete existing-file reproduction and repeated FIM context.
7. [x] Measure output and total tokens on two isolated real edit workloads under baseline/some/full (`evals/results/edit-completion-evaluation.md`): `some` reduced output 13.462% and total 2.082%; `full` reduced output 16.175% and total 2.921%.
8. [x] Require behavior tests, byte-exact changed files, unchanged-file checks, and no extra files for every live run; all 6 passed.

## 25. Tool Schema and Host Context Pruning

1. [x] Measure system, conversation, core-tool, other-tool, MCP, deferred, and unattributed input separately without claiming byte proxies are provider-exact tokens.
2. [x] Detect required tool categories from task signals while retaining only a task hash in telemetry.
3. [x] Load non-core OpenAI/Anthropic tool schemas lazily when a callable tool-search surface exists.
4. [x] Disable unrelated MCP entries under `full` while preserving task-relevant MCP access.
5. [x] Keep up to five common core tool definitions byte-stable and cacheable.
6. [x] Apply OpenClaw Code Mode and restore the exact captured baseline on `none`.
7. [x] Capability-gate native schema pruning; Claude Code, Codex CLI, and Cursor project surfaces report unsupported.
8. [x] Run exact `none`/`some`/`full` evaluation with required-tool quality gates. The deterministic provider-request preflight passed and measured 95.955% (`some`) / 95.896% (`full`) fewer initial-visible tool-schema bytes. After the five-hour reset, the final read-only live Codex CLI matrix passed all exact outputs and MCP calls: 38,584 / 38,567 / 38,653 total tokens. Codex therefore showed no material logical-token saving in this workload (`some` 0.044%, `full` −0.179% total reduction). See `evals/results/tool-context-evaluation.md` and `evals/results/codex-cli-tool-context-live.md`.

## 26. Cache-Lineage Controller

1. [x] Fingerprint provider/model/tool/system/reasoning/cache lineages without storing prompt or schema bodies.
2. [x] Compare projected input/output/reasoning savings with measured cached tokens at risk.
3. [x] Preserve model and reasoning settings below break-even; require explicit opt-in before restoring tools or system content.
4. [x] Let quality-required escalation override cache preservation.
5. [x] Integrate guarding into direct OpenAI/Anthropic prompt-cache decoration.
6. [x] Integrate same-session cache telemetry into Codex app-server model/reasoning routing when that route is available.
7. [x] Add hashed, deduplicated lineage telemetry, CLI commands, capability flags, adapter packaging, docs, and tests.
8. [x] Estimate observed opportunity from verified Codex telemetry: 3,072 recoverable uncached tokens, 36.402% for the affected turn and 15.997% across the three-run matrix; logical input reduction remains zero.
9. [ ] Run causal multi-turn A/B evaluation after gathering equivalent authenticated Claude telemetry.

## 27. Adaptive Output Governor

1. [x] Classify output work as micro, standard, or complex from bounded task signals, with explicit caller overrides.
2. [x] Apply `full` output caps of 128/512/2,048 tokens; keep `some` quality-biased at 512/2,048/4,096 and `none` inert.
3. [x] Prefer native direct edits and suppress successful edit recaps to changed paths, test result, and material failures.
4. [x] Limit tool calls by task size and policy strength; set OpenAI Responses `max_tool_calls` where supported.
5. [x] Keep Anthropic, OpenClaw, and host-only tool limits as explicit prompt contracts when no native field exists.
6. [x] Retry only when a named required result is absent or invalid; increase 128 → 512 → 2,048 and stop after two retries.
7. [x] Preserve fixed provider limits as fallback when no task evidence is supplied.
8. [x] Run live direct-edit and answer quality evaluation after the current usage window resets.
   The 2026-09-20 paired matrix passed all 18 exact-edit gates across Luna, Sol, and Astra, but token effects varied by model. See [paired-live-evaluation-v0.1.4.md](../evals/results/paired-live-evaluation-v0.1.4.md).
9. [x] Enforce one discovery plus one verification round, reuse existing results, and require a justified missing-evidence exception.
10. [x] Preserve required evidence by artifact or expanded cap instead of truncating it.

## 28. Verification-Aware Query Compressor

1. [x] Segment input into portable semantic evidence records with paths, line ranges, kinds, dependencies, and caller-supplied provider token counts.
2. [x] Rank optional evidence by query-aware lexical/semantic relevance, exact matches, dependency value, failure evidence, and score per token.
3. [x] Lock user-named paths, quoted symbols, opaque IDs, versions, numbers, explicit requirements, and caller-locked segments.
4. [x] Support exact, regex, segment, source, and line-range sufficiency requirements.
5. [x] Fail closed with no model prompt when any locked or required evidence is missing.
   Repository-specific async sufficiency validators can also fail closed and request named missing evidence.
6. [x] Exceed the token budget rather than discard locked evidence; label exact versus estimated token accounting.
7. [x] Retrieve only missing evidence and stop after one `some` or two `full` recovery rounds.
8. [x] Store content-free, deduplicated compression telemetry and aggregate verified token reductions.
9. [x] Add CLI, capability flags, adapter packaging, policy documentation, and deterministic tests.
10. [x] Run paired live coding evaluation with exact-file, test, error-evidence, and citation-grounding gates.
    The live matrix found model-dependent results and a Ranch-driven tool-round regression; no general savings claim is allowed. See [paired-live-evaluation-v0.1.4.md](../evals/results/paired-live-evaluation-v0.1.4.md).

## 29. Lossless Dictionary Compression for Repetitive Logs

1. [x] Split logs into exact records while preserving LF, CRLF, CR, and missing final newlines.
2. [x] Discover repeated templates across timestamps, UUIDs, addresses, numbers, durations, sizes, and percentages.
3. [x] Encode templates plus exact ordered substitutions only when the JSON representation is smaller than raw JSON.
   Consecutive template records use run packing with constant and arithmetic integer columns.
4. [x] Decode byte-exactly and reject hash, byte-count, template, and substitution corruption.
5. [x] Add bounded dictionary payloads to large-result envelopes while retaining hash-addressed artifacts and error evidence.
6. [x] Add portable CLI, adapter packaging, capability flags, documentation, and deterministic tests.
7. [x] Measure exact encoded-byte reduction on real repetitive fixture and command logs under a zero-model-call usage guard. Provider-token measurement remains pending.

## 30. Telemetry-Trained Output-Cap Selection

1. [x] Add task class and direct-edit labels to output-cap telemetry without storing prompt or response text.
2. [x] Scope training to exact provider, host, optimization level, and task class.
3. [x] Require eight verified samples; use nearest-rank p95 actual output plus 20% headroom and a 64-token quantum.
4. [x] Treat verified cap hits as censored lower bounds and reject learning after cap-caused required-result loss.
5. [x] Apply only a smaller learned cap; otherwise retain the static adaptive governor cap.
6. [x] Integrate learned selection into direct provider request decoration and expose training/selection CLIs.
7. [x] Add capability flags, adapter packaging, documentation, and deterministic safety tests.
8. [x] Run chronological shadow selection against existing authenticated Codex telemetry under a zero-model-call usage guard.
9. [ ] Run paired live direct-provider quality evaluation before enabling learned caps by default.

## 31. Reversible Dual-Form Memory

1. [x] Store exact raw session bytes in SHA-256 content-addressed objects and compact structured summaries in a session ledger.
2. [x] Integrate commit and folded references into native pre-compaction and restore hooks without injecting raw history.
3. [x] Enforce commit/expand/fold lifecycle bounds, action deduplication, summary similarity deduplication, and hash verification.
4. [x] Add CLI, adapter bundle, capability flags, documentation, and corruption/recovery tests.
5. [ ] Run long-session `none`/`some`/`full` evaluation with forced exact raw expansion only when checkpoint verification fails.
6. [x] Gate checkpoint creation on established sessions near context pressure; skip short sessions.

## 32. Significance-Aware Output and Hierarchical Budgets

1. [x] Classify semantic result blocks and protect paths, values, edits, tests, failures, citations, requested data, and unresolved work.
2. [x] Spend remaining soft budget on useful optional blocks by utility per token; deduplicate repeated optional prose.
3. [x] Fail quality when provider truncation removes a named required result.
4. [x] Split task caps exactly across locate, inspect, edit, verify, and report; favor verification and reduce direct-edit recap.
5. [x] Learn phase shares only from eight matching verified samples and detect inverse token elasticity.
6. [x] Add CLI, adapter bundle, capability flags, documentation, and deterministic tests.
7. [x] Run paired live edit/answer evaluation before training phase shares from provider telemetry.
   Quality passed, but shorter output did not consistently reduce total tokens. Keep learned phase shares disabled by default. See [paired-live-evaluation-v0.1.4.md](../evals/results/paired-live-evaluation-v0.1.4.md).

## 33. Query-Conditioned Context Allocation

1. [x] Weight errors, tests, code, configuration, dependencies, exact signals, and explicit requirements above generic prose/history.
2. [x] Penalize repetitive optional evidence while leaving locked evidence unaffected.
3. [x] Keep locked evidence at the front and strongest optional evidence at an ending attention boundary.
4. [x] Expose content-free score components while preserving fail-closed sufficiency and bounded recovery.
5. [x] Run paired live repository evaluation with provider-reported input and exact quality gates.
   Three counterbalanced Luna repeats plus Sol and Astra spot checks showed workload- and model-dependent outcomes. See [paired-live-evaluation-v0.1.4.md](../evals/results/paired-live-evaluation-v0.1.4.md).

## 34. Optional Learned Compression and Qwen Controls

1. [x] Add an opt-in LLMLingua-2 Python sidecar without downloading dependencies during installation.
2. [x] Require declared capability, extractive token order, locked-signal preservation, and net-positive estimated saving; otherwise return original input.
3. [x] Add capability-gated Qwen hybrid-thinking request decoration for native and OpenAI-compatible surfaces.
4. [x] Disable routine thinking under `full`, bound complex thinking, escalate for quality failure, and preserve lower caller budgets.
5. [x] Add CLIs, adapter bundle, truthful native capability flags, documentation, and deterministic tests.
6. [ ] Measure LLMLingua wall time and provider tokens on prose-heavy workloads with the model installed.
7. [ ] Run Qwen `none`/`some`/`full` reasoning-token and quality evaluation on an endpoint that reports reasoning usage.

## 35. Evidence-Gated Savings Routing

1. [x] Classify exact-edit, tool-heavy, and general workloads conservatively; keep lookups and simple edits on baseline.
2. [x] Enable Ranch alone for validated Luna debugging, tests, and noisy commands when `full` is requested; keep unevaluated strengths and evaluated regressions on baseline.
3. [x] Route unknown model/workload pairs to baseline with an explicit force override.
4. [x] Preserve byte-stable prompt prefixes, deduplicate stable instructions, and append changing task data last.
5. [x] Add CLI, references, adapter guidance, and deterministic tests.
6. [x] Rerun tuned controls: Ranch removed the earlier tool-call regression but stayed workload-dependent; Sol exact-edit `full` regressed 29.6% across two new repeats. See [savings-controls-evaluation-v0.1.4.md](../evals/results/savings-controls-evaluation-v0.1.4.md).
7. [x] Move duplicate suppression and one-discovery/one-verification enforcement into the Codex pre-tool hook.
8. [x] Omit policy text for baseline and inject only active controls' small directives.
9. [x] Preserve cache-sensitive request ordering and delay lineage changes below cached-token break-even.
10. [x] Gate Mayo task caps on projected output savings exceeding directive input cost.
