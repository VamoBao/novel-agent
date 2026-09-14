import { createDeepSeek } from "@ai-sdk/deepseek";

/**
 * DeepSeek provider 实例。
 *
 * API Key 从环境变量 `DEEPSEEK_API_KEY` 读取（Bun 启动时自动加载 `.env`），
 * 未设置时在真正发起请求才会报错，便于本地无 Key 场景下安全导入本模块。
 *
 * 用法：`deepseek("deepseek-v4-flash")` 或 `deepseek.chat("deepseek-v4-pro")`
 */
export const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY,
});
