import { z } from "zod";

/**
 * 模型 provider（接口类型）契约：Agent 会话模型与独立写作模型各自**显式选择**
 * 接口类型，agent 侧据此调用对应官方 SDK（OpenAI Chat Completions / DeepSeek /
 * Anthropic Messages），而不是统一走通用兼容接口。
 *
 * 历史配置（没有 provider 字段的 settings.json 与环境变量）按**有效地址**迁移：
 * DeepSeek 官方地址使用 DeepSeek，其余现有 OpenAI 兼容地址使用 OpenAI。
 * 不按模型名或域名猜测接口类型——自定义代理由用户明确选择。
 */

export const MODEL_PROVIDERS = ["openai", "deepseek", "claude"] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];
export const modelProviderSchema = z.enum(MODEL_PROVIDERS);

/** 各 provider 的官方接口地址：Base URL 留空时的默认值，也是设置弹窗的提示值 */
export const MODEL_PROVIDER_BASE_URLS: Record<ModelProvider, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
  claude: "https://api.anthropic.com/v1",
};

/** 取值合法时返回 provider，否则 null（缺省 / 手改非法值——调用方决定回落还是报错）；字符串前后空白忽略 */
export function parseModelProvider(value: unknown): ModelProvider | null {
  const parsed = modelProviderSchema.safeParse(typeof value === "string" ? value.trim() : value);
  return parsed.success ? parsed.data : null;
}

/** DeepSeek 官方地址判定（仅识别 `https://` 裸域名形态；忽略大小写与尾斜杠，兼容 /v1、/beta 等路径后缀） */
export function isDeepSeekOfficialBaseUrl(baseUrl: string): boolean {
  const normalized = baseUrl.trim().toLowerCase().replace(/\/+$/, "");
  return normalized === "https://api.deepseek.com" || normalized.startsWith("https://api.deepseek.com/");
}

/** 历史配置迁移：无显式 provider 时按有效地址推断（DeepSeek 官方地址 → deepseek，其余 → openai） */
export function inferModelProvider(baseUrl: string): ModelProvider {
  return isDeepSeekOfficialBaseUrl(baseUrl) ? "deepseek" : "openai";
}

/**
 * Agent 模型的生效 provider：显式值优先，缺省按有效地址迁移——地址留空沿用原
 * Agent 的 DeepSeek 官方默认地址，故全新配置与「只填了 Key」的历史配置都落 DeepSeek
 * （保留既有开箱体验）。设置弹窗展示初始选项时用同一规则，保证所见即所用。
 */
export function resolveAgentModelProvider(provider: unknown, baseUrl: string): ModelProvider {
  return parseModelProvider(provider) ?? inferModelProvider(baseUrl.trim() || MODEL_PROVIDER_BASE_URLS.deepseek);
}

/**
 * 写作模型的生效 provider：显式值优先，缺省按有效地址迁移——地址留空 / 非
 * DeepSeek 官方地址落 OpenAI（独立写作默认 OpenAI）。
 */
export function resolveWritingModelProvider(provider: unknown, baseUrl: string): ModelProvider {
  return parseModelProvider(provider) ?? inferModelProvider(baseUrl);
}
