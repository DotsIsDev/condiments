#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  appendCacheTelemetry,
  composeCacheFriendlyPrompt,
  createCacheTelemetryRecord,
  decoratePromptCacheRequest,
  extractCacheTelemetry,
  prepareCacheAwareRequest,
  readCacheTelemetry,
  summarizeCacheTelemetry,
} from "../src/prompt-cache.mjs";

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.action === "compose") {
    const payload = JSON.parse(await read(options.input));
    process.stdout.write(`${JSON.stringify(composeCacheFriendlyPrompt(payload), null, 2)}\n`);
    return;
  }
  if (options.action === "report") {
    const records = options.input
      ? extractCacheTelemetry(await read(options.input), { provider: options.provider, source: "cli-transcript" })
      : await readCacheTelemetry(options.root);
    process.stdout.write(`${JSON.stringify({ records, report: summarizeCacheTelemetry(records) }, null, 2)}\n`);
    return;
  }
  const payload = JSON.parse(await read(options.input));
  if (options.action === "prepare") {
    const request = payload.request ?? {};
    const preparationOptions = {
      ...(payload.options ?? {}),
      level: options.level,
      stablePrefix: options.stablePrefix ?? payload.options?.stablePrefix,
    };
    process.stdout.write(`${JSON.stringify(prepareCacheAwareRequest(options.provider, request, preparationOptions), null, 2)}\n`);
    return;
  }
  if (options.action === "decorate") {
    process.stdout.write(`${JSON.stringify(decoratePromptCacheRequest(options.provider, payload, {
      level: options.level,
      model: options.model,
      cacheKey: options.cacheKey,
      stablePrefix: options.stablePrefix,
      supportsPromptCacheOptions: options.modern,
      supportsLegacyLongRetention: options.legacy,
    }), null, 2)}\n`);
    return;
  }
  const items = Array.isArray(payload) ? payload : [payload];
  const records = items.map((item, index) => createCacheTelemetryRecord(options.provider ?? item.provider, item.payload ?? item, {
    ...(item.metadata ?? {}),
    mode: options.level ?? item.metadata?.mode,
    eventId: item.metadata?.eventId ?? `cli-${Date.now()}-${index}`,
  }));
  const receipt = await appendCacheTelemetry(options.root, records);
  process.stdout.write(`${JSON.stringify({ receipt, records, report: summarizeCacheTelemetry(records) }, null, 2)}\n`);
}

function parseOptions(args) {
  const action = args.shift();
  if (!["compose", "prepare", "decorate", "ingest", "report"].includes(action)) {
    throw new Error("Action required: compose, prepare, decorate, ingest, or report.");
  }
  const options = { action, root: process.cwd(), input: undefined, provider: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--input") options.input = value(args, ++index, arg);
    else if (arg === "--provider") options.provider = value(args, ++index, arg);
    else if (arg === "--root") options.root = path.resolve(value(args, ++index, arg));
    else if (arg === "--level") options.level = value(args, ++index, arg);
    else if (arg === "--model") options.model = value(args, ++index, arg);
    else if (arg === "--cache-key") options.cacheKey = value(args, ++index, arg);
    else if (arg === "--stable-prefix") options.stablePrefix = value(args, ++index, arg);
    else if (arg === "--modern") options.modern = true;
    else if (arg === "--legacy") options.legacy = true;
    else throw new Error(`Unknown option '${arg}'.`);
  }
  if (["compose", "prepare", "decorate", "ingest"].includes(action) && !options.input) throw new Error("--input is required; use - for stdin.");
  if (["prepare", "decorate"].includes(action) && (!options.provider || !options.level)) throw new Error(`${action} requires --provider and --level.`);
  if (action === "report" && options.input && !options.provider) throw new Error("report --input requires --provider.");
  return options;
}

function value(args, index, option) {
  if (index >= args.length || args[index].startsWith("--")) throw new Error(`${option} requires a value.`);
  return args[index];
}

async function read(input) {
  if (input === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
  }
  return readFile(path.resolve(input), "utf8");
}

main().catch((error) => {
  process.stderr.write(`condiments-cache: ${error.message}\n`);
  process.exitCode = 2;
});
