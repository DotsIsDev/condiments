#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { decodeLogDictionary, encodeLogDictionary } from "../src/log-dictionary.mjs";

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const text = options.input === "-" ? await readStdin() : await readFile(path.resolve(options.input), "utf8");
  if (options.action === "decode") {
    process.stdout.write(decodeLogDictionary(JSON.parse(text)));
    return;
  }
  const result = encodeLogDictionary(text, options);
  process.stdout.write(`${JSON.stringify(result, null, options.compact ? 0 : 2)}\n`);
}

function parseOptions(args) {
  const action = ["encode", "decode"].includes(args[0]) ? args.shift() : "encode";
  const options = { action, input: "-", compact: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--input") options.input = value(args, ++index, arg);
    else if (arg === "--min-occurrences") options.minOccurrences = integer(value(args, ++index, arg), arg, 1);
    else if (arg === "--min-savings") options.minSavingsBytes = integer(value(args, ++index, arg), arg, 0);
    else if (arg === "--compact") options.compact = true;
    else throw new Error(`Unknown option '${arg}'.`);
  }
  return options;
}

function value(args, index, option) {
  if (index >= args.length || args[index].startsWith("--")) throw new Error(`${option} requires a value.`);
  return args[index];
}

function integer(input, option, minimum) {
  const parsed = Number(input);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`${option} requires an integer >= ${minimum}.`);
  return parsed;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

main().catch((error) => {
  process.stderr.write(`condiments-log-dictionary: ${error.message}\n`);
  process.exitCode = 2;
});
