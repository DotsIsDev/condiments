# Changelog

All notable changes to Condiments will be recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/DotsIsDev/condiments/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/DotsIsDev/condiments/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/DotsIsDev/condiments/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/DotsIsDev/condiments/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/DotsIsDev/condiments/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/DotsIsDev/condiments/releases/tag/v0.1.0
