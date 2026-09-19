import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  applyCommand,
  createDefaultState,
  formatStatus,
  parseCommand,
  measureOutputBudget,
  renderPolicyPrefix,
  renderPrompt,
  renderStateDelta,
  resolveOutputBudget,
  resolveLevels,
} from "../src/core.mjs";

test("parses global presets through both command names", () => {
  assert.deepEqual(parseCommand("/cond some"), {
    type: "preset",
    level: "some",
  });
  assert.deepEqual(parseCommand("/CONDIMENTS FULL"), {
    type: "preset",
    level: "full",
  });
});

test("normalizes condiment aliases and makes a bare control full", () => {
  const expected = [
    ["mayonnaise", "mayo"],
    ["must", "mustard"],
    ["ket", "ketchup"],
    ["ran", "ranch"],
    ["hotsauce", "hot"],
  ];

  for (const [alias, control] of expected) {
    assert.deepEqual(parseCommand(`/cond ${alias}`), {
      type: "control",
      control,
      level: "full",
    });
  }
});

test("parses version aliases through both command names", () => {
  for (const alias of ["v", "ver", "version"]) {
    assert.deepEqual(parseCommand(`/cond ${alias}`), { type: "version" });
    assert.deepEqual(parseCommand(`/CONDIMENTS ${alias.toUpperCase()}`), { type: "version" });
  }
  assert.throws(() => parseCommand("/cond version extra"), /Too many arguments/);
});

test("rejects unknown controls and levels", () => {
  assert.throws(() => parseCommand("/cond relish"), /Unknown argument/);
  assert.throws(() => parseCommand("/cond mayo maximum"), /Unknown level/);
  assert.throws(() => parseCommand("/other full"), /Unknown command/);
});

test("individual overrides resolve over the active preset", () => {
  let state = applyCommand(createDefaultState(), parseCommand("/cond some"));
  state = applyCommand(state, parseCommand("/cond mayo full"));

  assert.deepEqual(resolveLevels(state), {
    mayo: "full",
    mustard: "some",
    ketchup: "some",
    ranch: "some",
    hot: "some",
  });
});

test("a later global preset clears individual overrides", () => {
  let state = applyCommand(createDefaultState(), parseCommand("/cond mayo full"));
  state = applyCommand(state, parseCommand("/cond some"));

  assert.deepEqual(state, { version: 1, preset: "some", overrides: {} });
  assert.ok(Object.values(resolveLevels(state)).every((level) => level === "some"));
});

test("reset restores pass-through behavior", () => {
  let state = applyCommand(createDefaultState(), parseCommand("/cond full"));
  state = applyCommand(state, parseCommand("/cond reset"));

  assert.deepEqual(state, createDefaultState());
  assert.equal(renderPrompt(state), "");
});

test("full prompt compiles every control below the per-turn overhead target", () => {
  const state = applyCommand(createDefaultState(), parseCommand("/cond full"));
  const prompt = renderPrompt(state);

  assert.match(prompt, /m=f,u=f,k=f,r=f,h=f/);
  assert.match(prompt, /o=120w-simple-terse/);
  assert.match(prompt, /q=verify/);
  assert.ok(Buffer.byteLength(prompt, "utf8") < 150);
});

test("state prompt emits only changed controls and stable policy stays separate", () => {
  const some = applyCommand(createDefaultState(), parseCommand("/cond some"));
  const mayoFull = applyCommand(some, parseCommand("/cond mayo full"));
  assert.equal(renderStateDelta(mayoFull, some), "<cond v=1 m=f o=120w-simple-terse q=verify/>");
  assert.equal(renderStateDelta(mayoFull, mayoFull), "");
  assert.equal(renderStateDelta(createDefaultState(), mayoFull), "<cond v=1 reset/>");
  assert.equal(renderPolicyPrefix(), renderPolicyPrefix());
  assert.match(renderPolicyPrefix(), /State tags are deltas/);
});

test("mayo full applies a checkpoint-independent hard final-response budget", () => {
  let state = applyCommand(createDefaultState(), parseCommand("/cond ketchup full"));
  assert.equal(resolveOutputBudget(state), null);

  state = applyCommand(state, parseCommand("/cond mayo full"));
  assert.deepEqual(resolveOutputBudget(state), {
    scope: "final-user-response",
    unit: "words",
    maximum: 120,
    excludes: ["checkpoints", "compaction-state", "memory", "tool-state"],
    userOverride: true,
  });
  assert.equal(measureOutputBudget(state, "word ".repeat(120)).withinBudget, true);
  assert.equal(measureOutputBudget(state, "word ".repeat(121)).withinBudget, false);
});

test("status reports effective levels and explicit capability flags", () => {
  let state = applyCommand(createDefaultState(), parseCommand("/cond some"));
  state = applyCommand(state, parseCommand("/cond ket full"));
  const status = formatStatus(state, {
    host: "test-host",
    capabilities: {
      nativeCompaction: true,
      usageTelemetry: true,
      nativePromptCacheControl: true,
      promptCacheTelemetry: true,
      nativeActiveTurnRouting: true,
    },
  });

  assert.match(status, /ketchup=full/);
  assert.match(status, /Host: test-host/);
  assert.match(status, /native-compact=yes/);
  assert.match(status, /usage=yes/);
  assert.match(status, /cache-control=yes/);
  assert.match(status, /cache-telemetry=yes/);
  assert.match(status, /active-turn-route=yes/);
  assert.match(status, /envelope=yes/);
  assert.match(status, /checkpoint=yes/);
  assert.match(status, /native-output=no/);
  assert.match(status, /output-request=yes/);
  assert.match(status, /output-native=no/);
  assert.match(status, /direct-edit=no/);
  assert.match(status, /fim=no/);
  assert.match(status, /unified-diff=yes/);
  assert.match(status, /split=yes/);
  assert.match(status, /provider-lazy=yes/);
  assert.match(status, /native-lazy=no/);
  assert.match(status, /reversible-memory=yes/);
  assert.match(status, /significant-output=yes/);
  assert.match(status, /phase-budget=yes/);
  assert.match(status, /qwen-request=yes/);
  assert.match(status, /qwen-native=no/);
});

test("CLI persists state and returns a machine-readable prompt", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "condiments-"));
  const statePath = path.join(temporaryDirectory, "state.json");
  const scriptPath = path.resolve("scripts", "condiments.mjs");
  try {
    const first = spawnSync(
      process.execPath,
      [scriptPath, "/cond", "some", "--state", statePath, "--json"],
      { cwd: path.resolve("."), encoding: "utf8" },
    );

    assert.equal(first.status, 0, first.stderr);
    const output = JSON.parse(first.stdout);
    assert.equal(output.effective.mustard, "some");
    assert.equal(output.capabilities.promptControls, true);
    assert.equal(output.capabilities.nativeCompaction, false);
    assert.match(output.prompt, /m=s,u=s,k=s,r=s,h=s/);

    const second = spawnSync(
      process.execPath,
      [scriptPath, "/cond", "mayo", "full", "--state", statePath, "--json"],
      { cwd: path.resolve("."), encoding: "utf8" },
    );
    assert.equal(second.status, 0, second.stderr);
    assert.equal(JSON.parse(second.stdout).effective.mayo, "full");
    assert.equal(JSON.parse(second.stdout).outputBudget.maximum, 120);
    assert.equal(JSON.parse(second.stdout).prompt, "<cond v=1 m=f o=120w-simple-terse q=verify/>");

    const promptOnly = spawnSync(
      process.execPath,
      [scriptPath, "/cond", "mayo", "none", "--state", statePath, "--prompt-only"],
      { cwd: path.resolve("."), encoding: "utf8" },
    );
    assert.equal(promptOnly.status, 0, promptOnly.stderr);
    assert.match(promptOnly.stdout, /^<cond v=1 m=n/);
    assert.doesNotMatch(promptOnly.stdout, /Capabilities:/);

    const persisted = JSON.parse(await readFile(statePath, "utf8"));
    assert.deepEqual(persisted, {
      version: 1,
      preset: "some",
      overrides: { mayo: "none" },
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("CLI reports its bundled version without reading or changing policy state", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "condiments-version-"));
  const statePath = path.join(temporaryDirectory, "state.json");
  const scriptPath = path.resolve("scripts", "condiments.mjs");
  const packageMetadata = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));

  try {
    await writeFile(statePath, "not valid json\n", "utf8");
    const human = spawnSync(
      process.execPath,
      [scriptPath, "/cond", "version", "--state", statePath],
      { cwd: temporaryDirectory, encoding: "utf8" },
    );
    assert.equal(human.status, 0, human.stderr);
    assert.equal(human.stdout, `Condiments v${packageMetadata.version}\n`);

    const machine = spawnSync(
      process.execPath,
      [scriptPath, "/condiments", "ver", "--state", statePath, "--json"],
      { cwd: temporaryDirectory, encoding: "utf8" },
    );
    assert.equal(machine.status, 0, machine.stderr);
    assert.deepEqual(JSON.parse(machine.stdout), {
      command: { type: "version" },
      version: packageMetadata.version,
    });
    assert.equal(await readFile(statePath, "utf8"), "not valid json\n");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
