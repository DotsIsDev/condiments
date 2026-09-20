# Zero-token memory

`scripts/zero-token-memory.mjs` maintains a local provenance index and never invokes an LLM.

```text
ingest --root <workspace> --input <json|->
query  --root <workspace> --input <json|->
decide --input <json|->
```

Ingest input requires `sessionId` and `rawText` or `rawPath`. Optional exact signals include `paths`, `symbols`, `errors`, `commands`, `turn`, `verified`, and `outcome`. Raw bytes are content-addressed under `.condiments/zero-memory/objects/`; the index stores hashes, provenance, and signals.

Query input requires `query`; optional `sessionId`, `topK`, and `maxChars` bound evidence. Results include verified raw paths, hashes, and previews. `providerCalls` and `providerTokens` are always zero.

Decision input accepts `level`, `turnCount`, `recurrenceCount`, context counters, and `compactionImminent`. Generative consolidation remains off in short sessions and below both recurrence and pressure thresholds.
