import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { ADAPTER_ORDER, getInstallPaths } from "../src/adapters.mjs";

for (const host of ADAPTER_ORDER) {
  test(`installs the ${host} adapter with both command names`, async () => {
    const target = await mkdtemp(path.join(os.tmpdir(), `condiments-${host}-`));
    try {
      const run = spawnSync(process.execPath, [
        path.resolve("scripts", "install-adapter.mjs"),
        "--host", host,
        "--target", target,
      ], { cwd: path.resolve("."), encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
      const receipt = JSON.parse(run.stdout);
      const destinations = getInstallPaths(host, target);
      assert.equal(receipt.host, host);
      await access(path.join(destinations.main, "SKILL.md"));
      await access(path.join(destinations.main, "scripts", "condiments.mjs"));
      await access(path.join(destinations.main, "scripts", "context-hook.mjs"));
      await access(path.join(destinations.main, "scripts", "result-hook.mjs"));
      await access(path.join(destinations.main, "scripts", "command-guard-hook.mjs"));
      await access(path.join(destinations.main, "scripts", "cache-hook.mjs"));
      await access(path.join(destinations.main, "scripts", "prompt-cache.mjs"));
      await access(path.join(destinations.main, "scripts", "output-budget.mjs"));
      await access(path.join(destinations.main, "scripts", "codex-route.mjs"));
      await access(path.join(destinations.main, "scripts", "reasoning-hook.mjs"));
      await access(path.join(destinations.main, "scripts", "completion-policy.mjs"));
      await access(path.join(destinations.main, "scripts", "tool-context.mjs"));
      await access(path.join(destinations.main, "scripts", "cache-lineage.mjs"));
      await access(path.join(destinations.main, "scripts", "output-governor.mjs"));
      await access(path.join(destinations.main, "scripts", "query-compressor.mjs"));
      await access(path.join(destinations.main, "scripts", "log-dictionary.mjs"));
      await access(path.join(destinations.main, "scripts", "output-cap-train.mjs"));
      await access(path.join(destinations.main, "scripts", "reversible-memory.mjs"));
      await access(path.join(destinations.main, "scripts", "significance-output.mjs"));
      await access(path.join(destinations.main, "scripts", "llmlingua-sidecar.mjs"));
      await access(path.join(destinations.main, "scripts", "reasoning-governor.mjs"));
      await access(path.join(destinations.main, "scripts", "qwen-thinking.mjs"));
      await access(path.join(destinations.main, "scripts", "deepseek-reasoning.mjs"));
      await access(path.join(destinations.main, "sidecars", "llmlingua2.py"));
      await access(path.join(destinations.main, "references", "completion-policy.md"));
      await access(path.join(destinations.main, "references", "tool-context.md"));
      await access(path.join(destinations.main, "references", "cache-lineage.md"));
      await access(path.join(destinations.main, "references", "output-governor.md"));
      await access(path.join(destinations.main, "references", "query-compressor.md"));
      await access(path.join(destinations.main, "references", "log-dictionary.md"));
      await access(path.join(destinations.main, "references", "output-cap-learning.md"));
      await access(path.join(destinations.main, "references", "research-controls.md"));
      await access(path.join(destinations.main, "references", "reasoning-governor.md"));
      await access(path.join(destinations.main, "capabilities.json"));
      await access(path.join(destinations.alias, "SKILL.md"));
      assert.match(await readFile(path.join(destinations.alias, "SKILL.md"), "utf8"), /name: cond/);
      assert.equal(receipt.nativeContext.installed, true);
      assert.equal(typeof receipt.nativeOutput.supported, "boolean");
      assert.equal(receipt.promptCache.installed, true);
      assert.equal(typeof receipt.nativeReasoning.supported, "boolean");
      const installedCapabilities = JSON.parse(await readFile(path.join(destinations.main, "capabilities.json"), "utf8"));
      assert.equal(
        installedCapabilities.nativeActiveTurnRouting,
        Boolean(receipt.nativeReasoning.activeTurnRouting),
      );
      assert.equal(installedCapabilities.providerOutputBudgetControl, true);
      assert.equal(installedCapabilities.nativeResponseBudgetControl, host === "openclaw");
      assert.equal(installedCapabilities.directFileEdit, true);
      assert.equal(installedCapabilities.nativeFimCompletion, false);
      assert.equal(installedCapabilities.unifiedDiffCompletion, true);
      assert.equal(installedCapabilities.toolContextTelemetry, true);
      assert.equal(installedCapabilities.providerLazyToolLoading, true);
      assert.equal(installedCapabilities.providerMcpToolControl, true);
      assert.equal(installedCapabilities.nativeLazyToolLoading, host === "openclaw");
      assert.equal(installedCapabilities.nativeMcpSchemaPruning, host === "openclaw");
      assert.equal(installedCapabilities.cacheLineageControl, true);
      assert.equal(installedCapabilities.adaptiveOutputGovernor, true);
      assert.equal(installedCapabilities.verificationAwareQueryCompression, true);
      assert.equal(installedCapabilities.losslessLogDictionary, true);
      assert.equal(installedCapabilities.telemetryTrainedOutputCaps, true);
      assert.equal(installedCapabilities.reversibleMemory, true);
      assert.equal(installedCapabilities.significanceAwareOutput, true);
      assert.equal(installedCapabilities.hierarchicalBudgetControl, true);
      assert.equal(installedCapabilities.queryConditionedContextAllocation, true);
      assert.equal(installedCapabilities.learnedContextCompressionAdapter, true);
      assert.equal(installedCapabilities.nativeLearnedContextCompression, false);
      assert.equal(installedCapabilities.providerReasoningGovernor, true);
      assert.equal(installedCapabilities.openaiReasoningRequestControl, true);
      assert.equal(installedCapabilities.anthropicReasoningRequestControl, true);
      assert.equal(installedCapabilities.qwenThinkingRequestControl, true);
      assert.equal(installedCapabilities.nativeQwenThinkingControl, false);
      assert.equal(installedCapabilities.deepseekReasoningRequestControl, true);
      assert.equal(installedCapabilities.deepseekReasoningHistoryPruning, true);
      assert.equal(installedCapabilities.nativeDeepSeekReasoningControl, false);
      assert.equal(installedCapabilities.nativeCacheLineageControl, host === "codex-cli" && Boolean(receipt.nativeReasoning.activeTurnRouting));
      assert.equal(receipt.nativeToolContext.supported, host === "openclaw");

      if (host === "claude-code") {
        const hooks = JSON.parse(await readFile(path.join(target, ".claude", "settings.json"), "utf8"));
        assert.equal(hooks.hooks.PreCompact.length, 1);
        assert.equal(hooks.hooks.PostToolUse.length, 1);
        assert.equal(hooks.hooks.Stop.length, 1);
      }
      if (host === "cursor") {
        const hooks = JSON.parse(await readFile(path.join(target, ".cursor", "hooks.json"), "utf8"));
        assert.equal(hooks.hooks.preCompact.length, 1);
        assert.equal(hooks.hooks.postToolUse.length, 1);
        assert.equal(hooks.hooks.sessionEnd.length, 1);
      }
      if (host === "codex-cli") {
        const hooks = JSON.parse(await readFile(path.join(target, ".codex", "hooks.json"), "utf8"));
        assert.equal(hooks.hooks.PostToolUse, undefined);
        assert.equal(receipt.nativeOutput.supported, true);
        assert.equal(hooks.hooks.PreToolUse.length, 1);
        assert.match(hooks.hooks.PreToolUse[0].hooks[0].command, /command-guard-hook\.mjs/);
        assert.equal(hooks.hooks.Stop.length, 1);
        assert.equal(installedCapabilities.nativeToolControl, true);
        if (receipt.nativeReasoning.activeTurnRouting) {
          assert.equal(hooks.hooks.UserPromptSubmit.length, 1);
        } else {
          assert.equal(hooks.hooks.UserPromptSubmit, undefined);
        }
        assert.equal(receipt.nativeReasoning.supported, true);
      }

      const status = spawnSync(process.execPath, [
        path.join(destinations.main, "scripts", "condiments.mjs"),
        "/cond", "status",
        "--host", host,
        "--capabilities", path.join(destinations.main, "capabilities.json"),
        "--no-write",
      ], { cwd: target, encoding: "utf8" });
      assert.equal(status.status, 0, status.stderr);
      assert.match(status.stdout, new RegExp(`Host: ${host}`));
      if (host === "codex-cli") assert.match(status.stdout, /native-tools=yes/);

      if (host === "claude-code") {
        const enabled = spawnSync(process.execPath, [
          path.join(destinations.main, "scripts", "condiments.mjs"),
          "/cond", "some",
          "--host", host,
          "--capabilities", path.join(destinations.main, "capabilities.json"),
          "--json",
        ], { cwd: target, encoding: "utf8" });
        assert.equal(enabled.status, 0, enabled.stderr);
        const result = JSON.parse(enabled.stdout);
        assert.equal(result.nativeContext.level, "some");
        assert.equal(result.nativeContext.detail.autoCompactPercent, 85);
        assert.equal(result.nativeOutput.level, "some");
        assert.equal(result.nativeOutput.detail.applied, true);
        assert.equal(result.nativeOutput.detail.profile.thresholdChars, 80_000);

        const intercepted = spawnSync(process.execPath, [
          path.join(destinations.main, "scripts", "result-hook.mjs"),
          "--host", host,
          "--cwd", target,
        ], {
          cwd: target,
          encoding: "utf8",
          input: JSON.stringify({ tool_name: "Read", tool_response: "x".repeat(85_000) }),
        });
        assert.equal(intercepted.status, 0, intercepted.stderr);
        assert.match(intercepted.stdout, /updatedToolOutput/);
      }

      const duplicate = spawnSync(process.execPath, [
        path.resolve("scripts", "install-adapter.mjs"),
        "--host", host,
        "--target", target,
      ], { cwd: path.resolve("."), encoding: "utf8" });
      assert.equal(duplicate.status, 2);
      assert.match(duplicate.stderr, /Destination exists/);
    } finally {
      await rm(target, { recursive: true, force: true });
    }
  });
}
