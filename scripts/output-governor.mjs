#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import { resolveAdaptiveOutputPolicy, resolveGovernorRetry, resolveToolRoundDecision } from "../src/output-governor.mjs";

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const input = options.input ? JSON.parse(await readFile(options.input, "utf8")) : {};
  const request = {
    ...input,
    level: options.level ?? input.level,
    task: options.task ?? input.task,
    taskClass: options.taskClass ?? input.taskClass,
    phase: options.phase ?? input.phase,
    directEdit: options.directEdit || input.directEdit,
    requiredEvidenceTokens: options.requiredEvidenceTokens ?? input.requiredEvidenceTokens,
    enforceEconomics: options.enforceEconomics || input.enforceEconomics,
    outputEconomics: {
      ...(input.outputEconomics ?? {}),
      ...(options.policyInputTokens === undefined ? {} : { policyInputTokens: options.policyInputTokens }),
      ...(options.projectedOutputSavingsTokens === undefined ? {} : { projectedOutputSavingsTokens: options.projectedOutputSavingsTokens }),
    },
  };
  const result = options.action === "retry"
    ? resolveGovernorRetry(request)
    : options.action === "tool-round"
      ? resolveToolRoundDecision(request)
      : resolveAdaptiveOutputPolicy(request);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function parseOptions(args) {
  const options = { action: "resolve", directEdit: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (["resolve", "retry", "tool-round"].includes(arg) && index === 0) options.action = arg;
    else if (arg === "--level") options.level = value(args, ++index, arg);
    else if (arg === "--task") options.task = value(args, ++index, arg);
    else if (arg === "--task-class") options.taskClass = value(args, ++index, arg);
    else if (arg === "--phase") options.phase = value(args, ++index, arg);
    else if (arg === "--input") options.input = value(args, ++index, arg);
    else if (arg === "--direct-edit") options.directEdit = true;
    else if (arg === "--required-evidence-tokens") options.requiredEvidenceTokens = Number(value(args, ++index, arg));
    else if (arg === "--enforce-economics") options.enforceEconomics = true;
    else if (arg === "--policy-input-tokens") options.policyInputTokens = Number(value(args, ++index, arg));
    else if (arg === "--projected-output-savings-tokens") options.projectedOutputSavingsTokens = Number(value(args, ++index, arg));
    else throw new Error(`Unknown option '${arg}'.`);
  }
  return options;
}

function value(args, index, option) {
  if (index >= args.length || args[index].startsWith("--")) throw new Error(`${option} requires a value.`);
  return args[index];
}

main().catch((error) => {
  process.stderr.write(`condiments-output-governor: ${error.message}\n`);
  process.exitCode = 2;
});
