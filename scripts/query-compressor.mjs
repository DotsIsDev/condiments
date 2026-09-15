#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  appendQueryCompressionTelemetry,
  compressQueryEvidence,
  compressQueryEvidenceWithRecovery,
  createQueryCompressionTelemetryRecord,
  readQueryCompressionTelemetry,
  summarizeQueryCompressionTelemetry,
  validateCompressedEvidence,
} from "../src/query-compressor.mjs";

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.action === "report") {
    const records = await readQueryCompressionTelemetry(options.root);
    process.stdout.write(`${JSON.stringify({ records, report: summarizeQueryCompressionTelemetry(records) }, null, 2)}\n`);
    return;
  }
  const input = JSON.parse(options.input === "-" ? await readStdin() : await readFile(path.resolve(options.input), "utf8"));
  let result;
  if (options.action === "validate") {
    result = validateCompressedEvidence(input);
  } else {
    const request = {
      ...input,
      level: options.level ?? input.level,
      budgetTokens: options.budgetTokens ?? input.budgetTokens,
      maxRecoveryRounds: options.maxRecoveryRounds ?? input.maxRecoveryRounds,
    };
    result = options.action === "recover"
      ? await compressQueryEvidenceWithRecovery(request)
      : compressQueryEvidence(request);
    if (options.record) {
      const record = createQueryCompressionTelemetryRecord(result, { host: options.host, provider: options.provider });
      const receipt = await appendQueryCompressionTelemetry(options.root, record);
      result = { ...result, telemetry: { receipt, record } };
    }
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.valid === false || result.readyForModel === false) process.exitCode = 1;
}

function parseOptions(args) {
  const action = ["compress", "recover", "validate", "report"].includes(args[0]) ? args.shift() : "compress";
  const options = { action, input: undefined, root: process.cwd(), record: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--input") options.input = value(args, ++index, arg);
    else if (arg === "--level") options.level = value(args, ++index, arg);
    else if (arg === "--budget-tokens") options.budgetTokens = positiveInteger(value(args, ++index, arg), arg);
    else if (arg === "--max-recovery-rounds") options.maxRecoveryRounds = nonNegativeInteger(value(args, ++index, arg), arg);
    else if (arg === "--root") options.root = path.resolve(value(args, ++index, arg));
    else if (arg === "--host") options.host = value(args, ++index, arg);
    else if (arg === "--provider") options.provider = value(args, ++index, arg);
    else if (arg === "--record") options.record = true;
    else throw new Error(`Unknown option '${arg}'.`);
  }
  if (action !== "report" && !options.input) throw new Error("--input is required; use - for stdin.");
  return options;
}

function value(args, index, option) {
  if (index >= args.length || args[index].startsWith("--")) throw new Error(`${option} requires a value.`);
  return args[index];
}

function positiveInteger(input, option) {
  const parsed = Number(input);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${option} requires a positive integer.`);
  return parsed;
}

function nonNegativeInteger(input, option) {
  const parsed = Number(input);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${option} requires a non-negative integer.`);
  return parsed;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

main().catch((error) => {
  process.stderr.write(`condiments-query-compressor: ${error.message}\n`);
  process.exitCode = 2;
});
