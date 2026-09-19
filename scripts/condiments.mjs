#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  applyCommand,
  createDefaultState,
  formatStatus,
  normalizeCapabilities,
  normalizeState,
  parseCommand,
  renderPolicyPrefix,
  renderPrompt,
  resolveOutputBudget,
  resolveLevels,
} from "../src/core.mjs";
import { applyNativeContextPolicy } from "../src/native-context.mjs";
import { applyNativeOutputPolicy } from "../src/native-output.mjs";
import { applyNativeResponseBudgetPolicy, resolveProviderOutputTokenLimit } from "../src/output-budget.mjs";
import { applyNativePromptCachePolicy } from "../src/prompt-cache.mjs";
import { applyNativeReasoningPolicy } from "../src/native-reasoning.mjs";
import { applyNativeToolContextPolicy } from "../src/tool-context.mjs";

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const command = parseCommand(options.commandTokens);

  if (command.type === "version") {
    const version = await readInstalledVersion();
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ command, version }, null, 2)}\n`);
    } else {
      process.stdout.write(`Condiments v${version}\n`);
    }
    return;
  }

  const statePath = path.resolve(
    options.statePath ||
      process.env.CONDIMENTS_STATE_PATH ||
      path.join(process.cwd(), ".condiments", "state.json"),
  );
  const currentState = await loadState(statePath);
  const nextState = applyCommand(currentState, command);

  if (command.type !== "status" && !options.noWrite) {
    await saveState(statePath, nextState);
  }

  const capabilityOverrides = options.capabilitiesPath
    ? JSON.parse(await readFile(path.resolve(options.capabilitiesPath), "utf8"))
    : {};
  const capabilities = normalizeCapabilities(capabilityOverrides);
  const host = options.host || process.env.CONDIMENTS_HOST || "portable";
  let nativeContext = null;
  let nativeOutput = null;
  let nativeResponseBudget = null;
  let promptCache = null;
  let nativeReasoning = null;
  let nativeToolContext = null;
  if (command.type !== "status" && !options.noWrite && host !== "portable") {
    try {
      nativeContext = await applyNativeContextPolicy(
        host,
        process.cwd(),
        resolveLevels(nextState).ketchup,
      );
    } catch (error) {
      nativeContext = { applied: false, error: error.message };
    }
    try {
      nativeOutput = await applyNativeOutputPolicy(
        host,
        process.cwd(),
        resolveLevels(nextState).ranch,
      );
    } catch (error) {
      nativeOutput = { applied: false, error: error.message };
    }
    try {
      nativeResponseBudget = await applyNativeResponseBudgetPolicy(
        host,
        process.cwd(),
        resolveLevels(nextState).mayo,
      );
    } catch (error) {
      nativeResponseBudget = { applied: false, error: error.message };
    }
    try {
      promptCache = await applyNativePromptCachePolicy(
        host,
        process.cwd(),
        resolveLevels(nextState).ranch,
      );
    } catch (error) {
      promptCache = { applied: false, error: error.message };
    }
    try {
      nativeReasoning = await applyNativeReasoningPolicy(
        host,
        process.cwd(),
        resolveLevels(nextState).hot,
      );
    } catch (error) {
      nativeReasoning = { applied: false, error: error.message };
    }
    try {
      nativeToolContext = await applyNativeToolContextPolicy(
        host,
        process.cwd(),
        resolveLevels(nextState).ranch,
      );
    } catch (error) {
      nativeToolContext = { applied: false, error: error.message };
    }
  }
  const status = formatStatus(nextState, { host, capabilities });
  const prompt = renderPrompt(nextState, { previousState: currentState });
  const policyPrefix = options.policyPrefix ? renderPolicyPrefix() : null;

  if (options.promptOnly) {
    if (policyPrefix) process.stdout.write(`${policyPrefix}\n`);
    if (prompt) process.stdout.write(`${prompt}\n`);
    return;
  }

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          command,
          state: nextState,
          effective: resolveLevels(nextState),
          host,
          capabilities,
          nativeContext,
          nativeOutput,
          nativeResponseBudget,
          providerOutputTokenLimit: resolveProviderOutputTokenLimit(resolveLevels(nextState).mayo),
          promptCache,
          nativeReasoning,
          nativeToolContext,
          outputBudget: resolveOutputBudget(nextState),
          status,
          prompt,
          policyPrefix,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  process.stdout.write(`${status}\n`);
  if (nativeContext) {
    const nativeState = nativeContext.error
      ? `error: ${nativeContext.error}`
      : `${nativeContext.level} (${
          nativeContext.detail?.pending
            ? "pending"
            : nativeContext.detail?.applied === false
              ? "skipped"
              : "applied"
        })`;
    process.stdout.write(`Native context: ${nativeState}\n`);
  }
  if (nativeOutput) {
    const nativeState = nativeOutput.error
      ? `error: ${nativeOutput.error}`
      : `${nativeOutput.level} (${
          nativeOutput.detail?.pending
            ? "pending"
            : nativeOutput.detail?.applied === false
              ? "unsupported"
              : "applied"
        })`;
    process.stdout.write(`Native output: ${nativeState}\n`);
  }
  if (nativeResponseBudget) {
    const budgetState = nativeResponseBudget.error
      ? `error: ${nativeResponseBudget.error}`
      : `${nativeResponseBudget.level} (${
          nativeResponseBudget.detail?.pending
            ? "pending"
            : nativeResponseBudget.detail?.applied === false
              ? "unsupported"
              : "applied"
        })`;
    process.stdout.write(`Native response budget: ${budgetState}\n`);
  }
  if (promptCache) {
    const cacheState = promptCache.error
      ? `error: ${promptCache.error}`
      : `${promptCache.level} (${
          promptCache.detail?.pending
            ? "pending"
            : promptCache.detail?.applied === false
              ? "unsupported"
              : "applied"
        })`;
    process.stdout.write(`Prompt cache: ${cacheState}\n`);
  }
  if (nativeReasoning) {
    const reasoningState = nativeReasoning.error
      ? `error: ${nativeReasoning.error}`
      : `${nativeReasoning.level} (${
          nativeReasoning.detail?.pending
            ? "pending"
            : nativeReasoning.detail?.applied === false
              ? "unsupported"
              : "applied"
        })`;
    process.stdout.write(`Native reasoning: ${reasoningState}\n`);
  }
  if (nativeToolContext) {
    const toolContextState = nativeToolContext.error
      ? `error: ${nativeToolContext.error}`
      : `${nativeToolContext.level} (${nativeToolContext.detail?.pending ? "pending" : nativeToolContext.detail?.applied ? "applied" : "unsupported"})`;
    process.stdout.write(`Native tool context: ${toolContextState}\n`);
  }
  if (options.prompt && (prompt || policyPrefix)) {
    if (policyPrefix) process.stdout.write(`\n${policyPrefix}\n`);
    if (prompt) process.stdout.write(`\n${prompt}\n`);
  }
}

async function readInstalledVersion() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const packagePath = path.resolve(scriptDirectory, "..", "package.json");
  const packageMetadata = JSON.parse(await readFile(packagePath, "utf8"));
  if (typeof packageMetadata.version !== "string" || packageMetadata.version.trim() === "") {
    throw new Error(`Cannot read installed version from '${packagePath}'.`);
  }
  return packageMetadata.version;
}

function parseOptions(args) {
  const options = {
    commandTokens: [],
    statePath: undefined,
    capabilitiesPath: undefined,
    host: undefined,
    json: false,
    prompt: false,
    promptOnly: false,
    policyPrefix: false,
    noWrite: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--prompt") {
      options.prompt = true;
    } else if (arg === "--prompt-only") {
      options.promptOnly = true;
    } else if (arg === "--policy-prefix") {
      options.policyPrefix = true;
    } else if (arg === "--no-write") {
      options.noWrite = true;
    } else if (arg === "--state") {
      options.statePath = requireOptionValue(args, ++index, "--state");
    } else if (arg === "--capabilities") {
      options.capabilitiesPath = requireOptionValue(args, ++index, "--capabilities");
    } else if (arg === "--host") {
      options.host = requireOptionValue(args, ++index, "--host");
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option '${arg}'.`);
    } else {
      options.commandTokens.push(arg);
    }
  }

  if (options.json && options.promptOnly) throw new Error("--json and --prompt-only cannot be combined.");

  return options;
}

function requireOptionValue(args, index, option) {
  if (index >= args.length || args[index].startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return args[index];
}

async function loadState(statePath) {
  try {
    return normalizeState(JSON.parse(await readFile(statePath, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return createDefaultState();
    throw new Error(`Cannot read state '${statePath}': ${error.message}`);
  }
}

async function saveState(statePath, state) {
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, statePath);
}

main().catch((error) => {
  process.stderr.write(`condiments: ${error.message}\n`);
  process.exitCode = 2;
});
