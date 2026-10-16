import type { LanguageModelV4 } from "@ai-sdk/provider";
import {
  MODEL_PROVIDERS,
  parseModelProvider,
  resolveWritingModelProvider,
  type ModelProvider,
} from "@novel/shared";
import { createProviderModel } from "./model-factory";
import { model as agentModel } from "./agent-model";

/** 写作模型三字段（模型名 / Key / Base URL）是否配置齐全（空串视为未配置）——仅作字段级判定，
 *  启用与否以 resolveWritingModelConfig 为准（provider 合法性单独报错）；
 *  （校验模型独立走 Agent 会话模型，write-chapter 会话不再据此豁免 Key 检查） */
export function isWritingModelConfigured(): boolean {
  return Boolean(
    process.env.WRITING_MODEL_NAME &&
      process.env.WRITING_MODEL_API_KEY &&
      process.env.WRITING_MODEL_BASE_URL,
  );
}

export interface WritingModelConfig {
  provider: ModelProvider;
  apiKey: string;
  modelName: string;
  baseUrl: string;
}

/**
 * 写作模型连接配置（正文创作专用，可与 Agent 会话模型不同）：
 * - `WRITING_MODEL_PROVIDER` 显式选择接口类型；未配置的历史配置按有效地址迁移
 *   （DeepSeek 官方地址 → deepseek，其余 → openai——独立写作默认即 OpenAI）；
 * - 模型名 / Key / Base URL 三项仍须齐全，任一未配置返回 null（调用方整体回落
 *   同一 Agent 模型实例）——半配置不拼凑请求，也不因新增默认 provider 而启用；
 * - 非法 provider 值直接抛可读错误（不静默换协议），正文生成前即报出。
 */
export function resolveWritingModelConfig(
  env: Readonly<NodeJS.ProcessEnv> = process.env,
): WritingModelConfig | null {
  const modelName = env.WRITING_MODEL_NAME?.trim() ?? "";
  const apiKey = env.WRITING_MODEL_API_KEY?.trim() ?? "";
  const baseUrl = env.WRITING_MODEL_BASE_URL?.trim() ?? "";
  const rawProvider = env.WRITING_MODEL_PROVIDER?.trim() ?? "";
  if (rawProvider && !parseModelProvider(rawProvider)) {
    throw new Error(
      `WRITING_MODEL_PROVIDER 配置无效：${rawProvider}（可选值：${MODEL_PROVIDERS.join(" / ")}）`,
    );
  }
  if (!modelName || !apiKey || !baseUrl) {
    return null;
  }
  return { provider: resolveWritingModelProvider(rawProvider, baseUrl), apiKey, modelName, baseUrl };
}

/**
 * 写作模型（章节正文创作专用）：Agent 负责世界观/角色/大纲等结构化编排，
 * 正文写作换用更长于文笔的模型时只需改配置，不动代码——两族模型可分别
 * 选择接口类型（如 Agent 用 DeepSeek、写作模型用 Claude）。
 *
 * 三个环境变量（Bun 启动时自动加载 `.env`，参考 `.env.example`）：
 * - `WRITING_MODEL_NAME`：模型名（按所接服务填写，如 gpt-5.2 / qwen3-max）
 * - `WRITING_MODEL_API_KEY`：API Key
 * - `WRITING_MODEL_BASE_URL`：接口 Base URL（如 https://api.example.com/v1）
 *
 * **任一未配置（含空串）时回落 Agent 会话模型**（agent-model.ts 的 `model`，
 * 与世界观/大纲等工作流共用同一 Agent 模型实例）——正文生成开箱即用，
 * 部分配置也整体回落，避免半配置产生难排查的请求错误；配置齐三项则用
 * 独立写作模型。provider 实例在调用时才创建，本模块导入零副作用。
 */
export function getWritingModel(): LanguageModelV4 {
  const config = resolveWritingModelConfig();
  if (!config) {
    return agentModel;
  }
  return createProviderModel(config, "novel-writing");
}
