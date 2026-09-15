#!/usr/bin/env node

import process from "node:process";
import { handleCodexReasoningHook } from "../src/native-reasoning.mjs";

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const input = await readStdin();
  const payload = input.trim() ? JSON.parse(input) : {};
  const result = await handleCodexReasoningHook(payload, options);
  process.stdout.write(`${JSON.stringify(result.output)}\n`);
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--host") options.host = value(args, ++index, arg);
    else if (arg === "--cwd") options.cwd = value(args, ++index, arg);
    else if (arg === "--state") options.statePath = value(args, ++index, arg);
    else throw new Error(`Unknown option '${arg}'.`);
  }
  if (options.host !== "codex-cli") throw new Error("--host codex-cli is required.");
  return options;
}

function value(args, index, option) {
  if (index >= args.length || args[index].startsWith("--")) throw new Error(`${option} requires a value.`);
  return args[index];
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

main().catch((error) => {
  process.stderr.write(`condiments-reasoning-hook: ${error.message}\n`);
  process.exitCode = 2;
});
