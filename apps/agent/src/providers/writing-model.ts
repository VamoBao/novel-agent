import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { model as agentModel } from "./deepseek";

/** 写作模型三项环境变量是否配置齐全（空串视为未配置）；headless 启动检查与回落判定共用 */
export function isWritingModelConfigured(): boolean {
  return Boolean(
    process.env.WRITING_MODEL_NAME &&
      process.env.WRITING_MODEL_API_KEY &&
      process.env.WRITING_MODEL_BASE_URL,
  );
}

/**
 * 写作模型（OpenAI 接口兼容端点）：小说正文创作专用，可与 Agent 会话模型
 * （deepseek.ts）不同——Agent 负责世界观/角色/大纲等结构化编排，正文写作
 * 换用更长于文笔的模型时只需改环境变量，不动代码。
 *
 * 三个环境变量（Bun 启动时自动加载 `.env`，参考 `.env.example`）：
 * - `WRITING_MODEL_NAME`：模型名（按所接服务填写，如 gpt-5.2 / qwen3-max）
 * - `WRITING_MODEL_API_KEY`：API Key
 * - `WRITING_MODEL_BASE_URL`：接口 Base URL（如 https://api.example.com/v1）
 *
 * **任一未配置（含空串）时回落 Agent 会话模型**（deepseek.ts 的 `model`，
 * 与世界观/大纲等工作流共用同一 DeepSeek 实例）——正文生成开箱即用，
 * 部分配置也整体回落，避免半配置产生难排查的请求错误；配置齐三项则用
 * 独立写作模型。provider 实例在调用时才创建，本模块导入零副作用。
 */
export function getWritingModel(): LanguageModelV4 {
  const name = process.env.WRITING_MODEL_NAME;
  const apiKey = process.env.WRITING_MODEL_API_KEY;
  const baseURL = process.env.WRITING_MODEL_BASE_URL;
  if (!name || !apiKey || !baseURL) {
    return agentModel;
  }
  return createOpenAICompatible({
    name: "novel-writing",
    baseURL,
    apiKey,
  })(name);
}
