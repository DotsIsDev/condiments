import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function inspectCodexRollout(threadId, options = {}) {
  const codexHome = options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const candidates = await findRollouts(path.join(codexHome, "sessions"), threadId);
  const rollout = candidates.at(-1) ?? null;
  if (!rollout) return emptyInspection();
  const records = parseRolloutJsonl(await readFile(rollout, "utf8"));
  return { ...inspectCodexRolloutRecords(records), rollout };
}

export function parseRolloutJsonl(input) {
  return String(input || "").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export function inspectCodexRolloutRecords(records) {
  const usageRecords = records.filter((record) => record.type === "token_usage_record" && record.payload);
  const latestUsage = usageRecords.at(-1)?.payload?.thread_token_usage ?? null;
  const responseIds = new Set(usageRecords.map((record) => record.payload?.response_id).filter(Boolean));
  const compacted = records.filter((record) => record.type === "compacted");
  const completedCompactions = records.filter((record) => {
    const payload = record.payload ?? record;
    return record.type === "event_msg" && payload.type === "item_completed" && payload.item?.type === "ContextCompaction";
  });
  const compactionCount = compacted.length || completedCompactions.length;
  const compactionsByTurn = {};
  for (const record of compacted) {
    const turnId = record.payload?.latest_token_usage_record?.turn_id || "unknown";
    compactionsByTurn[turnId] = (compactionsByTurn[turnId] || 0) + 1;
  }
  return {
    detected: compactionCount > 0,
    count: compactionCount,
    modelCalls: responseIds.size || usageRecords.length,
    threadUsage: latestUsage,
    compactionsByTurn,
    maximumCompactionsInTurn: Math.max(0, ...Object.values(compactionsByTurn)),
    usageRecordCount: usageRecords.length,
    rollout: null,
  };
}

export function budgetStatus(inspection, budget) {
  const totalTokens = Number(
    inspection?.threadUsage?.total_tokens
    ?? Number(inspection?.threadUsage?.input_tokens || 0) + Number(inspection?.threadUsage?.output_tokens || 0),
  );
  const tokenStopAt = Math.max(0, budget.maxTotalTokens - budget.delayedTokenReserve);
  const callStopAt = Math.max(0, budget.maxModelCalls - budget.delayedModelCallReserve);
  const reasons = [];
  if (totalTokens >= tokenStopAt) reasons.push(`observed ${totalTokens} tokens; reserve boundary ${tokenStopAt}`);
  if (inspection.modelCalls >= callStopAt) reasons.push(`observed ${inspection.modelCalls} model calls; reserve boundary ${callStopAt}`);
  if (inspection.maximumCompactionsInTurn > budget.maxCompactionsPerTurn) {
    reasons.push(`observed ${inspection.maximumCompactionsInTurn} compactions in one turn; maximum ${budget.maxCompactionsPerTurn}`);
  }
  return {
    stop: reasons.length > 0,
    reasons,
    observedTotalTokens: totalTokens,
    observedModelCalls: inspection.modelCalls,
    tokenStopAt,
    callStopAt,
  };
}

async function findRollouts(root, threadId) {
  const matches = [];
  async function visit(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.name.includes(threadId) && entry.name.endsWith(".jsonl")) matches.push(full);
    }
  }
  await visit(root);
  return matches.sort();
}

function emptyInspection() {
  return {
    detected: false,
    count: 0,
    modelCalls: 0,
    threadUsage: null,
    compactionsByTurn: {},
    maximumCompactionsInTurn: 0,
    usageRecordCount: 0,
    rollout: null,
  };
}
