import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const VERSION = 1;

export async function recordToolResult(root, input = {}) {
  const base = path.resolve(root);
  const identity = normalizeIdentity(input);
  const tool = String(input.tool ?? "tool").trim() || "tool";
  const call = requiredText(input.call ?? input.command, "call");
  const normalizedCall = normalizeCall(call);
  const inputFingerprint = String(input.inputFingerprint ?? "");
  const callHash = hash(`${tool}\0${normalizedCall}`);
  const content = Buffer.isBuffer(input.content) ? input.content : Buffer.from(String(input.content ?? ""), "utf8");
  const contentHash = hash(content);
  const objectPath = path.join(base, ".condiments", "tool-state", "objects", contentHash);
  await mkdir(path.dirname(objectPath), { recursive: true });
  if (!(await exists(objectPath))) await atomicWrite(objectPath, content);

  const statePath = toolStatePath(base, identity);
  const release = await acquireLock(statePath);
  try {
    const state = await readState(statePath, identity);
    const record = {
      id: hash(`${callHash}\0${inputFingerprint}\0${contentHash}`).slice(0, 32),
      tool,
      callHash,
      normalizedCall,
      inputFingerprint,
      success: resolveSuccess(input),
      exitStatus: input.exitStatus ?? null,
      contentHash,
      contentBytes: content.length,
      artifactPath: objectPath,
      facts: uniqueText(input.facts),
      openGaps: uniqueText(input.openGaps),
      recordedAt: validTimestamp(input.timestamp) ?? new Date().toISOString(),
    };
    const existingIndex = state.calls.findIndex((item) => item.id === record.id);
    if (existingIndex >= 0) state.calls[existingIndex] = record;
    else state.calls.push(record);
    state.calls = state.calls.slice(-100);
    state.goal = optionalText(input.goal) ?? state.goal;
    state.constraints = uniqueText([...(state.constraints ?? []), ...(Array.isArray(input.constraints) ? input.constraints : [])]).slice(-20);
    state.facts = uniqueText([...(state.facts ?? []), ...record.facts]).slice(-30);
    state.artifacts = uniqueText([...(state.artifacts ?? []), objectPath]).slice(-30);
    state.openGaps = uniqueText([...(state.openGaps ?? []), ...record.openGaps]).slice(-20);
    await atomicWrite(statePath, Buffer.from(`${JSON.stringify(state, null, 2)}\n`, "utf8"));
    return { version: VERSION, action: "record", record, state: publicState(state) };
  } finally {
    await release();
  }
}

export async function checkToolReuse(root, input = {}) {
  const base = path.resolve(root);
  const identity = normalizeIdentity(input);
  const tool = String(input.tool ?? "tool").trim() || "tool";
  const call = requiredText(input.call ?? input.command, "call");
  const callHash = hash(`${tool}\0${normalizeCall(call)}`);
  const inputFingerprint = String(input.inputFingerprint ?? "");
  const state = await readState(toolStatePath(base, identity), identity);
  const record = [...state.calls].reverse().find((item) => item.callHash === callHash && item.inputFingerprint === inputFingerprint);
  if (!record) return { version: VERSION, action: "execute", allow: true, reason: "new-call", record: null };
  if (input.inputsChanged === true) return { version: VERSION, action: "execute", allow: true, reason: "inputs-changed", record };
  if (record.success) {
    return {
      version: VERSION,
      action: "reuse",
      allow: false,
      reason: "sufficient-existing-result",
      record,
      instruction: `Reuse tool result ${record.contentHash} at ${record.artifactPath}.`,
    };
  }
  const justification = String(input.justification ?? "").trim();
  if (justification) return { version: VERSION, action: "execute", allow: true, reason: "failed-call-justified-retry", record };
  return {
    version: VERSION,
    action: "blocked",
    allow: false,
    reason: "repeated-failed-call",
    record,
    instruction: `The same failed call is recorded at ${record.artifactPath}; change inputs or provide missing-evidence justification.`,
  };
}

export async function inspectToolState(root, input = {}) {
  const identity = normalizeIdentity(input);
  return publicState(await readState(toolStatePath(path.resolve(root), identity), identity));
}

export function renderActiveToolState(state, options = {}) {
  const maxCalls = positiveInteger(options.maxCalls ?? 8, "maxCalls");
  const compact = {
    version: VERSION,
    goal: optionalText(state?.goal),
    constraints: uniqueText(state?.constraints).slice(0, 20),
    facts: uniqueText(state?.facts).slice(0, 30),
    artifacts: uniqueText(state?.artifacts).slice(0, 30),
    openGaps: uniqueText(state?.openGaps).slice(0, 20),
    calls: (state?.calls ?? []).slice(-maxCalls).map((call) => ({
      tool: call.tool,
      callHash: call.callHash,
      success: call.success,
      contentHash: call.contentHash,
      artifactPath: call.artifactPath,
      openGaps: call.openGaps,
    })),
  };
  return `<condiments-tool-state>${JSON.stringify(compact)}</condiments-tool-state>`;
}

function normalizeIdentity(input) {
  const sessionId = requiredText(input.sessionId ?? input.session_id, "sessionId");
  const turnId = requiredText(input.turnId ?? input.turn_id ?? input.promptHash, "turnId");
  return { sessionId, turnId };
}

async function readState(filePath, identity) {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8"));
    if (value?.version !== VERSION || !Array.isArray(value.calls)) throw new Error("Invalid compact tool-state ledger.");
    return value;
  } catch (error) {
    if (error?.code === "ENOENT") return { version: VERSION, ...identity, goal: null, constraints: [], facts: [], artifacts: [], openGaps: [], calls: [] };
    throw error;
  }
}

function publicState(state) { return structuredClone(state); }
function toolStatePath(root, identity) { return path.join(root, ".condiments", "tool-state", "sessions", safe(identity.sessionId), `${safe(identity.turnId)}.json`); }
function resolveSuccess(input) { if (typeof input.success === "boolean") return input.success; const code = Number(input.exitStatus); return Number.isFinite(code) ? code === 0 : !/\b(?:error|exception|failed|failure)\b/i.test(String(input.content ?? "")); }
function normalizeCall(value) { return String(value).trim().replace(/\s+/g, " "); }
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function safe(value) { return hash(String(value)).slice(0, 32); }
function requiredText(value, name) { const text = String(value ?? "").trim(); if (!text) throw new Error(`${name} is required.`); return text; }
function optionalText(value) { const text = String(value ?? "").trim(); return text || null; }
function uniqueText(value) { return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item).trim()).filter(Boolean))]; }
function validTimestamp(value) { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null; }
function positiveInteger(value, name) { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`); return parsed; }
async function exists(filePath) { try { await stat(filePath); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; } }

async function atomicWrite(filePath, bytes) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, filePath);
}

async function acquireLock(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const lockPath = `${filePath}.lock`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      return async () => { await handle.close(); await unlink(lockPath).catch((error) => { if (error?.code !== "ENOENT") throw error; }); };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try { const details = await stat(lockPath); if (Date.now() - details.mtimeMs > 30_000) await unlink(lockPath); }
      catch (stale) { if (stale?.code !== "ENOENT") throw stale; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error("Compact tool-state ledger is busy.");
}
