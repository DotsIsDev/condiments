#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import {
  appendToolContextTelemetry,
  decorateToolContextRequest,
  detectRequiredTools,
  measureContextSplit,
  readToolContextTelemetry,
  resolveToolPlan,
  summarizeToolContext,
} from "../src/tool-context.mjs";

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.action === "report") {
    process.stdout.write(`${JSON.stringify(summarizeToolContext(await readToolContextTelemetry(options.root)), null, 2)}\n`);
    return;
  }
  const input = await loadInput(options.input);
  if (options.action === "detect") {
    process.stdout.write(`${JSON.stringify(detectRequiredTools(options.task ?? input.task), null, 2)}\n`);
    return;
  }
  if (options.action === "plan") {
    process.stdout.write(`${JSON.stringify(resolveToolPlan(options.task ?? input.task, input.tools, { level: options.level, lazySupported: options.lazySupported }), null, 2)}\n`);
    return;
  }
  if (options.action === "measure") {
    process.stdout.write(`${JSON.stringify(measureContextSplit(input.request ?? input, { reportedInputTokens: input.reported_input_tokens, exactSplit: input.exact_split }), null, 2)}\n`);
    return;
  }
  if (options.action === "ingest") {
    process.stdout.write(`${JSON.stringify(await appendToolContextTelemetry(options.root, input), null, 2)}\n`);
    return;
  }
  const result = decorateToolContextRequest(options.provider, input.request ?? input, {
    level: options.level,
    task: options.task ?? input.task,
    supportsToolSearch: options.lazySupported,
    toolSearchTool: input.tool_search_tool,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function parseOptions(args) {
  const actions = new Set(["decorate", "detect", "plan", "measure", "ingest", "report"]);
  const options = { action: "decorate", level: "some", root: ".", lazySupported: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (index === 0 && actions.has(arg)) options.action = arg;
    else if (arg === "--provider") options.provider = value(args, ++index, arg);
    else if (arg === "--level") options.level = value(args, ++index, arg);
    else if (arg === "--task") options.task = value(args, ++index, arg);
    else if (arg === "--input") options.input = value(args, ++index, arg);
    else if (arg === "--root") options.root = value(args, ++index, arg);
    else if (arg === "--lazy-supported") options.lazySupported = true;
    else if (arg === "--no-lazy") options.lazySupported = false;
    else throw new Error(`Unknown option '${arg}'.`);
  }
  if (options.action === "decorate" && !options.provider) throw new Error("--provider is required for decorate.");
  return options;
}

async function loadInput(file) {
  const text = file ? await readFile(file, "utf8") : await readStdin();
  return text.trim() ? JSON.parse(text) : {};
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function value(args, index, option) {
  if (index >= args.length || args[index].startsWith("--")) throw new Error(`${option} requires a value.`);
  return args[index];
}

main().catch((error) => {
  process.stderr.write(`condiments-tool-context: ${error.message}\n`);
  process.exitCode = 2;
});
