# Mustard: context selection

Read this module only when Mustard is active.

Search filenames and symbols before reading files. Fetch relevant definitions, tests, and bounded line regions. Avoid dependencies, generated files, binaries, large lockfiles, and unrelated references unless required.

For long evidence, use `scripts/query-compressor.mjs`. Lock user-named paths, symbols, IDs, numbers, errors, citations, requirements, and line ranges. Send compressed context only when validation passes. Expand only reported evidence gaps and stay within the recovery limit. Optional learned compression remains capability-gated; never run it on exact code, JSON, diffs, or diagnostics without deterministic locks.

Details: [query-compressor.md](../query-compressor.md).
