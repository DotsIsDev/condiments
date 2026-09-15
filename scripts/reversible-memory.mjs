#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { commitReversibleMemory, expandReversibleMemory, foldReversibleMemory, inspectReversibleMemory } from "../src/reversible-memory.mjs";

async function main() {
  const [action = "inspect", ...args] = process.argv.slice(2);
  const options = parse(args);
  const input = options.input ? JSON.parse(options.input === "-" ? await stdin() : await readFile(path.resolve(options.input), "utf8")) : {};
  const request = { ...input, sessionId: options.sessionId ?? input.sessionId };
  let result;
  if (action === "commit") result = await commitReversibleMemory(options.root, request);
  else if (action === "expand") result = await expandReversibleMemory(options.root, request);
  else if (action === "fold") result = await foldReversibleMemory(options.root, request);
  else if (action === "inspect") result = await inspectReversibleMemory(options.root, request.sessionId);
  else throw new Error(`Unknown action '${action}'.`);
  if (Buffer.isBuffer(result?.bytes)) result = { ...result, bytes: result.bytes.toString("base64"), bytesEncoding: "base64" };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function parse(args) {
  const options = { root: process.cwd() };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--root") options.root = path.resolve(args[++i]);
    else if (args[i] === "--session") options.sessionId = args[++i];
    else if (args[i] === "--input") options.input = args[++i];
    else throw new Error(`Unknown option '${args[i]}'.`);
  }
  return options;
}

async function stdin() { const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk); return Buffer.concat(chunks).toString("utf8"); }
main().catch((error) => { process.stderr.write(`condiments-memory: ${error.message}\n`); process.exitCode = 2; });
