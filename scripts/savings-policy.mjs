#!/usr/bin/env node

import process from "node:process";
import { resolveSavingsPlan } from "../src/savings-policy.mjs";

try {
  const options = parseOptions(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(resolveSavingsPlan(options), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`condiments-savings-policy: ${error.message}\n`);
  process.exitCode = 2;
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--model") options.model = value(args, ++index, arg);
    else if (arg === "--level") options.requestedLevel = value(args, ++index, arg);
    else if (arg === "--workload") options.workload = value(args, ++index, arg);
    else if (arg === "--task") options.task = value(args, ++index, arg);
    else if (arg === "--exact-edit") options.exactEdit = true;
    else if (arg === "--direct-edit") options.directEdit = true;
    else if (arg === "--tool-heavy") options.toolHeavy = true;
    else if (arg === "--native-tool-control") options.nativeToolControl = true;
    else if (arg === "--policy-input-tokens") (options.outputEconomics ??= {}).policyInputTokens = Number(value(args, ++index, arg));
    else if (arg === "--projected-output-savings-tokens") (options.outputEconomics ??= {}).projectedOutputSavingsTokens = Number(value(args, ++index, arg));
    else if (arg === "--force") options.force = true;
    else throw new Error(`Unknown option '${arg}'.`);
  }
  if (!options.model) throw new Error("--model is required.");
  return options;
}

function value(args, index, option) {
  if (index >= args.length || args[index].startsWith("--")) throw new Error(`${option} requires a value.`);
  return args[index];
}
