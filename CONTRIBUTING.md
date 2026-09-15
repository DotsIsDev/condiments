# Contributing to Condiments

Thanks for helping make coding agents less hungry for tokens.

## Before you begin

- Open an issue for substantial behavior changes.
- Do not include API keys, private prompts, proprietary source, or raw user transcripts.
- Keep optimization claims tied to reproducible evidence.
- Preserve required-result and exact-file quality gates.

## Local setup

```sh
git clone https://github.com/DotsIsDev/condiments.git
cd condiments
npm install
npm test
```

Node.js 20 or newer is required.

## Pull requests

1. Keep each change focused.
2. Add or update meaningful tests for policy or runtime behavior.
3. Run `npm test` and `npm run pack:check`.
4. Document user-visible commands, capabilities, or evaluation changes.
5. Report provider tokens and quality checks separately. Do not present byte estimates as billed token measurements.

For new evaluations, record the model, host, workload, budget, exact success criteria, retries, and whether usage comes from provider telemetry or an estimate.

By contributing, you agree that your contribution is licensed under the MIT License.
