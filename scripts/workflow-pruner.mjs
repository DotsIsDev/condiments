#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { assessWorkflowPruning } from "../src/workflow-pruner.mjs";

async function main() {
  const inputPath = parseOptions(process.argv.slice(2));
  const source = inputPath === "-" ? await readStdin() : await readFile(path.resolve(inputPath), "utf8");
  process.stdout.write(`${JSON.stringify(assessWorkflowPruning(JSON.parse(source)), null, 2)}\n`);
}

function parseOptions(args) {
  if (args[0] !== "assess" || args[1] !== "--input" || !args[2]) throw new Error("Use assess --input <path|->.");
  if (args.length !== 3) throw new Error(`Unknown option '${args[3]}'.`);
  return args[2];
}

async function readStdin() { const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk); return Buffer.concat(chunks).toString("utf8"); }

main().catch((error) => {
  process.stderr.write(`condiments-workflow-pruner: ${error.message}\n`);
  process.exitCode = 2;
});
