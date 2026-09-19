# Provider Reasoning Governor

`condiments-reasoning --provider <provider> --input request.json` applies one capability-gated reasoning policy to direct OpenAI Responses, Anthropic Messages, Qwen, and DeepSeek requests. The input contains `request` and `options`; the command emits the decorated request plus its policy and cache-lineage decision.

```json
{
  "request": { "model": "provider-model", "messages": [] },
  "options": {
    "level": "full",
    "taskClass": "standard",
    "capabilities": {
      "reasoningEffort": true,
      "supportedEfforts": ["low", "medium", "high"]
    }
  }
}
```

Capabilities are explicit. The governor does not infer request-field support from a model name. `none` leaves requests unchanged. Existing lower caller effort remains lower unless `qualityRequired` or `blocked` requests escalation.

## OpenAI Responses

The governor writes `reasoning.effort`; it never emits a `configuration_update` input item. When `responseState` is declared and `previousResponseId` is supplied, it also writes `previous_response_id`. Chat Completions is rejected as an unsupported reasoning-control surface.

## Anthropic Messages

The governor writes `output_config.effort`. With explicit `contextEditing` support, it adds the `context-management-2025-06-27` beta and a server-side `clear_thinking_20251015` strategy. `some` keeps two recent thinking turns; `full` keeps one. Existing context-editing strategies remain intact, and thinking clearing is ordered first as required by the API.

When the latest user message contains a `tool_result`, the governor changes neither effort nor thinking context. This preserves the complete assistant thinking blocks required to continue an active tool-use response.

## Cache lineage

Pass `previousRequest` and measured `lineageMetrics` to protect a valuable cached prefix. If the projected reasoning/context saving does not recover the cached tokens at risk, the governor restores the earlier reasoning and context-management fields. Quality escalation overrides that hold.

## Qwen and DeepSeek

The existing `condiments-qwen-thinking` and `condiments-deepseek-reasoning` commands now use this shared classifier and escalation policy. Their provider-specific fields and compatibility behavior remain unchanged.
