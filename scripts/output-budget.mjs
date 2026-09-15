#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  appendOutputCapTelemetry,
  createOutputCapTelemetryRecord,
  decorateProviderOutputRequest,
  readOutputCapTelemetry,
  summarizeOutputCapTelemetry,
} from "../src/output-budget.mjs";

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.action === "report") {
    const records = await readOutputCapTelemetry(options.root);
    process.stdout.write(`${JSON.stringify({ records, report: summarizeOutputCapTelemetry(records) }, null, 2)}\n`);
    return;
  }
  const input = options.input === "-" ? await readStdin() : await readFile(path.resolve(options.input), "utf8");
  const payload = JSON.parse(input);
  if (options.action === "ingest") {
    const record = createOutputCapTelemetryRecord(options.provider, payload, {
      host: options.host,
      mode: options.level,
      requestedOutputTokens: options.requested,
      verificationPassed: options.verified,
      eventId: options.eventId,
      taskClass: options.taskClass,
      directEdit: options.directEdit,
    });
    const receipt = await appendOutputCapTelemetry(options.root, record);
    process.stdout.write(`${JSON.stringify({ receipt, record }, null, 2)}\n`);
    return;
  }
  const telemetryRecords = options.trained ? await readOutputCapTelemetry(options.root) : undefined;
  const result = decorateProviderOutputRequest(options.provider, payload, {
    level: options.level,
    api: options.api,
    task: options.task,
    taskClass: options.taskClass,
    phase: options.phase,
    directEdit: options.directEdit,
    host: options.host,
    telemetryRecords,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function parseOptions(args) {
  const action = ["decorate", "ingest", "report"].includes(args[0]) ? args.shift() : "decorate";
  const options = { action, provider: undefined, level: undefined, api: undefined, input: undefined, root: process.cwd(), directEdit: false, trained: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--provider") options.provider = value(args, ++index, arg);
    else if (arg === "--level") options.level = value(args, ++index, arg);
    else if (arg === "--api") options.api = value(args, ++index, arg);
    else if (arg === "--input") options.input = value(args, ++index, arg);
    else if (arg === "--root") options.root = path.resolve(value(args, ++index, arg));
    else if (arg === "--host") options.host = value(args, ++index, arg);
    else if (arg === "--task") options.task = value(args, ++index, arg);
    else if (arg === "--task-class") options.taskClass = value(args, ++index, arg);
    else if (arg === "--phase") options.phase = value(args, ++index, arg);
    else if (arg === "--direct-edit") options.directEdit = true;
    else if (arg === "--trained") options.trained = true;
    else if (arg === "--requested") options.requested = positiveInteger(value(args, ++index, arg), arg);
    else if (arg === "--event-id") options.eventId = value(args, ++index, arg);
    else if (arg === "--verified") options.verified = true;
    else if (arg === "--unverified") options.verified = false;
    else throw new Error(`Unknown option '${arg}'.`);
  }
  if (action === "report") return options;
  if (!options.provider || !options.input || (action === "decorate" && !options.level)) {
    throw new Error("--provider, --level, and --input are required; use - for stdin.");
  }
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

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

main().catch((error) => {
  process.stderr.write(`condiments-output-budget: ${error.message}\n`);
  process.exitCode = 2;
});
