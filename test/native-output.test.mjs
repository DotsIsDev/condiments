import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  installNativeOutputHooks,
  interceptNativeToolOutput,
} from "../src/native-output.mjs";
import { inspectToolState } from "../src/tool-state.mjs";

async function writeState(root, preset) {
  const directory = path.join(root, ".condiments");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "state.json"), JSON.stringify({
    version: 1,
    preset,
    overrides: {},
  }), "utf8");
}

test("native output hook installation is idempotent and preserves existing hooks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-output-install-"));
  try {
    const claudePath = path.join(root, ".claude", "settings.json");
    await mkdir(path.dirname(claudePath), { recursive: true });
    await writeFile(claudePath, JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "echo keep" }] }] },
    }), "utf8");
    await installNativeOutputHooks("claude-code", root);
    await installNativeOutputHooks("claude-code", root);
    const claude = JSON.parse(await readFile(claudePath, "utf8"));
    assert.equal(claude.hooks.Stop.length, 1);
    assert.equal(claude.hooks.PostToolUse.length, 1);
    assert.match(claude.hooks.PostToolUse[0].hooks[0].command, /result-hook\.mjs/);

    await installNativeOutputHooks("cursor", root);
    await installNativeOutputHooks("cursor", root);
    const cursor = JSON.parse(await readFile(path.join(root, ".cursor", "hooks.json"), "utf8"));
    assert.equal(cursor.hooks.postToolUse.length, 1);
    assert.equal(cursor.hooks.postToolUse[0].matcher, "MCP:.*");

    await installNativeOutputHooks("codex-cli", root);
    await installNativeOutputHooks("codex-cli", root);
    const codex = JSON.parse(await readFile(path.join(root, ".codex", "hooks.json"), "utf8"));
    assert.equal(codex.hooks.PreToolUse.length, 1);
    assert.match(codex.hooks.PreToolUse[0].hooks[0].command, /command-guard-hook\.mjs/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Claude PostToolUse replaces large structured output and preserves exact artifact", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-output-claude-"));
  try {
    await writeState(root, "some");
    const original = {
      stdout: `${"noise\n".repeat(15_000)}ERROR actionable failure`,
      stderr: "",
      interrupted: false,
      isImage: false,
    };
    const result = await interceptNativeToolOutput({
      cwd: root,
      session_id: "session-a",
      turn_id: "turn-a",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      tool_response: original,
    }, { host: "claude-code" });

    assert.equal(result.action, "intercepted");
    assert.equal(result.envelope.truncated, true);
    const replacement = result.output.hookSpecificOutput.updatedToolOutput;
    assert.match(replacement.stdout, /condiments_result_envelope/);
    assert.equal(replacement.stderr, "");
    assert.equal(replacement.interrupted, false);
    assert.equal(replacement.isImage, false);
    assert.equal(await readFile(result.envelope.artifact_path, "utf8"), JSON.stringify(original));
    assert.ok(JSON.stringify(replacement).length < JSON.stringify(original).length / 10);
    const toolState = await inspectToolState(root, { sessionId: "session-a", turnId: "turn-a" });
    assert.ok(toolState.facts.some((fact) => fact.includes("ERROR actionable failure")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("full profile intercepts at 20K while small output passes through", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-output-profile-"));
  try {
    await writeState(root, "full");
    const large = await interceptNativeToolOutput({
      cwd: root,
      tool_name: "Read",
      tool_response: "x".repeat(25_000),
    }, { host: "claude-code" });
    assert.equal(large.action, "intercepted");
    assert.match(large.output.hookSpecificOutput.updatedToolOutput, /artifact_path/);

    const small = await interceptNativeToolOutput({
      cwd: root,
      tool_name: "Read",
      tool_response: "x".repeat(19_000),
    }, { host: "claude-code" });
    assert.equal(small.action, "pass");
    assert.deepEqual(small.output, {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Cursor replaces oversized MCP output but leaves shell output untouched", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-output-cursor-"));
  try {
    await writeState(root, "full");
    const mcp = await interceptNativeToolOutput({
      cwd: root,
      tool_name: "MCP:search",
      tool_input: { query: "needle" },
      tool_output: JSON.stringify({ results: "z".repeat(30_000) }),
    }, { host: "cursor" });
    assert.equal(mcp.action, "intercepted");
    assert.match(mcp.output.updated_mcp_tool_output.results, /condiments_result_envelope/);

    const shell = await interceptNativeToolOutput({
      cwd: root,
      tool_name: "Shell",
      tool_output: "z".repeat(30_000),
    }, { host: "cursor" });
    assert.equal(shell.action, "unsupported-tool");
    assert.deepEqual(shell.output, {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("none is inert and Codex does not append a redundant compact copy", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-output-none-"));
  try {
    await writeState(root, "none");
    const none = await interceptNativeToolOutput({
      cwd: root,
      tool_name: "Bash",
      tool_response: "x".repeat(100_000),
    }, { host: "claude-code" });
    assert.equal(none.action, "noop");
    await assert.rejects(access(path.join(root, ".condiments", "artifacts")));

    await writeState(root, "full");
    const codex = await interceptNativeToolOutput({
      cwd: root,
      tool_name: "Bash",
      tool_response: "x".repeat(100_000),
    }, { host: "codex-cli" });
    assert.equal(codex.action, "unsupported-hook");
    assert.deepEqual(codex.output, {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("result hook CLI returns only host replacement JSON", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "condiments-output-cli-"));
  try {
    await writeState(root, "full");
    const run = spawnSync(process.execPath, [
      path.resolve("scripts", "result-hook.mjs"),
      "--host", "claude-code",
      "--cwd", root,
    ], {
      cwd: path.resolve("."),
      encoding: "utf8",
      input: JSON.stringify({ tool_name: "Read", tool_response: "q".repeat(25_000) }),
    });
    assert.equal(run.status, 0, run.stderr);
    const output = JSON.parse(run.stdout);
    assert.equal(output.hookSpecificOutput.hookEventName, "PostToolUse");
    assert.match(output.hookSpecificOutput.updatedToolOutput, /content_hash/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
