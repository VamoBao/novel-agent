import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getWritingModel,
  isWritingModelConfigured,
  resolveWritingModelConfig,
} from "./writing-model";
import { model as agentModel } from "./agent-model";

const ENV_KEYS = [
  "WRITING_MODEL_NAME",
  "WRITING_MODEL_API_KEY",
  "WRITING_MODEL_BASE_URL",
  "WRITING_MODEL_PROVIDER",
  "DEEPSEEK_MODEL_NAME",
] as const;

/** 三项齐（连接可用）的基线配置：provider 由各用例覆盖 */
function configureWritingModel(): void {
  process.env.WRITING_MODEL_NAME = "test-writing-model";
  process.env.WRITING_MODEL_API_KEY = "sk-test";
  process.env.WRITING_MODEL_BASE_URL = "https://api.example.com/v1";
}

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("isWritingModelConfigured", () => {
  test("三项齐为 true；任一缺失或空串为 false", () => {
    expect(isWritingModelConfigured()).toBe(false);
    process.env.WRITING_MODEL_NAME = "test-writing-model";
    expect(isWritingModelConfigured()).toBe(false);
    process.env.WRITING_MODEL_API_KEY = "sk-test";
    expect(isWritingModelConfigured()).toBe(false);
    process.env.WRITING_MODEL_BASE_URL = "";
    expect(isWritingModelConfigured()).toBe(false);
    process.env.WRITING_MODEL_BASE_URL = "https://api.example.com/v1";
    expect(isWritingModelConfigured()).toBe(true);
  });
});

describe("getWritingModel", () => {
  test("未配置（含空串）回落 Agent 会话模型——与 agent-model.ts 的 model 同一实例", () => {
    const model = getWritingModel();
    expect(model).toBe(agentModel);
    expect(model.specificationVersion).toBe("v4");
    // 空串同样视为未配置回落
    process.env.WRITING_MODEL_NAME = "";
    process.env.WRITING_MODEL_API_KEY = "sk-test";
    process.env.WRITING_MODEL_BASE_URL = "https://api.example.com/v1";
    expect(getWritingModel()).toBe(agentModel);
  });

  test("部分缺失同样整体回落（避免半配置产生难排查的请求错误）", () => {
    process.env.WRITING_MODEL_NAME = "test-writing-model";
    process.env.WRITING_MODEL_API_KEY = "";
    expect(getWritingModel()).toBe(agentModel);
  });

  test("三项配置齐全时返回 LanguageModelV4 实例（v4 规格、模型名透传、生成入口可用）", () => {
    configureWritingModel();
    const model = getWritingModel();
    expect(model).not.toBe(agentModel);
    expect(model.specificationVersion).toBe("v4");
    expect(model.modelId).toBe("test-writing-model");
    expect(typeof model.doGenerate).toBe("function");
    expect(typeof model.doStream).toBe("function");
  });

  test("可重复调用，每次返回可用实例（无模块级缓存副作用）", () => {
    configureWritingModel();
    expect(getWritingModel().modelId).toBe("test-writing-model");
    expect(getWritingModel().modelId).toBe("test-writing-model");
  });

  test("按所选 provider 创建对应 SDK 实例——写作模型与 Agent 模型可分别选择", () => {
    configureWritingModel();
    process.env.WRITING_MODEL_PROVIDER = "claude";
    expect(getWritingModel().provider).toBe("novel-writing");

    process.env.WRITING_MODEL_PROVIDER = "openai";
    expect(getWritingModel().provider).toBe("novel-writing.chat");

    process.env.WRITING_MODEL_PROVIDER = "deepseek";
    process.env.WRITING_MODEL_BASE_URL = "https://api.deepseek.com";
    expect(getWritingModel().provider).toBe("deepseek.chat");
  });
});

describe("resolveWritingModelConfig", () => {
  test("三变量任一缺失（含空串）返回 null——调用方整体回落 Agent 模型", () => {
    expect(resolveWritingModelConfig({})).toBeNull();
    expect(resolveWritingModelConfig({
      WRITING_MODEL_NAME: " ", WRITING_MODEL_API_KEY: "sk", WRITING_MODEL_BASE_URL: "https://api.example.com/v1",
    })).toBeNull();
    expect(resolveWritingModelConfig({
      WRITING_MODEL_NAME: "m", WRITING_MODEL_API_KEY: "", WRITING_MODEL_BASE_URL: "https://api.example.com/v1",
    })).toBeNull();
  });

  test("provider 留空按有效地址迁移：DeepSeek 官方地址 → deepseek，其余（含默认）→ openai", () => {
    const base = { WRITING_MODEL_NAME: "m", WRITING_MODEL_API_KEY: "sk" };
    expect(resolveWritingModelConfig({ ...base, WRITING_MODEL_BASE_URL: "https://api.deepseek.com/v1" }))
      .toEqual({ provider: "deepseek", apiKey: "sk", modelName: "m", baseUrl: "https://api.deepseek.com/v1" });
    expect(resolveWritingModelConfig({ ...base, WRITING_MODEL_BASE_URL: "https://api.example.com/v1" })?.provider)
      .toBe("openai");
    expect(resolveWritingModelConfig({ ...base, WRITING_MODEL_BASE_URL: "https://api.anthropic.com/v1" })?.provider)
      .toBe("openai");
  });

  test("显式 provider 优先（自定义 DeepSeek 代理由用户明确选择）", () => {
    expect(resolveWritingModelConfig({
      WRITING_MODEL_NAME: "m", WRITING_MODEL_API_KEY: "sk",
      WRITING_MODEL_BASE_URL: "https://deepseek-proxy.example/v1", WRITING_MODEL_PROVIDER: "deepseek",
    })).toEqual({
      provider: "deepseek", apiKey: "sk", modelName: "m", baseUrl: "https://deepseek-proxy.example/v1",
    });
  });

  test("非法 provider 值抛可读错误（不静默换协议）", () => {
    expect(() => resolveWritingModelConfig({ WRITING_MODEL_PROVIDER: "claud" }))
      .toThrow("WRITING_MODEL_PROVIDER 配置无效：claud（可选值：openai / deepseek / claude）");
    configureWritingModel();
    process.env.WRITING_MODEL_PROVIDER = "Claude";
    expect(() => getWritingModel()).toThrow("WRITING_MODEL_PROVIDER 配置无效：Claude");
  });
});
