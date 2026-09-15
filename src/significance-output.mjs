import { createHash } from "node:crypto";

export const REQUIRED_OUTPUT_KINDS = Object.freeze([
  "artifact", "citation", "edit", "error", "exact", "failure", "file", "line", "path", "requested", "test", "unresolved", "value",
]);

const OPTIONAL_KIND_SCORE = Object.freeze({ result: 5, evidence: 4, rationale: 2, recap: 1, narration: 0.5, greeting: 0 });

export function selectSignificantOutput(options = {}) {
  const level = normalizeLevel(options.level);
  const blocks = normalizeBlocks(options.blocks);
  const budgetTokens = options.budgetTokens == null ? Infinity : positiveInteger(options.budgetTokens, "budgetTokens");
  const deduplicated = deduplicateOptional(blocks);
  const required = deduplicated.filter((block) => block.required);
  const optional = deduplicated.filter((block) => !block.required);
  const requiredTokens = total(required);
  const selected = new Map(required.map((block) => [block.id, block]));
  let used = requiredTokens;

  if (level === "none") {
    for (const block of optional) selected.set(block.id, block);
  } else {
    for (const block of optional.sort(byUtility)) {
      if (used + block.tokenCount > budgetTokens) continue;
      selected.set(block.id, block);
      used += block.tokenCount;
    }
  }

  const ordered = deduplicated.filter((block) => selected.has(block.id));
  const selectedTokens = total(ordered);
  const omitted = blocks.filter((block) => !selected.has(block.id)).map((block) => block.id);
  const requiredOverBudget = requiredTokens > budgetTokens;
  const requiredResults = normalizeRequiredResults(options.requiredResults);
  const missingRequired = requiredResults.filter((result) => !result.present).map((result) => result.name);
  const capHit = options.capHit === true;
  const qualityPassed = missingRequired.length === 0 && !(capHit && options.requiredResultLost === true);

  return {
    version: 1,
    level,
    sourceBlocks: blocks.length,
    selectedBlocks: ordered.length,
    sourceTokens: total(blocks),
    selectedTokens,
    budgetTokens: Number.isFinite(budgetTokens) ? budgetTokens : null,
    requiredTokens,
    requiredOverBudget,
    omitted,
    capHit,
    qualityPassed,
    missingRequired,
    blocks: ordered.map(publicBlock),
    output: ordered.map((block) => block.text).join(options.separator ?? "\n"),
  };
}

export function classifyOutputBlock(block = {}) {
  const kind = String(block.kind ?? "result").toLowerCase();
  const text = String(block.text ?? block.content ?? "");
  const required = block.required === true
    || REQUIRED_OUTPUT_KINDS.includes(kind)
    || /\b(?:required|must include|exact value|test failed|unresolved|blocked)\b/i.test(text);
  return { kind, required };
}

function normalizeBlocks(candidate) {
  if (!Array.isArray(candidate)) throw new Error("blocks must be an array.");
  const ids = new Set();
  return candidate.map((block, index) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) throw new Error(`blocks[${index}] must be an object.`);
    const id = String(block.id ?? `block-${index + 1}`);
    if (ids.has(id)) throw new Error(`Duplicate block id '${id}'.`);
    ids.add(id);
    const text = String(block.text ?? block.content ?? "");
    const classification = classifyOutputBlock(block);
    const tokenCount = block.tokenCount == null ? estimateTokens(text) : positiveInteger(block.tokenCount, `blocks[${index}].tokenCount`);
    const utility = Number.isFinite(Number(block.utility)) ? Number(block.utility) : OPTIONAL_KIND_SCORE[classification.kind] ?? 1;
    return { id, text, tokenCount, utility, ...classification, index, contentHash: hash(text) };
  });
}

function deduplicateOptional(blocks) {
  const hashes = new Set();
  return blocks.filter((block) => {
    if (block.required) return true;
    if (hashes.has(block.contentHash)) return false;
    hashes.add(block.contentHash);
    return true;
  });
}

function normalizeRequiredResults(candidate) {
  if (!Array.isArray(candidate)) return [];
  return candidate.filter((item) => item?.required !== false).map((item, index) => ({
    name: String(item?.name ?? item?.id ?? `result-${index + 1}`),
    present: item?.present === true || item?.valid === true || item?.passed === true,
  }));
}

function byUtility(left, right) {
  return (right.utility / Math.max(1, right.tokenCount)) - (left.utility / Math.max(1, left.tokenCount)) || right.utility - left.utility || left.index - right.index;
}

function publicBlock(block) { return { id: block.id, kind: block.kind, required: block.required, tokenCount: block.tokenCount, text: block.text, contentHash: block.contentHash }; }
function total(items) { return items.reduce((sum, item) => sum + item.tokenCount, 0); }
function estimateTokens(text) { return Math.max(1, Math.ceil(Buffer.byteLength(String(text), "utf8") / 4)); }
function positiveInteger(value, name) { if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`); return value; }
function normalizeLevel(value) { const level = String(value ?? "full").toLowerCase(); if (!["none", "some", "full"].includes(level)) throw new Error(`Unknown level '${value}'.`); return level; }
function hash(value) { return createHash("sha256").update(String(value)).digest("hex"); }
