#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import {
  createFimEnvelope,
  detectEditTask,
  resolveCompletionStrategy,
  validateCompletionOutput,
} from "../src/completion-policy.mjs";

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const input = options.input ? JSON.parse(await readFile(options.input, "utf8")) : {};
  const task = options.task ?? input.task ?? "";
  const capabilities = options.capabilities
    ? JSON.parse(await readFile(options.capabilities, "utf8"))
    : input.capabilities;
  if (options.action === "detect") {
    process.stdout.write(`${JSON.stringify(detectEditTask(task), null, 2)}\n`);
    return;
  }
  if (options.action === "fim") {
    process.stdout.write(`${JSON.stringify(createFimEnvelope(input), null, 2)}\n`);
    return;
  }
  if (options.action === "validate") {
    const result = validateCompletionOutput(input);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.valid) process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify(resolveCompletionStrategy({ ...input, task, capabilities, level: options.level ?? input.level }), null, 2)}\n`);
}

function parseOptions(args) {
  const options = { action: "resolve" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (["detect", "resolve", "fim", "validate"].includes(arg) && index === 0) options.action = arg;
    else if (arg === "--task") options.task = value(args, ++index, arg);
    else if (arg === "--level") options.level = value(args, ++index, arg);
    else if (arg === "--input") options.input = value(args, ++index, arg);
    else if (arg === "--capabilities") options.capabilities = value(args, ++index, arg);
    else throw new Error(`Unknown option '${arg}'.`);
  }
  return options;
}

function value(args, index, option) {
  if (index >= args.length || args[index].startsWith("--")) throw new Error(`${option} requires a value.`);
  return args[index];
}

main().catch((error) => {
  process.stderr.write(`condiments-completion: ${error.message}\n`);
  process.exitCode = 2;
});
