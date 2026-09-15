#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import { normalizeUsage, summarizeRuns } from "../src/usage.mjs";

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const raw = options.input === "-"
    ? await readStdin()
    : await readFile(options.input, "utf8");
  const payload = JSON.parse(raw);
  const items = Array.isArray(payload) ? payload : [payload];
  const runs = items.map((item) => normalizeUsage(
    options.provider || item.provider,
    item.payload ?? item,
    {
      ...(item.metadata ?? {}),
      ...(options.verified ? { verificationPassed: true } : {}),
    },
  ));
  process.stdout.write(`${JSON.stringify({ runs, summary: summarizeRuns(runs) }, null, 2)}\n`);
}

function parseOptions(args) {
  const options = { provider: undefined, input: undefined, verified: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--provider") options.provider = requireValue(args, ++index, arg);
    else if (arg === "--input") options.input = requireValue(args, ++index, arg);
    else if (arg === "--verified") options.verified = true;
    else throw new Error(`Unknown option '${arg}'.`);
  }
  if (!options.input) throw new Error("--input is required; use - for stdin.");
  return options;
}

function requireValue(args, index, option) {
  if (index >= args.length || args[index].startsWith("--")) throw new Error(`${option} requires a value.`);
  return args[index];
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

main().catch((error) => {
  process.stderr.write(`condiments-usage: ${error.message}\n`);
  process.exitCode = 2;
});

