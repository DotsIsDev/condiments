import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const VERSION = 1;
const STOP_WORDS = new Set(["about", "after", "again", "also", "been", "before", "being", "could", "from", "have", "into", "only", "other", "should", "that", "their", "there", "these", "they", "this", "those", "through", "using", "were", "what", "when", "where", "which", "with", "would"]);
const PATH_PATTERN = /(?:[A-Za-z]:\\[^\s"'<>|]+|(?:\.{0,2}\/|\/)?(?:[\w.-]+\/)+[\w.@+-]+(?:\.[A-Za-z0-9]+)?)/g;
const ERROR_PATTERN = /\b(?:ERR_[A-Z0-9_]+|E\d{3,}|[A-Z][A-Za-z0-9]*(?:Error|Exception|Failure))\b/g;
const SYMBOL_PATTERN = /`([^`\r\n]{2,120})`|\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\b/g;

export function extractMemorySignals(text, explicit = {}) {
  const source = String(text ?? "");
  return {
    paths: unique([...(source.match(PATH_PATTERN) ?? []), ...(explicit.paths ?? [])].map(normalizePathSignal)),
    symbols: unique([...source.matchAll(SYMBOL_PATTERN)].map((match) => match[1] ?? match[2]).concat(explicit.symbols ?? []).map(normalizeSignal)),
    errors: unique([...(source.match(ERROR_PATTERN) ?? []), ...(explicit.errors ?? [])].map(normalizeSignal)),
    commands: unique((explicit.commands ?? []).map(normalizeSignal)),
    terms: unique(tokenize(source).concat((explicit.terms ?? []).flatMap(tokenize))).slice(0, 256),
  };
}

export async function ingestMemoryEvent(root, input = {}) {
  const base = path.resolve(root);
  const sessionId = requiredText(input.sessionId, "sessionId");
  const raw = await loadRaw(input);
  const rawSha256 = sha256(raw.bytes);
  const timestamp = validTimestamp(input.timestamp) ?? new Date().toISOString();
  const signals = extractMemorySignals(raw.bytes.toString("utf8"), input);
  const eventId = sha256(Buffer.from(`${sessionId}\0${input.turn ?? ""}\0${rawSha256}`, "utf8"));
  const objectPath = path.join(base, ".condiments", "zero-memory", "objects", rawSha256);
  await mkdir(path.dirname(objectPath), { recursive: true });
  if (!(await exists(objectPath))) await atomicWrite(objectPath, raw.bytes);

  const indexPath = path.join(base, ".condiments", "zero-memory", "events.json");
  const release = await acquireLock(indexPath);
  try {
    const events = await readEvents(indexPath);
    const duplicate = events.find((event) => event.id === eventId);
    if (duplicate) return { version: VERSION, action: "ingest", deduplicated: true, event: duplicate };
    const event = {
      version: VERSION,
      id: eventId,
      sessionId,
      turn: input.turn ?? null,
      timestamp,
      verified: input.verified === true,
      outcome: optionalText(input.outcome),
      rawSha256,
      rawBytes: raw.bytes.length,
      rawPath: objectPath,
      sourcePath: raw.sourcePath,
      ...signals,
    };
    events.push(event);
    await atomicWrite(indexPath, Buffer.from(`${JSON.stringify(events, null, 2)}\n`, "utf8"));
    return { version: VERSION, action: "ingest", deduplicated: false, event };
  } finally {
    await release();
  }
}

export async function queryMemoryEvents(root, input = {}) {
  const base = path.resolve(root);
  const query = requiredText(input.query, "query");
  const topK = positiveInteger(input.topK ?? 5, "topK");
  const maxChars = positiveInteger(input.maxChars ?? 2_000, "maxChars");
  const events = await readEvents(path.join(base, ".condiments", "zero-memory", "events.json"));
  const requested = extractMemorySignals(query, input);
  const scored = events
    .filter((event) => !input.sessionId || event.sessionId === input.sessionId)
    .map((event) => ({ event, score: scoreEvent(event, requested, input.now) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || Date.parse(right.event.timestamp) - Date.parse(left.event.timestamp))
    .slice(0, topK);

  const evidence = [];
  for (const item of scored) {
    const rawBytes = await readFile(item.event.rawPath);
    if (sha256(rawBytes) !== item.event.rawSha256) throw new Error(`Memory object '${item.event.id}' failed hash verification.`);
    const raw = rawBytes.toString("utf8");
    evidence.push({
      id: item.event.id,
      score: round(item.score),
      timestamp: item.event.timestamp,
      verified: item.event.verified,
      rawSha256: item.event.rawSha256,
      rawPath: item.event.rawPath,
      preview: evidencePreview(raw, requested, maxChars),
    });
  }
  return { version: VERSION, action: "query", providerCalls: 0, providerTokens: 0, querySignals: requested, evidence };
}

export function decideMemoryConsolidation(options = {}) {
  const level = String(options.level ?? "full").toLowerCase();
  if (!["none", "some", "full"].includes(level)) throw new Error(`Unknown memory level '${options.level}'.`);
  if (level === "none") return { consolidate: false, reason: "inactive", threshold: null };
  const turnCount = nonNegativeInteger(options.turnCount ?? 0, "turnCount");
  const recurrenceCount = nonNegativeInteger(options.recurrenceCount ?? 0, "recurrenceCount");
  const recurrenceThreshold = level === "full" ? 4 : 5;
  const pressureThreshold = level === "full" ? 0.70 : 0.85;
  const pressure = pressureRatio(options.usedTokens, options.contextWindowTokens);
  if (turnCount < 4) return { consolidate: false, reason: "short-session", recurrenceThreshold, pressure, pressureThreshold };
  if (options.compactionImminent === true || (pressure !== null && pressure >= pressureThreshold)) {
    return { consolidate: true, reason: options.compactionImminent === true ? "compaction-imminent" : "context-pressure", recurrenceThreshold, pressure, pressureThreshold };
  }
  return {
    consolidate: recurrenceCount >= recurrenceThreshold,
    reason: recurrenceCount >= recurrenceThreshold ? "sustained-recurrence" : "raw-retrieval-sufficient",
    recurrenceThreshold,
    pressure,
    pressureThreshold,
  };
}

async function readEvents(indexPath) {
  try {
    const value = JSON.parse(await readFile(indexPath, "utf8"));
    if (!Array.isArray(value)) throw new Error("Zero-token memory index must be an array.");
    return value;
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function scoreEvent(event, query, nowValue) {
  const weights = { paths: 12, errors: 10, symbols: 6, commands: 5, terms: 1 };
  let score = 0;
  for (const [field, weight] of Object.entries(weights)) {
    const candidates = new Set((event[field] ?? []).map((value) => String(value).toLowerCase()));
    for (const value of query[field] ?? []) if (candidates.has(String(value).toLowerCase())) score += weight;
  }
  if (score === 0) return 0;
  if (event.verified) score += 1;
  const now = validTimestamp(nowValue) ? Date.parse(nowValue) : Date.now();
  const ageDays = Math.max(0, now - Date.parse(event.timestamp)) / 86_400_000;
  return score + 1 / (1 + ageDays / 30);
}

function evidencePreview(raw, query, maxChars) {
  if (raw.length <= maxChars) return raw;
  const needles = [...query.paths, ...query.errors, ...query.symbols, ...query.terms].map((value) => String(value).toLowerCase());
  const lines = raw.split(/\r?\n/);
  const matches = [];
  for (let index = 0; index < lines.length; index += 1) {
    const lower = lines[index].toLowerCase();
    if (needles.some((needle) => needle && lower.includes(needle))) {
      for (let offset = Math.max(0, index - 1); offset <= Math.min(lines.length - 1, index + 1); offset += 1) matches.push(lines[offset]);
    }
  }
  const selected = unique(matches).join("\n");
  if (selected) return selected.slice(0, maxChars);
  const side = Math.floor((maxChars - 32) / 2);
  return `${raw.slice(0, side)}\n…[exact raw at artifact]…\n${raw.slice(-side)}`;
}

async function loadRaw(input) {
  if (input.rawText !== undefined) return { bytes: Buffer.from(String(input.rawText), "utf8"), sourcePath: null };
  const sourcePath = path.resolve(requiredText(input.rawPath, "rawPath"));
  return { bytes: await readFile(sourcePath), sourcePath };
}

async function acquireLock(indexPath) {
  await mkdir(path.dirname(indexPath), { recursive: true });
  const lockPath = `${indexPath}.lock`;
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
  throw new Error("Zero-token memory index is busy.");
}

async function atomicWrite(filePath, bytes) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, filePath);
}

async function exists(filePath) { try { await stat(filePath); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; } }
function tokenize(value) { return (String(value ?? "").toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) ?? []).filter((token) => !STOP_WORDS.has(token)); }
function normalizePathSignal(value) { return String(value ?? "").trim().replaceAll("\\", "/").toLowerCase(); }
function normalizeSignal(value) { return String(value ?? "").trim(); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function requiredText(value, name) { const text = String(value ?? "").trim(); if (!text) throw new Error(`${name} is required.`); return text; }
function optionalText(value) { const text = String(value ?? "").trim(); return text || null; }
function validTimestamp(value) { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null; }
function positiveInteger(value, name) { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`); return parsed; }
function nonNegativeInteger(value, name) { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer.`); return parsed; }
function pressureRatio(used, window) { const a = Number(used); const b = Number(window); return Number.isFinite(a) && a >= 0 && Number.isFinite(b) && b > 0 ? a / b : null; }
function round(value) { return Math.round(value * 1_000) / 1_000; }
