#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { compressWithLLMLingua, probeLLMLinguaSidecar } from "../src/llmlingua-sidecar.mjs";

const args = process.argv.slice(2);
const action = args.shift() ?? "probe";
const inputAt = args.indexOf("--input");
let result;
if (action === "probe") result = await probeLLMLinguaSidecar();
else if (action === "compress" && inputAt >= 0) {
  const source = args[inputAt + 1];
  const raw = source === "-" ? await stdin() : await readFile(path.resolve(source), "utf8");
  result = await compressWithLLMLingua(JSON.parse(raw));
} else throw new Error("Use probe or compress --input <file|->.");
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

async function stdin() { const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk); return Buffer.concat(chunks).toString("utf8"); }
