import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyNativeReasoningPolicy,
  buildCodexExecArgs,
  classifyCodexTask,
  handleCodexReasoningHook,
  installNativeReasoningHooks,
  resolveCodexRoute,
} from "../src/native-reasoning.mjs";

const catalog = [
  model("gpt-6-astra", ["low", "medium", "high", "xhigh"], true),
  model("gpt-5.6-terra", ["low", "medium", "high"]),
  model("gpt-5.6-luna", ["low", "medium", "high"]),
];

test("classifies routine, standard, and escalation work", () => {
  assert.equal(classifyCodexTask("Fix typo in README").class, "routine");
  assert.equal(classifyCodexTask("Implement the repository migration").class, "standard");
  assert.equal(classifyCodexTask("Debug a production authentication race condition").class, "escalation");
  assert.equal(classifyCodexTask("Try again", { failureCount: 2 }).class, "escalation");
});

test("full routes cheapest-first and escalates model plus reasoning", () => {
  const routine = resolveCodexRoute("full", { prompt: "Fix typo", model: "gpt-6-astra" }, catalog);
  const standard = resolveCodexRoute("full", { prompt: "Implement repository parser", model: "gpt-6-astra" }, catalog);
  const escalation = resolveCodexRoute("full", { prompt: "Investigate security race condition", model: "gpt-5.6-luna" }, catalog);
  assert.deepEqual([routine.model, routine.effort], ["gpt-5.6-luna", "low"]);
  assert.deepEqual([standard.model, standard.effort], ["gpt-5.6-terra", "low"]);
  assert.deepEqual([escalation.model, escalation.effort], ["gpt-6-astra", "high"]);
});

test("some preserves current model for standard work and adapts effort", () => {
  const route = resolveCodexRoute("some", {
    prompt: "Implement parser",
    model: "gpt-6-astra",
  }, catalog);
  assert.equal(route.model, "gpt-6-astra");
  assert.equal(route.effort, "medium");
  assert.equal(route.switchedModel, false);
});

test("exec arguments carry native model and reasoning overrides", () => {
  const args = buildCodexExecArgs({ model: "gpt-5.6-luna", effort: "low" }, {
    prompt: "status",
    cwd: "C:\\work",
    json: true,
  });
  assert.deepEqual(args.slice(0, 5), ["exec", "--model", "gpt-5.6-luna", "-c", "model_reasoning_effort=\"low\""]);
  assert.ok(args.includes("--json"));
});

test("Codex installation and policy toggle native features with baseline restoration", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-reasoning-"));
  try {
    const codexDir = path.join(root, ".codex");
    await writeFile(path.join(root, "seed"), "");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(codexDir, { recursive: true }));
    const configPath = path.join(codexDir, "config.toml");
    await writeFile(configPath, "model = \"gpt-6-astra\"\nmodel_reasoning_effort = \"high\"\n\n[features]\nstep_model_switching = false\nother = true\n");
    const installed = await installNativeReasoningHooks("codex-cli", root, {
      probe: async () => ({ available: true, modelCount: 3, via: "test" }),
    });
    assert.equal(installed.supported, true);
    const hooks = JSON.parse(await readFile(path.join(codexDir, "hooks.json"), "utf8"));
    assert.equal(hooks.hooks.UserPromptSubmit.length, 1);

    await applyNativeReasoningPolicy("codex-cli", root, "full");
    let config = await readFile(configPath, "utf8");
    assert.match(config, /step_model_switching = true/);
    assert.match(config, /reasoning_effort_override = false/);
    assert.match(config, /model_reasoning_effort = "low"/);
    assert.match(config, /other = true/);

    await applyNativeReasoningPolicy("codex-cli", root, "none");
    config = await readFile(configPath, "utf8");
    assert.match(config, /step_model_switching = false/);
    assert.doesNotMatch(config, /reasoning_effort_override/);
    assert.match(config, /model = "gpt-6-astra"/);
    assert.match(config, /model_reasoning_effort = "high"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("socket gate removes stale routing hook and preserves unrelated hooks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-reasoning-gate-"));
  try {
    const codexDir = path.join(root, ".codex");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(codexDir, { recursive: true }));
    const hooksPath = path.join(codexDir, "hooks.json");
    await writeFile(hooksPath, JSON.stringify({ hooks: {
      UserPromptSubmit: [
        { matcher: ".*", hooks: [{ type: "command", command: "node existing.mjs" }] },
        { matcher: ".*", hooks: [{ type: "command", command: "node .agents/skills/condiments/scripts/reasoning-hook.mjs" }] },
      ],
    }}));
    const installed = await installNativeReasoningHooks("codex-cli", root, {
      probe: async () => ({ available: false, reason: "no managed socket", fallback: "wrapper" }),
    });
    assert.equal(installed.activeTurnRouting, false);
    assert.equal(installed.event, null);
    const hooks = JSON.parse(await readFile(hooksPath, "utf8"));
    assert.equal(hooks.hooks.UserPromptSubmit.length, 1);
    assert.match(JSON.stringify(hooks), /existing\.mjs/);
    assert.doesNotMatch(JSON.stringify(hooks), /reasoning-hook\.mjs/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("UserPromptSubmit hook applies injected native route and stores no prompt text", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-reasoning-hook-"));
  try {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(path.join(root, ".condiments"), { recursive: true }));
    await writeFile(path.join(root, ".condiments", "state.json"), JSON.stringify({ version: 1, preset: "full", overrides: {} }));
    const result = await handleCodexReasoningHook({
      cwd: root,
      session_id: "thread-1",
      turn_id: "turn-1",
      model: "gpt-6-astra",
      prompt: "Fix typo",
    }, {
      client: async (input) => ({
        route: resolveCodexRoute(input.level, { prompt: input.prompt, model: input.currentModel }, catalog),
        status: "applied",
        catalogModels: catalog.length,
      }),
    });
    assert.equal(result.action, "routed");
    assert.equal(result.route.model, "gpt-5.6-luna");
    const events = await readFile(path.join(root, ".condiments", "native-reasoning", "events.jsonl"), "utf8");
    assert.doesNotMatch(events, /Fix typo/);
    assert.match(events, /prompt_hash/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("UserPromptSubmit uses latest same-session cache telemetry to hold cheap route", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-reasoning-lineage-"));
  try {
    const cacheDir = path.join(root, ".condiments", "prompt-cache");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(cacheDir, { recursive: true }));
    await writeFile(path.join(root, ".condiments", "state.json"), JSON.stringify({ version: 1, preset: "full", overrides: {} }));
    await writeFile(path.join(cacheDir, "events.jsonl"), `${JSON.stringify({
      session_id: "thread-1", cache_read_reported: true, cache_read_tokens: 30_000,
    })}\n`);
    const result = await handleCodexReasoningHook({
      cwd: root, session_id: "thread-1", turn_id: "turn-2", model: "gpt-6-astra", reasoning_effort: "medium", prompt: "Fix typo",
    }, {
      client: async (input) => ({
        route: resolveCodexRoute(input.level, { prompt: input.prompt, model: input.currentModel, effort: input.policy.currentEffort }, catalog, input.policy),
        status: "applied",
      }),
    });
    assert.equal(result.route.model, "gpt-6-astra");
    assert.equal(result.route.effort, "medium");
    assert.equal(result.route.cacheLineage.action, "preserve");
  } finally { await rm(root, { recursive: true, force: true }); }
});

function model(name, efforts, isDefault = false) {
  return {
    id: name,
    model: name,
    isDefault,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort })),
    defaultReasoningEffort: "medium",
  };
}
