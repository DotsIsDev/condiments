#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { checkToolReuse, inspectToolState, recordToolResult, renderActiveToolState } from "../src/tool-state.mjs";

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const input = options.input ? JSON.parse(await readInput(options.input)) : {};
  const root = path.resolve(options.root ?? ".");
  const result = options.action === "record"
    ? await recordToolResult(root, input)
    : options.action === "check"
      ? await checkToolReuse(root, input)
      : await inspectToolState(root, input);
  process.stdout.write(options.action === "render" ? `${renderActiveToolState(result)}\n` : `${JSON.stringify(result, null, 2)}\n`);
}

function parseOptions(args) {
  const action = args[0];
  if (!new Set(["record", "check", "inspect", "render"]).has(action)) throw new Error("Use record, check, inspect, or render.");
  const options = { action };
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--root") options.root = required(args, ++index, arg);
    else if (arg === "--input") options.input = required(args, ++index, arg);
    else throw new Error(`Unknown option '${arg}'.`);
  }
  if (!options.input) throw new Error(`${action} requires --input <path|->.`);
  return options;
}

async function readInput(inputPath) { if (inputPath !== "-") return readFile(path.resolve(inputPath), "utf8"); const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk); return Buffer.concat(chunks).toString("utf8"); }
function required(args, index, option) { if (index >= args.length || args[index].startsWith("--")) throw new Error(`${option} requires a value.`); return args[index]; }

main().catch((error) => {
  process.stderr.write(`condiments-tool-state: ${error.message}\n`);
  process.exitCode = 2;
});
