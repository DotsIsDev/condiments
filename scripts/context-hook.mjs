#!/usr/bin/env node

import process from "node:process";
import { handleContextHook } from "../src/native-context.mjs";

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const stdin = await readStdin();
  const payload = stdin.trim() ? JSON.parse(stdin) : {};
  const result = await handleContextHook(payload, {
    host: options.host,
    event: options.event,
    cwd: options.cwd,
    statePath: options.state,
  });
  process.stdout.write(`${JSON.stringify(result.output)}\n`);
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--host") options.host = value(args, ++index, arg);
    else if (arg === "--event") options.event = value(args, ++index, arg);
    else if (arg === "--cwd") options.cwd = value(args, ++index, arg);
    else if (arg === "--state") options.state = value(args, ++index, arg);
    else throw new Error(`Unknown option '${arg}'.`);
  }
  if (!options.host) throw new Error("--host is required.");
  return options;
}

function value(args, index, option) {
  if (index >= args.length || args[index].startsWith("--")) throw new Error(`${option} requires a value.`);
  return args[index];
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

main().catch((error) => {
  process.stderr.write(`condiments-context-hook: ${error.message}\n`);
  process.exitCode = 2;
});
