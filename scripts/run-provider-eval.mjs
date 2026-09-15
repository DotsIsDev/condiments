#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { EVAL_MODES, runProviderEvaluation } from "../src/provider-eval.mjs";

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const configPath = path.resolve(options.config);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const report = await runProviderEvaluation(config, {
    host: options.host,
    modes: options.modes,
    workloads: options.workloads,
    control: options.control,
    configDirectory: path.dirname(configPath),
  });
  const output = `${JSON.stringify({ ...report, generatedAt: new Date().toISOString() }, null, 2)}\n`;
  if (options.output) {
    const outputPath = path.resolve(options.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output, "utf8");
  } else {
    process.stdout.write(output);
  }
  if (report.runs.some((run) => !run.verification_passed)) process.exitCode = 1;
}

function parseOptions(args) {
  const options = { config: undefined, host: undefined, modes: EVAL_MODES, workloads: undefined, control: undefined, output: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--config") options.config = value(args, ++index, arg);
    else if (arg === "--host") options.host = value(args, ++index, arg);
    else if (arg === "--modes") options.modes = value(args, ++index, arg).split(",").filter(Boolean);
    else if (arg === "--workloads") options.workloads = value(args, ++index, arg).split(",").filter(Boolean);
    else if (arg === "--control") options.control = value(args, ++index, arg);
    else if (arg === "--output") options.output = value(args, ++index, arg);
    else throw new Error(`Unknown option '${arg}'.`);
  }
  if (!options.config || !options.host) throw new Error("--config and --host are required.");
  return options;
}

function value(args, index, option) {
  if (index >= args.length || args[index].startsWith("--")) throw new Error(`${option} requires a value.`);
  return args[index];
}

main().catch((error) => {
  process.stderr.write(`condiments-provider-eval: ${error.message}\n`);
  process.exitCode = 2;
});
