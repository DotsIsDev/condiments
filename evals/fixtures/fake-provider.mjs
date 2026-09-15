import process from "node:process";

for await (const _chunk of process.stdin) {
  // Consume prompt so integration test covers stdin delivery.
}

process.stdout.write(`${JSON.stringify({
  result: JSON.stringify({
    symbol: "TargetSymbol",
    file: "src/target.js",
    line: 2,
    evidence: "export function TargetSymbol()",
  }),
  usage: {
    input_tokens: 100,
    output_tokens: 20,
    cache_read_input_tokens: 50,
    cache_creation_input_tokens: 10,
  },
  total_cost_usd: 0.01,
  duration_ms: 5,
  num_turns: 1,
})}\n`);

