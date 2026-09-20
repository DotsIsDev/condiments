import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { analyzeFileRead, guardCodexCommand } from "../src/command-guard.mjs";
import { recordToolResult } from "../src/tool-state.mjs";

async function fixture(level, bytes = 100_000) {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-command-guard-"));
  await mkdir(path.join(root, ".condiments"), { recursive: true });
  await mkdir(path.join(root, "data"), { recursive: true });
  await writeFile(path.join(root, ".condiments", "state.json"), JSON.stringify({ version: 1, preset: level, overrides: {} }));
  await writeFile(path.join(root, "data", "history.log"), "x".repeat(bytes));
  return root;
}

test("Codex guard blocks oversized whole-file reads and returns bounded alternatives", async () => {
  const root = await fixture("full");
  try {
    const result = await guardCodexCommand({
      cwd: root,
      tool_name: "Bash",
      tool_input: { command: "Get-Content -LiteralPath 'data/history.log'" },
    });
    assert.equal(result.action, "blocked");
    assert.equal(result.analysis.totalBytes, 100_000);
    assert.equal(result.output.hookSpecificOutput.permissionDecision, "deny");
    assert.match(result.output.hookSpecificOutput.permissionDecisionReason, /-Tail 200/);
    assert.match(result.output.hookSpecificOutput.permissionDecisionReason, /rg -n/);
    const log = await readFile(path.join(root, ".condiments", "command-guard", "events.jsonl"), "utf8");
    assert.doesNotMatch(log, /Get-Content/);
    assert.match(log, /command_hash/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bounded reads, small files, bypass, other tools, and ranch none pass", async () => {
  const root = await fixture("full");
  try {
    const bounded = await guardCodexCommand({
      cwd: root,
      tool_name: "Bash",
      tool_input: { command: "Get-Content data/history.log -Tail 20" },
    });
    assert.equal(bounded.action, "already-bounded");
    assert.deepEqual(bounded.output, {});

    const bypass = await guardCodexCommand({
      cwd: root,
      tool_name: "Bash",
      tool_input: { command: "Get-Content data/history.log # condiments:allow-large-output" },
    });
    assert.equal(bypass.action, "explicit-bypass");

    const other = await guardCodexCommand({ cwd: root, tool_name: "Read", tool_input: {} });
    assert.equal(other.action, "unsupported-tool");

    await writeFile(path.join(root, ".condiments", "state.json"), JSON.stringify({ version: 1, preset: "none", overrides: {} }));
    const none = await guardCodexCommand({ cwd: root, tool_name: "Bash", tool_input: { command: "Get-Content data/history.log" } });
    assert.equal(none.action, "noop");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("some and full use different byte thresholds", async () => {
  const root = await fixture("full");
  try {
    const some = await analyzeFileRead("Get-Content data/history.log", { cwd: root, thresholdBytes: 320_000, previewLines: 400 });
    const full = await analyzeFileRead("Get-Content data/history.log", { cwd: root, thresholdBytes: 80_000, previewLines: 200 });
    assert.equal(some.risky, false);
    assert.equal(full.risky, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("command guard CLI emits valid PreToolUse denial JSON", async () => {
  const root = await fixture("full");
  try {
    const run = spawnSync(process.execPath, [path.resolve("scripts", "command-guard-hook.mjs"), "--cwd", root], {
      cwd: path.resolve("."),
      encoding: "utf8",
      input: JSON.stringify({ cwd: root, tool_name: "Bash", tool_input: { command: "Get-Content data/history.log" } }),
    });
    assert.equal(run.status, 0, run.stderr);
    const output = JSON.parse(run.stdout);
    assert.equal(output.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native Ranch permits one discovery and verification round and blocks duplicates", async () => {
  const root = await fixture("full");
  const base = { cwd: root, session_id: "session", turn_id: "turn", user_prompt: "Debug the failing tests", tool_name: "Bash" };
  try {
    assert.equal((await guardCodexCommand({ ...base, tool_input: { command: "rg -n error src" } })).round.allow, true);
    const duplicate = await guardCodexCommand({ ...base, tool_input: { command: "rg   -n error src" } });
    assert.equal(duplicate.action, "blocked");
    assert.match(duplicate.round.reason, /duplicate/);
    assert.equal((await guardCodexCommand({ ...base, tool_input: { command: "npm test" } })).round.phase, "verification");
    const extra = await guardCodexCommand({ ...base, tool_input: { command: "npm run lint" } });
    assert.equal(extra.action, "blocked");
    const justified = await guardCodexCommand({ ...base, tool_input: { command: "npm run lint # condiments:extra-tool=test output omitted required evidence" } });
    assert.equal(justified.round.exceptional, true);
    const ledgerRoot = path.join(root, ".condiments", "tool-rounds");
    const ledgerFiles = await readdir(ledgerRoot, { recursive: true });
    const ledger = await readFile(path.join(ledgerRoot, ledgerFiles.find((item) => item.endsWith(".json"))), "utf8");
    assert.doesNotMatch(ledger, /rg|npm|error|lint/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native Ranch leaves simple lookups outside round accounting", async () => {
  const root = await fixture("full");
  const base = { cwd: root, session_id: "session", turn_id: "turn", user_prompt: "Look up the package version", tool_name: "Bash" };
  try {
    assert.equal((await guardCodexCommand({ ...base, tool_input: { command: "rg -n version package.json" } })).round, null);
    assert.equal((await guardCodexCommand({ ...base, tool_input: { command: "rg -n version package.json" } })).action, "not-file-reader");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native Ranch serializes concurrent duplicate decisions", async () => {
  const root = await fixture("full");
  const payload = {
    cwd: root, session_id: "parallel-session", turn_id: "parallel-turn",
    user_prompt: "Debug a failing test", tool_name: "Bash", tool_input: { command: "rg -n failure src" },
  };
  try {
    const results = await Promise.all([guardCodexCommand(payload), guardCodexCommand(payload)]);
    assert.equal(results.filter((result) => result.round?.allow === true).length, 1);
    assert.equal(results.filter((result) => result.action === "blocked").length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native Ranch returns a recorded artifact instead of repeating a successful call", async () => {
  const root = await fixture("full");
  const base = { cwd: root, session_id: "reuse-session", turn_id: "reuse-turn", user_prompt: "Debug the failing tests", tool_name: "Bash" };
  try {
    const saved = await recordToolResult(root, {
      sessionId: "reuse-session", turnId: "reuse-turn", tool: "Bash", call: "npm test", exitStatus: 0, content: "all passed",
    });
    const result = await guardCodexCommand({ ...base, tool_input: { command: "npm test" } });
    assert.equal(result.action, "blocked");
    assert.equal(result.reuse.action, "reuse");
    assert.match(result.output.hookSpecificOutput.permissionDecisionReason, new RegExp(saved.record.contentHash));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
