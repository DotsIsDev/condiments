#!/usr/bin/env node

import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ADAPTER_ORDER, getAdapter, getInstallPaths } from "../src/adapters.mjs";
import { installNativeContextHooks } from "../src/native-context.mjs";
import { installNativeOutputHooks } from "../src/native-output.mjs";
import { installPromptCacheTelemetry } from "../src/prompt-cache.mjs";
import { installNativeReasoningHooks } from "../src/native-reasoning.mjs";
import { installNativeToolContextControl } from "../src/tool-context.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const adapter = getAdapter(options.host);
  const targetRoot = path.resolve(options.target);
  const paths = getInstallPaths(options.host, targetRoot);
  const adapterRoot = path.join(packageRoot, "adapters", options.host);

  await access(targetRoot);
  await prepareDestination(paths.main, paths.skillsRoot, options.force);
  await prepareDestination(paths.alias, paths.skillsRoot, options.force);
  await mkdir(paths.main, { recursive: true });
  await mkdir(paths.alias, { recursive: true });

  await copyRuntimeBundle(paths.main);
  await cp(path.join(adapterRoot, "capabilities.json"), path.join(paths.main, "capabilities.json"));
  await cp(path.join(adapterRoot, "condiments.SKILL.md"), path.join(paths.main, "SKILL.md"));
  await cp(path.join(adapterRoot, "cond.SKILL.md"), path.join(paths.alias, "SKILL.md"));
  if (options.host === "codex-cli") {
    await cp(path.join(adapterRoot, "agents"), path.join(paths.main, "agents"), { recursive: true });
  }
  const nativeContext = await installNativeContextHooks(options.host, targetRoot);
  const nativeOutput = await installNativeOutputHooks(options.host, targetRoot);
  const promptCache = await installPromptCacheTelemetry(options.host, targetRoot);
  const nativeReasoning = await installNativeReasoningHooks(options.host, targetRoot);
  const nativeToolContext = await installNativeToolContextControl(options.host, targetRoot);
  const capabilitiesPath = path.join(paths.main, "capabilities.json");
  const installedCapabilities = JSON.parse(await readFile(capabilitiesPath, "utf8"));
  installedCapabilities.nativeActiveTurnRouting = Boolean(nativeReasoning.activeTurnRouting);
  installedCapabilities.nativeCacheLineageControl = Boolean(nativeReasoning.activeTurnRouting);
  await writeFile(capabilitiesPath, `${JSON.stringify(installedCapabilities, null, 2)}\n`, "utf8");

  const receipt = {
    host: adapter.host,
    targetRoot,
    skillsRoot: paths.skillsRoot,
    installed: [paths.main, paths.alias],
    invocations: adapter.invocations,
    nativeContext,
    nativeOutput,
    promptCache,
    nativeReasoning,
    nativeToolContext,
    capabilities: installedCapabilities,
  };
  await writeFile(path.join(paths.main, "install-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

async function copyRuntimeBundle(destination) {
  const files = [
    "src/core.mjs",
    "src/result-envelope.mjs",
    "src/checkpoint.mjs",
    "src/native-context.mjs",
    "src/native-output.mjs",
    "src/output-budget.mjs",
    "src/command-guard.mjs",
    "src/usage.mjs",
    "src/prompt-cache.mjs",
    "src/native-reasoning.mjs",
    "src/completion-policy.mjs",
    "src/tool-context.mjs",
    "src/cache-lineage.mjs",
    "src/output-governor.mjs",
    "src/query-compressor.mjs",
    "src/log-dictionary.mjs",
    "src/output-cap-learner.mjs",
    "src/reversible-memory.mjs",
    "src/significance-output.mjs",
    "src/hierarchical-budget.mjs",
    "src/llmlingua-sidecar.mjs",
    "src/reasoning-governor.mjs",
    "src/native-qwen.mjs",
    "src/native-deepseek.mjs",
    "scripts/condiments.mjs",
    "scripts/compact-tool-result.mjs",
    "scripts/output-budget.mjs",
    "scripts/checkpoint.mjs",
    "scripts/context-hook.mjs",
    "scripts/result-hook.mjs",
    "scripts/command-guard-hook.mjs",
    "scripts/report-usage.mjs",
    "scripts/cache-hook.mjs",
    "scripts/prompt-cache.mjs",
    "scripts/codex-route.mjs",
    "scripts/reasoning-hook.mjs",
    "scripts/completion-policy.mjs",
    "scripts/tool-context.mjs",
    "scripts/cache-lineage.mjs",
    "scripts/output-governor.mjs",
    "scripts/query-compressor.mjs",
    "scripts/log-dictionary.mjs",
    "scripts/output-cap-train.mjs",
    "scripts/reversible-memory.mjs",
    "scripts/significance-output.mjs",
    "scripts/llmlingua-sidecar.mjs",
    "scripts/reasoning-governor.mjs",
    "scripts/qwen-thinking.mjs",
    "scripts/deepseek-reasoning.mjs",
    "sidecars/llmlingua2.py",
    "references/policy.md",
    "references/policy-protocol.md",
    "references/checkpoint.schema.json",
    "references/native-context.md",
    "references/native-output.md",
    "references/output-budget.md",
    "references/prompt-cache.md",
    "references/native-reasoning.md",
    "references/platform-capabilities.md",
    "references/completion-policy.md",
    "references/tool-context.md",
    "references/cache-lineage.md",
    "references/output-governor.md",
    "references/query-compressor.md",
    "references/log-dictionary.md",
    "references/output-cap-learning.md",
    "references/research-controls.md",
    "references/reasoning-governor.md",
  ];
  for (const relativePath of files) {
    const destinationPath = path.join(destination, relativePath);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await cp(path.join(packageRoot, relativePath), destinationPath);
  }

  const sourcePackage = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const runtimePackage = {
    name: sourcePackage.name,
    version: sourcePackage.version,
    private: true,
    type: "module",
    bin: {
      condiments: "scripts/condiments.mjs",
      "condiments-result": "scripts/compact-tool-result.mjs",
      "condiments-output-budget": "scripts/output-budget.mjs",
      "condiments-checkpoint": "scripts/checkpoint.mjs",
      "condiments-context-hook": "scripts/context-hook.mjs",
      "condiments-result-hook": "scripts/result-hook.mjs",
      "condiments-command-guard": "scripts/command-guard-hook.mjs",
      "condiments-usage": "scripts/report-usage.mjs",
      "condiments-cache": "scripts/prompt-cache.mjs",
      "condiments-cache-hook": "scripts/cache-hook.mjs",
      "condiments-codex-route": "scripts/codex-route.mjs",
      "condiments-reasoning-hook": "scripts/reasoning-hook.mjs",
      "condiments-completion": "scripts/completion-policy.mjs",
      "condiments-tool-context": "scripts/tool-context.mjs",
      "condiments-cache-lineage": "scripts/cache-lineage.mjs",
      "condiments-output-governor": "scripts/output-governor.mjs",
      "condiments-query-compressor": "scripts/query-compressor.mjs",
      "condiments-log-dictionary": "scripts/log-dictionary.mjs",
      "condiments-output-cap-train": "scripts/output-cap-train.mjs",
      "condiments-memory": "scripts/reversible-memory.mjs",
      "condiments-significance-output": "scripts/significance-output.mjs",
      "condiments-llmlingua": "scripts/llmlingua-sidecar.mjs",
      "condiments-reasoning": "scripts/reasoning-governor.mjs",
      "condiments-qwen-thinking": "scripts/qwen-thinking.mjs",
      "condiments-deepseek-reasoning": "scripts/deepseek-reasoning.mjs",
    },
  };
  await writeFile(path.join(destination, "package.json"), `${JSON.stringify(runtimePackage, null, 2)}\n`, "utf8");
}

function parseOptions(args) {
  const options = { host: undefined, target: undefined, force: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--host") options.host = requireValue(args, ++index, arg);
    else if (arg === "--target") options.target = requireValue(args, ++index, arg);
    else if (arg === "--force") options.force = true;
    else throw new Error(`Unknown option '${arg}'.`);
  }
  if (!options.host || !options.target) {
    throw new Error(`--host and --target are required. Hosts: ${ADAPTER_ORDER.join(", ")}.`);
  }
  return options;
}

function requireValue(args, index, option) {
  if (index >= args.length || args[index].startsWith("--")) throw new Error(`${option} requires a value.`);
  return args[index];
}

async function prepareDestination(destination, skillsRoot, force) {
  if (!isInside(destination, skillsRoot)) throw new Error(`Unsafe adapter destination: ${destination}`);
  try {
    await access(destination);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (!force) throw new Error(`Destination exists: ${destination}. Use --force to replace it.`);
  await rm(destination, { recursive: true, force: true });
}

function isInside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

main().catch((error) => {
  process.stderr.write(`condiments-adapter: ${error.message}\n`);
  process.exitCode = 2;
});
