// SCNet 模型静态兜底表
// 数据来源：SCNet 客户端 ~/.sclaw/agent/models.json（2026-11-06，32 个模型）。
// 登录后由 GET /acx/llm/api/console/model 实时替换。
// cost 为 null 表示按平台计费（与客户端一致，不显示价格）。

export const STATIC_MODELS = {
  "DeepSeek-V4.1-Flash-1017": { name: "DeepSeek-V4.1-Flash-1017", limit: { context: 1048576, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "Kimi-K3.1-Pro": { name: "Kimi-K3.1-Pro", limit: { context: 1048576, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "Kimi-K3.1-Pro-Highspeed": { name: "Kimi-K3.1-Pro-Highspeed", limit: { context: 1048576, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "GLM-5.3-Flash": { name: "GLM-5.3-Flash", limit: { context: 1048576, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "MiniMax-M3.1-Flash": { name: "MiniMax-M3.1-Flash", limit: { context: 1048576, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "Qwen3.8-Flash": { name: "Qwen3.8-Flash", limit: { context: 1048576, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "GLM-5.3": { name: "GLM-5.3", limit: { context: 1048576, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "MiniMax-M3": { name: "MiniMax-M3", limit: { context: 1024000, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "DeepSeek-V4.1-Flash": { name: "DeepSeek-V4.1-Flash", limit: { context: 1048576, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "Kimi-K3": { name: "Kimi-K3", limit: { context: 1024000, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "DeepSeek-V4-Pro-0813": { name: "DeepSeek-V4-Pro-0813", limit: { context: 1048576, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "Qwen3.8-Max": { name: "Qwen3.8-Max", limit: { context: 1048576, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "DeepSeek-V4-Flash-0731": { name: "DeepSeek-V4-Flash-0731", limit: { context: 1048576, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "GLM-5.2": { name: "GLM-5.2", limit: { context: 1048576, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "Spark-X2.5": { name: "Spark-X2.5", limit: { context: 262144, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "GLM-5.1": { name: "GLM-5.1", limit: { context: 206848, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "Qwen3.7-Max": { name: "Qwen3.7-Max", limit: { context: 1014784, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "Kimi-K2.7-Code": { name: "Kimi-K2.7-Code", limit: { context: 262144, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "Kimi-K2.6": { name: "Kimi-K2.6", limit: { context: 262144, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "Kimi-K2.5": { name: "Kimi-K2.5", limit: { context: 262144, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "GLM-5": { name: "GLM-5", limit: { context: 204800, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "MiniMax-M2.7": { name: "MiniMax-M2.7", limit: { context: 204800, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "MiniMax-M2.5": { name: "MiniMax-M2.5", limit: { context: 204800, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "Qwen3.7-Plus": { name: "Qwen3.7-Plus", limit: { context: 1014784, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "Qwen3.6-Plus": { name: "Qwen3.6-Plus", limit: { context: 512000, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "Qwen3.6-Flash": { name: "Qwen3.6-Flash", limit: { context: 1024000, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "Qwen3.6-27B": { name: "Qwen3.6-27B", limit: { context: 262144, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "Qwen3.5-122B-A10B": { name: "Qwen3.5-122B-A10B", limit: { context: 102400, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "MiMo-V2.5-Pro": { name: "MiMo-V2.5-Pro", limit: { context: 1024000, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "Qwen3-235B-A22B": { name: "Qwen3-235B-A22B", limit: { context: 32768, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "SCNet-Max": { name: "SCNet-Max", limit: { context: 1048576, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
  "GLM-5.2-Base": { name: "GLM-5.2-Base", limit: { context: 131072, output: 131072 }, reasoning: true, tool_call: true, modalities: { input: ["text"] } },
};

export function staticModelList() {
  return Object.entries(STATIC_MODELS).map(([id, m]) => ({
    id,
    name: m.name,
    limit: m.limit,
    reasoning: m.reasoning,
    tool_call: m.tool_call,
    modalities: m.modalities,
  }));
}