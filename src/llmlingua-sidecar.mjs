import { spawn } from "node:child_process";
import path from "node:path";

export async function probeLLMLinguaSidecar(options = {}) {
  const command = options.command ?? "python";
  const args = options.args ?? [path.resolve("sidecars", "llmlingua2.py"), "--probe"];
  try {
    const result = await run(command, args, "", options.timeoutMs ?? 10_000);
    const payload = JSON.parse(result.stdout || "{}");
    return { available: result.code === 0 && payload.available === true, command, detail: payload.detail ?? (result.stderr.trim() || null) };
  } catch (error) {
    return { available: false, command, detail: error.message };
  }
}

export async function compressWithLLMLingua(options = {}) {
  const source = String(options.text ?? "");
  const level = normalizeLevel(options.level);
  if (level === "none") return fallback(source, "inactive");
  if (options.capability !== true) return fallback(source, "capability-unavailable");
  if (!source.trim()) return fallback(source, "empty-input");

  const command = options.command ?? "python";
  const args = options.args ?? [path.resolve("sidecars", "llmlingua2.py")];
  const targetRate = Number(options.targetRate ?? (level === "full" ? 0.35 : 0.65));
  if (!(targetRate > 0 && targetRate <= 1)) throw new Error("targetRate must be greater than 0 and at most 1.");
  const payload = JSON.stringify({ text: source, query: String(options.query ?? ""), target_rate: targetRate });
  let executed;
  try {
    executed = await run(command, args, payload, options.timeoutMs ?? 120_000);
  } catch (error) {
    return fallback(source, "sidecar-error", { detail: error.message });
  }
  if (executed.code !== 0) return fallback(source, "sidecar-error", { detail: executed.stderr.trim() });

  let response;
  try { response = JSON.parse(executed.stdout); } catch { return fallback(source, "invalid-sidecar-json"); }
  const compressed = String(response.compressed_text ?? "");
  if (!isExtractiveTokenSubsequence(source, compressed)) return fallback(source, "non-extractive-output");
  const missingSignals = [...new Set((options.lockedSignals ?? []).map(String))].filter((signal) => signal && !compressed.toLowerCase().includes(signal.toLowerCase()));
  if (missingSignals.length) return fallback(source, "locked-signal-lost", { missingSignalCount: missingSignals.length });
  const sourceTokens = integer(response.source_tokens) ?? estimateTokens(source);
  const compressedTokens = integer(response.compressed_tokens) ?? estimateTokens(compressed);
  const overheadTokens = integer(options.overheadTokens) ?? 64;
  if (sourceTokens - compressedTokens <= overheadTokens) return fallback(source, "no-net-token-saving", { sourceTokens, compressedTokens, overheadTokens });
  return {
    version: 1,
    active: true,
    applied: true,
    reason: "verified-extractive-compression",
    text: compressed,
    sourceTokens,
    compressedTokens,
    overheadTokens,
    netTokenReduction: sourceTokens - compressedTokens - overheadTokens,
    reductionRate: sourceTokens ? (sourceTokens - compressedTokens) / sourceTokens : 0,
    exactSignalsPreserved: true,
  };
}

export function isExtractiveTokenSubsequence(source, candidate) {
  const sourceTokens = tokens(source);
  const candidateTokens = tokens(candidate);
  let cursor = 0;
  for (const token of candidateTokens) {
    while (cursor < sourceTokens.length && sourceTokens[cursor] !== token) cursor += 1;
    if (cursor >= sourceTokens.length) return false;
    cursor += 1;
  }
  return true;
}

function run(command, args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => { child.kill(); reject(new Error(`sidecar timed out after ${timeoutMs} ms`)); }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }); });
    child.stdin.end(input);
  });
}

function fallback(text, reason, extra = {}) { return { version: 1, active: reason !== "inactive", applied: false, reason, text, ...extra }; }
function tokens(value) { return String(value ?? "").toLowerCase().match(/[\p{L}\p{N}_$./:@-]+/gu) ?? []; }
function estimateTokens(value) { return Math.max(1, Math.ceil(Buffer.byteLength(String(value), "utf8") / 4)); }
function integer(value) { const number = Number(value); return Number.isSafeInteger(number) && number >= 0 ? number : null; }
function normalizeLevel(value) { const level = String(value ?? "full").toLowerCase(); if (!["none", "some", "full"].includes(level)) throw new Error(`Unknown level '${value}'.`); return level; }
