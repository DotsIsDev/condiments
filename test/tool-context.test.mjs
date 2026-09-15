import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  appendToolContextTelemetry,
  applyNativeToolContextPolicy,
  decorateToolContextRequest,
  detectRequiredTools,
  installNativeToolContextControl,
  measureContextSplit,
  readToolContextTelemetry,
  resolveToolPlan,
  summarizeToolContext,
} from "../src/tool-context.mjs";
import { runDeterministicToolContextEvaluation } from "../src/tool-context-evaluation.mjs";

const tools = [
  { type: "function", name: "search_files", description: "Search files", parameters: { type: "object" } },
  { type: "function", name: "read_file", description: "Read file", parameters: { type: "object" } },
  { type: "function", name: "edit_file", description: "Edit file", parameters: { type: "object" } },
  { type: "function", name: "shell", description: "Run shell command", parameters: { type: "object" } },
  { type: "function", name: "weather_lookup", description: "Weather data", parameters: { type: "object" } },
  { type: "mcp", server_label: "github", description: "GitHub pull requests and issues" },
  { type: "mcp", server_label: "slack", description: "Slack messages" },
];

test("detects task tool categories without retaining task text", () => {
  const result = detectRequiredTools("Fix src/cart.ts and run tests");
  assert.deepEqual(result.categories, ["edit", "read", "search", "shell", "test"]);
  assert.match(result.task_hash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes("cart.ts"), false);
});

test("resolves stable core, lazy tools, and unrelated MCP disable list", () => {
  const plan = resolveToolPlan("Create a GitHub issue", tools, { level: "full", lazySupported: true });
  assert.deepEqual(plan.core, ["search_files", "read_file", "edit_file", "shell"]);
  assert.ok(plan.deferred.includes("github"));
  assert.ok(plan.disabled.includes("slack"));
  assert.ok(plan.disabled.includes("weather_lookup") === false);
});

test("Anthropic decorator adds tool search, defers schemas, disables unrelated MCP, and caches core", () => {
  const request = { model: "claude-sonnet-4-6", messages: [{ role: "user", content: "Create a GitHub issue" }], tools };
  const result = decorateToolContextRequest("anthropic", request, { level: "full", task: "Create a GitHub issue" });
  assert.equal(request.tools.some((tool) => tool.defer_loading), false);
  assert.ok(result.request.tools.some((tool) => tool.type === "tool_search_tool_bm25_20251119"));
  assert.equal(result.request.tools.some((tool) => tool.server_label === "slack"), false);
  assert.equal(result.request.tools.find((tool) => tool.server_label === "github").defer_loading, true);
  assert.equal(result.request.tools.filter((tool) => tool.cache_control).length, 1);
  assert.ok(result.split_after.estimated_visible_tokens < result.split_before.estimated_visible_tokens);
});

test("OpenAI decorator uses supplied search tool and a stable cache key", () => {
  const request = { instructions: "Help", input: "Fix src/a.js", tools };
  const options = { level: "some", task: "Fix src/a.js", toolSearchTool: { type: "tool_search", execution: "hosted", description: "Find a tool" } };
  const first = decorateToolContextRequest("openai", request, options);
  const second = decorateToolContextRequest("openai", request, options);
  assert.equal(first.request.prompt_cache_key, second.request.prompt_cache_key);
  assert.ok(first.request.tools.some((tool) => tool.defer_loading === true));
  assert.equal(first.control.lazy_supported, true);
});

test("none preserves the request byte-for-byte by value", () => {
  const request = { instructions: "Stable", input: "Question", tools };
  assert.deepEqual(decorateToolContextRequest("openai", request, { level: "none" }).request, request);
});

test("context split separates system, core, MCP, deferred, and unattributed input", () => {
  const split = measureContextSplit({
    instructions: "system",
    input: [{ role: "user", content: "task" }],
    tools: [tools[0], tools[5], { ...tools[6], defer_loading: true }],
  }, { reportedInputTokens: 1000 });
  assert.ok(split.estimated_tokens.system > 0);
  assert.ok(split.estimated_tokens.user_context > 0);
  assert.ok(split.estimated_tokens.core_tools > 0);
  assert.ok(split.estimated_tokens.mcp_tools > 0);
  assert.ok(split.estimated_tokens.deferred_tools > 0);
  assert.ok(split.unattributed_reported_tokens > 0);
});

test("telemetry persists counts without prompt or schema text", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-tool-context-"));
  try {
    const record = await appendToolContextTelemetry(root, {
      timestamp: "2026-09-13T00:00:00.000Z", provider: "openai", mode: "full", task_hash: "abc",
      before: { estimated_visible_tokens: 100 }, after: { estimated_visible_tokens: 25 },
      actual_input_tokens: 200, actual_output_tokens: 10, verification_passed: true,
    });
    await appendToolContextTelemetry(root, record);
    const records = await readToolContextTelemetry(root);
    assert.equal(records.length, 1);
    assert.equal(summarizeToolContext(records).modes.full.actual_input_tokens, 200);
    const raw = await readFile(path.join(root, ".condiments", "tool-context", "events.jsonl"), "utf8");
    assert.equal(raw.includes("schema"), false);
    assert.equal(raw.includes("prompt"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("OpenClaw native Code Mode applies levels and restores exact baseline", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-tool-context-native-"));
  const patches = [];
  const runner = async (_command, args) => {
    if (args[0] === "config" && args[1] === "get") return JSON.stringify({ codeMode: { enabled: false, maxSearchLimit: 17 } });
    if (args[0] === "config" && args[1] === "patch" && !args.includes("--dry-run")) patches.push(JSON.parse(await readFile(args[3], "utf8")));
    return "{}";
  };
  try {
    assert.equal((await installNativeToolContextControl("openclaw", root, { runCommand: runner })).supported, true);
    assert.equal((await applyNativeToolContextPolicy("openclaw", root, "some", { runCommand: runner })).detail.codeMode.enabled, "auto");
    assert.equal((await applyNativeToolContextPolicy("openclaw", root, "full", { runCommand: runner })).detail.codeMode.enabled, true);
    await applyNativeToolContextPolicy("openclaw", root, "none", { runCommand: runner });
    assert.deepEqual(patches.at(-1), { tools: { codeMode: { enabled: false, maxSearchLimit: 17 } } });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unsupported project hosts report truthful native fallback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-tool-context-host-"));
  try {
    const result = await applyNativeToolContextPolicy("codex-cli", root, "full");
    assert.equal(result.detail.applied, false);
    assert.equal(result.detail.supported, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("deterministic none/some/full evaluation preserves exact required-tool quality", () => {
  const result = runDeterministicToolContextEvaluation({ generatedAt: "2026-09-13T00:00:00.000Z" });
  assert.equal(result.quality_passed, true);
  assert.deepEqual(result.modes.map((mode) => mode.quality_passed), [true, true, true]);
  assert.equal(result.modes[0].disabled_tool_count, 0);
  assert.ok(result.modes[1].deferred_tool_count > 0);
  assert.equal(result.modes[2].disabled_tool_count, 40);
  assert.ok(result.modes[2].exact_initial_visible_tool_bytes < result.modes[0].exact_initial_visible_tool_bytes);
});
