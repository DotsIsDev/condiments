# Compact Policy Protocol

Condiments keeps full control rules in the installed skill and sends a compact state delta when settings change. This avoids repeating status, capability flags, receipts, and long policy prose in model context.

## Stable session prefix

`renderPolicyPrefix()` defines protocol version 1. Inject it once when building a direct provider session, place it in the stable system/developer prefix, and keep it byte-identical for prompt caching. Installed coding-agent skills already carry the same rules, so normal mode changes need only the state delta.

Get prefix plus first delta:

```bash
node scripts/condiments.mjs /cond full --prompt-only --policy-prefix
```

Later mode changes:

```bash
node scripts/condiments.mjs /cond mayo full --prompt-only
```

## Delta format

```text
<cond v=1 m=f,u=s,k=n,r=f,h=s o=120w-simple-terse c=target t=batch-cache-dedupe z=adaptive q=verify/>
```

Control codes:

| Code | Control |
| --- | --- |
| `m` | mayo/output |
| `u` | mustard/context |
| `k` | ketchup/memory |
| `r` | ranch/tools/cache |
| `h` | hot/reasoning |

Levels are `n` off, `s` some, and `f` full. Only changed controls appear. `<cond v=1 reset/>` turns all controls off. `q=verify` retains the correctness guard.

Directive codes are compact reminders for one-shot and portable hosts:

- `o`: response length/style
- `c`: context loading
- `x`: checkpoint policy
- `t`: tool execution/cache behavior
- `z`: reasoning escalation

For `m=s|f`, the stable prefix also enables patch-first edit handling: direct file edit, native FIM when capability-confirmed, smallest exact changed block, then unified diff. Full existing files are blocked unless requested.

For `r=s|f`, keep a small stable core tool set and discover other schemas lazily. Under `full`, exclude unrelated MCP schemas where provider/native control is reversible.

The largest global preset delta is 129 ASCII bytes. Individual changes are smaller. `--prompt-only` emits no human status, capability flags, or native receipts. Normal CLI output remains available for `/cond status`.
