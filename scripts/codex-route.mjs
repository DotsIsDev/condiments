#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createDefaultState, normalizeState, resolveLevels } from "../src/core.mjs";
import { buildCodexExecArgs, discoverCodexModels, resolveCodexRoute } from "../src/native-reasoning.mjs";
import { readCacheTelemetry } from "../src/prompt-cache.mjs";

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const prompt = options.prompt ?? await readStdin();
  const level = options.level ?? await readLevel(options.state, options.cwd);
  const catalog = await discoverCodexModels({ cwd: options.cwd, timeoutMs: options.timeout });
  const cacheEvents = await readCacheTelemetry(options.cwd);
  const latestCache = [...cacheEvents].reverse().find((event) => event.cache_read_reported && event.cache_read_tokens > 0
    && catalog.some((model) => (model.model ?? model.id) === event.model));
  const current = latestCache?.model ?? catalog.find((model) => model.isDefault)?.model ?? catalog[0]?.model ?? "";
  const route = resolveCodexRoute(level, { prompt, model: current, effort: options.currentEffort }, catalog, {
    currentEffort: options.currentEffort,
    ...(latestCache ? { cacheLineage: {
      cacheReadTokens: latestCache.cache_read_tokens,
      expectedInputTokenSavings: options.expectedTokenSavings,
    }} : {}),
  });
  if (options.action === "route") {
    process.stdout.write(`${JSON.stringify({ route, catalogModels: catalog.length }, null, 2)}\n`);
    return;
  }
  const args = buildCodexExecArgs(route, {
    prompt: prompt || "-",
    cwd: options.cwd,
    json: options.json,
    ephemeral: options.ephemeral,
    skipGitRepoCheck: options.skipGitRepoCheck,
  });
  const exitCode = await run("codex", args);
  process.exitCode = exitCode;
}

function parseOptions(args) {
  const action = args.shift();
  if (!["route", "exec"].includes(action)) throw new Error("Action required: route or exec.");
  const options = { action, cwd: process.cwd(), timeout: 10_000 };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--level") options.level = value(args, ++index, arg);
    else if (arg === "--prompt") options.prompt = value(args, ++index, arg);
    else if (arg === "--cwd") options.cwd = path.resolve(value(args, ++index, arg));
    else if (arg === "--state") options.state = path.resolve(value(args, ++index, arg));
    else if (arg === "--timeout") options.timeout = Number(value(args, ++index, arg));
    else if (arg === "--current-effort") options.currentEffort = value(args, ++index, arg);
    else if (arg === "--expected-token-savings") options.expectedTokenSavings = Number(value(args, ++index, arg));
    else if (arg === "--json") options.json = true;
    else if (arg === "--ephemeral") options.ephemeral = true;
    else if (arg === "--skip-git-repo-check") options.skipGitRepoCheck = true;
    else throw new Error(`Unknown option '${arg}'.`);
  }
  return options;
}

function value(args, index, option) {
  if (index >= args.length || args[index].startsWith("--")) throw new Error(`${option} requires a value.`);
  return args[index];
}

async function readLevel(statePath, cwd) {
  const filePath = statePath ?? path.join(cwd, ".condiments", "state.json");
  try {
    return resolveLevels(normalizeState(JSON.parse(await readFile(filePath, "utf8")))).hot;
  } catch (error) {
    if (error?.code === "ENOENT") return resolveLevels(createDefaultState()).hot;
    throw error;
  }
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

main().catch((error) => {
  process.stderr.write(`condiments-codex-route: ${error.message}\n`);
  process.exitCode = 2;
});
