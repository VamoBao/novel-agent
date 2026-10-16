import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { MODEL_PROVIDER_BASE_URLS, type ModelProvider } from "@novel/shared";

/**
 * 模型接入层：按所选 provider 调用对应官方 SDK，厂商差异（消息格式、工具、
 * 鉴权、结构化输出协议）由官方包收敛，业务侧只见统一的 LanguageModelV4。
 *
 * 结构化输出的差异正是本层的意义所在：DeepSeek 的 json_object 请求要求 prompt
 * 中出现 json 字样，通用兼容接口不会注入该指令（服务端直接 400），而
 * `@ai-sdk/deepseek` 会把「Return JSON that conforms to the following schema: …」
 * 注入 system 消息；Anthropic 走 Messages 协议（结构化输出经 output_config 或
 * 强制 json 工具），OpenAI 走 Chat Completions（json_schema 响应格式）。
 */

/** 一个模型连接的完整描述：接口类型 + 鉴权 + 模型名 + 地址（地址留空按 provider 取官方默认） */
export interface ModelConnection {
  provider: ModelProvider;
  apiKey: string;
  modelName: string;
  baseUrl: string;
}

/**
 * 创建官方 SDK 模型实例。`instanceName` 为 provider 实例名（OpenAI / Anthropic
 * 支持，用于错误信息与元数据区分 Agent 与写作模型实例；DeepSeek 官方包无该选项）。
 */
export function createProviderModel(connection: ModelConnection, instanceName: string): LanguageModelV4 {
  const baseURL = connection.baseUrl || MODEL_PROVIDER_BASE_URLS[connection.provider];
  switch (connection.provider) {
    // OpenAI 显式走 Chat Completions：provider 默认的 Responses API 不适用于自定义兼容地址
    case "openai":
      return createOpenAI({ name: instanceName, apiKey: connection.apiKey, baseURL }).chat(connection.modelName);
    case "deepseek":
      return createDeepSeek({ apiKey: connection.apiKey, baseURL })(connection.modelName);
    case "claude":
      return createAnthropic({ name: instanceName, apiKey: connection.apiKey, baseURL })(connection.modelName);
  }
}
