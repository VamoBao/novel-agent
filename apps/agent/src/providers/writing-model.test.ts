import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getWritingModel, isWritingModelConfigured } from "./writing-model";
import { model as agentModel } from "./deepseek";

const ENV_KEYS = [
  "WRITING_MODEL_NAME",
  "WRITING_MODEL_API_KEY",
  "WRITING_MODEL_BASE_URL",
  "DEEPSEEK_MODEL_NAME",
] as const;

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
  test("未配置（含空串）回落 Agent 会话模型——与 deepseek.ts 的 model 同一实例", () => {
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
    process.env.WRITING_MODEL_NAME = "test-writing-model";
    process.env.WRITING_MODEL_API_KEY = "sk-test";
    process.env.WRITING_MODEL_BASE_URL = "https://api.example.com/v1";
    const model = getWritingModel();
    expect(model).not.toBe(agentModel);
    expect(model.specificationVersion).toBe("v4");
    expect(model.modelId).toBe("test-writing-model");
    expect(typeof model.doGenerate).toBe("function");
    expect(typeof model.doStream).toBe("function");
  });

  test("可重复调用，每次返回可用实例（无模块级缓存副作用）", () => {
    process.env.WRITING_MODEL_NAME = "test-writing-model";
    process.env.WRITING_MODEL_API_KEY = "sk-test";
    process.env.WRITING_MODEL_BASE_URL = "https://api.example.com/v1";
    expect(getWritingModel().modelId).toBe("test-writing-model");
    expect(getWritingModel().modelId).toBe("test-writing-model");
  });
});
