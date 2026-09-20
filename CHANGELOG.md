# Changelog

All notable changes to Condiments will be recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.5] - 2026-09-20

### Added

- Progressive skill disclosure with deterministic release auditing and compact host/control modules.
- Zero-token local memory with content-addressed raw evidence, deterministic signal lookup, and pressure-aware consolidation decisions.
- Compact tool-state artifacts that let Ranch reuse successful results and suppress unchanged failed calls.
- Amortized workflow-pruning decisions with paired-sample, quality, confidence, and break-even gates.
- A resumable paired live evaluation for disclosure, local memory, compact tool state, and amortized deployment decisions.

### Fixed

- Conditional policy directives now match their documented controls: Mustard selects context, Ketchup handles memory, and Hot controls reasoning.
- Provider evaluation prompts now include the stable Condiments protocol prefix before compact state deltas, preventing invalid evaluations where models received control codes without their semantics.
- Ranch now reuses sufficient tool results and defaults to one discovery plus one verification round; exceptional rounds require missing required evidence and a written justification.
- Codex now enforces Ranch rounds and duplicate suppression in the native pre-tool hook, without spending prompt tokens on those limits.

### Changed

- Eight paired Luna runs validated progressive disclosure at 5.1% lower total tokens and zero-token local memory at 32.2% lower total tokens, with every exact-answer gate passing.
- Prompt-only compact tool-state reuse remains disabled after Luna reran commands in six of eight candidate cells; native or caller-enforced blocking is required.
- Luna `full` now enables Ketchup alone for explicit prior-session recall. Unevaluated memory/model combinations remain baseline.
- Skill entry points now load the stable policy core, current host module, and active control modules instead of eagerly loading the combined policy reference.
- Native Ranch output handling records exact tool evidence for later local reuse before applying model-visible output bounds.
- Long-session evaluation accepts `--model` and `--effort` overrides so all modes can use the same route for causal memory comparisons.
- Added evidence-gated routing. Replication demoted Sol exact edits after the earlier saving failed to reproduce; only the validated Luna tool-heavy Ranch route activates automatically.
- Cache-friendly prompt assembly preserves a byte-stable prefix, removes repeated stable instructions, and appends changing task data last.
- Checkpoints now require an established session near measured context pressure or imminent compaction, while short sessions skip checkpoint work.
- Adaptive output caps now preserve required evidence through an artifact or an expanded provider cap.
- A 38-call replication evaluation demoted all automatic savings routes to baseline: tuned Ranch reduced logical tokens only on tool-heavy work and raised uncached input, while Sol exact-edit savings failed two new repeats.
- Luna tool-heavy work with requested `full` now enables Ranch alone; lookups, simple edits, unevaluated strengths, and unevaluated model/workload pairs stay at baseline.
- Baseline requests omit the Condiments policy, while active routes inject only each active control's small directive.
- Cache-aware request preparation preserves expensive request lineage and appends changing task data last.
- Mayo task caps now require projected output savings to exceed their policy-input cost.

## [0.1.4] - 2026-09-19

### Added

- Added `/cond v`, `/cond ver`, and `/cond version` aliases, including `/condiments` forms, for reporting the installed release from the bundled package metadata.
- Added machine-readable version output through `--json`.

### Changed

- Added a command-only fast path for all adapters. Enabling, disabling, resetting, checking status, and reporting version now skip sibling-skill and policy-reference reads.

### Fixed

- Version checks no longer read, create, or change Condiments policy state.
- Removed unnecessary policy-loading work from simple control commands, reducing enable and disable latency while preserving native policy application.

## [0.1.3] - 2026-09-18

### Changed

- Expanded the README with the cross-provider reasoning controls introduced in 0.1.2.
- Added a transparent sensitivity estimate for reasoning-token and total-token savings.

## [0.1.2] - 2026-09-18

### Added

- DeepSeek V4.1 direct-request controls for adaptive reasoning effort, tool-safe reasoning-history elision, native output caps, and usage normalization.
- Shared capability-gated reasoning governor for OpenAI Responses, Anthropic Messages, Qwen, and DeepSeek, including cache-lineage protection and Claude server-side thinking cleanup.

## [0.1.1] - 2026-09-18

### Added

- Public repository documentation and contribution standards.
- GitHub and npm installation paths.
- CI and package validation.

### Fixed

- Prevent Codex model failures from unsupported `configuration_update` input items by keeping the experimental reasoning-effort override disabled.

## [0.1.0] - 2026-09-15

### Added

- Five `none`/`some`/`full` token-efficiency controls.
- Adapters for Codex CLI, Claude Code, Cursor, and OpenClaw.
- Context compression, checkpoints, large-output handling, prompt-cache telemetry, model routing, patch-first completion, and evaluation tooling.

[Unreleased]: https://github.com/DotsIsDev/condiments/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/DotsIsDev/condiments/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/DotsIsDev/condiments/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/DotsIsDev/condiments/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/DotsIsDev/condiments/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/DotsIsDev/condiments/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/DotsIsDev/condiments/releases/tag/v0.1.0
