import type { LanguageModelV4 } from "@ai-sdk/provider";
import {
  MODEL_PROVIDERS,
  MODEL_PROVIDER_BASE_URLS,
  parseModelProvider,
  resolveAgentModelProvider,
  type ModelProvider,
} from "@novel/shared";
import { createProviderModel } from "./model-factory";

/** DeepSeek 的默认模型名（其余 provider 无默认模型名——模型名按所接服务填写） */
export const DEFAULT_DEEPSEEK_MODEL_NAME = "deepseek-flash";

export interface AgentModelConfig {
  provider: ModelProvider;
  apiKey: string;
  modelName: string;
  baseUrl: string;
}

/**
 * Agent 统一配置（Agent 会话与正文校验共用同一实例）：
 * - `AGENT_MODEL_PROVIDER` 显式选择接口类型（openai / deepseek / claude）；
 * - 未配置 provider 的历史配置按**有效地址**迁移——地址留空沿用原 Agent 的
 *   DeepSeek 官方默认地址，故按 DeepSeek 处理，其余地址按 OpenAI 处理；
 * - Base URL 留空按 provider 取官方默认地址，模型名留空仅 DeepSeek 有默认值；
 * - 旧 DeepSeek 环境变量（Key / 模型名）继续兼容。
 *
 * 非法 provider 值此处不抛错（module 级 `model` 常量创建于 import 期，抛错会
 * 使入口连可读提示都打不出），由 `describeAgentModelConfigError` 交入口启动检查。
 */
export function resolveAgentModelConfig(env: Readonly<NodeJS.ProcessEnv> = process.env): AgentModelConfig {
  const baseUrl = env.AGENT_MODEL_BASE_URL?.trim() ?? "";
  const provider = resolveAgentModelProvider(env.AGENT_MODEL_PROVIDER, baseUrl);
  return {
    provider,
    apiKey: env.AGENT_MODEL_API_KEY?.trim() || env.DEEPSEEK_API_KEY?.trim() || "",
    modelName:
      env.AGENT_MODEL_NAME?.trim() ||
      env.DEEPSEEK_MODEL_NAME?.trim() ||
      (provider === "deepseek" ? DEFAULT_DEEPSEEK_MODEL_NAME : ""),
    baseUrl: baseUrl || MODEL_PROVIDER_BASE_URLS[provider],
  };
}

/**
 * 配置问题的可读提示（null = 配置可用）：非法 provider 值不静默走错协议，
 * 非 DeepSeek 的接口类型缺模型名也提前拦住（否则请求期才报模型不存在的错）。
 */
export function describeAgentModelConfigError(env: Readonly<NodeJS.ProcessEnv> = process.env): string | null {
  const rawProvider = env.AGENT_MODEL_PROVIDER?.trim();
  if (rawProvider && !parseModelProvider(rawProvider)) {
    return `AGENT_MODEL_PROVIDER 配置无效：${rawProvider}（可选值：${MODEL_PROVIDERS.join(" / ")}）`;
  }
  const { provider, modelName } = resolveAgentModelConfig(env);
  if (!modelName) {
    return `AGENT_MODEL_PROVIDER=${provider} 需配置 AGENT_MODEL_NAME（该接口类型没有默认模型名）`;
  }
  return null;
}

/** 按所选 provider 创建模型实例，工具调用与结构化输出供各 Agent 共用 */
export function createAgentModel(env: Readonly<NodeJS.ProcessEnv> = process.env): LanguageModelV4 {
  return createProviderModel(resolveAgentModelConfig(env), "novel-agent");
}

/** 每次会话启动创建一次；无 Key 仍可导入，入口负责启动检查 */
export const model = createAgentModel();
