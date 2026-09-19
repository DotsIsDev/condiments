# Changelog

All notable changes to Condiments will be recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/DotsIsDev/condiments/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/DotsIsDev/condiments/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/DotsIsDev/condiments/releases/tag/v0.1.0
