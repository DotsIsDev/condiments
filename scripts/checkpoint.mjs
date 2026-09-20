#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  checkpointTemplate,
  generateCheckpoint,
  renderCheckpoint,
  resolveCheckpointDecision,
  validateCheckpoint,
} from "../src/checkpoint.mjs";

async function main() {
  const options = parseOptions(process.argv.slice(2));

  if (options.action === "template") {
    process.stdout.write(`${JSON.stringify(checkpointTemplate(), null, 2)}\n`);
    return;
  }

  const candidate = JSON.parse(await readInput(options.inputPath));

  if (options.action === "decide") {
    process.stdout.write(`${JSON.stringify(resolveCheckpointDecision(candidate), null, 2)}\n`);
    return;
  }

  if (options.action === "validate") {
    const result = validateCheckpoint(candidate);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.valid) process.exitCode = 2;
    return;
  }

  if (options.action === "render") {
    process.stdout.write(`${renderCheckpoint(candidate)}\n`);
    return;
  }

  const checkpoint = generateCheckpoint(candidate);
  const serialized = `${JSON.stringify(checkpoint, null, 2)}\n`;
  if (options.outputPath) {
    await atomicWrite(path.resolve(options.outputPath), serialized);
  } else {
    process.stdout.write(serialized);
  }
}

function parseOptions(args) {
  const action = args[0];
  if (!new Set(["template", "decide", "generate", "validate", "render"]).has(action)) {
    throw new Error("Use template, decide, generate, validate, or render.");
  }

  const options = { action, inputPath: undefined, outputPath: undefined };
  for (let index = 1; index < args.length; index += 1) {
    const option = args[index];
    if (option !== "--input" && option !== "--output") {
      throw new Error(`Unknown option '${option}'.`);
    }
    const value = args[++index];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${option} requires a value.`);
    }
    if (option === "--input") options.inputPath = value;
    if (option === "--output") options.outputPath = value;
  }

  if (action !== "template" && !options.inputPath) {
    throw new Error(`${action} requires --input <path|->.`);
  }
  if (action !== "generate" && options.outputPath) {
    throw new Error("--output is supported only with generate.");
  }
  return options;
}

async function readInput(inputPath) {
  if (inputPath !== "-") return readFile(path.resolve(inputPath), "utf8");
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function atomicWrite(outputPath, content) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, content, "utf8");
  await rename(temporaryPath, outputPath);
}

main().catch((error) => {
  process.stderr.write(`checkpoint: ${error.message}\n`);
  process.exitCode = 2;
});
