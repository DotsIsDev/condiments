import { decorateProviderReasoningRequest, resolveProviderReasoningPolicy } from "./reasoning-governor.mjs";

export function resolveDeepSeekReasoningPolicy(options = {}) {
  return resolveProviderReasoningPolicy("deepseek", options);
}

export function decorateDeepSeekRequest(request, options = {}) {
  return decorateProviderReasoningRequest("deepseek", request, options);
}
