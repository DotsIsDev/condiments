import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateCheckpoint } from "../src/checkpoint.mjs";
import {
  applyNativeContextPolicy,
  extractTranscriptFacts,
  handleContextHook,
  installNativeContextHooks,
} from "../src/native-context.mjs";

test("Claude native hooks preserve settings and restore the original threshold", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-claude-native-"));
  try {
    const settingsPath = path.join(root, ".claude", "settings.json");
    await mkdir(path.dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, JSON.stringify({
      env: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "92", KEEP: "yes" },
      hooks: { Stop: [{ hooks: [{ type: "command", command: "echo keep" }] }] },
    }), "utf8");

    await installNativeContextHooks("claude-code", root);
    await installNativeContextHooks("claude-code", root);
    let settings = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(settings.hooks.Stop.length, 1);
    assert.equal(settings.hooks.PreCompact.length, 1);
    assert.equal(settings.hooks.SessionStart.length, 1);

    await applyNativeContextPolicy("claude-code", root, "full");
    settings = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(settings.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, "70");
    assert.equal(settings.env.KEEP, "yes");

    await applyNativeContextPolicy("claude-code", root, "none");
    settings = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(settings.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, "92");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex native context merges TOML, registers hooks, and restores baseline", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-codex-native-"));
  try {
    const directory = path.join(root, ".codex");
    const configPath = path.join(directory, "config.toml");
    await mkdir(directory, { recursive: true });
    await writeFile(configPath, "model = \"test\"\nmodel_auto_compact_token_limit_scope = \"total\"\n\n[features]\ncontext_management = false\nother = true\n", "utf8");

    await installNativeContextHooks("codex-cli", root);
    await applyNativeContextPolicy("codex-cli", root, "some");
    let config = await readFile(configPath, "utf8");
    assert.match(config, /context_management = true/);
    assert.match(config, /other = true/);
    assert.match(config, /hooks = true/);
    assert.match(config, /model_auto_compact_token_limit_scope = "body_after_prefix"/);

    const hooks = JSON.parse(await readFile(path.join(directory, "hooks.json"), "utf8"));
    assert.equal(hooks.hooks.PreCompact.length, 1);
    assert.equal(hooks.hooks.PostCompact.length, 1);
    assert.equal(hooks.hooks.SessionStart.length, 1);

    await applyNativeContextPolicy("codex-cli", root, "none");
    config = await readFile(configPath, "utf8");
    assert.match(config, /context_management = false/);
    assert.match(config, /model_auto_compact_token_limit_scope = "total"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex transcript extraction preserves recent exact results and opaque IDs", () => {
  const transcript = [
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<recommended_plugins>app-1234567-demo</recommended_plugins>" }] } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Find exact values." }] } },
    { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: '{"answer":"subtotal > 100|session.expiresAtMs|createRouter|CP-FINAL-7K9"}' }] } },
  ].map(JSON.stringify).join("\n");
  const facts = extractTranscriptFacts(transcript, "full");
  assert.match(facts.recentAssistant.at(-1), /subtotal > 100/);
  assert.doesNotMatch(facts.recentAssistant.at(-1), /output_text/);
  assert.ok(facts.identifiers.includes("CP-FINAL-7K9"));
  assert.ok(!facts.identifiers.includes("app-1234567-demo"));
});

test("Codex PreCompact throttles repeated compaction in one turn", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-compact-throttle-"));
  try {
    await mkdir(path.join(root, ".condiments"), { recursive: true });
    await writeFile(path.join(root, ".condiments", "state.json"), JSON.stringify({ version: 1, preset: "full", overrides: {} }), "utf8");
    const payload = { session_id: "s-1", turn_id: "t-1", cwd: root, trigger: "auto" };
    const first = await handleContextHook(payload, { host: "codex-cli", event: "pre-compact" });
    const second = await handleContextHook(payload, { host: "codex-cli", event: "pre-compact" });
    assert.equal(first.action, "checkpoint");
    assert.equal(second.action, "throttled");
    assert.equal(second.output.continue, false);
    assert.match(second.output.stopReason, /repeated compaction/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pre-compaction hook archives transcript and restore injects validated state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-hook-"));
  try {
    const transcriptPath = path.join(root, "transcript.jsonl");
    await mkdir(path.join(root, ".condiments"), { recursive: true });
    await writeFile(path.join(root, ".condiments", "state.json"), JSON.stringify({ version: 1, preset: "full", overrides: {} }), "utf8");
    const noise = Array.from({ length: 200 }, (_, index) => JSON.stringify({
      role: index % 2 ? "assistant" : "user",
      content: `Required noise ${index} ${"x".repeat(700)} src/generated/file-${index}.mjs`,
      command: `tool-${index} ${"y".repeat(700)}`,
    }));
    await writeFile(transcriptPath, [...noise,
      JSON.stringify({ role: "user", content: "Fix src/session.mjs. Never change the public API." }),
      JSON.stringify({ role: "assistant", content: "Implemented the unit conversion decision.", command: "npm test" }),
      JSON.stringify({ role: "assistant", content: "Error: one test remains blocked." }),
    ].join("\n"), "utf8");
    const payload = {
      hook_event_name: "PreCompact",
      session_id: "session-123",
      turn_id: "turn-9",
      cwd: root,
      transcript_path: transcriptPath,
      trigger: "auto",
    };

    const saved = await handleContextHook(payload, { host: "claude-code", event: "pre-compact" });
    assert.equal(saved.action, "checkpoint");
    const checkpoint = JSON.parse(await readFile(saved.checkpointPath, "utf8"));
    assert.deepEqual(validateCheckpoint(checkpoint), { valid: true, errors: [] });
    assert.match(checkpoint.goal, /Fix src\/session\.mjs/);
    assert.ok(checkpoint.artifact_paths.length === 1);
    await access(checkpoint.artifact_paths[0]);

    const restored = await handleContextHook(payload, { host: "claude-code", event: "restore" });
    assert.equal(restored.action, "restore");
    assert.match(restored.output.hookSpecificOutput.additionalContext, /<condiments-checkpoint>/);

    const cursor = await handleContextHook(payload, { host: "cursor", event: "restore" });
    assert.match(cursor.output.additional_context, /session-123/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native hooks remain inert when ketchup is none", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-hook-none-"));
  try {
    const result = await handleContextHook({ session_id: "none" }, {
      host: "codex-cli",
      event: "pre-compact",
      cwd: root,
    });
    assert.equal(result.action, "noop");
    await assert.rejects(access(path.join(root, ".condiments", "checkpoints", "none.json")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenClaw none leaves configuration unchanged when no baseline was captured", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-openclaw-native-"));
  try {
    await installNativeContextHooks("openclaw", root);
    const result = await applyNativeContextPolicy("openclaw", root, "none");
    assert.equal(result.detail.applied, false);
    assert.match(result.detail.reason, /left unchanged/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
