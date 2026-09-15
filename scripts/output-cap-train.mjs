#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { readOutputCapTelemetry } from "../src/output-budget.mjs";
import { selectTelemetryTrainedOutputCap, trainOutputCapPolicy } from "../src/output-cap-learner.mjs";

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const records = await readOutputCapTelemetry(options.root);
  const result = options.action === "select"
    ? selectTelemetryTrainedOutputCap(records, options, options)
    : trainOutputCapPolicy(records, options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function parseOptions(args) {
  const action = ["train", "select"].includes(args[0]) ? args.shift() : "train";
  const options = { action, root: process.cwd() };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--root") options.root = path.resolve(value(args, ++index, arg));
    else if (arg === "--provider") options.provider = value(args, ++index, arg);
    else if (arg === "--host") options.host = value(args, ++index, arg);
    else if (arg === "--level") options.level = value(args, ++index, arg);
    else if (arg === "--task-class") options.taskClass = value(args, ++index, arg);
    else if (arg === "--fallback-cap") options.fallbackCap = integer(value(args, ++index, arg), arg);
    else if (arg === "--min-samples") options.minSamples = integer(value(args, ++index, arg), arg);
    else if (arg === "--quantile") options.quantile = Number(value(args, ++index, arg));
    else if (arg === "--headroom") options.headroom = Number(value(args, ++index, arg));
    else if (arg === "--lookback") options.lookback = integer(value(args, ++index, arg), arg);
    else throw new Error(`Unknown option '${arg}'.`);
  }
  if (action === "select" && (!options.provider || !options.host || !options.level || !options.taskClass || !options.fallbackCap)) {
    throw new Error("select requires --provider, --host, --level, --task-class, and --fallback-cap.");
  }
  return options;
}

function value(args, index, option) {
  if (index >= args.length || args[index].startsWith("--")) throw new Error(`${option} requires a value.`);
  return args[index];
}

function integer(input, option) {
  const parsed = Number(input);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${option} requires a positive integer.`);
  return parsed;
}

main().catch((error) => {
  process.stderr.write(`condiments-output-cap-train: ${error.message}\n`);
  process.exitCode = 2;
});
