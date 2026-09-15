# Lossless Log Dictionary Compression

`ranch some|full` applies dictionary compression to oversized repetitive logs before a result reaches the model. The original output remains in the hash-addressed artifact. The dictionary payload is included only when it is smaller than raw JSON and the complete result envelope remains below the active interception threshold.

The codec splits text while preserving every line ending. It groups repeated line templates and replaces timestamps, UUIDs, addresses, numbers, durations, sizes, and percentages with ordered substitutions. Consecutive template records are run-packed; constant and arithmetic integer columns use compact lossless forms. Repeated identical lines also qualify. Groups need three occurrences and a positive encoded-byte saving by default.

The wire payload uses compact keys:

- `d`: templates, with `null` marking substitution positions.
- `r`: raw strings or arrays containing a template index followed by exact substitutions.
- `h`: SHA-256 of the original text.
- `b`: original UTF-8 byte count.

Decoding verifies both the hash and byte count. Any tampering, missing substitution, malformed template, or extra substitution fails instead of returning partial text.

```text
node scripts/log-dictionary.mjs encode --input build.log --compact > encoded.json
node scripts/log-dictionary.mjs decode --input encoded.json > restored.log
```

Use `--min-occurrences` and `--min-savings` to tune standalone encoding. Use `--no-dictionary` with `scripts/compact-tool-result.mjs` to disable this path. Compression rate measures encoded JSON bytes against the equivalent raw JSON payload; it is not claimed as provider token reduction until live telemetry measures it.
