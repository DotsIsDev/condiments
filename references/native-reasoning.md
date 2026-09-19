# Codex Native Model and Reasoning Routing

The Codex adapter maps effective `hot` state to native model and reasoning settings. Direct Codex CLI sessions receive a project default on their next launch. Managed app-server sessions also register a `UserPromptSubmit` hook that can classify each prompt and call experimental `turn/settings/update` before model sampling.

## Routing policy

| Level | Routine | Standard coding | Escalation |
| --- | --- | --- | --- |
| `none` | Preserve current settings | Preserve current settings | Preserve current settings |
| `some` | Terra/compatible efficient model, low | Current model, medium | Astra/current strongest, high |
| `full` | Luna/cheapest advertised candidate, low | Terra/compatible balanced model, low | Astra/current strongest, high |

Escalation signals include repeated failures, conflicting evidence, explicit requests for deeper reasoning, security/authentication work, data-loss risk, concurrency, races, and deadlocks. Implementation, migration, debugging, design, optimization, and large requests use the standard route. Other prompts use the routine route.

The router only selects a model returned by Codex `model/list`. If preferred models are unavailable, it keeps the current model or uses Codex's advertised default. It also selects the nearest reasoning effort supported by that model.

## Native activation

`/cond hot some|full` enables these project-scoped Codex features:

```toml
[features]
step_model_switching = true
reasoning_effort_override = false
```

The next direct Codex CLI session loads a routed `model` and `model_reasoning_effort` project default. Condiments keeps `reasoning_effort_override` disabled because Codex represents that experimental feature as a `configuration_update` input item, which some advertised models reject. Managed sessions use `turn/settings/update`; explicit routed executions use command-line settings. `none` restores all four exact pre-Condiments values captured in `.condiments/native-reasoning/codex-baseline.json`.

At adapter installation, Condiments probes `codex app-server proxy` once. It does not start a daemon. Only a successful probe installs the active-turn hook and sets `active-turn-route=yes`. A failed probe removes any stale Condiments routing hook while preserving unrelated hooks.

When a managed app-server control socket is available, the installed turn hook uses:

```text
UserPromptSubmit -> model/list -> turn/settings/update
```

Routing receipts are appended to `.condiments/native-reasoning/events.jsonl`. They contain the selected route, native response status, and SHA-256 prompt hash. Prompt text is not stored. Direct interactive CLI processes do not expose their active turn through the managed proxy; there, no routing hook is installed. The project default and explicit wrapper provide native execution. If an available socket later fails, the hook does not block the user prompt and records the unavailable result.

These Codex features are currently marked under development. Each managed native response is therefore recorded as `applied`, `targetunavailable`, `rejected`, or unavailable rather than assuming the switch succeeded.

Re-run the adapter installer when managed-daemon availability changes. This refreshes the probe result and adds or removes only the Condiments routing hook.

## Explicit routed execution

Inspect a route without running a model:

```text
node scripts/codex-route.mjs route --level full --prompt "Fix typo"
```

Run a separate Codex execution with the selected native model and reasoning setting:

```text
node scripts/codex-route.mjs exec --level full --prompt "Implement parser" --cwd . --json
```

The wrapper uses Codex's native `--model` and `-c model_reasoning_effort=...` arguments.

## Cache behavior

Changing models starts another prompt-cache lineage. `some` therefore keeps the current model for standard coding work. Condiments does not append reasoning configuration updates to interactive history; managed turn settings and explicit executions change effort outside model input. Cache telemetry must still verify actual reuse.

The cache-lineage controller now checks latest same-session provider cache telemetry before active-turn routing. Below break-even, it retains the current model and reasoning effort. Escalation work always bypasses that hold. When no managed socket exists, `scripts/codex-route.mjs` uses the latest compatible project telemetry for the same check during explicit routed execution. See [cache-lineage.md](cache-lineage.md).

## Primary sources

- Codex configuration schema: https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json
- Codex model discovery protocol: https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/model.rs
- Codex turn settings protocol: https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/turn.rs
- OpenAI model guidance: https://developers.openai.com/api/docs/guides/latest-model
