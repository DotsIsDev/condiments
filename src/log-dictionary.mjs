import { createHash } from "node:crypto";

export const LOG_DICTIONARY_DEFAULTS = Object.freeze({
  minOccurrences: 3,
  minSavingsBytes: 16,
});

const VARIABLE = /(?:\d{4}-\d{2}-\d{2}[T ][0-9:.+-]+Z?|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|0x[0-9a-fA-F]+|\b(?:\d{1,3}\.){3}\d{1,3}\b|\b[-+]?\d+(?:\.\d+)?(?:ns|us|ms|s|m|h|B|KB|MB|GB|%)?\b)/g;

export function encodeLogDictionary(input, options = {}) {
  const content = String(input ?? "");
  const minOccurrences = positiveInteger(options.minOccurrences, LOG_DICTIONARY_DEFAULTS.minOccurrences, "minOccurrences");
  const minSavingsBytes = nonNegativeInteger(options.minSavingsBytes, LOG_DICTIONARY_DEFAULTS.minSavingsBytes, "minSavingsBytes");
  const segments = splitLinesExact(content);
  const analyzed = segments.map(templateLine);
  const groups = new Map();

  for (const item of analyzed) {
    const group = groups.get(item.signature) ?? { parts: item.parts, items: [] };
    group.items.push(item);
    groups.set(item.signature, group);
  }

  const candidates = [...groups.entries()]
    .filter(([, group]) => group.items.length >= minOccurrences)
    .map(([signature, group]) => ({ signature, ...group, estimatedSavings: estimateGroupSavings(group) }))
    .filter((group) => group.estimatedSavings >= minSavingsBytes)
    .sort((left, right) => right.estimatedSavings - left.estimatedSavings || left.signature.localeCompare(right.signature));

  const dictionary = candidates.map((group) => group.parts);
  const dictionaryIds = new Map(candidates.map((group, index) => [group.signature, index]));
  const records = packRecords(analyzed.map((item) => {
    const dictionaryId = dictionaryIds.get(item.signature);
    return dictionaryId === undefined ? item.raw : [dictionaryId, ...item.values];
  }));
  const digest = hash(content);
  const dictionaryPayload = { v: 1, c: "log-dict", h: digest, b: Buffer.byteLength(content, "utf8"), d: dictionary, r: records };
  const rawPayload = { v: 1, c: "raw", h: digest, b: Buffer.byteLength(content, "utf8"), x: content };
  const dictionaryBytes = jsonBytes(dictionaryPayload);
  const rawBytes = jsonBytes(rawPayload);
  const compressed = dictionary.length > 0 && dictionaryBytes < rawBytes;
  const payload = compressed ? dictionaryPayload : rawPayload;
  const encodedBytes = compressed ? dictionaryBytes : rawBytes;

  return {
    version: 1,
    codec: payload.c,
    compressed,
    lossless: true,
    original_chars: content.length,
    original_bytes: Buffer.byteLength(content, "utf8"),
    raw_json_bytes: rawBytes,
    encoded_bytes: encodedBytes,
    saved_bytes: Math.max(0, rawBytes - encodedBytes),
    reduction_rate: rawBytes ? Math.max(0, (rawBytes - encodedBytes) / rawBytes) : 0,
    dictionary_entries: compressed ? dictionary.length : 0,
    records: records.length,
    content_hash: `sha256:${digest}`,
    payload,
  };
}

export function decodeLogDictionary(input, options = {}) {
  const payload = input?.payload ?? input;
  if (!payload || payload.v !== 1 || !["raw", "log-dict"].includes(payload.c)) {
    throw new Error("Unsupported log dictionary payload.");
  }
  let content;
  if (payload.c === "raw") {
    if (typeof payload.x !== "string") throw new Error("Raw log payload is missing content.");
    content = payload.x;
  } else {
    if (!Array.isArray(payload.d) || !Array.isArray(payload.r)) throw new Error("Dictionary payload is malformed.");
    content = payload.r.map((record) => decodeRecord(record, payload.d)).join("");
  }
  if (options.verify !== false) {
    if (hash(content) !== payload.h) throw new Error("Decoded log hash does not match payload.");
    if (Buffer.byteLength(content, "utf8") !== payload.b) throw new Error("Decoded log byte count does not match payload.");
  }
  return content;
}

export function renderLogDictionary(input) {
  const result = input?.payload ? input : encodeLogDictionary(input);
  return JSON.stringify(result.payload);
}

function splitLinesExact(content) {
  if (!content) return [];
  return content.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g).filter((line) => line.length > 0);
}

function templateLine(raw) {
  const parts = [];
  const values = [];
  let cursor = 0;
  for (const match of raw.matchAll(VARIABLE)) {
    parts.push(raw.slice(cursor, match.index), null);
    values.push(match[0]);
    cursor = match.index + match[0].length;
  }
  parts.push(raw.slice(cursor));
  return { raw, parts, values, signature: JSON.stringify(parts) };
}

function estimateGroupSavings(group) {
  const rawBytes = group.items.reduce((total, item) => total + jsonBytes(item.raw) + 1, 0);
  const encodedBytes = jsonBytes(group.parts) + group.items.reduce((total, item) => total + jsonBytes([0, ...item.values]) + 1, 0);
  return rawBytes - encodedBytes;
}

function decodeRecord(record, dictionary) {
  if (typeof record === "string") return record;
  if (Array.isArray(record) && record[0] === "R") return decodeRun(record, dictionary);
  if (!Array.isArray(record) || !Number.isSafeInteger(record[0]) || !Array.isArray(dictionary[record[0]])) {
    throw new Error("Dictionary record is malformed.");
  }
  const parts = dictionary[record[0]];
  let valueIndex = 1;
  let output = "";
  for (const part of parts) {
    if (part === null) {
      if (typeof record[valueIndex] !== "string") throw new Error("Dictionary record has missing substitution.");
      output += record[valueIndex++];
    } else if (typeof part === "string") output += part;
    else throw new Error("Dictionary template is malformed.");
  }
  if (valueIndex !== record.length) throw new Error("Dictionary record has extra substitutions.");
  return output;
}

function packRecords(records) {
  const output = [];
  for (let index = 0; index < records.length;) {
    const record = records[index];
    if (!Array.isArray(record) || typeof record[0] !== "number") {
      output.push(record);
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < records.length && Array.isArray(records[end]) && records[end][0] === record[0] && records[end].length === record.length) end += 1;
    const run = records.slice(index, end);
    if (run.length < 4) output.push(...run);
    else output.push(["R", record[0], run.length, ...record.slice(1).map((_, column) => encodeColumn(run.map((item) => item[column + 1])))]);
    index = end;
  }
  return output;
}

function encodeColumn(values) {
  if (values.every((value) => value === values[0])) return ["c", values[0]];
  if (values.every(canonicalInteger)) {
    const integers = values.map(Number);
    const delta = integers[1] - integers[0];
    if (integers.every((value, index) => value === integers[0] + delta * index)) return ["i", integers[0], delta];
  }
  return ["v", ...values];
}

function decodeRun(record, dictionary) {
  const [, dictionaryId, count, ...columns] = record;
  if (!Number.isSafeInteger(dictionaryId) || !Number.isSafeInteger(count) || count < 1 || !Array.isArray(dictionary[dictionaryId])) {
    throw new Error("Dictionary run is malformed.");
  }
  const template = dictionary[dictionaryId];
  const slots = template.filter((part) => part === null).length;
  if (columns.length !== slots) throw new Error("Dictionary run column count does not match template.");
  const decodedColumns = columns.map((column) => decodeColumn(column, count));
  return Array.from({ length: count }, (_, row) => decodeRecord([dictionaryId, ...decodedColumns.map((column) => column[row])], dictionary)).join("");
}

function decodeColumn(column, count) {
  if (!Array.isArray(column)) throw new Error("Dictionary run column is malformed.");
  if (column[0] === "c" && column.length === 2 && typeof column[1] === "string") return Array(count).fill(column[1]);
  if (column[0] === "i" && column.length === 3 && Number.isSafeInteger(column[1]) && Number.isSafeInteger(column[2])) {
    return Array.from({ length: count }, (_, index) => String(column[1] + column[2] * index));
  }
  if (column[0] === "v" && column.length === count + 1 && column.slice(1).every((value) => typeof value === "string")) return column.slice(1);
  throw new Error("Dictionary run column is malformed.");
}

function canonicalInteger(value) {
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d*)$/.test(value)) return false;
  const number = Number(value);
  return Number.isSafeInteger(number) && String(number) === value;
}

function hash(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function positiveInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function nonNegativeInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer.`);
  return parsed;
}
