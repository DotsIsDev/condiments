#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { evaluateRepository } from "../src/evaluation.mjs";

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const configPath = path.resolve(options.config);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (!Array.isArray(config.repositories) || config.repositories.length === 0) {
    throw new Error("Config must contain a non-empty repositories array.");
  }

  const configDirectory = path.dirname(configPath);
  const repositories = [];
  for (const item of config.repositories) {
    repositories.push(await evaluateRepository({
      ...item,
      root: path.resolve(configDirectory, item.path),
    }));
  }

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    disclaimer: "Deterministic offline context-volume proxy. It does not measure provider tokens, cost, latency, or model correctness.",
    repositories,
  };
  const markdown = renderMarkdown(report);

  if (options.json) await writeOutput(options.json, `${JSON.stringify(report, null, 2)}\n`);
  if (options.markdown) await writeOutput(options.markdown, markdown);
  if (!options.json && !options.markdown) process.stdout.write(markdown);
}

function parseOptions(args) {
  const options = { config: undefined, json: undefined, markdown: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--config") options.config = value(args, ++index, arg);
    else if (arg === "--json") options.json = value(args, ++index, arg);
    else if (arg === "--markdown") options.markdown = value(args, ++index, arg);
    else throw new Error(`Unknown option '${arg}'.`);
  }
  if (!options.config) throw new Error("--config is required.");
  return options;
}

function value(args, index, option) {
  if (index >= args.length || args[index].startsWith("--")) throw new Error(`${option} requires a value.`);
  return args[index];
}

async function writeOutput(outputPath, content) {
  const absolutePath = path.resolve(outputPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

function renderMarkdown(report) {
  const rows = [];
  for (const repository of report.repositories) {
    for (const level of ["baseline", "some", "full"]) {
      const result = repository.modes[level];
      rows.push(`| ${repository.name} | ${repository.query} | ${level} | ${result.includedFiles} | ${result.includedRegions} | ${result.contextBytes} | ${result.estimatedTokens} | ${percent(result.reductionVsBaseline)} | ${percent(result.matchRecall)} |`);
    }
  }
  return `# Three-Repository Condiments Evaluation\n\nGenerated: ${report.generatedAt}\n\n${report.disclaimer}\n\nMethod: baseline loads every eligible text file; some loads query-matching files plus root guidance; full loads merged ±8-line regions around every exact query match. Generated/dependency directories, lockfiles, binaries, and files over 2 MB are excluded. Token counts use UTF-8 bytes / 4.\n\n| Repository | Query | Mode | Files | Regions | Context bytes | Est. tokens | Reduction | Match recall |\n| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |\n${rows.join("\n")}\n\nMatch recall only verifies that selected context retains every exact query occurrence. Provider-backed evaluation is still required for correctness, actual token use, cost, cache reuse, and latency.\n`;
}

function percent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

main().catch((error) => {
  process.stderr.write(`condiments-evaluate: ${error.message}\n`);
  process.exitCode = 2;
});

