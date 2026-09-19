#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { decorateProviderReasoningRequest } from "../src/reasoning-governor.mjs";

const args = process.argv.slice(2);
const providerAt = args.indexOf("--provider");
const inputAt = args.indexOf("--input");
if (providerAt < 0 || !args[providerAt + 1]) throw new Error("--provider is required.");
if (inputAt < 0 || !args[inputAt + 1]) throw new Error("--input is required; use - for stdin.");
const source = args[inputAt + 1];
const raw = source === "-" ? await stdin() : await readFile(path.resolve(source), "utf8");
const input = JSON.parse(raw);
process.stdout.write(`${JSON.stringify(decorateProviderReasoningRequest(args[providerAt + 1], input.request, input.options), null, 2)}\n`);

async function stdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
