export const LEVELS = Object.freeze(["none", "some", "full"]);
export const CONTROLS = Object.freeze([
  "mayo",
  "mustard",
  "ketchup",
  "ranch",
  "hot",
]);

const COMMANDS = new Set(["/cond", "/condiments"]);
const LEVEL_SET = new Set(LEVELS);
export const MAYO_FULL_MAX_WORDS = 120;
export const POLICY_PROTOCOL_VERSION = 1;
const LEVEL_CODES = Object.freeze({ none: "n", some: "s", full: "f" });
const CONTROL_CODES = Object.freeze({ mayo: "m", mustard: "u", ketchup: "k", ranch: "r", hot: "h" });
const COMPACT_DIRECTIVES = Object.freeze({
  mayo: Object.freeze({ some: "o=brief-simple", full: "o=120w-simple-terse" }),
  mustard: Object.freeze({ some: "c=target", full: "c=exact-lines" }),
  ketchup: Object.freeze({ some: "x=milestone", full: "x=exact-checkpoint" }),
  ranch: Object.freeze({ some: "t=batch-filter", full: "t=batch-cache-dedupe" }),
  hot: Object.freeze({ some: "z=adaptive", full: "z=low-escalate" }),
});
const CONTROL_ALIASES = new Map([
  ["mayo", "mayo"],
  ["mayonnaise", "mayo"],
  ["must", "mustard"],
  ["mustard", "mustard"],
  ["ket", "ketchup"],
  ["ketchup", "ketchup"],
  ["ran", "ranch"],
  ["ranch", "ranch"],
  ["hot", "hot"],
  ["hotsauce", "hot"],
]);

export const CAPABILITY_KEYS = Object.freeze([
  "promptControls",
  "statePersistence",
  "largeResultEnvelope",
  "structuredCheckpoints",
  "nativeOutputControl",
  "providerOutputBudgetControl",
  "nativeResponseBudgetControl",
  "nativeContextControl",
  "nativeCompaction",
  "nativeToolControl",
  "nativeReasoningControl",
  "usageTelemetry",
  "nativePromptCacheControl",
  "promptCacheTelemetry",
  "nativeActiveTurnRouting",
  "directFileEdit",
  "nativeFimCompletion",
  "unifiedDiffCompletion",
  "toolContextTelemetry",
  "providerLazyToolLoading",
  "providerMcpToolControl",
  "nativeLazyToolLoading",
  "nativeMcpSchemaPruning",
  "cacheLineageControl",
  "nativeCacheLineageControl",
  "adaptiveOutputGovernor",
  "verificationAwareQueryCompression",
  "losslessLogDictionary",
  "telemetryTrainedOutputCaps",
  "reversibleMemory",
  "significanceAwareOutput",
  "hierarchicalBudgetControl",
  "queryConditionedContextAllocation",
  "learnedContextCompressionAdapter",
  "nativeLearnedContextCompression",
  "qwenThinkingRequestControl",
  "nativeQwenThinkingControl",
  "deepseekReasoningRequestControl",
  "deepseekReasoningHistoryPruning",
  "nativeDeepSeekReasoningControl",
]);

export const DEFAULT_CAPABILITIES = Object.freeze({
  promptControls: true,
  statePersistence: true,
  largeResultEnvelope: true,
  structuredCheckpoints: true,
  nativeOutputControl: false,
  providerOutputBudgetControl: true,
  nativeResponseBudgetControl: false,
  nativeContextControl: false,
  nativeCompaction: false,
  nativeToolControl: false,
  nativeReasoningControl: false,
  usageTelemetry: false,
  nativePromptCacheControl: false,
  promptCacheTelemetry: false,
  nativeActiveTurnRouting: false,
  directFileEdit: false,
  nativeFimCompletion: false,
  unifiedDiffCompletion: true,
  toolContextTelemetry: true,
  providerLazyToolLoading: true,
  providerMcpToolControl: true,
  nativeLazyToolLoading: false,
  nativeMcpSchemaPruning: false,
  cacheLineageControl: true,
  nativeCacheLineageControl: false,
  adaptiveOutputGovernor: true,
  verificationAwareQueryCompression: true,
  losslessLogDictionary: true,
  telemetryTrainedOutputCaps: true,
  reversibleMemory: true,
  significanceAwareOutput: true,
  hierarchicalBudgetControl: true,
  queryConditionedContextAllocation: true,
  learnedContextCompressionAdapter: true,
  nativeLearnedContextCompression: false,
  qwenThinkingRequestControl: true,
  nativeQwenThinkingControl: false,
  deepseekReasoningRequestControl: true,
  deepseekReasoningHistoryPruning: true,
  nativeDeepSeekReasoningControl: false,
});

const PROMPT_POLICY = Object.freeze({
  mayo: Object.freeze({
    some: Object.freeze([
      "Direct, concise, simple words; report outcome, evidence, failures, next action.",
      "For edit tasks, apply the smallest direct file edit when a host edit tool is available; otherwise emit only the smallest usable change.",
      "Set an output cap from task size; limit tool calls; retry only when a required result is missing.",
      "Use a smaller telemetry-trained output cap only after enough matching verified successes; fall back after any cap-caused quality loss.",
    ]),
    full: Object.freeze([
      `Final reply: hard max ${MAYO_FULL_MAX_WORDS} words unless user asks long. Use simple words, terse grammar; fragments okay. Keep material evidence/failures only.`,
      "Checkpoint, compaction, memory, tool state stay internal. Put needed long detail in artifact; link briefly.",
      "Never reproduce a complete existing file unless the user explicitly asks for it.",
      "Use task caps of 128/512/2048 tokens for micro/standard/complex work. For direct edits, suppress recap; return paths, test result, and failures only.",
      "Protect required semantic blocks before spending output budget on rationale, narration, greeting, or recap. Allocate the task cap across locate, inspect, edit, verify, and report.",
      "Prefer a smaller telemetry-trained cap only when provider, host, level, and task-class evidence is sufficient and quality-safe.",
    ]),
  }),
  mustard: Object.freeze({
    some: Object.freeze([
      "Target an exact path when given; search inside large files first. If a hit proves the answer, stop; read only needed callers/tests.",
      "Before compressing context, lock user-named paths, symbols, numbers, errors, citations, and required evidence; validate sufficiency.",
    ]),
    full: Object.freeze([
      "Search inside an exact path and fetch only matching ranges; never print a full large file unless requested. If evidence proves the answer, stop.",
      "Compress query-aware semantic evidence units. Never send compressed context unless all exact requirements validate; retrieve only missing evidence, at most twice.",
      "Weight code, tests, errors, and dependencies above repeated prose; place high-value evidence at an attention boundary. Use an optional learned extractive compressor only after capability, exact-signal, and net-saving checks pass.",
    ]),
  }),
  ketchup: Object.freeze({
    some: Object.freeze([
      "In long sessions, checkpoint only at milestones/pressure; skip checkpoint work for a short isolated task.",
    ]),
    full: Object.freeze([
      "Do no compaction work for an isolated task. In long sessions, compact only at milestones/pressure and preserve exact state.",
      "Store long-session memory in dual form: compact summary plus hash-verified raw artifact. Expand only missing exact evidence, then fold it again.",
    ]),
  }),
  ranch: Object.freeze({
    some: Object.freeze([
      "Batch independent reads; never repeat success; filter noisy output in-command; keep model/reasoning/tool order stable.",
      "Losslessly dictionary-compress repetitive log templates before sending large output when the encoded form is smaller.",
    ]),
    full: Object.freeze([
      "One discovery, one verification; batch reads; never repeat success; filter large output; keep cache prefix/settings stable.",
      "Use hash-verified lossless dictionary encoding for repetitive logs when it fits the result budget.",
    ]),
  }),
  hot: Object.freeze({
    some: Object.freeze([
      "Use low/balanced reasoning; raise for complex, ambiguous, or risky work.",
    ]),
    full: Object.freeze([
      "Keep routine reasoning low; escalate only after failed evidence/commands, conflict, risk, or user request.",
      "On declared Qwen hybrid-thinking APIs, disable thinking for routine work and use a bounded thinking budget for complex or quality-escalated work.",
    ]),
  }),
});

export function createDefaultState() {
  return {
    version: 1,
    preset: "none",
    overrides: {},
  };
}

export function normalizeState(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return createDefaultState();
  }

  const preset = LEVEL_SET.has(candidate.preset) ? candidate.preset : "none";
  const overrides = {};
  if (candidate.overrides && typeof candidate.overrides === "object") {
    for (const control of CONTROLS) {
      const level = candidate.overrides[control];
      if (LEVEL_SET.has(level) && level !== preset) {
        overrides[control] = level;
      }
    }
  }

  return { version: 1, preset, overrides };
}

export function parseCommand(input) {
  const raw = Array.isArray(input) ? input.join(" ") : String(input ?? "");
  const tokens = raw.trim().split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    throw new Error("Missing command. Use /cond status.");
  }

  const commandName = tokens[0].toLowerCase();
  if (!COMMANDS.has(commandName)) {
    throw new Error(`Unknown command '${tokens[0]}'. Use /cond or /condiments.`);
  }

  if (tokens.length === 1) {
    return { type: "status" };
  }

  const subject = tokens[1].toLowerCase();
  if (subject === "status") {
    assertArity(tokens, 2);
    return { type: "status" };
  }

  if (subject === "reset") {
    assertArity(tokens, 2);
    return { type: "reset" };
  }

  if (LEVEL_SET.has(subject)) {
    assertArity(tokens, 2);
    return { type: "preset", level: subject };
  }

  const control = CONTROL_ALIASES.get(subject);
  if (!control) {
    throw new Error(`Unknown argument '${tokens[1]}'. Use a preset, control, status, or reset.`);
  }

  if (tokens.length > 3) {
    throw new Error("Too many arguments.");
  }

  const level = tokens.length === 2 ? "full" : tokens[2].toLowerCase();
  if (!LEVEL_SET.has(level)) {
    throw new Error(`Unknown level '${tokens[2]}'. Use none, some, or full.`);
  }

  return { type: "control", control, level };
}

function assertArity(tokens, expected) {
  if (tokens.length !== expected) {
    throw new Error("Too many arguments.");
  }
}

export function applyCommand(currentState, command) {
  const state = normalizeState(currentState);

  if (command.type === "status") {
    return state;
  }

  if (command.type === "reset") {
    return createDefaultState();
  }

  if (command.type === "preset") {
    return { version: 1, preset: command.level, overrides: {} };
  }

  if (command.type === "control") {
    const overrides = { ...state.overrides };
    if (command.level === state.preset) {
      delete overrides[command.control];
    } else {
      overrides[command.control] = command.level;
    }
    return { version: 1, preset: state.preset, overrides };
  }

  throw new Error(`Unsupported command type '${command.type}'.`);
}

export function resolveLevels(candidateState) {
  const state = normalizeState(candidateState);
  return Object.fromEntries(
    CONTROLS.map((control) => [
      control,
      state.overrides[control] ?? state.preset,
    ]),
  );
}

export function resolvePolicy(candidateState) {
  const levels = resolveLevels(candidateState);
  const controls = {};

  for (const control of CONTROLS) {
    const level = levels[control];
    if (level === "none") {
      controls[control] = [];
      continue;
    }

    controls[control] = level === "full"
      ? [...PROMPT_POLICY[control].full]
      : [...PROMPT_POLICY[control].some];
  }

  return { levels, controls };
}

export function resolveOutputBudget(candidateState) {
  const level = resolveLevels(candidateState).mayo;
  if (level !== "full") return null;
  return {
    scope: "final-user-response",
    unit: "words",
    maximum: MAYO_FULL_MAX_WORDS,
    excludes: ["checkpoints", "compaction-state", "memory", "tool-state"],
    userOverride: true,
  };
}

export function measureOutputBudget(candidateState, response) {
  const budget = resolveOutputBudget(candidateState);
  const words = countWords(response);
  return {
    budget,
    words,
    withinBudget: budget === null || words <= budget.maximum,
  };
}

export function renderPrompt(candidateState, options = {}) {
  return renderStateDelta(candidateState, options.previousState);
}

export function renderStateDelta(candidateState, previousCandidate = createDefaultState()) {
  const levels = resolveLevels(candidateState);
  const previous = resolveLevels(previousCandidate);
  const changed = CONTROLS.filter((control) => levels[control] !== previous[control]);
  if (changed.length === 0) return "";
  if (CONTROLS.every((control) => levels[control] === "none")) {
    return `<cond v=${POLICY_PROTOCOL_VERSION} reset/>`;
  }
  const assignments = changed.map((control) => `${CONTROL_CODES[control]}=${LEVEL_CODES[levels[control]]}`).join(",");
  const directives = changed
    .map((control) => COMPACT_DIRECTIVES[control][levels[control]])
    .filter(Boolean);
  return `<cond v=${POLICY_PROTOCOL_VERSION} ${assignments}${directives.length ? ` ${directives.join(" ")}` : ""} q=verify/>`;
}

export function renderPolicyPrefix() {
  return [
    `<cond-policy v=${POLICY_PROTOCOL_VERSION}>`,
    "m output; u context; k memory; r tools; h reasoning. n off; s some; f full.",
    "o brief/simple or <=120 words/simple/terse; c targeted or exact lines; x milestone or exact checkpoint; t batch/filter or batch/cache/dedupe; z adaptive or low then escalate.",
    "State tags are deltas. Keep prior values. reset means all off. q=verify means correctness and material failures stay required. Internal checkpoint/tool state never expands final reply.",
    "For m=s/f: classify output; f caps micro/standard/complex at 128/512/2048 tokens; bound tools; retry only missing required results. Edit work: direct edit first; suppress recap; else native FIM, smallest exact changed block, unified diff. Never reproduce a full existing file unless asked.",
    "</cond-policy>",
  ].join("\n");
}

function countWords(value) {
  const text = String(value ?? "").trim();
  return text === "" ? 0 : text.split(/\s+/u).length;
}

export function normalizeCapabilities(candidate = {}) {
  const capabilities = { ...DEFAULT_CAPABILITIES };
  if (!candidate || typeof candidate !== "object") return capabilities;

  for (const key of CAPABILITY_KEYS) {
    if (key in candidate) {
      if (typeof candidate[key] !== "boolean") {
        throw new Error(`Capability '${key}' must be boolean.`);
      }
      capabilities[key] = candidate[key];
    }
  }
  return capabilities;
}

export function formatStatus(candidateState, options = {}) {
  const state = normalizeState(candidateState);
  const levels = resolveLevels(state);
  const capabilities = normalizeCapabilities(options.capabilities);
  const host = options.host || "portable";
  const flag = (value) => (value ? "yes" : "no");

  return [
    `Condiments: preset=${state.preset}`,
    `Controls: ${CONTROLS.map((control) => `${control}=${levels[control]}`).join(" ")}`,
    `Host: ${host}`,
    `Capabilities: prompt=${flag(capabilities.promptControls)} state=${flag(capabilities.statePersistence)} envelope=${flag(capabilities.largeResultEnvelope)} checkpoint=${flag(capabilities.structuredCheckpoints)} native-output=${flag(capabilities.nativeOutputControl)} output-request=${flag(capabilities.providerOutputBudgetControl)} output-native=${flag(capabilities.nativeResponseBudgetControl)} native-context=${flag(capabilities.nativeContextControl)} native-compact=${flag(capabilities.nativeCompaction)} native-tools=${flag(capabilities.nativeToolControl)} native-reasoning=${flag(capabilities.nativeReasoningControl)} active-turn-route=${flag(capabilities.nativeActiveTurnRouting)} usage=${flag(capabilities.usageTelemetry)} cache-control=${flag(capabilities.nativePromptCacheControl)} cache-telemetry=${flag(capabilities.promptCacheTelemetry)}`,
    `Completion: direct-edit=${flag(capabilities.directFileEdit)} fim=${flag(capabilities.nativeFimCompletion)} unified-diff=${flag(capabilities.unifiedDiffCompletion)}`,
    `Tool context: split=${flag(capabilities.toolContextTelemetry)} provider-lazy=${flag(capabilities.providerLazyToolLoading)} provider-mcp=${flag(capabilities.providerMcpToolControl)} native-lazy=${flag(capabilities.nativeLazyToolLoading)} native-mcp-prune=${flag(capabilities.nativeMcpSchemaPruning)}`,
    `Cache lineage: controller=${flag(capabilities.cacheLineageControl)} native=${flag(capabilities.nativeCacheLineageControl)}`,
    `Output governor: adaptive=${flag(capabilities.adaptiveOutputGovernor)}`,
    `Output cap learner: telemetry-trained=${flag(capabilities.telemetryTrainedOutputCaps)}`,
    `Query compressor: verification-aware=${flag(capabilities.verificationAwareQueryCompression)}`,
    `Log compressor: lossless-dictionary=${flag(capabilities.losslessLogDictionary)}`,
    `Research controls: reversible-memory=${flag(capabilities.reversibleMemory)} significant-output=${flag(capabilities.significanceAwareOutput)} phase-budget=${flag(capabilities.hierarchicalBudgetControl)} query-allocation=${flag(capabilities.queryConditionedContextAllocation)}`,
    `Optional providers: learned-compressor=${flag(capabilities.learnedContextCompressionAdapter)} learned-native=${flag(capabilities.nativeLearnedContextCompression)} qwen-request=${flag(capabilities.qwenThinkingRequestControl)} qwen-native=${flag(capabilities.nativeQwenThinkingControl)} deepseek-request=${flag(capabilities.deepseekReasoningRequestControl)} deepseek-history=${flag(capabilities.deepseekReasoningHistoryPruning)} deepseek-native=${flag(capabilities.nativeDeepSeekReasoningControl)}`,
  ].join("\n");
}
