#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { offloadToolResult } from "../src/result-envelope.mjs";

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const content =
    options.inputPath && options.inputPath !== "-"
      ? await readFile(path.resolve(options.inputPath), "utf8")
      : await readStandardInput();

  const envelope = await offloadToolResult(
    {
      content,
      tool: options.tool,
      request_summary: options.requestSummary,
      exit_status: options.exitStatus,
    },
    {
      artifactDirectory: options.artifactDirectory,
      thresholdChars: options.thresholdChars,
      previewChars: options.previewChars,
      maxErrorMatches: options.maxErrorMatches,
      maxErrorChars: options.maxErrorChars,
      dictionaryCompression: options.dictionaryCompression,
      dictionaryOptions: {
        minOccurrences: options.minOccurrences,
        minSavingsBytes: options.minSavingsBytes,
      },
    },
  );

  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
}

function parseOptions(args) {
  const options = {
    inputPath: undefined,
    tool: "tool",
    requestSummary: "",
    exitStatus: null,
    artifactDirectory: undefined,
    thresholdChars: undefined,
    previewChars: undefined,
    maxErrorMatches: undefined,
    maxErrorChars: undefined,
    dictionaryCompression: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--no-dictionary") {
      options.dictionaryCompression = false;
      continue;
    }
    const valueOptions = new Set([
      "--input",
      "--tool",
      "--request",
      "--exit-status",
      "--artifact-dir",
      "--threshold",
      "--preview",
      "--max-error-matches",
      "--max-error-chars",
      "--min-occurrences",
      "--min-savings",
    ]);
    if (!valueOptions.has(option)) {
      throw new Error(`Unknown option '${option}'.`);
    }
    const value = args[++index];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${option} requires a value.`);
    }

    if (option === "--input") options.inputPath = value;
    if (option === "--tool") options.tool = value;
    if (option === "--request") options.requestSummary = value;
    if (option === "--exit-status") options.exitStatus = integerOrString(value);
    if (option === "--artifact-dir") options.artifactDirectory = value;
    if (option === "--threshold") options.thresholdChars = value;
    if (option === "--preview") options.previewChars = value;
    if (option === "--max-error-matches") options.maxErrorMatches = value;
    if (option === "--max-error-chars") options.maxErrorChars = value;
    if (option === "--min-occurrences") options.minOccurrences = value;
    if (option === "--min-savings") options.minSavingsBytes = value;
  }
  return options;
}

function integerOrString(value) {
  return /^-?\d+$/.test(value) ? Number(value) : value;
}

async function readStandardInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

main().catch((error) => {
  process.stderr.write(`compact-tool-result: ${error.message}\n`);
  process.exitCode = 2;
});
