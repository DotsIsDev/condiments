#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { auditSkillDisclosure, compileSkillSlice, selectSkillModules } from "../src/skill-disclosure.mjs";

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const root = path.resolve(options.root ?? ".");
  if (options.action === "audit") {
    const result = await auditSkillDisclosure(root);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.valid) process.exitCode = 2;
    return;
  }
  const input = { host: options.host, controls: options.controls };
  if (options.action === "plan") {
    process.stdout.write(`${JSON.stringify(selectSkillModules(input), null, 2)}\n`);
    return;
  }
  const result = await compileSkillSlice(root, input);
  if (options.json) {
    const { content, ...metadata } = result;
    process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
  } else {
    process.stdout.write(result.content);
  }
}

function parseOptions(args) {
  const action = args[0];
  if (!new Set(["plan", "compile", "audit"]).has(action)) throw new Error("Use plan, compile, or audit.");
  const options = { action, controls: "", json: false };
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--root") options.root = required(args, ++index, arg);
    else if (arg === "--host") options.host = required(args, ++index, arg);
    else if (arg === "--controls") options.controls = required(args, ++index, arg);
    else if (arg === "--json") options.json = true;
    else throw new Error(`Unknown option '${arg}'.`);
  }
  if (action !== "audit" && !options.host) throw new Error(`${action} requires --host.`);
  return options;
}

function required(args, index, option) {
  if (index >= args.length || args[index].startsWith("--")) throw new Error(`${option} requires a value.`);
  return args[index];
}

main().catch((error) => {
  process.stderr.write(`condiments-skill-disclosure: ${error.message}\n`);
  process.exitCode = 2;
});
