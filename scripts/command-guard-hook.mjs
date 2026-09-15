#!/usr/bin/env node

import process from "node:process";
import { guardCodexCommand } from "../src/command-guard.mjs";

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const stdin = await readStdin();
  const payload = stdin.trim() ? JSON.parse(stdin) : {};
  const result = await guardCodexCommand(payload, {
    cwd: options.cwd,
    statePath: options.state,
  });
  process.stdout.write(`${JSON.stringify(result.output)}\n`);
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--cwd") options.cwd = value(args, ++index, arg);
    else if (arg === "--state") options.state = value(args, ++index, arg);
    else throw new Error(`Unknown option '${arg}'.`);
  }
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
  process.stderr.write(`condiments-command-guard: ${error.message}\n`);
  process.exitCode = 2;
});
