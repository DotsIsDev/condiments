import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { encodeLogDictionary } from "./log-dictionary.mjs";

export const DEFAULT_RESULT_LIMITS = Object.freeze({
  thresholdChars: 80_000,
  previewChars: 2_000,
  maxErrorMatches: 20,
  maxErrorChars: 8_000,
});

const ERROR_PATTERN = /\b(error|exception|failed|failure|fatal|panic|traceback)\b/i;

export function createResultEnvelope(input, options = {}) {
  if (!input || typeof input !== "object") {
    throw new Error("Tool result input must be an object.");
  }

  const content = String(input.content ?? "");
  const limits = normalizeLimits(options);
  const digest = createHash("sha256").update(content, "utf8").digest("hex");
  const base = {
    version: 1,
    tool: nonEmptyString(input.tool, "tool"),
    request_summary: optionalString(input.request_summary),
    exit_status: normalizeExitStatus(input.exit_status),
    truncated: content.length > limits.thresholdChars,
    original_chars: content.length,
    original_bytes: Buffer.byteLength(content, "utf8"),
    content_hash: `sha256:${digest}`,
  };

  if (!base.truncated) {
    return {
      ...base,
      content,
      relevant_head: "",
      relevant_tail: "",
      error_matches: collectErrorMatches(content, limits),
      artifact_path: null,
      dictionary_compression: null,
    };
  }

  const envelope = {
    ...base,
    content: null,
    relevant_head: content.slice(0, limits.previewChars),
    relevant_tail: content.slice(-limits.previewChars),
    error_matches: collectErrorMatches(content, limits),
    artifact_path: options.artifactPath ? path.resolve(options.artifactPath) : null,
    dictionary_compression: null,
  };
  if (options.dictionaryCompression !== false) {
    const encoded = encodeLogDictionary(content, options.dictionaryOptions);
    const candidate = {
      codec: encoded.codec,
      lossless: encoded.lossless,
      encoded_bytes: encoded.encoded_bytes,
      raw_json_bytes: encoded.raw_json_bytes,
      saved_bytes: encoded.saved_bytes,
      reduction_rate: encoded.reduction_rate,
      dictionary_entries: encoded.dictionary_entries,
      payload: encoded.payload,
    };
    if (encoded.compressed && JSON.stringify({ ...envelope, dictionary_compression: candidate }).length <= limits.thresholdChars) {
      envelope.dictionary_compression = candidate;
    }
  }
  return envelope;
}

export async function offloadToolResult(input, options = {}) {
  const previewEnvelope = createResultEnvelope(input, options);
  if (!previewEnvelope.truncated) return previewEnvelope;

  const artifactDirectory = path.resolve(
    options.artifactDirectory || path.join(process.cwd(), ".condiments", "artifacts"),
  );
  const digest = previewEnvelope.content_hash.slice("sha256:".length);
  const safeTool = previewEnvelope.tool
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "tool";
  const artifactPath = path.join(
    artifactDirectory,
    `${safeTool}-${digest.slice(0, 16)}.txt`,
  );

  await mkdir(artifactDirectory, { recursive: true });
  if (!(await exists(artifactPath))) {
    await writeFile(artifactPath, String(input.content ?? ""), "utf8");
  }

  return createResultEnvelope(input, { ...options, artifactPath });
}

function normalizeLimits(options) {
  return {
    thresholdChars: positiveInteger(
      options.thresholdChars,
      DEFAULT_RESULT_LIMITS.thresholdChars,
      "thresholdChars",
    ),
    previewChars: positiveInteger(
      options.previewChars,
      DEFAULT_RESULT_LIMITS.previewChars,
      "previewChars",
    ),
    maxErrorMatches: positiveInteger(
      options.maxErrorMatches,
      DEFAULT_RESULT_LIMITS.maxErrorMatches,
      "maxErrorMatches",
    ),
    maxErrorChars: positiveInteger(
      options.maxErrorChars,
      DEFAULT_RESULT_LIMITS.maxErrorChars,
      "maxErrorChars",
    ),
  };
}

function collectErrorMatches(content, limits) {
  const matches = [];
  let usedChars = 0;
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    if (!ERROR_PATTERN.test(lines[index])) continue;
    const text = lines[index].slice(0, 1_000);
    if (usedChars + text.length > limits.maxErrorChars) break;
    matches.push({ line: index + 1, text });
    usedChars += text.length;
    if (matches.length >= limits.maxErrorMatches) break;
  }
  return matches;
}

function positiveInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return number;
}

function nonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new Error("request_summary must be a string.");
  }
  return value;
}

function normalizeExitStatus(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("exit_status must be a string, number, or null.");
  }
  return value;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
