import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV4 } from "@ai-sdk/provider";

/** Agent 统一配置；旧 DeepSeek 环境变量仅用于兼容已有配置。 */
export function resolveAgentModelConfig(env: Readonly<NodeJS.ProcessEnv> = process.env) {
  return {
    apiKey: env.AGENT_MODEL_API_KEY?.trim() || env.DEEPSEEK_API_KEY?.trim() || "",
    modelName: env.AGENT_MODEL_NAME?.trim() || env.DEEPSEEK_MODEL_NAME?.trim() || "deepseek-flash",
    baseUrl: env.AGENT_MODEL_BASE_URL?.trim() || "https://api.deepseek.com",
  };
}

/** OpenAI Chat Completions 兼容模型，工具调用与 JSON 输出供各 Agent 共用。 */
export function createAgentModel(env: Readonly<NodeJS.ProcessEnv> = process.env): LanguageModelV4 {
  const { apiKey, modelName, baseUrl } = resolveAgentModelConfig(env);
  return createOpenAICompatible({
    name: "novel-agent",
    apiKey,
    baseURL: baseUrl,
  })(modelName);
}

/** 每次会话启动创建一次；无 Key 仍可导入，入口负责启动检查。 */
export const model = createAgentModel();
