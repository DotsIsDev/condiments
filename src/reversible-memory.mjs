import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const VERSION = 1;
const DEFAULT_SIMILARITY_LIMIT = 0.9;

export async function commitReversibleMemory(root, input = {}) {
  const base = path.resolve(root);
  const sessionId = requiredText(input.sessionId, "sessionId");
  const summary = normalizeSummary(input.summary);
  const raw = await loadRaw(input);
  const rawSha256 = sha256(raw.bytes);
  const summarySha256 = sha256(Buffer.from(summary, "utf8"));
  const state = await readMemoryState(base, sessionId);
  const limit = finiteUnit(input.similarityLimit) ?? DEFAULT_SIMILARITY_LIMIT;
  const duplicate = state.memories.find((memory) => memory.rawSha256 === rawSha256 && memory.summarySha256 === summarySha256);
  if (duplicate) {
    return { version: VERSION, action: "commit", deduplicated: true, summaryDeduplicated: false, memory: publicMemory(duplicate), state: publicState(state) };
  }
  const summaryMatch = state.memories.find((memory) => memorySummarySimilarity(resolveSummary(state, memory), summary) > limit);

  const objectPath = path.join(base, ".condiments", "memory", "objects", rawSha256);
  await mkdir(path.dirname(objectPath), { recursive: true });
  if (!(await fileExists(objectPath))) await atomicWrite(objectPath, raw.bytes);
  const id = `mem-${rawSha256.slice(0, 16)}-${summarySha256.slice(0, 8)}`;
  assertActionAllowed(state, "commit", id);
  const memory = {
    id,
    summary: summaryMatch ? null : summary,
    summaryRef: summaryMatch?.id ?? null,
    summarySha256,
    rawSha256,
    rawBytes: raw.bytes.length,
    objectPath,
    sourcePath: raw.sourcePath,
    committedAt: validTimestamp(input.timestamp) ?? new Date().toISOString(),
  };
  state.memories.push(memory);
  state.actions.push({ type: "commit", memoryId: id, at: memory.committedAt });
  await writeMemoryState(base, sessionId, state);
  return { version: VERSION, action: "commit", deduplicated: false, summaryDeduplicated: Boolean(summaryMatch), memory: publicMemory(memory), state: publicState(state) };
}

export async function expandReversibleMemory(root, input = {}) {
  const base = path.resolve(root);
  const sessionId = requiredText(input.sessionId, "sessionId");
  const state = await readMemoryState(base, sessionId);
  const memory = findMemory(state, input.memoryId);
  assertActionAllowed(state, "expand", memory.id);
  const bytes = await readFile(memory.objectPath);
  if (bytes.length !== memory.rawBytes || sha256(bytes) !== memory.rawSha256) {
    throw new Error(`Raw memory '${memory.id}' failed byte/hash verification.`);
  }
  state.actions.push({ type: "expand", memoryId: memory.id, at: validTimestamp(input.timestamp) ?? new Date().toISOString() });
  state.expandedMemoryId = memory.id;
  await writeMemoryState(base, sessionId, state);
  return {
    version: VERSION,
    action: "expand",
    memory: publicMemory(memory),
    verified: true,
    bytes,
    text: input.encoding === null ? null : bytes.toString(input.encoding ?? "utf8"),
    state: publicState(state),
  };
}

export async function foldReversibleMemory(root, input = {}) {
  const base = path.resolve(root);
  const sessionId = requiredText(input.sessionId, "sessionId");
  const state = await readMemoryState(base, sessionId);
  const memory = findMemory(state, input.memoryId ?? state.expandedMemoryId);
  assertActionAllowed(state, "fold", memory.id);
  if (state.expandedMemoryId !== memory.id) throw new Error(`Memory '${memory.id}' is not expanded.`);
  state.actions.push({ type: "fold", memoryId: memory.id, at: validTimestamp(input.timestamp) ?? new Date().toISOString() });
  state.expandedMemoryId = null;
  await writeMemoryState(base, sessionId, state);
  return { version: VERSION, action: "fold", memory: publicMemory(memory), summary: resolveSummary(state, memory), state: publicState(state) };
}

export async function inspectReversibleMemory(root, sessionId) {
  const state = await readMemoryState(path.resolve(root), requiredText(sessionId, "sessionId"));
  return publicState(state);
}

export function renderReversibleMemoryReference(memory) {
  if (!memory?.id || !memory?.rawSha256) throw new Error("A valid memory record is required.");
  return `<condiments-memory id="${escapeAttribute(memory.id)}" raw_sha256="${escapeAttribute(memory.rawSha256)}" raw_bytes="${Number(memory.rawBytes)}" mode="folded">Use the checkpoint summary first. Expand exact raw history only when required evidence is missing.</condiments-memory>`;
}

export function memorySummarySimilarity(left, right) {
  const a = normalizedTokens(left);
  const b = normalizedTokens(right);
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const counts = new Map();
  for (const token of a) counts.set(token, (counts.get(token) ?? 0) + 1);
  let overlap = 0;
  for (const token of b) {
    const remaining = counts.get(token) ?? 0;
    if (remaining > 0) {
      overlap += 1;
      counts.set(token, remaining - 1);
    }
  }
  return (2 * overlap) / (a.length + b.length);
}

async function loadRaw(input) {
  if (input.rawBytes !== undefined) {
    const bytes = Buffer.isBuffer(input.rawBytes) ? input.rawBytes : Buffer.from(input.rawBytes);
    return { bytes, sourcePath: null };
  }
  if (input.rawText !== undefined) return { bytes: Buffer.from(String(input.rawText), "utf8"), sourcePath: null };
  const sourcePath = path.resolve(requiredText(input.rawPath, "rawPath"));
  return { bytes: await readFile(sourcePath), sourcePath };
}

async function readMemoryState(root, sessionId) {
  const filePath = statePath(root, sessionId);
  try {
    const candidate = JSON.parse(await readFile(filePath, "utf8"));
    validateState(candidate, sessionId);
    return candidate;
  } catch (error) {
    if (error?.code === "ENOENT") return { version: VERSION, sessionId, memories: [], actions: [], expandedMemoryId: null };
    throw error;
  }
}

async function writeMemoryState(root, sessionId, state) {
  validateState(state, sessionId);
  await atomicWrite(statePath(root, sessionId), Buffer.from(`${JSON.stringify(state, null, 2)}\n`, "utf8"));
}

function validateState(state, sessionId) {
  if (state?.version !== VERSION || state?.sessionId !== sessionId || !Array.isArray(state.memories) || !Array.isArray(state.actions)) {
    throw new Error(`Invalid reversible-memory state for '${sessionId}'.`);
  }
}

function assertActionAllowed(state, type, memoryId) {
  const last = state.actions.at(-1);
  if (last?.type === type && (memoryId === null || last.memoryId === memoryId)) {
    throw new Error(`Repeated '${type}' action is not allowed.`);
  }
  const commits = state.actions.filter((action) => action.type === "commit").length;
  const expands = state.actions.filter((action) => action.type === "expand").length;
  const folds = state.actions.filter((action) => action.type === "fold").length;
  if (type === "expand" && expands + 1 > commits) throw new Error("Expand count cannot exceed commit count.");
  if (type === "fold" && (folds + 1 > expands || expands + folds + 1 > 2 * commits)) {
    throw new Error("Fold violates the bounded memory lifecycle.");
  }
}

function findMemory(state, memoryId) {
  const id = requiredText(memoryId, "memoryId");
  const memory = state.memories.find((item) => item.id === id);
  if (!memory) throw new Error(`Unknown memory '${id}'.`);
  return memory;
}

function resolveSummary(state, memory, seen = new Set()) {
  if (typeof memory.summary === "string") return memory.summary;
  if (!memory.summaryRef || seen.has(memory.id)) throw new Error(`Memory '${memory.id}' has an invalid summary reference.`);
  seen.add(memory.id);
  const referenced = state.memories.find((item) => item.id === memory.summaryRef);
  if (!referenced) throw new Error(`Memory '${memory.id}' references a missing summary.`);
  return resolveSummary(state, referenced, seen);
}

function publicMemory(memory) {
  return { ...memory };
}

function publicState(state) {
  return {
    version: state.version,
    sessionId: state.sessionId,
    memories: state.memories.map(publicMemory),
    actions: state.actions.map((action) => ({ ...action })),
    expandedMemoryId: state.expandedMemoryId,
  };
}

function statePath(root, sessionId) {
  return path.join(root, ".condiments", "memory", "sessions", `${safe(sessionId)}.json`);
}

async function atomicWrite(filePath, bytes) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, filePath);
}

async function fileExists(filePath) {
  try { await readFile(filePath); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

function normalizeSummary(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && !Array.isArray(value)) return stableJson(value);
  throw new Error("summary must be non-empty text or an object.");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function normalizedTokens(value) {
  return String(value ?? "").toLowerCase().match(/[\p{L}\p{N}_./:-]+/gu) ?? [];
}

function requiredText(value, name) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${name} is required.`);
  return text;
}

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function finiteUnit(value) { return Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1 ? Number(value) : null; }
function validTimestamp(value) { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null; }
function safe(value) { return String(value).replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 120) || "session"; }
function escapeAttribute(value) { return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }
