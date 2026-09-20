# Native Large-Output Interception

Condiments applies this control from effective `ranch` state. `none` passes results through. `some` and `full` archive oversized text by SHA-256 and replace model-visible output only where the host exposes a replacement contract. String results are preserved byte-for-byte; structured results use a lossless JSON serialization of the hook payload.

## Profiles

| Level | Trigger | Head | Tail | Error evidence |
| --- | ---: | ---: | ---: | ---: |
| `some` | 80,000 characters | 2,000 | 2,000 | 20 lines / 8,000 characters |
| `full` | 20,000 characters | 1,000 | 1,000 | 12 lines / 4,000 characters |

The envelope preserves the tool name, request summary, exit status, original character and byte counts, SHA-256 hash, bounded previews, error lines, and absolute artifact path. Identical output reuses one artifact under `.condiments/artifacts/`. Before replacement, supported hooks also record the exact result in compact tool state. A later identical successful call can reuse that artifact without rerunning the tool; an unchanged failed call is blocked until inputs change or the caller supplies a justification. Repetitive logs also carry a lossless, hash-verified dictionary payload when the full encoded envelope fits the model-visible budget. See [log-dictionary.md](log-dictionary.md) and [compact-tool-state.md](compact-tool-state.md).

## Host execution

### Claude Code

The installer adds a `PostToolUse` hook. The hook returns `updatedToolOutput`, preserving the original output type and structured shape. Large string fields are replaced until the result is bounded. MCP results may fall back to a whole-result envelope because Claude does not schema-check MCP replacement output.

### OpenClaw

`/cond ranch some|full` enables the official Tokenjuice plugin when the owner CLI is available. Tokenjuice uses OpenClaw's pre-model tool-result middleware for `exec` and `bash`. `none` restores the plugin state captured before Condiments. Missing installation, consent, or CLI access is reported as pending.

### Cursor

The installer adds `postToolUse` for `MCP:.*`. Cursor accepts `updated_mcp_tool_output`, so oversized MCP results are replaced before the next model turn. Cursor shell hooks expose output for observation but do not document a shell-output replacement field; shell output therefore remains prompt-controlled.

### Codex CLI

Codex cannot replace output after `PostToolUse`, so Condiments uses trusted `PreToolUse:Bash` control. For tool-heavy debugging, testing, and noisy-command tasks, the hook permits one discovery and one verification command per turn and blocks exact duplicates. One additional command is available with a `condiments:extra-tool=<missing evidence>` marker. Lookups and simple edits do not enter round accounting. The per-turn ledger stores hashes and counts only under `.condiments/tool-rounds/`.

For preventable file-read explosions, the same hook resolves literal file paths and blocks unbounded whole-file reads above 320,000 bytes under `ranch some` or 80,000 bytes under `ranch full`. Its denial returns two retry choices: a bounded head/tail read and an exact `rg` search. Already bounded commands and smaller files pass unchanged.

The check is deliberately narrow: it covers literal paths used by `Get-Content`, `cat`, `type`, or `gc`. It does not guess the output of arbitrary programs or variable-expanded paths. Add `condiments:allow-large-output` to the command only when complete output is required. Hook logs store a command hash and file metadata, not command text.

Codex hooks require project trust. The explicit `condiments-result` helper remains available for output that cannot be prevented before execution.

## Recovery and telemetry

```text
.condiments/artifacts/<tool>-<hash>.txt
.condiments/native-output/events.jsonl
.condiments/native-output/last-apply.json
.condiments/command-guard/events.jsonl
.condiments/tool-rounds/<session-hash>/<turn-hash>.json
.condiments/tool-state/objects/<sha256>
.condiments/tool-state/sessions/<session-hash>/<turn-hash>.json
```

Retrieve exact archived output only when the envelope lacks required evidence.

## Primary references

- [Claude Code PostToolUse replacement](https://code.claude.com/docs/en/hooks#posttooluse-decision-control)
- [OpenClaw Tokenjuice](https://docs.openclaw.ai/tools/tokenjuice)
- [OpenClaw tool-result middleware](https://docs.openclaw.ai/plugins/sdk-overview/host-hooks#when-to-use-tool-result-middleware)
- [Cursor hooks](https://prod.cursor.com/docs/hooks)
- [Codex output-replacement limitation](https://github.com/openai/codex/issues/38135)
