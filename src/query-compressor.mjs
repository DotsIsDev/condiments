import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export const QUERY_COMPRESSION_PROFILES = Object.freeze({
  none: Object.freeze({ retentionRatio: 1, maxRecoveryRounds: 0 }),
  some: Object.freeze({ retentionRatio: 0.65, maxRecoveryRounds: 1 }),
  full: Object.freeze({ retentionRatio: 0.35, maxRecoveryRounds: 2 }),
});

const WORD = /[\p{L}\p{N}_$.-]+/gu;
const PATH_SIGNAL = /(?:^|[\s`'"(])((?:[\w@.-]+[\\/])+[\w@.()$-]+)/g;
const QUOTED_SIGNAL = /`([^`]{2,120})`|"([^"\r\n]{2,120})"|'([^'\r\n]{2,120})'/g;
const OPAQUE_SIGNAL = /\b(?:[A-Fa-f0-9]{7,64}|[A-Za-z]+[-_:][A-Za-z0-9_.:-]{2,}|\d+(?:\.\d+)+|\d{2,})\b/g;
const FAILURE = /\b(?:error|exception|fail(?:ed|ure)?|panic|timeout|traceback|assert(?:ion)?)\b/i;
const KIND_WEIGHT = Object.freeze({ error: 1.6, test: 1.5, code: 1.3, config: 1.25, diff: 1.25, log: 1.1, text: 1, docs: 0.8, history: 0.65 });
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "for", "from", "how", "i", "in", "is", "it",
  "of", "on", "or", "that", "the", "this", "to", "was", "what", "when", "where", "which", "with", "you",
]);

export function compressQueryEvidence(options = {}) {
  const level = normalizeLevel(options.level);
  const query = String(options.query ?? "").trim();
  const evidence = normalizeEvidence(options.evidence);
  const requirements = normalizeRequirements(options.requirements);
  const signals = extractExactSignals(query, requirements);
  const scored = scoreEvidence(query, evidence, { requirements, signals });
  const sourceTokens = sum(scored, "tokenCount");
  const requestedBudget = options.budgetTokens === undefined
    ? Math.max(1, Math.floor(sourceTokens * QUERY_COMPRESSION_PROFILES[level].retentionRatio))
    : positiveInteger(options.budgetTokens, "budgetTokens");

  const selected = level === "none"
    ? [...scored]
    : selectEvidence(scored, requestedBudget);
  const ordered = level === "none" ? selected.sort((left, right) => left.index - right.index) : orderForAttention(selected);
  const selectedTokens = sum(ordered, "tokenCount");
  const validation = validateCompressedEvidence({
    query,
    sourceEvidence: evidence,
    selectedEvidence: ordered,
    requirements,
    signals,
  });
  const overBudget = selectedTokens > requestedBudget;
  const tokenCountMode = evidence.every((item) => item.tokenCountExact) ? "provider" : "estimated";

  return {
    version: 1,
    level,
    queryHash: hash(query),
    sourceSegments: evidence.length,
    selectedSegments: ordered.length,
    sourceTokens,
    selectedTokens,
    requestedBudget,
    tokenCountMode,
    reductionRate: sourceTokens ? (sourceTokens - selectedTokens) / sourceTokens : 0,
    overBudget,
    readyForModel: validation.valid,
    validation,
    selected: ordered.map(publicEvidence),
    prompt: validation.valid ? renderSelectedEvidence(ordered) : null,
  };
}

export function scoreEvidence(query, evidenceInput, options = {}) {
  const evidence = normalizeEvidence(evidenceInput);
  const requirements = normalizeRequirements(options.requirements);
  const signals = options.signals ?? extractExactSignals(query, requirements);
  const queryTerms = meaningfulTerms(query);
  const documentFrequency = new Map();
  for (const item of evidence) {
    for (const term of new Set(meaningfulTerms(item.content))) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  return evidence.map((item, index) => {
    const terms = new Set(meaningfulTerms(`${item.path ?? ""} ${item.source ?? ""} ${item.content}`));
    let lexical = 0;
    for (const term of queryTerms) {
      if (!terms.has(term)) continue;
      lexical += Math.log(1 + evidence.length / (1 + (documentFrequency.get(term) ?? 0)));
    }
    lexical = queryTerms.length ? lexical / queryTerms.length : 0;
    const semantic = finiteUnit(item.semanticScore) ?? lexical;
    const exactMatches = signals.filter((signal) => evidenceContains(item, signal.value));
    const requirementMatches = requirements.filter((requirement) => requirementMatchesEvidence(requirement, item));
    const lockedReasons = [
      ...exactMatches.map((signal) => `query:${signal.type}:${signal.value}`),
      ...requirementMatches.filter((requirement) => requirement.lock).map((requirement) => `required:${requirement.id}`),
      ...(item.locked ? ["source:locked"] : []),
    ];
    const dependencyMatches = item.dependencies.filter((dependency) =>
      queryTerms.includes(dependency.toLowerCase()) || signals.some((signal) => equalFold(signal.value, dependency))
    ).length;
    const failureBonus = FAILURE.test(query) && (item.kind === "error" || item.kind === "test" || FAILURE.test(item.content)) ? 1 : 0;
    const exactBonus = exactMatches.length * 3 + requirementMatches.length * 4;
    const dependencyBonus = dependencyMatches * 1.5;
    const kindWeight = KIND_WEIGHT[item.kind] ?? 1;
    const redundancy = maxSimilarity(item, evidence.slice(0, index));
    const relevance = 0.6 * semantic + 0.4 * lexical;
    const scoreBeforeRedundancy = kindWeight * relevance + exactBonus + dependencyBonus + failureBonus;
    const redundancyPenalty = lockedReasons.length ? 0 : redundancy * Math.min(1, scoreBeforeRedundancy) * 0.75;
    const score = Math.max(0, scoreBeforeRedundancy - redundancyPenalty);
    return {
      ...item,
      index,
      score,
      scoreDensity: score / Math.max(1, item.tokenCount),
      scoreComponents: { lexical, semantic, kindWeight, exactBonus, dependencyBonus, failureBonus, redundancy, redundancyPenalty },
      locked: lockedReasons.length > 0,
      lockedReasons: [...new Set(lockedReasons)],
      contentHash: hash(item.content),
    };
  });
}

export function validateCompressedEvidence(options = {}) {
  const source = normalizeEvidence(options.sourceEvidence);
  const selected = normalizeEvidence(options.selectedEvidence);
  const requirements = normalizeRequirements(options.requirements);
  const signals = options.signals ?? extractExactSignals(options.query, requirements);
  const selectedIds = new Set(selected.map((item) => item.id));
  const lockedSource = scoreEvidence(options.query ?? "", source, { requirements, signals }).filter((item) => item.locked);
  const missing = [];

  for (const item of lockedSource) {
    if (!selectedIds.has(item.id)) missing.push({ type: "locked-evidence", id: item.id });
  }
  for (const requirement of requirements) {
    if (requirementsSatisfied(requirement, selected)) continue;
    missing.push({ type: "requirement", id: requirement.id, requirementType: requirement.type });
  }
  for (const signal of signals) {
    if (!source.some((item) => evidenceContains(item, signal.value))) continue;
    if (!selected.some((item) => evidenceContains(item, signal.value))) {
      missing.push({ type: "query-signal", signalType: signal.type, valueHash: hash(signal.value) });
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    checks: {
      lockedEvidence: lockedSource.length,
      requirements: requirements.length,
      querySignalsPresentInSource: signals.filter((signal) => source.some((item) => evidenceContains(item, signal.value))).length,
    },
  };
}

export async function compressQueryEvidenceWithRecovery(options = {}) {
  const level = normalizeLevel(options.level);
  const maxRounds = options.maxRecoveryRounds === undefined
    ? QUERY_COMPRESSION_PROFILES[level].maxRecoveryRounds
    : nonNegativeInteger(options.maxRecoveryRounds, "maxRecoveryRounds");
  let evidence = normalizeEvidence(options.evidence);
  const history = [];

  for (let round = 0; round <= maxRounds; round += 1) {
    let result = compressQueryEvidence({ ...options, evidence });
    if (result.readyForModel && typeof options.verifySufficiency === "function") {
      const verdict = await options.verifySufficiency(result, { round, query: options.query });
      const external = normalizeSufficiencyVerdict(verdict);
      if (!external.valid) {
        result = {
          ...result,
          readyForModel: false,
          prompt: null,
          validation: {
            ...result.validation,
            valid: false,
            missing: [...result.validation.missing, ...external.missing],
            external: true,
          },
        };
      }
    }
    history.push({
      round,
      readyForModel: result.readyForModel,
      selectedTokens: result.selectedTokens,
      missing: result.validation.missing,
    });
    if (result.readyForModel) return { ...result, recoveryRounds: round, recoveryHistory: history };
    if (round === maxRounds) return { ...result, recoveryRounds: round, recoveryHistory: history };

    const recovered = options.retrieveMissing
      ? await options.retrieveMissing(result.validation.missing, { round: round + 1, query: options.query })
      : options.recoveryBatches?.[round];
    const additions = normalizeEvidence(recovered ?? []);
    if (!additions.length) return { ...result, recoveryRounds: round, recoveryHistory: history };
    evidence = mergeEvidence(evidence, additions);
  }
}

export function createQueryCompressionTelemetryRecord(result, metadata = {}) {
  if (!result || typeof result !== "object") throw new Error("Compression result must be an object.");
  const timestamp = validTimestamp(metadata.timestamp) ?? new Date().toISOString();
  const record = {
    version: 1,
    eventId: String(metadata.eventId ?? hash(JSON.stringify({ timestamp, queryHash: result.queryHash, level: result.level, selectedTokens: result.selectedTokens }))),
    timestamp,
    host: metadata.host ?? null,
    provider: metadata.provider ?? null,
    level: result.level ?? null,
    queryHash: result.queryHash ?? null,
    sourceSegments: integerOrNull(result.sourceSegments),
    selectedSegments: integerOrNull(result.selectedSegments),
    sourceTokens: integerOrNull(result.sourceTokens),
    selectedTokens: integerOrNull(result.selectedTokens),
    requestedBudget: integerOrNull(result.requestedBudget),
    tokenCountMode: result.tokenCountMode ?? null,
    overBudget: result.overBudget === true,
    readyForModel: result.readyForModel === true,
    missingCount: Array.isArray(result.validation?.missing) ? result.validation.missing.length : null,
    recoveryRounds: integerOrNull(result.recoveryRounds),
  };
  return record;
}

export async function appendQueryCompressionTelemetry(root, records) {
  const filePath = telemetryPath(root);
  const items = Array.isArray(records) ? records : [records];
  const existing = await readQueryCompressionTelemetry(root);
  const ids = new Set(existing.map((record) => record.eventId));
  const added = items.filter((record) => record?.eventId && !ids.has(record.eventId) && ids.add(record.eventId));
  if (added.length) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, `${added.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
  }
  return { path: filePath, added: added.length, duplicate: items.length - added.length };
}

export async function readQueryCompressionTelemetry(root) {
  try {
    const records = (await readFile(telemetryPath(root), "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    return [...new Map(records.map((record) => [record.eventId, record])).values()];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export function summarizeQueryCompressionTelemetry(records) {
  if (!Array.isArray(records)) throw new Error("Query-compression records must be an array.");
  const sourceTokens = sum(records, "sourceTokens");
  const selectedTokens = sum(records, "selectedTokens");
  return {
    version: 1,
    events: records.length,
    qualityPasses: records.filter((record) => record.readyForModel).length,
    qualityFailures: records.filter((record) => !record.readyForModel).length,
    overBudgetEvents: records.filter((record) => record.overBudget).length,
    sourceTokens,
    selectedTokens,
    tokenReduction: sourceTokens - selectedTokens,
    reductionRate: sourceTokens ? (sourceTokens - selectedTokens) / sourceTokens : 0,
  };
}

function selectEvidence(scored, budget) {
  const selected = new Map();
  for (const item of scored.filter((candidate) => candidate.locked)) selected.set(item.id, item);
  let used = sum([...selected.values()], "tokenCount");
  const candidates = scored
    .filter((item) => !selected.has(item.id))
    .sort((left, right) => right.scoreDensity - left.scoreDensity || right.score - left.score || left.index - right.index);

  for (const item of candidates) {
    if (item.score <= 0) continue;
    if (used + item.tokenCount > budget) continue;
    selected.set(item.id, item);
    used += item.tokenCount;
    for (const dependency of item.dependsOn) {
      const dependencyItem = scored.find((candidate) => candidate.id === dependency);
      if (!dependencyItem || selected.has(dependencyItem.id)) continue;
      if (used + dependencyItem.tokenCount > budget) continue;
      selected.set(dependencyItem.id, dependencyItem);
      used += dependencyItem.tokenCount;
    }
  }
  return [...selected.values()];
}

function normalizeEvidence(candidate) {
  if (!Array.isArray(candidate)) throw new Error("evidence must be an array.");
  const ids = new Set();
  return candidate.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`evidence[${index}] must be an object.`);
    const id = String(item.id ?? `segment-${index + 1}`);
    if (ids.has(id)) throw new Error(`Duplicate evidence id '${id}'.`);
    ids.add(id);
    const content = String(item.content ?? "");
    const explicitTokens = item.tokenCount;
    if (explicitTokens !== undefined) positiveInteger(explicitTokens, `evidence[${index}].tokenCount`);
    const startLine = optionalPositiveInteger(item.startLine, `evidence[${index}].startLine`);
    const endLine = optionalPositiveInteger(item.endLine, `evidence[${index}].endLine`);
    if (startLine && endLine && endLine < startLine) throw new Error(`evidence[${index}] line range is reversed.`);
    return {
      id,
      source: item.source == null ? null : String(item.source),
      path: item.path == null ? null : String(item.path),
      startLine,
      endLine,
      kind: String(item.kind ?? "text").toLowerCase(),
      content,
      tokenCount: explicitTokens ?? estimateTokens(content),
      tokenCountExact: explicitTokens !== undefined,
      semanticScore: item.semanticScore,
      dependencies: stringArray(item.dependencies),
      dependsOn: stringArray(item.dependsOn),
      locked: item.locked === true,
    };
  });
}

function normalizeRequirements(candidate) {
  if (candidate === undefined) return [];
  if (!Array.isArray(candidate)) throw new Error("requirements must be an array.");
  return candidate.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`requirements[${index}] must be an object.`);
    const type = String(item.type ?? "exact").toLowerCase();
    if (!["exact", "regex", "segment", "source", "line"].includes(type)) throw new Error(`Unknown requirement type '${type}'.`);
    if (type === "line") {
      optionalPositiveInteger(item.startLine, `requirements[${index}].startLine`);
      optionalPositiveInteger(item.endLine, `requirements[${index}].endLine`);
    } else if (item.value === undefined) {
      throw new Error(`requirements[${index}].value is required.`);
    }
    return {
      id: String(item.id ?? `requirement-${index + 1}`),
      type,
      value: item.value == null ? null : String(item.value),
      path: item.path == null ? null : String(item.path),
      startLine: item.startLine ?? null,
      endLine: item.endLine ?? item.startLine ?? null,
      flags: String(item.flags ?? ""),
      lock: item.lock !== false,
    };
  });
}

function extractExactSignals(query, requirements) {
  const signals = [];
  for (const match of query.matchAll(PATH_SIGNAL)) signals.push({ type: "path", value: match[1] });
  for (const match of query.matchAll(QUOTED_SIGNAL)) signals.push({ type: "quoted", value: match[1] ?? match[2] ?? match[3] });
  for (const match of query.matchAll(OPAQUE_SIGNAL)) signals.push({ type: "opaque", value: match[0] });
  for (const requirement of requirements) {
    if (requirement.type === "exact" && requirement.value) signals.push({ type: "required", value: requirement.value });
    if (requirement.path) signals.push({ type: "path", value: requirement.path });
  }
  return [...new Map(signals.filter((signal) => signal.value.length >= 2).map((signal) => [`${signal.type}:${signal.value.toLowerCase()}`, signal])).values()];
}

function requirementMatchesEvidence(requirement, item) {
  if (requirement.type === "exact") return evidenceContains(item, requirement.value);
  if (requirement.type === "regex") return safeRegex(requirement).test(item.content);
  if (requirement.type === "segment") return item.id === requirement.value;
  if (requirement.type === "source") return equalFold(item.source, requirement.value) || equalFold(item.path, requirement.value);
  if (requirement.type === "line") return lineRequirementMatches(requirement, item);
  return false;
}

function requirementsSatisfied(requirement, selected) {
  return selected.some((item) => requirementMatchesEvidence(requirement, item));
}

function lineRequirementMatches(requirement, item) {
  if (requirement.path && !equalFold(item.path, requirement.path) && !equalFold(item.source, requirement.path)) return false;
  if (!item.startLine || !item.endLine || !requirement.startLine) return false;
  return item.startLine <= requirement.startLine && item.endLine >= (requirement.endLine ?? requirement.startLine);
}

function evidenceContains(item, value) {
  const needle = String(value ?? "");
  if (!needle) return false;
  return [item.id, item.source, item.path, item.content, ...item.dependencies].some((candidate) =>
    candidate != null && String(candidate).toLowerCase().includes(needle.toLowerCase())
  );
}

function publicEvidence(item) {
  return {
    id: item.id,
    source: item.source,
    path: item.path,
    startLine: item.startLine,
    endLine: item.endLine,
    kind: item.kind,
    content: item.content,
    tokenCount: item.tokenCount,
    contentHash: item.contentHash ?? hash(item.content),
    score: Number.isFinite(item.score) ? item.score : null,
    scoreComponents: item.scoreComponents ?? null,
    attentionPosition: item.attentionPosition ?? null,
    locked: item.locked === true,
    lockedReasons: item.lockedReasons ?? [],
  };
}

function orderForAttention(items) {
  const locked = items.filter((item) => item.locked).sort((left, right) => left.index - right.index);
  const optional = items.filter((item) => !item.locked).sort((left, right) => left.score - right.score || left.index - right.index);
  return [...locked, ...optional].map((item, index, ordered) => ({
    ...item,
    attentionPosition: index < locked.length ? "front" : index === ordered.length - 1 ? "back" : "middle",
  }));
}

function maxSimilarity(item, earlier) {
  const terms = new Set(meaningfulTerms(item.content));
  if (!terms.size) return 0;
  let maximum = 0;
  for (const candidate of earlier) {
    const other = new Set(meaningfulTerms(candidate.content));
    const intersection = [...terms].filter((term) => other.has(term)).length;
    const union = new Set([...terms, ...other]).size;
    maximum = Math.max(maximum, union ? intersection / union : 0);
  }
  return maximum;
}

function renderSelectedEvidence(items) {
  return items.map((item) => {
    const location = item.path
      ? `${item.path}${item.startLine ? `:${item.startLine}${item.endLine && item.endLine !== item.startLine ? `-${item.endLine}` : ""}` : ""}`
      : item.source ?? item.id;
    return `<evidence id="${escapeAttribute(item.id)}" source="${escapeAttribute(location)}">\n${item.content}\n</evidence>`;
  }).join("\n");
}

function mergeEvidence(existing, additions) {
  const merged = new Map(existing.map((item) => [item.id, item]));
  for (const item of additions) merged.set(item.id, item);
  return [...merged.values()];
}

function normalizeSufficiencyVerdict(verdict) {
  if (verdict === true || verdict?.valid === true) return { valid: true, missing: [] };
  if (verdict === false) return { valid: false, missing: [{ type: "external-sufficiency", id: "required-evidence" }] };
  if (verdict && typeof verdict === "object" && Array.isArray(verdict.missing)) {
    return {
      valid: false,
      missing: verdict.missing.map((item, index) => typeof item === "string"
        ? { type: "external-sufficiency", id: item }
        : { type: "external-sufficiency", id: String(item?.id ?? `external-${index + 1}`) }),
    };
  }
  throw new Error("verifySufficiency must return true, false, or { valid, missing }.");
}

function meaningfulTerms(value) {
  return [...String(value ?? "").toLowerCase().matchAll(WORD)]
    .map((match) => match[0])
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

function estimateTokens(value) {
  const text = String(value ?? "");
  if (!text) return 1;
  return Math.max(1, Math.ceil(Buffer.byteLength(text, "utf8") / 4));
}

function safeRegex(requirement) {
  try {
    return new RegExp(requirement.value, requirement.flags);
  } catch (error) {
    throw new Error(`Invalid regex requirement '${requirement.id}': ${error.message}`);
  }
}

function equalFold(left, right) {
  return left != null && right != null && String(left).toLowerCase() === String(right).toLowerCase();
}

function finiteUnit(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("semanticScore must be between 0 and 1.");
  return value;
}

function stringArray(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("dependencies and dependsOn must be arrays.");
  return value.map(String);
}

function normalizeLevel(value) {
  const level = String(value ?? "full").toLowerCase();
  if (!(level in QUERY_COMPRESSION_PROFILES)) throw new Error(`Unknown compression level '${value}'.`);
  return level;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function optionalPositiveInteger(value, name) {
  if (value === undefined || value === null) return null;
  return positiveInteger(value, name);
}

function nonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value;
}

function integerOrNull(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function validTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function escapeAttribute(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function sum(items, field) {
  return items.reduce((total, item) => total + Number(item[field] ?? 0), 0);
}

function telemetryPath(root) {
  return path.join(path.resolve(root), ".condiments", "query-compressor", "events.jsonl");
}
