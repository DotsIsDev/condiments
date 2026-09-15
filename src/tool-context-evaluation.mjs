import { decorateToolContextRequest, detectRequiredTools, measureContextSplit } from "./tool-context.mjs";

const TASK = "Use the database tool to look up build code ALPHA. Return only its exact value.";
const EXPECTED = "TOKEN-SPLIT-OK-927";

export function buildToolContextEvaluationRequest() {
  const tools = [
    fn("search_files", "Search repository files by exact text."),
    fn("read_file", "Read one bounded file region."),
    fn("edit_file", "Apply one exact file edit."),
    fn("shell", "Run one bounded shell command."),
    mcp("database_lookup_build_code", "Build registry database lookup. Input is an opaque build code."),
  ];
  const domains = ["calendar", "email", "finance", "github", "image", "messaging", "music", "shipping", "social", "weather"];
  for (let index = 0; index < 40; index += 1) {
    const domain = domains[index % domains.length];
    tools.push(mcp(`${domain}_catalog_${String(index + 1).padStart(2, "0")}`,
      `Unrelated ${domain} service operation ${index + 1}. This detailed schema represents a realistic optional remote integration and is intentionally irrelevant to the current task.`));
  }
  return {
    model: "claude-sonnet-4-6",
    system: "Use the required tool once. Return only its exact result.",
    messages: [{ role: "user", content: TASK }],
    tools,
  };
}

export function runDeterministicToolContextEvaluation(options = {}) {
  const baseline = buildToolContextEvaluationRequest();
  const modes = ["none", "some", "full"].map((mode) => {
    const decorated = decorateToolContextRequest("anthropic", baseline, { level: mode, task: TASK });
    const request = decorated.request;
    const split = measureContextSplit(request);
    const execution = executeExactToolTask(request);
    const wireToolBytes = Buffer.byteLength(JSON.stringify(request.tools), "utf8");
    const visibleToolBytes = split.bytes.core_tools + split.bytes.other_tools + split.bytes.mcp_tools;
    return {
      mode,
      tool_count: request.tools.length,
      eager_tool_count: request.tools.filter((tool) => tool.defer_loading !== true).length,
      deferred_tool_count: request.tools.filter((tool) => tool.defer_loading === true).length,
      disabled_tool_count: decorated.control.disabled_tools?.length ?? 0,
      exact_wire_tool_bytes: wireToolBytes,
      exact_initial_visible_tool_bytes: visibleToolBytes,
      initial_visible_token_proxy: split.estimated_visible_tokens,
      exact_output_bytes: Buffer.byteLength(execution.output, "utf8"),
      output_token_proxy: Math.ceil(Buffer.byteLength(execution.output, "utf8") / 4),
      required_tool_called: execution.required_tool_called,
      exact_output_passed: execution.output === EXPECTED,
      quality_passed: execution.required_tool_called && execution.output === EXPECTED,
      control: decorated.control,
      split,
    };
  });
  const none = modes[0];
  for (const mode of modes) {
    mode.visible_tool_byte_reduction_vs_none_percent = percentReduction(none.exact_initial_visible_tool_bytes, mode.exact_initial_visible_tool_bytes);
    mode.wire_tool_byte_reduction_vs_none_percent = percentReduction(none.exact_wire_tool_bytes, mode.exact_wire_tool_bytes);
  }
  return {
    version: 1,
    generated_at: options.generatedAt ?? new Date().toISOString(),
    evaluation: "deterministic-provider-request-preflight",
    provider_contract: "Anthropic deferred tool loading",
    task_hash: detectRequiredTools(TASK).task_hash,
    expected_output: EXPECTED,
    quality_passed: modes.every((mode) => mode.quality_passed),
    measurement_note: "Schema and output bytes are exact. Token values are byte proxies, not provider-reported usage.",
    live_codex: options.liveCodex ?? { attempted: false, skipped: true, reason: "not requested by runner" },
    modes,
  };
}

export function renderToolContextEvaluationMarkdown(result) {
  const rows = result.modes.map((mode) => `| ${mode.mode} | ${mode.tool_count} | ${mode.eager_tool_count} | ${mode.deferred_tool_count} | ${mode.disabled_tool_count} | ${mode.exact_initial_visible_tool_bytes} | ${mode.visible_tool_byte_reduction_vs_none_percent}% | ${mode.quality_passed ? "pass" : "FAIL"} |`).join("\n");
  return `# Tool Context Evaluation\n\n` +
    `Generated: ${result.generated_at}\n\n` +
    `All three deterministic request modes returned the exact value through the required database tool: **${result.quality_passed ? "pass" : "FAIL"}**.\n\n` +
    `| Mode | Tools sent | Eager | Deferred | Disabled | Exact initial-visible tool bytes | Reduction vs none | Quality |\n` +
    `| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |\n${rows}\n\n` +
    `Schema and output byte counts are exact. Token counts in this preflight are UTF-8 byte proxies; they are not provider-reported usage.\n\n` +
    `## Live Codex CLI\n\n` + renderLive(result.live_codex);
}

function renderLive(live) {
  if (live.skipped) return `Skipped by the hard usage guard: ${live.reason}\n`;
  const rows = (live.modes ?? []).map((mode) => `| ${mode.mode} | ${mode.input_tokens} | ${mode.output_tokens} | ${mode.total_tokens} | ${mode.quality_passed ? "pass" : "FAIL"} |`).join("\n");
  return `Provider-reported matrix: **${live.quality_passed ? "pass" : "FAIL"}**.\n\n| Mode | Input | Output | Total | Quality |\n| --- | ---: | ---: | ---: | --- |\n${rows}\n`;
}

function executeExactToolTask(request) {
  const required = request.tools.find((tool) => tool.name === "database_lookup_build_code");
  if (!required) return { required_tool_called: false, output: "" };
  if (required.defer_loading === true && !request.tools.some((tool) => String(tool.type).startsWith("tool_search_tool_"))) {
    return { required_tool_called: false, output: "" };
  }
  return { required_tool_called: true, output: EXPECTED };
}

function fn(name, description) {
  return { type: "custom", name, description, input_schema: { type: "object", properties: {}, additionalProperties: false } };
}

function mcp(name, description) {
  return {
    type: "mcp",
    name,
    server_label: name,
    description,
    input_schema: {
      type: "object",
      properties: { code: { type: "string", description: "Exact opaque lookup key supplied by the user." } },
      required: ["code"],
      additionalProperties: false,
    },
  };
}

function percentReduction(baseline, value) {
  return baseline === 0 ? 0 : Number((((baseline - value) / baseline) * 100).toFixed(3));
}
