import type { LanguageModelV4 } from "@ai-sdk/provider";
import {
  MODEL_PROVIDERS,
  parseModelProvider,
  resolveReviewModelProvider,
  type ModelProvider,
} from "@novel/shared";
import { createProviderModel } from "./model-factory";
import { model as agentModel } from "./agent-model";

export interface ReviewModelConfig {
  provider: ModelProvider;
  apiKey: string;
  modelName: string;
  baseUrl: string;
}

/**
 * 校审模型连接配置（章节正文三段审校专用，可与 Agent 会话模型不同）：
 * - `REVIEW_MODEL_PROVIDER` 显式选择接口类型；未配置的历史配置按有效地址迁移
 *   （DeepSeek 官方地址 → deepseek，其余 → openai）；
 * - 模型名 / Key / Base URL 三项仍须齐全，任一未配置返回 null（调用方整体回落
 *   同一 Agent 模型实例）——半配置不拼凑请求，也不因新增默认 provider 而启用；
 * - 非法 provider 值直接抛可读错误（不静默换协议）。
 *
 * 配置先行：当前审校流程（chapter-review）仍使用 Agent 会话模型，本模块
 * 尚无消费方——接入为后续独立需求，届时经 Options 注入替换默认模型。
 */
export function resolveReviewModelConfig(
  env: Readonly<NodeJS.ProcessEnv> = process.env,
): ReviewModelConfig | null {
  const modelName = env.REVIEW_MODEL_NAME?.trim() ?? "";
  const apiKey = env.REVIEW_MODEL_API_KEY?.trim() ?? "";
  const baseUrl = env.REVIEW_MODEL_BASE_URL?.trim() ?? "";
  const rawProvider = env.REVIEW_MODEL_PROVIDER?.trim() ?? "";
  if (rawProvider && !parseModelProvider(rawProvider)) {
    throw new Error(
      `REVIEW_MODEL_PROVIDER 配置无效：${rawProvider}（可选值：${MODEL_PROVIDERS.join(" / ")}）`,
    );
  }
  if (!modelName || !apiKey || !baseUrl) {
    return null;
  }
  return { provider: resolveReviewModelProvider(rawProvider, baseUrl), apiKey, modelName, baseUrl };
}

/**
 * 校审模型（章节正文审校专用）：三段校验（内容约束 / 文风相似度 / 前后自洽）
 * 换用更长于评审的模型时只需改配置，不动代码——可与 Agent 会话模型、写作模型
 * 分别选择接口类型。
 *
 * 三个环境变量（Bun 启动时自动加载 `.env`，参考 `.env.example`；客户端设置页
 * 「模型设置 → 校审模型」维护并经 childEnv 注入）：
 * - `REVIEW_MODEL_NAME`：模型名（按所接服务填写，如 deepseek-v4-pro）
 * - `REVIEW_MODEL_API_KEY`：API Key
 * - `REVIEW_MODEL_BASE_URL`：接口 Base URL（如 https://api.example.com/v1）
 *
 * **任一未配置（含空串）时回落 Agent 会话模型**（agent-model.ts 的 `model`）
 * ——部分配置也整体回落，避免半配置产生难排查的请求错误。provider 实例在
 * 调用时才创建，本模块导入零副作用。当前尚无调用方（配置先行）。
 */
export function getReviewModel(): LanguageModelV4 {
  const config = resolveReviewModelConfig();
  if (!config) {
    return agentModel;
  }
  return createProviderModel(config, "novel-review");
}
