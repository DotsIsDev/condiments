import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveAdaptiveOutputPolicy } from "./output-governor.mjs";
import { selectTelemetryTrainedOutputCap } from "./output-cap-learner.mjs";

export const PROVIDER_OUTPUT_TOKEN_LIMITS = Object.freeze({
  some: 4_096,
  full: 2_048,
});

const PROVIDERS = new Set(["openai", "anthropic", "deepseek", "openclaw", "cursor"]);
const HOSTS = new Set(["openclaw", "claude-code", "codex-cli", "cursor"]);
const LEVELS = new Set(["none", "some", "full"]);

export function resolveProviderOutputTokenLimit(level) {
  const normalized = assertLevel(level);
  return normalized === "none" ? null : PROVIDER_OUTPUT_TOKEN_LIMITS[normalized];
}

export function decorateProviderOutputRequest(provider, request, options = {}) {
  const kind = assertProvider(provider);
  const level = assertLevel(options.level ?? "some");
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("Provider request must be an object.");
  }

  const output = structuredClone(request);
  const governor = options.task || options.taskClass
    ? resolveAdaptiveOutputPolicy(options)
    : null;
  const fallbackLimit = governor?.outputTokenCap ?? resolveProviderOutputTokenLimit(level);
  const learned = fallbackLimit !== null && governor && Array.isArray(options.telemetryRecords)
    ? selectTelemetryTrainedOutputCap(options.telemetryRecords, {
        provider: kind,
        host: options.host,
        level,
        taskClass: governor.taskClass,
        fallbackCap: fallbackLimit,
      }, options.capTraining)
    : null;
  const requestedLimit = learned?.cap ?? fallbackLimit;
  const control = {
    provider: kind,
    level,
    applied: false,
    mechanism: level === "none" ? "provider-default" : "unavailable",
    requested_limit: requestedLimit,
    effective_limit: null,
    governor,
    cap_selection: learned,
    requested_tool_calls: governor?.toolCallCap ?? null,
    effective_tool_calls: null,
  };
  if (requestedLimit === null) return { request: output, control };

  if (kind === "openai") {
    const api = String(options.api ?? "responses").toLowerCase();
    if (api !== "responses") return { request: output, control: { ...control, reason: `OpenAI API '${api}' does not use max_output_tokens` } };
    const effective = lowerLimit(output.max_output_tokens, requestedLimit);
    output.max_output_tokens = effective;
    let effectiveToolCalls = null;
    if (Number.isInteger(governor?.toolCallCap) && governor.toolCallCap > 0) {
      effectiveToolCalls = lowerLimit(output.max_tool_calls, governor.toolCallCap);
      output.max_tool_calls = effectiveToolCalls;
    }
    return {
      request: output,
      control: {
        ...control,
        applied: true,
        mechanism: "max_output_tokens",
        effective_limit: effective,
        tool_mechanism: effectiveToolCalls === null ? "prompt-contract" : "max_tool_calls",
        effective_tool_calls: effectiveToolCalls,
      },
    };
  }

  if (kind === "anthropic") {
    const api = String(options.api ?? "messages").toLowerCase();
    if (api !== "messages") return { request: output, control: { ...control, reason: `Anthropic API '${api}' does not use max_tokens` } };
    const effective = lowerLimit(output.max_tokens, requestedLimit);
    output.max_tokens = effective;
    return {
      request: output,
      control: {
        ...control,
        applied: true,
        mechanism: "max_tokens",
        effective_limit: effective,
        tool_mechanism: governor ? "prompt-contract" : null,
      },
    };
  }

  if (kind === "deepseek") {
    const api = String(options.api ?? "chat-completions").toLowerCase();
    const key = api === "responses" ? "max_output_tokens" : api === "chat-completions" ? "max_tokens" : null;
    if (!key) return { request: output, control: { ...control, reason: `DeepSeek API '${api}' is unsupported` } };
    const effective = lowerLimit(output[key], requestedLimit);
    output[key] = effective;
    return {
      request: output,
      control: {
        ...control,
        applied: true,
        mechanism: key,
        effective_limit: effective,
        tool_mechanism: governor ? "prompt-contract" : null,
      },
    };
  }

  if (kind === "openclaw") {
    const effective = lowerLimit(output.maxTokens, requestedLimit);
    output.maxTokens = effective;
    return {
      request: output,
      control: {
        ...control,
        applied: true,
        mechanism: "maxTokens",
        effective_limit: effective,
        tool_mechanism: governor ? "prompt-contract" : null,
      },
    };
  }

  return { request: output, control };
}

export function detectOutputCapHit(provider, payload) {
  const kind = assertProvider(provider);
  const candidates = collectObjects(payload);
  if (kind === "openai") {
    const match = candidates.find((value) =>
      value?.incomplete_details?.reason === "max_output_tokens" ||
      value?.incompleteDetails?.reason === "max_output_tokens"
    );
    return { hit: Boolean(match), reason: match ? "max_output_tokens" : null };
  }
  if (kind === "anthropic") {
    const match = candidates.find((value) =>
      value?.stop_reason === "max_tokens" || value?.stopReason === "max_tokens"
    );
    return { hit: Boolean(match), reason: match ? "max_tokens" : null };
  }
  if (kind === "deepseek") {
    const responseLimit = candidates.find((value) =>
      value?.incomplete_details?.reason === "max_output_tokens" || value?.incompleteDetails?.reason === "max_output_tokens"
    );
    if (responseLimit) return { hit: true, reason: "max_output_tokens" };
    const chatLimit = candidates.find((value) => value?.finish_reason === "length" || value?.finishReason === "length");
    return { hit: Boolean(chatLimit), reason: chatLimit ? "length" : null };
  }
  if (kind === "openclaw") {
    const match = candidates.find((value) =>
      ["max_tokens", "maxTokens"].includes(value?.stop_reason) ||
      ["max_tokens", "maxTokens"].includes(value?.stopReason)
    );
    return { hit: Boolean(match), reason: match ? String(match.stop_reason ?? match.stopReason) : null };
  }
  return { hit: false, reason: null };
}

export function createOutputCapTelemetryRecord(provider, payload, metadata = {}) {
  const kind = assertProvider(provider);
  const cap = detectOutputCapHit(kind, payload);
  const requested = requestedLimit(kind, payload, metadata.requestedOutputTokens);
  const actual = actualOutputTokens(kind, payload, metadata.actualOutputTokens);
  const reasoning = tokenField(payload, ["reasoning_tokens", "reasoning_output_tokens", "thinking_tokens"], metadata.reasoningOutputTokens);
  const verified = typeof metadata.verificationPassed === "boolean" ? metadata.verificationPassed : null;
  const timestamp = validTimestamp(metadata.timestamp) ?? new Date().toISOString();
  const record = {
    version: 1,
    event_id: String(metadata.eventId ?? hash(JSON.stringify({
      kind,
      timestamp,
      requested,
      actual,
      reasoning,
      cap,
      host: metadata.host ?? null,
      mode: metadata.mode ?? null,
      taskClass: metadata.taskClass ?? metadata.task_class ?? null,
      directEdit: metadata.directEdit ?? null,
    }))),
    timestamp,
    provider: kind,
    host: metadata.host ?? null,
    mode: metadata.mode ?? null,
    task_class: optionalTaskClass(metadata.taskClass ?? metadata.task_class),
    direct_edit: typeof metadata.directEdit === "boolean" ? metadata.directEdit : null,
    request_id: metadata.requestId ?? null,
    requested_output_tokens: requested,
    actual_output_tokens: actual,
    reasoning_output_tokens: reasoning,
    cap_hit: cap.hit,
    cap_reason: cap.reason,
    verification_passed: verified,
    required_result_lost: cap.hit && verified === false,
    quality_passed: verified === null ? null : verified,
  };
  return record;
}

export function outputCapQualityFailures(record) {
  if (!record?.cap_hit || record.verification_passed !== false) return [];
  return [`output cap '${record.cap_reason}' removed or invalidated the required result`];
}

export async function appendOutputCapTelemetry(root, records) {
  const filePath = telemetryPath(root);
  const items = Array.isArray(records) ? records : [records];
  const existing = await readOutputCapTelemetry(root);
  const ids = new Set(existing.map((record) => record.event_id));
  const added = [];
  for (const record of items) {
    if (!record?.event_id || ids.has(record.event_id)) continue;
    ids.add(record.event_id);
    added.push(record);
  }
  if (added.length) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, `${added.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
  }
  return { path: filePath, added: added.length, duplicate: items.length - added.length };
}

export async function readOutputCapTelemetry(root) {
  try {
    const records = (await readFile(telemetryPath(root), "utf8"))
      .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    return [...new Map(records.map((record) => [record.event_id, record])).values()];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export function summarizeOutputCapTelemetry(records) {
  if (!Array.isArray(records)) throw new Error("Output-cap records must be an array.");
  const measured = records.filter((record) => Number.isFinite(record.actual_output_tokens));
  const requested = records.filter((record) => Number.isFinite(record.requested_output_tokens));
  return {
    version: 1,
    events: records.length,
    cap_hits: records.filter((record) => record.cap_hit).length,
    required_result_losses: records.filter((record) => record.required_result_lost).length,
    requested_limit_coverage: records.length ? requested.length / records.length : null,
    actual_output_coverage: records.length ? measured.length / records.length : null,
    requested_output_tokens: sum(requested, "requested_output_tokens"),
    actual_output_tokens: sum(measured, "actual_output_tokens"),
  };
}

export async function applyNativeResponseBudgetPolicy(host, targetRoot, level, options = {}) {
  assertHost(host);
  assertLevel(level);
  const root = path.resolve(targetRoot);
  let detail;

  if (host === "openclaw") {
    const baseline = await captureOpenClawBaseline(root, options.runCommand ?? runCommand);
    if (level === "none" && baseline.value.commandAvailable === false) {
      detail = { applied: false, pending: false, reason: "OpenClaw unavailable; existing maxTokens setting left unchanged" };
    } else {
      const maxTokens = level === "none"
        ? baseline.value.maxTokens ?? null
        : lowerLimit(baseline.value.maxTokens, resolveProviderOutputTokenLimit(level));
      const patch = { agents: { defaults: { params: { maxTokens } } } };
      const patchPath = path.join(root, ".condiments", "output-budget", "openclaw.patch.json");
      await atomicWriteJson(patchPath, patch);
      detail = { patchPath, maxTokens, ...await runOpenClawPatch(patchPath, options.runCommand ?? runCommand) };
    }
  } else {
    detail = {
      applied: false,
      supported: false,
      reason: `${host} does not expose per-request generation limits to project hooks`,
      fallback: "mayo prompt contract",
    };
  }

  const receipt = { version: 1, host, level, appliedAt: new Date().toISOString(), detail };
  await atomicWriteJson(path.join(root, ".condiments", "output-budget", "last-apply.json"), receipt);
  return receipt;
}

function lowerLimit(current, requested) {
  if (current === undefined || current === null) return requested;
  if (!Number.isInteger(current) || current < 1) throw new Error("Existing output-token limit must be a positive integer.");
  return Math.min(current, requested);
}

function requestedLimit(provider, payload, explicit) {
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  const candidates = collectObjects(payload);
  const keys = provider === "openai"
    ? ["max_output_tokens"]
    : provider === "anthropic"
      ? ["max_tokens"]
      : provider === "deepseek"
        ? ["max_output_tokens", "max_tokens"]
        : ["maxTokens"];
  const found = candidates.flatMap((value) => keys.map((key) => value?.[key])).find((value) => Number.isInteger(value) && value > 0);
  return found ?? null;
}

function actualOutputTokens(provider, payload, explicit) {
  const keys = provider === "openai" || provider === "deepseek"
    ? ["output_tokens", "completion_tokens"]
    : provider === "anthropic"
      ? ["output_tokens"]
      : ["outputTokens", "output_tokens", "output"];
  return tokenField(payload, keys, explicit);
}

function tokenField(payload, keys, explicit) {
  if (Number.isSafeInteger(explicit) && explicit >= 0) return explicit;
  const values = collectObjects(payload)
    .flatMap((value) => keys.map((key) => value?.[key]))
    .filter((value) => Number.isSafeInteger(value) && value >= 0);
  return values.length ? values.at(-1) : null;
}

function collectObjects(payload) {
  const output = [];
  const seen = new Set();
  function visit(value, depth) {
    if (!value || typeof value !== "object" || depth > 8 || seen.has(value)) return;
    seen.add(value);
    output.push(value);
    if (Array.isArray(value)) for (const item of value) visit(item, depth + 1);
    else for (const item of Object.values(value)) visit(item, depth + 1);
  }
  visit(payload, 0);
  return output;
}

function validTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function telemetryPath(root) {
  return path.join(path.resolve(root), ".condiments", "output-budget", "events.jsonl");
}

function sum(records, field) {
  return records.reduce((total, record) => total + Number(record[field] ?? 0), 0);
}

async function captureOpenClawBaseline(root, runner) {
  const baselinePath = path.join(root, ".condiments", "output-budget", "openclaw-baseline.json");
  try {
    const existing = JSON.parse(await readFile(baselinePath, "utf8"));
    if (existing.value?.commandAvailable !== false) return { ...existing, path: baselinePath };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  let value;
  try {
    const stdout = await runner("openclaw", ["config", "get", "agents.defaults", "--json"]);
    const defaults = JSON.parse(stdout);
    value = { commandAvailable: true, maxTokens: defaults?.params?.maxTokens ?? null };
  } catch (error) {
    value = { commandAvailable: false, maxTokens: null, reason: error.message };
  }
  const baseline = { version: 1, host: "openclaw", capturedAt: new Date().toISOString(), value };
  await atomicWriteJson(baselinePath, baseline);
  return { ...baseline, path: baselinePath };
}

async function runOpenClawPatch(patchPath, runner) {
  try {
    await runner("openclaw", ["config", "patch", "--file", patchPath, "--dry-run"]);
    await runner("openclaw", ["config", "patch", "--file", patchPath]);
    return { applied: true, via: "openclaw config patch" };
  } catch (error) {
    return { applied: false, pending: true, reason: error.code === "ENOENT" ? "openclaw command unavailable" : error.message };
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => { error.code = error.code ?? "SPAWN"; reject(error); });
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString("utf8"));
      else reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `${command} exited ${code}`));
    });
  });
}

async function atomicWriteJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

function assertProvider(provider) {
  const value = String(provider ?? "").toLowerCase();
  if (!PROVIDERS.has(value)) throw new Error(`Unknown output-budget provider '${provider}'.`);
  return value;
}

function assertHost(host) {
  if (!HOSTS.has(host)) throw new Error(`Unknown output-budget host '${host}'.`);
  return host;
}

function assertLevel(level) {
  const value = String(level ?? "").toLowerCase();
  if (!LEVELS.has(value)) throw new Error(`Unknown output-budget level '${level}'.`);
  return value;
}

function optionalTaskClass(value) {
  if (value === undefined || value === null || value === "") return null;
  const taskClass = String(value).toLowerCase();
  if (!["micro", "standard", "complex"].includes(taskClass)) throw new Error(`Unknown output task class '${value}'.`);
  return taskClass;
}
