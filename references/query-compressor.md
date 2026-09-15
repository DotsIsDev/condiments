# Verification-Aware Query Compressor

Ranking also uses evidence-type weights and a repetition penalty. Errors, tests, code, configuration, exact requirements, and dependencies outrank generic prose. Locked evidence stays at the front; the strongest optional evidence is placed at the ending attention boundary. `scoreComponents` exposes the deterministic inputs without storing them in telemetry.

This compressor reduces true logical input before a model request. It operates on semantic evidence units and fails closed when required evidence is missing.

## Profiles

| Level | Default retained-token target | Recovery rounds |
| --- | ---: | ---: |
| `none` | 100% | 0 |
| `some` | 65% | 1 |
| `full` | 35% | 2 |

Targets are ceilings for optional evidence. Locked evidence always survives, even when this makes the result exceed budget. Ratios are initial policy values and are not savings claims.

## Evidence model

Each segment may include `id`, `content`, `path`, `source`, `startLine`, `endLine`, `kind`, `dependencies`, `dependsOn`, `semanticScore`, and an exact provider `tokenCount`. Without `tokenCount`, the portable fallback estimates UTF-8 bytes divided by four and labels telemetry `estimated`.

The scorer combines query lexical overlap, an optional semantic score, exact matches, dependencies, and failure evidence. These inputs become locked:

- paths, quoted symbols/phrases, opaque IDs, versions, and numbers named by the query;
- explicit exact, regex, segment, source, or line-range requirements;
- segments explicitly marked `locked`.

Selection ranks optional whole segments by score per token. It does not slice code, error messages, or citations mid-unit. Zero-relevance evidence is omitted instead of filling the budget.

## Quality gate and recovery

Validation checks every locked source segment, explicit requirement, and query signal that existed in the source. An invalid result has `readyForModel=false` and `prompt=null`. Never feed that result to a model.

`recover` passes only the missing requirement descriptions to a caller-provided retriever or consumes `recoveryBatches`. It recompresses after each retrieval and stops immediately on success. Recovery is bounded by profile.

Library callers may provide `verifySufficiency(result, context)`. It returns `true`, `false`, or `{ valid, missing }`. This supports repository tests, citation grounding, schema checks, and other task-specific validators. A failed external verdict clears the prompt and sends only its missing IDs to `retrieveMissing`.

## CLI

Input JSON example:

```json
{
  "level": "full",
  "query": "Fix `discount` in src/cart.ts; expected 85",
  "evidence": [
    { "id": "code", "path": "src/cart.ts", "startLine": 40, "endLine": 48, "kind": "code", "content": "...", "tokenCount": 30 },
    { "id": "test", "path": "test/cart.test.ts", "kind": "test", "content": "expected 85, received 80", "tokenCount": 15 }
  ],
  "requirements": [
    { "id": "target", "type": "line", "path": "src/cart.ts", "startLine": 42 },
    { "id": "expected", "type": "exact", "value": "expected 85" }
  ]
}
```

```text
node scripts/query-compressor.mjs compress --input request.json --record --root .
node scripts/query-compressor.mjs recover --input request-with-recovery-batches.json
node scripts/query-compressor.mjs report --root .
```

Telemetry is written to `.condiments/query-compressor/events.jsonl`. It contains query hashes, segment/token counts, quality state, budget overflow, and recovery rounds. It excludes queries, evidence content, paths, symbols, requirement values, and selected IDs.

This design follows the query-aware rate-distortion result, IterCOMP’s evidence and answerability loop, and the 2026 finding that answer correctness alone can hide severe grounding loss. See [LATEST_TOKEN_REDUCTION_RESEARCH.md](../research/LATEST_TOKEN_REDUCTION_RESEARCH.md).
