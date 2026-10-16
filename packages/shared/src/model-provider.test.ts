import { describe, expect, test } from "bun:test";
import {
  MODEL_PROVIDERS,
  MODEL_PROVIDER_BASE_URLS,
  inferModelProvider,
  isDeepSeekOfficialBaseUrl,
  modelProviderSchema,
  parseModelProvider,
  resolveAgentModelProvider,
  resolveWritingModelProvider,
} from "./model-provider";

describe("模型 provider 枚举", () => {
  test("三选：openai / deepseek / claude，顺序即下拉框展示顺序", () => {
    expect(MODEL_PROVIDERS).toEqual(["openai", "deepseek", "claude"]);
    expect(modelProviderSchema.options).toEqual([...MODEL_PROVIDERS]);
  });

  test("parseModelProvider 仅接受合法取值，其余（缺省 / 大小写 / 非字符串）归 null", () => {
    for (const provider of MODEL_PROVIDERS) {
      expect(parseModelProvider(provider)).toBe(provider);
    }
    // 前后空白忽略（.env 粘贴与手改 settings.json 的常见形态）
    expect(parseModelProvider(" claude ")).toBe("claude");
    expect(parseModelProvider("\tdeepseek\n")).toBe("deepseek");
    expect(parseModelProvider(undefined)).toBeNull();
    expect(parseModelProvider("")).toBeNull();
    expect(parseModelProvider("   ")).toBeNull();
    expect(parseModelProvider("OpenAI")).toBeNull();
    expect(parseModelProvider("deepseek-chat")).toBeNull();
    expect(parseModelProvider(123)).toBeNull();
  });

  test("每个 provider 都有官方默认地址（Base URL 留空时的兜底与弹窗提示）", () => {
    expect(MODEL_PROVIDER_BASE_URLS).toEqual({
      openai: "https://api.openai.com/v1",
      deepseek: "https://api.deepseek.com",
      claude: "https://api.anthropic.com/v1",
    });
  });
});

describe("DeepSeek 官方地址判定", () => {
  test("官方地址及其路径 / 尾斜杠 / 大小写写法均命中", () => {
    for (const url of [
      "https://api.deepseek.com",
      "https://api.deepseek.com/",
      "https://api.deepseek.com/v1",
      "https://api.deepseek.com/beta",
      " https://API.DeepSeek.com/v1/ ",
    ]) {
      expect(isDeepSeekOfficialBaseUrl(url)).toBe(true);
    }
  });

  test("相似域名、其他厂商与空地址不命中（不按域名猜测接口类型）", () => {
    for (const url of [
      "https://api.deepseek.com.cn/v1",
      "https://deepseek-proxy.example/v1",
      "https://api.openai.com/v1",
      "https://api.anthropic.com/v1",
      "",
      " ",
    ]) {
      expect(isDeepSeekOfficialBaseUrl(url)).toBe(false);
    }
  });
});

describe("历史配置迁移（无显式 provider 时按有效地址推断）", () => {
  test("DeepSeek 官方地址 → deepseek", () => {
    expect(inferModelProvider("https://api.deepseek.com")).toBe("deepseek");
    expect(inferModelProvider("https://api.deepseek.com/v1")).toBe("deepseek");
  });

  test("其余现有 OpenAI 兼容地址 → openai（自定义代理由用户明确选择）", () => {
    expect(inferModelProvider("https://api.example.com/v1")).toBe("openai");
    expect(inferModelProvider("https://api.openai.com/v1")).toBe("openai");
    expect(inferModelProvider("https://api.anthropic.com/v1")).toBe("openai");
  });
});

describe("生效 provider 解析（显式优先 + 按地址迁移）", () => {
  test("显式值优先于地址推断", () => {
    expect(resolveAgentModelProvider("claude", "https://api.deepseek.com")).toBe("claude");
    expect(resolveWritingModelProvider("deepseek", "https://api.example.com/v1")).toBe("deepseek");
  });

  test("Agent：地址留空沿用 DeepSeek 官方默认（全新配置与只填 Key 的历史配置）", () => {
    expect(resolveAgentModelProvider("", "")).toBe("deepseek");
    expect(resolveAgentModelProvider(undefined, " ")).toBe("deepseek");
    expect(resolveAgentModelProvider("", "https://api.deepseek.com/v1")).toBe("deepseek");
    expect(resolveAgentModelProvider("", "https://api.example.com/v1")).toBe("openai");
  });

  test("写作：地址留空 / 非 DeepSeek 官方地址落 OpenAI（独立写作默认）", () => {
    expect(resolveWritingModelProvider("", "")).toBe("openai");
    expect(resolveWritingModelProvider(undefined, "https://api.example.com/v1")).toBe("openai");
    expect(resolveWritingModelProvider("", "https://api.deepseek.com")).toBe("deepseek");
  });

  test("非法显式值不参与解析（按地址迁移，报错交调用方）", () => {
    expect(resolveAgentModelProvider("claud", "")).toBe("deepseek");
    expect(resolveWritingModelProvider("claud", "https://api.deepseek.com")).toBe("deepseek");
  });
});
