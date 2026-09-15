# Prompt Cache Control and Telemetry

`ranch` controls provider prompt-cache optimization together with tool batching:

| Level | Provider request policy | Native OpenClaw policy |
| --- | --- | --- |
| `none` | Leave the request unchanged | Restore captured `cacheRetention` |
| `some` | Stable OpenAI cache key; Anthropic 5-minute ephemeral cache | `cacheRetention: short` |
| `full` | Stable OpenAI key plus supported extended TTL; Anthropic 1-hour ephemeral cache | `cacheRetention: long` |

OpenAI `full` uses `prompt_cache_options.ttl: "30m"` only for recognized GPT-5.6+ models or when `--modern` explicitly confirms compatibility. Legacy `prompt_cache_retention: "24h"` requires `--legacy`. This prevents unsupported fields from being sent to compatible proxies or older models.

Decorate a raw provider request:

```text
node scripts/prompt-cache.mjs decorate --provider openai --level full --model gpt-5.6 --stable-prefix project-v1 --input request.json
node scripts/prompt-cache.mjs decorate --provider anthropic --level full --input request.json
```

The OpenAI cache key is a SHA-256-derived stable identifier. Raw prompt prefixes and explicit cache keys are never written to telemetry.

## Telemetry

Native adapter hooks scan completed-turn transcripts and append deduplicated JSONL records to:

```text
.condiments/prompt-cache/events.jsonl
```

Ingest a provider response directly, then report stored telemetry:

```text
node scripts/prompt-cache.mjs ingest --provider openai --root . --input response.json
node scripts/prompt-cache.mjs report --root .
```

Each record distinguishes these cases:

- `cache_read_reported: true`, `cache_read_tokens: 0`: the provider reported a real miss.
- `cache_read_reported: false`, `cache_read_tokens: 0`: the provider omitted the counter.
- `cache_telemetry_available`: at least one cache counter was exposed.
- Anthropic 5-minute and 1-hour cache-write buckets remain separate.

Reports include telemetry coverage, cache-hit ratio over reported events only, provider/model/mode groups, and a `cache-read-drop` alert when the same supplied prefix fingerprint falls from a hit to zero.

## Host boundaries

| Host | Request control | Telemetry path |
| --- | --- | --- |
| OpenClaw | Native `cacheRetention` via dry-run-validated config patch | Native `cacheRead` / `cacheWrite`; direct/transcript ingest supported |
| Claude Code | Provider request knobs are not exposed to project hooks | `Stop` transcript ingestion |
| Codex CLI | Provider request knobs are not exposed to project hooks | `Stop` transcript ingestion; current JSONL `cached_input_tokens` and `cache_write_input_tokens` are normalized |
| Cursor | Provider request knobs are not exposed to project hooks | `sessionEnd` transcript ingestion when fields exist; SDK/OTEL events can be ingested directly |

Capability flags remain false where a host does not expose a confirmed counter or control. A hook installation alone is not reported as provider telemetry support.

## Primary sources

- OpenAI prompt caching: https://developers.openai.com/api/docs/guides/prompt-caching
- Anthropic prompt caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- OpenClaw prompt caching: https://docs.openclaw.ai/reference/prompt-caching
- Cursor SDK token usage: https://prod.cursor.com/docs/sdk/python
- Cursor OpenTelemetry token metrics: https://prod.cursor.com/docs/enterprise/opentelemetry-export/wire
