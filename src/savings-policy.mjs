import { detectEditTask } from "./completion-policy.mjs";
import { assessOutputCapEconomics } from "./output-governor.mjs";

export const SAVINGS_WORKLOADS = Object.freeze(["exact-edit", "tool-heavy", "general"]);
export const SAVINGS_CONTROLS = Object.freeze(["mayo", "mustard", "ketchup", "ranch", "hot"]);

const NONE_CONTROLS = Object.freeze(Object.fromEntries(SAVINGS_CONTROLS.map((control) => [control, "none"])));
const TOOL_HEAVY = /\b(?:debug(?:ging)?|diagnos(?:e|is|ing)|investigat(?:e|ion|ing)|failing|failure|flaky|root cause|stack trace|traceback|test(?:s|ing)?|pytest|jest|vitest|lint(?:ing)?|typecheck|build|benchmark|profile|logs?|noisy (?:command|output)|command output)\b/i;
const SIMPLE_LOOKUP = /^\s*(?:find|locate|look up|lookup|show|read|open|where is|what is|which)\b/i;

const EVALUATED_ROUTES = Object.freeze({
  "gpt-5.6-luna|general|some": Object.freeze({ level: "none", expectedLogicalSavings: -0.12899, reason: "paired live evaluation found some mode increased total tokens on Luna general tasks" }),
  "gpt-5.6-luna|general|full": Object.freeze({ level: "none", expectedLogicalSavings: -0.10442, reason: "paired live evaluation found full mode increased total tokens on Luna general tasks" }),
  "gpt-5.6-luna|tool-heavy|full": Object.freeze({ level: "full", controls: Object.freeze({ ranch: "full" }), expectedLogicalSavings: 0.21831, reason: "paired live evaluation found Ranch reduced logical tokens on tool-heavy tasks" }),
  "gpt-5.6-sol|exact-edit|some": Object.freeze({ level: "none", expectedLogicalSavings: -0.0758, reason: "paired live evaluation found some mode increased total tokens on Sol exact edits" }),
  "gpt-5.6-sol|exact-edit|full": Object.freeze({ level: "none", expectedLogicalSavings: -0.29625, reason: "two counterbalanced replication repeats found full mode increased total tokens on Sol exact edits; prior savings did not replicate" }),
  "gpt-6-astra|exact-edit|some": Object.freeze({ level: "none", expectedLogicalSavings: -0.32097, reason: "paired live evaluation found some mode increased total tokens on Astra exact edits" }),
  "gpt-6-astra|exact-edit|full": Object.freeze({ level: "none", expectedLogicalSavings: -0.26843, reason: "paired live evaluation found full mode increased total tokens on Astra exact edits" }),
});

export function classifySavingsWorkload(task, options = {}) {
  const explicit = normalizeWorkload(options.workload, true);
  if (explicit) return { workload: explicit, reason: "explicit" };
  const text = String(task ?? "").trim();
  const edit = detectEditTask(text);
  const exactSignal = options.exactEdit === true || options.directEdit === true
    || /\b(?:byte[- ]exact|edit exactly|exact replacement|replace .+ with|change .+ to)\b/i.test(text);
  if (edit.isEdit && exactSignal) return { workload: "exact-edit", reason: "exact-edit-signals" };
  if (options.toolHeavy === true || TOOL_HEAVY.test(text)) return { workload: "tool-heavy", reason: "tool-heavy-signals" };
  if (SIMPLE_LOOKUP.test(text) || options.simpleEdit === true) return { workload: "general", reason: "simple-baseline" };
  return { workload: "general", reason: "conservative-default" };
}

export function resolveSavingsRoute(options = {}) {
  const requestedLevel = normalizeLevel(options.requestedLevel ?? options.level ?? "full");
  const model = normalizeModel(options.model);
  const classification = classifySavingsWorkload(options.task, options);
  if (requestedLevel === "none") return routeResult({ model, classification, requestedLevel, level: "none", evaluated: false, reason: "Condiments disabled" });
  if (options.force === true) return routeResult({ model, classification, requestedLevel, level: requestedLevel, controls: Object.fromEntries(SAVINGS_CONTROLS.map((control) => [control, requestedLevel])), evaluated: false, reason: "explicit force override" });
  const evaluated = EVALUATED_ROUTES[`${model}|${classification.workload}|${requestedLevel}`];
  if (!evaluated) return routeResult({ model, classification, requestedLevel, level: "none", evaluated: false, reason: "model/workload pair is not savings-validated; use baseline" });
  return routeResult({ model, classification, requestedLevel, level: evaluated.level, controls: evaluated.controls, evaluated: true, expectedLogicalSavings: evaluated.expectedLogicalSavings, reason: evaluated.reason });
}

export function resolveSavingsPlan(options = {}) {
  const route = resolveSavingsRoute(options);
  const controls = { ...route.effectiveControls };
  let outputEconomics = null;
  if (controls.mayo !== "none") {
    outputEconomics = assessOutputCapEconomics(options.outputEconomics ?? {});
    if (!outputEconomics.apply) controls.mayo = "none";
  }
  const enabledControls = SAVINGS_CONTROLS.filter((control) => controls[control] !== "none");
  const directive = renderConditionalPolicy({ controls, nativeToolControl: options.nativeToolControl === true });
  return { ...route, effectiveControls: controls, enabledControls, baseline: enabledControls.length === 0, directive, policyInputTokens: estimateTokens(directive), outputEconomics };
}

export function renderConditionalPolicy(options = {}) {
  const controls = normalizeControls(options.controls);
  const directives = [];
  if (controls.ranch !== "none" && options.nativeToolControl !== true) directives.push("<cond-ranch>reuse results; allow one discovery and one verification round; extra calls require missing evidence and justification.</cond-ranch>");
  if (controls.mayo !== "none") directives.push("<cond-mayo>be concise; preserve required evidence.</cond-mayo>");
  if (controls.mustard !== "none") directives.push("<cond-mustard>prefer the lowest sufficient reasoning effort.</cond-mustard>");
  if (controls.ketchup !== "none") directives.push("<cond-ketchup>reuse the stable prefix and append changing task data last.</cond-ketchup>");
  if (controls.hot !== "none") directives.push("<cond-hot>checkpoint only near context pressure.</cond-hot>");
  return directives.join("\n");
}

function routeResult({ model, classification, requestedLevel, level, controls = {}, evaluated, expectedLogicalSavings = null, reason }) {
  const effectiveControls = level === "none" ? { ...NONE_CONTROLS } : { ...NONE_CONTROLS, ...controls };
  const enabledControls = SAVINGS_CONTROLS.filter((control) => effectiveControls[control] !== "none");
  return { version: 2, model: model || null, workload: classification.workload, workloadReason: classification.reason, requestedLevel, effectiveLevel: level, effectiveControls, enabledControls, baseline: enabledControls.length === 0, evaluated, expectedLogicalSavings, source: evaluated ? "evals/results/savings-controls-evaluation-v0.1.4.md" : null, reason };
}

function normalizeControls(value) {
  const controls = { ...NONE_CONTROLS };
  for (const control of SAVINGS_CONTROLS) controls[control] = normalizeLevel(value?.[control] ?? "none");
  return controls;
}

function estimateTokens(value) { return value ? Math.ceil(String(value).length / 4) : 0; }
function normalizeModel(value) { return String(value ?? "").trim().toLowerCase(); }
function normalizeLevel(value) {
  const level = String(value ?? "full").trim().toLowerCase();
  if (!["none", "some", "full"].includes(level)) throw new Error(`Unknown Condiments level '${value}'.`);
  return level;
}
function normalizeWorkload(value, optional = false) {
  if ((value === undefined || value === null || value === "") && optional) return null;
  const workload = String(value ?? "general").trim().toLowerCase();
  if (!SAVINGS_WORKLOADS.includes(workload)) throw new Error(`Unknown savings workload '${value}'.`);
  return workload;
}
