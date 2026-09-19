import { decorateProviderReasoningRequest, resolveProviderReasoningPolicy } from "./reasoning-governor.mjs";

export function resolveQwenThinkingPolicy(options = {}) {
  return resolveProviderReasoningPolicy("qwen", options);
}

export function decorateQwenRequest(request, options = {}) {
  return decorateProviderReasoningRequest("qwen", request, options);
}
