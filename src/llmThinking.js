/**
 * 为 Chat Completions 请求按 Base URL 合并「思考模式」参数；非支持厂商不添加，避免 400。
 * - DeepSeek: thinking + reasoning_effort
 * - 硅基流动: enable_thinking + thinking_budget
 */
export function mergeChatCompletionThinking(endpoint, body) {
  if (!body || typeof body !== 'object') return body;
  if (!endpoint?.thinkingEnabled) return { ...body };
  const url = String(endpoint?.url || '').toLowerCase();
  if (url.includes('deepseek.com')) {
    return {
      ...body,
      thinking: { type: 'enabled' },
      reasoning_effort: endpoint?.reasoningEffort === 'max' ? 'max' : 'high',
    };
  }
  if (url.includes('siliconflow') || url.includes('api.siliconflow')) {
    const tb = Number(endpoint?.thinkingBudget);
    const budget =
      Number.isFinite(tb) && tb >= 128 && tb <= 32768 ? Math.floor(tb) : 4096;
    return {
      ...body,
      enable_thinking: true,
      thinking_budget: budget,
    };
  }
  return { ...body };
}
