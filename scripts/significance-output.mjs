#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { selectSignificantOutput } from "../src/significance-output.mjs";

const args = process.argv.slice(2);
const inputIndex = args.indexOf("--input");
if (inputIndex < 0 || !args[inputIndex + 1]) {
  process.stderr.write("condiments-significance-output: --input is required; use - for stdin.\n");
  process.exitCode = 2;
} else {
  const source = args[inputIndex + 1];
  const text = source === "-" ? await readStdin() : await readFile(path.resolve(source), "utf8");
  const result = selectSignificantOutput(JSON.parse(text));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.qualityPassed) process.exitCode = 1;
}

async function readStdin() { const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk); return Buffer.concat(chunks).toString("utf8"); }
