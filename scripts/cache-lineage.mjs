#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  appendCacheLineageTelemetry,
  assessCacheLineage,
  createCacheLineageSnapshot,
  estimateCacheLineageOpportunity,
  guardCacheLineage,
  readCacheLineageTelemetry,
} from "../src/cache-lineage.mjs";

const options = parse(process.argv.slice(2));
if (options.action === "report") {
  console.log(JSON.stringify(await readCacheLineageTelemetry(options.root), null, 2));
} else {
  const payload = JSON.parse(await input(options.input));
  let result;
  if (options.action === "snapshot") result = createCacheLineageSnapshot(options.provider, payload);
  else if (options.action === "estimate") result = estimateCacheLineageOpportunity(payload);
  else if (options.action === "assess") {
    result = assessCacheLineage(
      createCacheLineageSnapshot(options.provider, payload.previous),
      createCacheLineageSnapshot(options.provider, payload.candidate),
      payload.metrics,
      { level: options.level },
    );
  } else if (options.action === "guard") {
    result = guardCacheLineage(options.provider, payload.previous, payload.candidate, payload.metrics, {
      level: options.level,
      preserveFields: payload.preserveFields,
    });
  } else if (options.action === "ingest") result = await appendCacheLineageTelemetry(options.root, payload);
  console.log(JSON.stringify(result, null, 2));
}

function parse(args) {
  const action = args.shift();
  if (!["snapshot", "assess", "guard", "estimate", "ingest", "report"].includes(action)) throw new Error("Action required: snapshot, assess, guard, estimate, ingest, or report.");
  const output = { action, root: process.cwd(), input: "-", provider: "openai", level: "some" };
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[++index];
    if (!value) throw new Error(`${key} requires a value.`);
    if (key === "--root") output.root = path.resolve(value);
    else if (key === "--input") output.input = value;
    else if (key === "--provider") output.provider = value;
    else if (key === "--level") output.level = value;
    else throw new Error(`Unknown option '${key}'.`);
  }
  return output;
}

async function input(source) {
  if (source !== "-") return readFile(path.resolve(source), "utf8");
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
