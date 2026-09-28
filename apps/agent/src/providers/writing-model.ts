import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV4 } from "@ai-sdk/provider";

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
 * provider 实例在 `getWritingModel()` 调用时才创建：三项均未配置时本模块
 * 仍可安全导入（不影响既有 Agent 流程），取用时才抛可读错误指明缺哪些变量。
 */
export function getWritingModel(): LanguageModelV4 {
  const name = process.env.WRITING_MODEL_NAME;
  const apiKey = process.env.WRITING_MODEL_API_KEY;
  const baseURL = process.env.WRITING_MODEL_BASE_URL;
  if (!name || !apiKey || !baseURL) {
    const missing = [
      !name && "WRITING_MODEL_NAME",
      !apiKey && "WRITING_MODEL_API_KEY",
      !baseURL && "WRITING_MODEL_BASE_URL",
    ]
      .filter(Boolean)
      .join("、");
    throw new Error(
      `写作模型未配置：缺少环境变量 ${missing}（请在 .env 中设置，参考 .env.example）`,
    );
  }
  return createOpenAICompatible({
    name: "novel-writing",
    baseURL,
    apiKey,
  })(name);
}
